/**
 * DSH Script Manager Plugin - Script Commands
 * /script（执行脚本）与 /create_script（按指令创建脚本）斜杠命令。
 */

import type { Context } from '@deepseek-ai/cordis';
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm';
import type { ToolExecutionToken } from '@deepseek-ai/dsh-tools';
import type { ScriptStore } from './script-store.js';
import type { ScriptRunner } from './script-runner.js';
import { executeToolCallWithEvents } from './script-tool-events.js';

interface CommandsService {
  register(definition: {
    name: string;
    description: string;
    input?: { hint?: string; images?: boolean };
    handler: (invocation: any) => Promise<{ kind: string; text?: string }>;
  }): () => void;
}

function parseScriptName(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const spaceIndex = trimmed.indexOf(" ");
  return spaceIndex === -1 ? trimmed : trimmed.substring(0, spaceIndex);
}

/**
 * /create_script 命令：把任务指令注入会话并唤醒 agent，
 * 由模型按环境规范用 script_create 工具创建新脚本。
 *
 * bare 调用（无指令）不立即处理、不唤醒 agent、无副作用：
 * 仅温和提示，等待用户补充完整指令后再次执行（参考 /plan 的轻量行为）。
 */
export function registerCreateScriptCommand(
  ctx: Context,
): () => void {
  const commands = ctx.get('commands') as CommandsService | undefined;
  if (!commands || typeof commands.register !== "function") {
    return () => {};
  }

  return commands.register({
    name: 'create_script',
    description: 'Create a new reusable script from a task instruction. Usage: /create_script <task description>',
    // 与 /plan 对齐：输入槽位带提示 hint
    input: { hint: '[task instruction]', images: false },
    async handler(invocation: any) {
      const instruction = (invocation.rawInput ?? '').trim();
      // bare /create_script：不立即处理，仅提示引导，等待用户补充任务指令
      // bare /create_script：与 /plan bare 一致 —— 不产生任何模型交互，
      // 仅返回成功提示，等待用户补充任务指令后再次执行
      if (!instruction) {
        return { kind: "success", text: "create_script 已就绪：请补充任务指令（/create_script <任务指令>）后执行。" };
      }
      const agent = invocation.agent;
      if (agent && typeof agent.whenIdle === 'function') {
        await agent.whenIdle();
      }
      if (!agent || typeof agent.steer !== 'function') {
        return { kind: "error", text: "No agent context available to create a script." };
      }
      // 与 /plan 一致：用 agent.steer()（next-step 唤醒）注入指令而非 followup
      agent.steer(createUserMessage({
        content: [{
          type: "text",
          text: '请根据以下任务指令，使用 script_create 工具创建一个 PTC 脚本（按你环境中脚本工具的规范流程：先查重，再创建，验证，然后告知用户如何调用）。\n\n' +
            'PTC（programmatic tool call）脚本规格：独立可执行单元——代码体是一个 async TypeScript 函数体，内部可用 tools.* 绑定（tools.read / tools.bash 等），执行不经过模型回合，应返回 lossless-JSON 值（console.log 记录日志）；脚本保存在 ~/.dsh/scripts；可设 registerAsTool+toolName 注册为 agent 直接调用的工具；通过 script_run / /script <id> 执行。请让脚本自包含（在脚本内解析所需输入）、通用可复用，创建后务必用 script_run 验证。\n\n' +
            '任务指令：\n' + instruction,
        }],
        source: { kind: "user" },
      }));
      return { kind: "success", text: "已提交脚本创建任务，模型将按照指令创建脚本。" };
    },
  });
}

export function registerScriptCommand(
  ctx: Context,
  store: ScriptStore,
  runner: ScriptRunner,
): () => void {
  const commands = ctx.get('commands') as CommandsService | undefined;
  if (!commands || typeof commands.register !== "function") {
    return () => {};
  }

  return commands.register({
    name: 'script',
    description: 'Execute custom script. Usage: /script <script-name>',
    async handler(invocation: any) {
      const scriptName = parseScriptName(invocation.rawInput);

      if (!scriptName) {
        const scripts = await store.list();
        if (scripts.length === 0) {
          return { kind: "error", text: "No scripts available. Use script_create to add one." };
        }
        const lines = scripts.map((s: any) => "  " + s.id + " - " + s.description);
        lines.unshift("Usage: /script <script-name>\n\nAvailable scripts:");
        return { kind: "error", text: lines.join("\n") };
      }

      const script = await store.get(scriptName);
      if (!script) {
        return { kind: "error", text: "Script not found: " + scriptName };
      }

      const agent = invocation.agent;
      if (agent && typeof agent.whenIdle === 'function') {
        await agent.whenIdle();
      }
      const parentToken: ToolExecutionToken = Symbol('dsh.tool.execution') as ToolExecutionToken;

      let toolResult;
      if (agent && agent.session) {
        // 模拟一次完整的 agent 工具调用回合（写入 turn/start → step/start →
        // assistant/message → tool/call → tool/result → step/end → turn/end），
        // 与会话中 agent 直接调用 script_run 的事件序列一致。
        toolResult = await executeToolCallWithEvents(
          ctx,
          agent,
          'script_run',
          { scriptId: scriptName },
          invocation.signal,
          parentToken,
        );
      } else {
        // 回退：无 agent/session 上下文时直接执行（不写事件）
        toolResult = await ctx.tools.execute({
          callId: CallId('script-cmd-' + Date.now()),
          name: 'script_run',
          arguments: { scriptId: scriptName },
          agent,
          parent: parentToken,
          signal: invocation.signal,
        });
      }

      if (toolResult.isError) {
        return { kind: "error", text: "Script failed: " + script.name + "\n" + toolResult.error.message };
      }

      const runResult = toolResult.value as Record<string, unknown>;

      // 唤醒 agent 继续回复：以一条极简 user 消息触发下一回合（DSH 的 agent
      // 空唤醒会直接完成回合不调用模型，唤醒必须携带消息）。内容仅为执行
      // 提示，不含 formatScriptResult 全文——完整结果已通过 tool/result 事件
      // 注入会话，模型在 deriveMessages 中自然读到，避免重复注入。
      if (agent && typeof agent.followup === 'function') {
        agent.followup(createUserMessage({
          content: [{
            type: "text",
            text: '脚本 ' + script.name + ' 已执行完成，结果见上方工具调用记录。',
          }],
          source: { kind: "user" },
        }));
      }

      return {
        kind: runResult.success ? "success" : "error",
        text: runResult.success ? "Script executed: " + script.name : "Script failed: " + script.name,
      };
    },
  });
}
