/**
 * DSH Script Manager Plugin - Dynamic Tool Registry
 * 按脚本的 registerAsTool/toolName 动态注册 agent 可调用工具。
 *
 * 同步逻辑：扫描脚本存储，对 registerAsTool=true 的脚本注册一个
 * 无参数动态工具（代理 ScriptRunner.run）；脚本取消勾选/删除/改名时
 * 自动卸载对应工具。写操作（script_manage / REST CRUD）后调用 sync()。
 */

import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { ScriptStore } from './script-store.js';
import type { ScriptRunner } from './script-runner.js';
import { formatScriptResult } from './format-script-result.js';
import type { NormalizedScriptParameter } from './script-params.js';

/** 从脚本 id 派生默认工具名（连字符转下划线，script_ 前缀）。 */
export function defaultToolName(id: string): string {
  return 'script_' + id.replace(/-/g, '_');
}

/** 工具名合法性：小写字母/数字/下划线，字母或下划线开头。 */
export function isValidToolName(name: string): boolean {
  return /^[a-z_][a-z0-9_]*$/.test(name);
}

/** 动态工具注册表：保持注册状态与脚本存储一致。 */
export class ScriptToolRegistry {
  /** 已注册工具:键=工具名,值含脚本 id、定义指纹(描述+参数,变更即需刷新)与卸载器。 */
  private registered = new Map<string, { scriptId: string; fingerprint: string; dispose: () => void }>();

  constructor(
    private ctx: Context,
    private store: ScriptStore,
    private runner: ScriptRunner,
  ) {}

  /** 同步注册表：按 store 现状注册新增、卸载失效的动态工具。 */
  async sync(): Promise<void> {
    const scripts = await this.store.list();
    const wanted = new Map<string, { scriptId: string; name: string; description: string; parameters?: NormalizedScriptParameter[] }>();
    for (const s of scripts) {
      if (!s.registerAsTool) continue;
      const toolName = (s.toolName ?? '').trim() || defaultToolName(s.id);
      if (!isValidToolName(toolName)) continue;
      wanted.set(toolName, { scriptId: s.id, name: s.name, description: s.description || '', parameters: s.parameters });
    }

    // 卸载：取消勾选 / 删除 / toolName 变更 / 指向其他脚本 / 定义指纹变更(描述或参数变化需刷新 schema)
    for (const [toolName, entry] of this.registered) {
      const want = wanted.get(toolName);
      const stale = want && entry.fingerprint !== dynamicFingerprint(want);
      if (!want || want.scriptId !== entry.scriptId || stale) {
        try { entry.dispose(); } catch { /* 已卸载 */ }
        this.registered.delete(toolName);
      }
    }

    // 注册：新增工具(含指纹变更后重注册)
    for (const [toolName, want] of wanted) {
      if (this.registered.has(toolName)) continue;
      const paramsSpec = buildDynamicParamSpec(want.parameters);
      const description = 'Execute the custom script "' + want.name + '"' +
        (want.description ? ' - ' + want.description : '') +
        (paramsSpec.hasParams
          ? ' Arguments: ' + (want.parameters || []).map((p) => p.name).join(', ') + '.'
          : ' No arguments.');
      try {
        const dispose = this.ctx.tools.register(defineTool({
          name: toolName,
          description,
          parameters: paramsSpec.props,
          output: {
            schema: { type: 'json' },
            render: (_a: unknown, v: unknown) => [{ type: 'text', text: formatScriptResult(v as Record<string, unknown>) }],
          },
          // 必须用箭头函数：execute 被框架以无 this 方式调用，
          // 方法简写会导致 this 丢失（this.runner undefined）
          execute: async (args: unknown, exec: unknown) => {
            const runContext = exec as { signal?: AbortSignal; agent?: unknown; token?: unknown; callId?: unknown; rootCallId?: unknown } | undefined;
            // 参数:动态工具的声明参数即平铺在调用参数里(与脚本声明一一对应)
            const params = (typeof args === 'object' && args !== null && !Array.isArray(args))
              ? (args as Record<string, unknown>)
              : undefined;
            const result = await this.runner.run(
              want.scriptId,
              runContext?.signal,
              runContext?.agent as never,
              runContext?.token as never,
              undefined,
              runContext?.callId !== undefined && runContext?.callId !== ''
                ? {
                    callId: String(runContext.callId),
                    rootCallId: String(runContext.rootCallId ?? runContext.callId),
                  }
                : undefined,
              params,
              'dynamic-tool:' + toolName,
            );
            return result;
          },
        } as never));
        this.registered.set(toolName, { scriptId: want.scriptId, fingerprint: dynamicFingerprint(want), dispose });
      } catch (error) {
        console.error('[dsh-script-manager] failed to register dynamic tool ' + toolName + ':', error);
      }
    }
  }

  /** 卸载全部动态工具（插件卸载时调用）。 */
  dispose(): void {
    for (const entry of this.registered.values()) {
      try { entry.dispose(); } catch { /* ignore */ }
    }
    this.registered.clear();
  }
}

/** 动态工具参数 schema:脚本声明参数映射为具名属性(必输/类型/说明),无参脚本返回空。 */
function buildDynamicParamSpec(parameters: NormalizedScriptParameter[] | undefined): { props: Record<string, unknown>; hasParams: boolean } {
  const props: Record<string, unknown> = {};
  if (!parameters || parameters.length === 0) return { props, hasParams: false };
  for (const p of parameters) {
    const bits = ['parameter "' + p.name + '"'];
    if (p.label && p.label !== p.name) bits.push(p.label);
    if (p.description) bits.push(p.description);
    bits.push('type: ' + p.type);
    if (p.required) bits.push('REQUIRED - must be provided');
    else bits.push('optional - default: ' + JSON.stringify(p.default));
    const prop: Record<string, unknown> = {
      type: p.type === 'number' ? 'number' : p.type === 'boolean' ? 'boolean' : 'string',
      description: bits.join('; ') + '.',
    };
    if (p.required) prop.required = true;
    props[p.name] = prop;
  }
  return { props, hasParams: true };
}

/** 动态工具定义指纹:描述 + 参数声明(名称/类型/必输/默认)。任一变化 → 已注册工具需刷新 schema。 */
function dynamicFingerprint(want: { name: string; description: string; parameters?: NormalizedScriptParameter[] }): string {
  const params = (want.parameters || []).map((p) =>
    p.name + ':' + p.type + ':' + (p.required ? 'req' : 'opt') + ':' + JSON.stringify(p.default)
  ).join('|');
  return want.name + '\u0000' + want.description + '\u0000' + params;
}

