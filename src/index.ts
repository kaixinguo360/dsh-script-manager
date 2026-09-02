/**
 * DSH Script Manager Plugin
 * 自定义操作脚本管理插件
 */

import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { ScriptStore } from './script-store.js';
import { ScriptRunner } from './script-runner.js';
import { registerScriptCommand, registerCreateScriptCommand } from './script-command.js';
import { registerScriptTools } from './script-tools.js';
import { registerScriptRoutes } from './web/routes.js';
import { ScriptToolRegistry } from './script-tool-registry.js';

export const name = 'dsh-script-manager';
export const inject = ['tools', 'commands', 'codeRuntime', 'systemPrompt'];

export const Config = Schema.object({
  scriptsDir: Schema.string().default('~/.dsh/scripts').description('脚本存储目录'),
  maxExecutionTime: Schema.number().default(0).description('默认脚本执行超时（毫秒）；0 = 不限制（脚本级 timeoutMs / 调用级 script_run timeoutMs 可覆盖）'),
});

export type Config = typeof Config.infer;

/** 注入系统提示：让 agent 常态化知道 script_* 工具的存在与适用时机。 */
const SCRIPT_TOOLS_GUIDANCE = [
  'Custom script tooling is available in this environment (dsh-script-manager). ',
  'You can inspect and manage reusable operation scripts, then call them instead of repeating manual steps:',
  '- script_list / script_get: inspect registered scripts (id, name, description).',
  '- script_create: define a new script (async TypeScript body; tools.* such as tools.read / tools.bash are available inside).',
  '- script_update / script_delete: maintain existing scripts.',
  '- script_run: execute a script by its id (its result is returned; formatScriptResult output also appears in the conversation).',
  'Prefer creating a script when the same multi-step operation recurs or would otherwise be tedious to repeat.',
  '',
  'PTC (programmatic tool call) scripts: each script is a standalone, self-contained execution unit — an async TypeScript body that runs with the code runtime, has tools.* bindings (tools.read, tools.bash, ...) available inside, executes without a model roundtrip, and should return a lossless-JSON value (plus console.log for logs). Scripts live under ~/.dsh/scripts, are managed via the script_* tools, can be registered as direct agent tools (registerAsTool + toolName), and are run via script_run or /script <id>. Write scripts that are self-contained and reusable (resolve inputs inside the script), keep them generic, and always verify with script_run after creating or updating.',
  '',
  'When the user asks to distill/summarize an operation or workflow into a reusable script (e.g. "把…总结为脚本", "固化为可复用脚本"), follow this flow:',
  '1. First script_search / script_list to check whether a similar script already exists — do not duplicate.',
  '2. Compose the script with script_create: choose a clear id (lowercase-hyphen), name, and description; write a self-contained async TypeScript body using tools.* bindings that reproduces the steps, and return a useful value.',
  '3. If the script is meant to be invoked directly as a tool during this task, set registerAsTool: true with a toolName. Otherwise keep it runnable via script_run / /script <id>.',
  '4. After creation, verify it with script_run (or /script <id>) and tell the user how to invoke it (script_run, /script <id>, or the dynamic tool name).',
  '5. Keep the script generic and parameter-light unless the user asks for specific inputs; prefer editing later via script_update.',
].join('');

export function apply(ctx: Context, config: Partial<Config> = {}): void {
  // 引导 agent 使用 script_* 工具（在系统提示中常驻）
  try {
    (ctx as any).systemPrompt?.section?.({ name: 'dsh-script-manager', order: 210, text: SCRIPT_TOOLS_GUIDANCE });
  } catch (error) {
    console.error('[' + name + '] failed to register system prompt section:', error);
  }

  const resolved = {
    scriptsDir: config.scriptsDir ?? '~/.dsh/scripts',
    maxExecutionTime: config.maxExecutionTime ?? 0,
  };

  const store = new ScriptStore(resolved.scriptsDir);
  const runner = new ScriptRunner(store, ctx, { defaultTimeoutMs: resolved.maxExecutionTime });
  const toolRegistry = new ScriptToolRegistry(ctx, store, runner);

  // 注册/卸载动态工具（按 registerAsTool/toolName）；写操作后同步
  const syncDynamicTools = async () => {
    try { await toolRegistry.sync(); } catch (error) {
      console.error('[' + name + '] failed to sync dynamic tools:', error);
    }
  };

  store.init()
    .then(syncDynamicTools)
    .catch(err => {
      console.error("[" + name + "] Failed to initialize script store:", err);
    });

  const unregisterCommand = registerScriptCommand(ctx, store, runner);
  const unregisterCreateCommand = registerCreateScriptCommand(ctx);
  const unregisterTools = registerScriptTools(ctx, store, runner, syncDynamicTools);

  // Register HTTP API routes for the client management UI
  ctx.inject(['webServer'], (injected: any) => {
    return registerScriptRoutes(injected, store, syncDynamicTools);
  });

  ctx.effect(() => {
    return () => {
      unregisterCommand();
      unregisterCreateCommand();
      unregisterTools();
      toolRegistry.dispose();
    };
  });
}