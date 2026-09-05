/**
 * DSH Script Manager Plugin - Script Commands
 * /script（执行脚本）与 /create_script（按指令创建脚本）斜杠命令。
 */

import type { Context } from '@deepseek-ai/cordis';
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm';
import type { ToolExecutionResult, ToolExecutionToken } from '@deepseek-ai/dsh-tools';
import { formatScriptResult } from './format-script-result.js';
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

/** 拆分 /script 输入:首个空格前为脚本名,其后为可选 JSON 参数文本。 */
function splitScriptInvocation(input: string): { name: string | null; argsText: string } {
  const trimmed = input.trim();
  if (!trimmed) return { name: null, argsText: "" };
  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) return { name: trimmed, argsText: "" };
  return { name: trimmed.substring(0, spaceIndex), argsText: trimmed.substring(spaceIndex + 1).trim() };
}

/** 解析可选的 JSON 参数文本;非法返回错误消息。 */
function parseJsonArgs(argsText: string): { params?: Record<string, unknown>; error?: string } {
  if (!argsText) return {};
  try {
    const parsed = JSON.parse(argsText);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { error: "Script arguments must be a JSON object, e.g. /script <id> {\"key\":\"value\"}" };
    }
    return { params: parsed as Record<string, unknown> };
  } catch {
    return { error: "Script arguments are not valid JSON. Use /script <script-id> {\"param\":\"value\"} or pick the script in the candidate list to fill parameters." };
  }
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
        return { kind: "success", text: "create_script ready - append a task instruction: /create_script <task description>" };
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
          text: 'Please create a PTC script using the script_create tool per the instruction below (follow the env guidance: dedupe first, create, verify, then tell the user how to invoke it).\n\n' +
            'PTC (programmatic tool call) spec: a standalone execution unit — an async TypeScript body that runs with the code runtime, has tools.* bindings (tools.read / tools.bash ...) available inside, executes without a model roundtrip, and returns a lossless-JSON value (console.log for logs). Scripts live under ~/.dsh/scripts; can be registered as direct agent tools (registerAsTool + toolName); invoked via script_run or /script <id>. Keep the script self-contained (resolve inputs inside) and generic; always verify with script_run after creating.\n\n' +
            'When the operation result needs verifying, also set the execution contract fields on the script: expectedOutcome (intended result once finished), successCriteria (how to verify it - artifacts/exit codes/output patterns/return fields), failureGuidance (how to intervene when not as expected or failed - adjust inputs/manual steps/script_update then rerun). They are surfaced with the run result so the post-run agent can check the intended behavior and decide whether to intervene.\n\n' +
            'When the operation takes inputs, declare a parameters array on the script: each entry { name (identifier, read as params.<name> in the script), type (string/number/boolean, default string), label?, description?, required, default }. Rule: required parameters must NOT declare a default and must be provided at run time; optional parameters MUST declare a default matching type. Callers then run with script_run({ scriptId, params: {...} }), and the effective params (defaults merged) are surfaced in the run result. Optional parameters with defaults let the /script candidate list run directly.\n\n' +
            'Task instruction:\n' + instruction,
        }],
        // 来源标记为插件（系统侧说明），而非用户消息：
        // 目的仅是向 agent 说明情况，绝不伪装成用户发言
        source: { kind: "plugin", plugin: "dsh-script-manager" },
      }));
      return { kind: "success", text: "Create-script task submitted; the model will create the script per the instruction." };
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
    description: 'Execute custom script. Usage: /script <script-name> [{\"param\":\"value\"}]',
    async handler(invocation: any) {
      const { name: scriptName, argsText } = splitScriptInvocation(invocation.rawInput);

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

      // 可选 JSON 参数文本 → params(透传给 script_run 与 runner)
      const jsonArgs = parseJsonArgs(argsText);
      if (jsonArgs.error) {
        return { kind: "error", text: jsonArgs.error };
      }
      const runArgs: Record<string, unknown> = { scriptId: scriptName };
      if (jsonArgs.params) runArgs.params = jsonArgs.params;

      const agent = invocation.agent;
      if (agent && typeof agent.whenIdle === 'function') {
        await agent.whenIdle();
      }
      const parentToken: ToolExecutionToken = Symbol('dsh.tool.execution') as ToolExecutionToken;

      let toolResult;
      if (agent && agent.session) {
        // 写入标准会话事件序列（turn/start → tool/call → tool/result → turn/end），
        // 但绕过 script_run 工具管道，直接调用 runner.run() 并传入真实来源标记，
        // 使执行历史 caller 字段正确区分入口。
        toolResult = await executeToolCallWithEvents(
          ctx,
          agent,
          'script_run',
          runArgs,
          invocation.signal,
          parentToken,
          // 自定义执行器：直调 runner.run，传入 runSource='/script'
          async (_callId: string): Promise<ToolExecutionResult> => {
            const runResult = await runner.run(
              scriptName,
              invocation.signal,
              agent,
              parentToken,
              jsonArgs.timeoutMs,
              { callId: _callId, rootCallId: _callId },
              jsonArgs.params,
              '/script',
            );
            return {
              isError: false,
              content: [{ type: 'text', text: formatScriptResult(runResult) }],
              value: runResult,
            } as unknown as ToolExecutionResult;
          },
        );
      } else {
        // 回退：无 agent/session 上下文时直接执行（不写事件）
        toolResult = await ctx.tools.execute({
          callId: CallId('script-cmd-' + Date.now()),
          name: 'script_run',
          arguments: runArgs,
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
        // 来源标记为插件（系统侧说明），而非用户消息：仅向 agent 说明情况
        agent.followup(createUserMessage({
          content: [{
            type: "text",
            text: 'Script ' + script.name + ' executed (triggered by your /script command); see the tool call above.',
          }],
          source: { kind: "plugin", plugin: "dsh-script-manager" },
        }));
      }

      return {
        kind: runResult.success ? "success" : "error",
        text: runResult.success ? "Script executed: " + script.name : "Script failed: " + script.name,
      };
    },
  });
}
