/**
 * DSH Script Manager Plugin - Script Command
 * /script slash command
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
    handler: (invocation: any) => Promise<{ kind: string; text?: string }>;
  }): () => void;
}

function parseScriptName(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const spaceIndex = trimmed.indexOf(" ");
  return spaceIndex === -1 ? trimmed : trimmed.substring(0, spaceIndex);
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
          return { kind: "error", text: "No scripts available. Use script_manage to create." };
        }
        const list = scripts.map((s: any) => "  " + s.id + " - " + s.description).join("\n");
        return { kind: "error", text: "Usage: /script <script-name>\n\nAvailable scripts:\n" + list };
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
