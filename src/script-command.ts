/**
 * DSH Script Manager Plugin - Script Commands
 * /script（执行脚本）与 /create_script（按指令创建脚本）斜杠命令。
 */

import type { Context } from '@deepseek-ai/cordis';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { CommandDefinition } from '@deepseek-ai/dsh-commands';
import type { ScriptStore } from './script-store.js';
import type { ScriptTransport } from './script-transport.js';
import { SCRIPT_MANAGER_SOURCE } from './message-source.js';

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
      return { error: 'Script arguments must be a JSON object, e.g. /script <id> {"key":"value"}' };
    }
    return { params: parsed as Record<string, unknown> };
  } catch {
    return { error: 'Script arguments are not valid JSON. Use /script <script-id> {"param":"value"} or pick the script in the candidate list to fill parameters.' };
  }
}

/**
 * /create_script 命令：把任务指令注入会话并唤醒 agent，
 * 由 agent 按环境规范用 script_create 工具创建新脚本。
 */
export function registerCreateScriptCommand(ctx: Context): () => void {
  const commands = ctx.get('commands');
  if (commands === undefined) return () => {};

  return commands.register({
    name: 'create_script',
    description: 'Create a new reusable script from a task instruction. Usage: /create_script <task description>',
    input: { hint: '[task instruction]' },
    async handler(invocation) {
      const instruction = (invocation.rawInput ?? '').trim();
      if (!instruction) {
        return { kind: "success", text: "create_script ready - append a task instruction: /create_script <task description>" };
      }
      const agent = invocation.agent;
      await agent.whenIdle();
      agent.steer(createUserMessage({
        content: [{
          type: "text",
          text: 'Please create a PTC script using the script_create tool per the instruction below (follow the env guidance: dedupe first, create, verify, then tell the user how to invoke it).\n\n' +
            'PTC (programmatic tool call) spec: a standalone execution unit — an async TypeScript body that runs on the PTC runtime, has tools.* bindings (tools.read / tools.bash ...) available inside, executes without a roundtrip, and returns a lossless-JSON value (console.log for logs). Scripts live under ~/.dsh/scripts; can be registered as direct agent tools (registerAsTool + toolName); invoked via script_run or /script <id>. Keep the script self-contained (resolve inputs inside) and generic; always verify with script_run after creating.\n\n' +
            'When the operation result needs verifying, also set the execution contract fields on the script: expectedOutcome (intended result once finished), successCriteria (how to verify it), failureGuidance (how to intervene when not as expected). They are surfaced with the run result so the agent can check the intended behavior.\n\n' +
            'When the operation takes inputs, declare a parameters array on the script: each entry { name, type (string/number/boolean), label?, description?, required, default }. Required parameters must not declare a default; optional parameters must declare a default matching type.\n\n' +
            'Task instruction:\n' + instruction,
        }],
        source: SCRIPT_MANAGER_SOURCE,
      }));
      return { kind: "success", text: "Create-script task submitted; the agent will create the script per the instruction." };
    },
  } satisfies CommandDefinition);
}

/**
 * /script 命令：把用户触发的脚本执行投递到框架原生的工具回合。
 *
 * 处理函数本身不执行脚本 —— 它只登记一次待派发意图并唤醒 agent，随后的工具调用、
 * 执行与结果投递全部由 dsh-agent-loop 按真实执行身份完成（见 script-transport）。
 * 这样脚本内层 tools.* 才能拿到真实的父令牌并写入嵌套分发事件，/script 与
 * script_run 两条入口在会话里留下完全同构的记录。
 */
export function registerScriptCommand(
  ctx: Context,
  store: ScriptStore,
  transport: ScriptTransport,
): () => void {
  const commands = ctx.get('commands');
  if (commands === undefined) return () => {};

  return commands.register({
    name: 'script',
    description: 'Execute custom script. Usage: /script <script-name> [{"param":"value"}]',
    async handler(invocation) {
      const { name: scriptName, argsText } = splitScriptInvocation(invocation.rawInput);

      if (!scriptName) {
        const scripts = await store.list();
        if (scripts.length === 0) {
          return { kind: "error", text: "No scripts available. Use script_create to add one." };
        }
        const lines = scripts.map((s) => "  " + s.id + " - " + s.description);
        lines.unshift("Usage: /script <script-name>\n\nAvailable scripts:");
        return { kind: "error", text: lines.join("\n") };
      }

      const script = await store.get(scriptName);
      if (!script) {
        return { kind: "error", text: "Script not found: " + scriptName };
      }

      const jsonArgs = parseJsonArgs(argsText);
      if (jsonArgs.error) {
        return { kind: "error", text: jsonArgs.error };
      }

      // 等到真正空闲再登记：运行中的回合会在它自己的下一步请求上消费掉这次登记，
      // 从而把脚本派发错挂到别人的回合里。
      const agent = invocation.agent;
      await agent.whenIdle();

      if (!transport.arm(agent, scriptName, jsonArgs.params)) {
        return {
          kind: "error",
          text: 'Cannot dispatch script "' + scriptName + '": this agent\'s tool surface exposes neither the PTC run_code transport nor script_run.',
        };
      }
      // 此后的 followup 保证该会话随即产生一次模型请求并消费掉登记；若那次回合没有发生
      // （agent 被销毁等），登记由 TTL 自行作废，因此这里不再挂命令信号的 abort 监听 ——
      // UI 请求在处理器返回后结束也会 abort，那会把尚未消费的登记误撤。
      agent.followup(createUserMessage({
        content: [{
          type: "text",
          text: 'Script "' + script.name + '" was invoked through the /script command. Its execution is dispatched as the tool call below; when the result arrives, review it against the script\'s declared expectations and report anything that needs attention.',
        }],
        source: { ...SCRIPT_MANAGER_SOURCE, form: 'notice', summary: 'Script dispatched: ' + script.name },
      }));

      return { kind: "success", text: 'Script "' + script.name + '" dispatched; its result will appear in this conversation.' };
    },
  } satisfies CommandDefinition);
}
