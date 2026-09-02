/**
 * DSH Script Manager Plugin - Script Tools
 * script_manage 按 action 拆分为独立单操作工具：
 *   script_list / script_get / script_create / script_update /
 *   script_delete / script_search，外加 script_run（执行）。
 */

import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { ScriptStore } from './script-store.js';
import type { ScriptRunner } from './script-runner.js';
import { formatScriptResult } from './format-script-result.js';

/** 工具参数（单操作工具各自的入参）。 */
interface ToolArgs {
  scriptId?: string;
  script?: Record<string, unknown>;
  query?: string;
  tags?: string[];
  limit?: number;
  timeoutMs?: number;
}

/** 通用 JSON 输出渲染。 */
function jsonOutput() {
  return { schema: { type: 'json' }, render: (_a: unknown, v: unknown) => [{ type: 'json', value: v }] };
}

export function registerScriptTools(
  ctx: Context,
  store: ScriptStore,
  runner: ScriptRunner,
  onChanged?: () => Promise<void> | void,
): () => void {
  const disposers: (() => void)[] = [];

  // script 对象的逐字段 schema（模型可见的 JSON Schema 结构）
  const SCRIPT_FIELDS = {
    id: { type: 'string', description: 'Unique script id (lowercase letters/digits/hyphens, file name base).' },
    name: { type: 'string', description: 'Display name of the script.' },
    description: { type: 'string', description: 'Script purpose note sent to the model.' },
    version: { type: 'string', description: 'Version string (defaults to 0.1.0).' },
    author: { type: 'string', description: 'Author name (optional).' },
    tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags.' },
    code: { type: 'string', description: 'The TypeScript async function body; may return a value; runs with tools.* bindings (tools.read, tools.bash, ...) available.' },
    registerAsTool: { type: 'boolean', description: 'When true, register the script as a no-argument agent tool named by toolName.' },
    toolName: { type: 'string', description: 'Dynamic tool name when registerAsTool is true; must match ^[a-z_][a-z0-9_]*$; defaults to script_<id>.' },
    timeoutMs: { type: 'number', description: 'Optional per-run timeout budget in milliseconds (positive integer). Defaults to the plugin maxExecutionTime config (0 = unlimited); a script_run({ timeoutMs }) call overrides it for one run.' },
  } as const;

  const CREATE_SCRIPT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
      ...SCRIPT_FIELDS,
      id: { ...SCRIPT_FIELDS.id, required: true as const },
      name: { ...SCRIPT_FIELDS.name, required: true as const },
      code: { ...SCRIPT_FIELDS.code, required: true as const },
    },
  };
  // update 是部分补丁：字段均可选
  const UPDATE_SCRIPT_SCHEMA = { type: 'object', additionalProperties: false, properties: SCRIPT_FIELDS };

  const definitions: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    execute: (args: ToolArgs) => Promise<unknown>;
  }[] = [
    {
      name: 'script_list',
      description: 'List custom script summaries (id/name/description/version/tags/metadata), optionally filtered by tags or limited.',
      parameters: {
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tag filter.' },
        limit: { type: 'number', description: 'Optional maximum number of results.' },
      },
      execute: (args: ToolArgs) => store.list({ tags: args.tags, limit: args.limit }),
    },
    {
      name: 'script_get',
      description: 'Fetch the full definition of one custom script by id (includes its code).',
      parameters: {
        scriptId: { type: 'string', required: true, description: 'Unique script id (lowercase letters/digits/hyphens), e.g. hello-world.' },
      },
      execute: async (args: ToolArgs) => {
        if (!args.scriptId) throw new Error('scriptId required');
        const script = await store.get(args.scriptId);
        if (!script) throw new Error('Script not found: ' + args.scriptId);
        return script;
      },
    },
    {
      name: 'script_create',
      description: 'Create a new custom script. The script body runs in an async TypeScript context with tools.* bindings (e.g. tools.read, tools.bash) available.',
      parameters: {
        script: {
          type: 'object',
          required: true,
          additionalProperties: false,
          properties: CREATE_SCRIPT_SCHEMA.properties,
          description: 'Script definition object; see properties for field formats. Required: id, name, code.',
        },
      },
      execute: async (args: ToolArgs) => {
        if (!args.script) throw new Error('script required');
        const created = await store.create(args.script as any);
        if (onChanged) await onChanged();
        return created;
      },
    },
    {
      name: 'script_update',
      description: 'Update an existing custom script by id (partial patch; changing id renames the script file).',
      parameters: {
        scriptId: { type: 'string', required: true, description: 'Unique script id to update, e.g. hello-world.' },
        script: {
          type: 'object',
          required: true,
          additionalProperties: false,
          properties: UPDATE_SCRIPT_SCHEMA.properties,
          description: 'Partial patch object; accepted fields are the same as script_create (id, name, description, version, author, tags, code, registerAsTool, toolName). Unset fields keep current values.',
        },
      },
      execute: async (args: ToolArgs) => {
        if (!args.scriptId) throw new Error('scriptId required');
        const updated = await store.update(args.scriptId, args.script || {});
        if (onChanged) await onChanged();
        return updated;
      },
    },
    {
      name: 'script_delete',
      description: 'Delete a custom script by id (removes its file and any registered dynamic tool).',
      parameters: {
        scriptId: { type: 'string', required: true, description: 'Unique script id to delete.' },
      },
      execute: async (args: ToolArgs) => {
        if (!args.scriptId) throw new Error('scriptId required');
        const ok = await store.delete(args.scriptId);
        if (onChanged) await onChanged();
        if (!ok) throw new Error('Script not found: ' + args.scriptId);
        return { success: true };
      },
    },
    {
      name: 'script_search',
      description: 'Search custom scripts by text matched against id/name/description, optionally filtered by tags.',
      parameters: {
        query: { type: 'string', required: true, description: 'Search text.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tag filter.' },
      },
      execute: (args: ToolArgs) => store.search(args.query || '', { tags: args.tags }),
    },
  ];

  for (const def of definitions) {
    disposers.push(ctx.tools.register(defineTool({
      name: def.name,
      description: def.description,
      parameters: def.parameters as any,
      output: jsonOutput(),
      async execute(args: any) { return def.execute(args as ToolArgs); },
    })));
  }

  disposers.push(ctx.tools.register(defineTool({
    name: 'script_run',
    description: 'Execute a registered custom script by its id. The script runs in an async TypeScript context with tools.* bindings (e.g. tools.read, tools.bash) available.',
    parameters: {
      scriptId: {
        type: 'string', required: true,
        description: 'The script id to execute (e.g. hello-world, project-info). Fetch available ids via script_list.',
      },
      timeoutMs: {
        type: 'number',
        description: 'Optional per-run timeout budget in milliseconds (positive integer). Overrides the script/plugin default for this run only. Omit for no override.',
      },
    },
    output: {
      schema: { type: 'json' },
      // 与 /script 命令共用 formatScriptResult，保证模型看到的输出完全一致
      render: (_a: unknown, v: unknown) => [{ type: 'text', text: formatScriptResult(v as Record<string, unknown>) }],
    },
    async execute(args: any, exec: any) {
      // 透传外层执行身份：内层 tools.* 子分发事件挂在本 script_run 调用之下，
      // Web GUI 据此把脚本内部调用渲染为 PTC 同款嵌套层级（rootCallId 需一致）。
      const result = await runner.run(args.scriptId, exec.signal, exec.agent, exec.token, args.timeoutMs, {
        callId: String(exec.callId),
        rootCallId: String(exec.rootCallId ?? exec.callId),
      });
      return result;
    },
  })));

  return () => { for (const d of disposers) d(); };
}
