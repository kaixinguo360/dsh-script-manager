/**
 * DSH Script Manager Plugin
 * 自定义操作脚本管理插件
 */

import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { ScriptStore } from './script-store.js';
import { ScriptRunner } from './script-runner.js';
import { registerScriptCommand } from './script-command.js';
import { registerScriptTools } from './script-tools.js';
import { registerScriptRoutes } from './web/routes.js';
import { ScriptToolRegistry } from './script-tool-registry.js';

export const name = 'dsh-script-manager';
export const inject = ['tools', 'commands', 'codeRuntime'];

export const Config = Schema.object({
  scriptsDir: Schema.string().default('~/.dsh/scripts').description('脚本存储目录'),
  maxExecutionTime: Schema.number().default(30000).description('脚本最大执行时间（毫秒）'),
});

export type Config = typeof Config.infer;

export function apply(ctx: Context, config: Partial<Config> = {}): void {
  const resolved = {
    scriptsDir: config.scriptsDir ?? '~/.dsh/scripts',
    maxExecutionTime: config.maxExecutionTime ?? 30000,
  };

  const store = new ScriptStore(resolved.scriptsDir);
  const runner = new ScriptRunner(store, ctx);
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
  const unregisterTools = registerScriptTools(ctx, store, runner, syncDynamicTools);

  // Register HTTP API routes for the client management UI
  ctx.inject(['webServer'], (injected: any) => {
    return registerScriptRoutes(injected, store, syncDynamicTools);
  });

  ctx.effect(() => {
    return () => {
      unregisterCommand();
      unregisterTools();
      toolRegistry.dispose();
    };
  });
}