/**
 * DSH Script Manager Plugin - Script Tools
 */

import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { ScriptStore } from './script-store.js';
import type { ScriptRunner } from './script-runner.js';
import type { ScriptManageArgs } from './types.js';
import { formatScriptResult } from './format-script-result.js';

async function manageScripts(store: ScriptStore, args: ScriptManageArgs): Promise<unknown> {
  switch (args.action) {
    case "list": return store.list({ tags: args.tags, limit: args.limit });
    case "get": if (!args.scriptId) throw new Error("scriptId required"); return store.get(args.scriptId);
    case "create": if (!args.script) throw new Error("script required"); return store.create(args.script as any);
    case "update": if (!args.scriptId) throw new Error("scriptId required"); return store.update(args.scriptId, args.script || {});
    case "delete": if (!args.scriptId) throw new Error("scriptId required"); return store.delete(args.scriptId);
    case "search": return store.search(args.query || "", { tags: args.tags });
    default: throw new Error("Unknown action: " + args.action);
  }
}

export function registerScriptTools(ctx: Context, store: ScriptStore, runner: ScriptRunner): () => void {
  const disposers: (() => void)[] = [];

  disposers.push(ctx.tools.register(defineTool({
    name: 'script_manage',
    description: 'Manage custom scripts. Supports create, update, delete, get, list, search.',
    parameters: {
      action: { type: "string", required: true, enum: ["create", "update", "delete", "get", "list", "search"] },
      scriptId: { type: "string" },
      script: { type: "json" },
      query: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      limit: { type: "number" },
    },
    output: { schema: { type: "json" }, render: (_a, v) => [{ type: "json", value: v }] },
    async execute(args) { return manageScripts(store, args as any); },
  })));

  disposers.push(ctx.tools.register(defineTool({
    name: 'script_run',
    description: 'Execute a registered script.',
    parameters: {
      scriptId: { type: "string", required: true },
    },
    output: {
      schema: { type: "json" },
      // 与 /script 命令共用 formatScriptResult，保证模型看到的输出完全一致
      render: (_a, v) => [{ type: "text", text: formatScriptResult(v as Record<string, unknown>) }],
    },
    async execute(args, exec) {
      const result = await runner.run(args.scriptId, exec.signal, exec.agent, exec.token);
      return result;
    },
  })));

  return () => { for (const d of disposers) d(); };
}