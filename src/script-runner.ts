/**
 * DSH Script Manager Plugin - Script Runner
 * 脚本执行引擎（基于 ctx.codeRuntime）
 */

import type { Context } from '@deepseek-ai/cordis';
import { CallId } from '@deepseek-ai/dsh-llm';
import type { Agent, ToolExecutionToken } from '@deepseek-ai/dsh-tools';
import type { CodeBindingFunction, CodeBindingNamespace } from '@deepseek-ai/dsh-code-runtime';
import type { ScriptStore } from './script-store.js';
import { resolveScriptParams, buildParamInjection } from './script-params.js';

/** 会话事件写入的最小表面（与 dsh-tools code-mode 追加 log-only 事件一致）。 */
interface SessionLike {
  events: readonly { type: string; data: Record<string, unknown> }[];
  append(type: string, data: Record<string, unknown>, opts?: Record<string, unknown>): { seq: number };
}

/**
 * 脚本本次执行的外层调用身份：内层 tools.* 子分发事件以它为 parent/root。
 * 缺失（无会话可写）时无需提供；有会话时由调用点从 script_run 的 exec
 * （callId / rootCallId）透传，保证 GUI 把子调用树挂在正确的根调用之下。
 */
export interface ScriptDispatchIdentity {
  /** 外层 script_run 调用 id（父调用的 callId）。 */
  callId: string;
  /** 整棵调用树的最顶层调用 id；非嵌套时等于 callId。 */
  rootCallId: string;
}

/** 脚本执行器构造选项 */
export interface ScriptRunnerOptions {
  /**
   * 插件级默认执行预算（毫秒）。0 / 未提供 = 不施加默认超时（无限制，
   * 仍受 DSH 平台级 maxWallMs 护栏约束）。
   * 生效优先级：调用级（script_run.timeoutMs）> 脚本级（script.timeoutMs）
   * > 本默认值。
   */
  defaultTimeoutMs?: number;
}

/** 将超时预算归一为可选数字：非正/非法/缺省一律视为无预算。 */
function normalizeBudgetMs(value: unknown): number | undefined {
  const ms = typeof value === 'number' ? value : undefined;
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : undefined;
}

/**
 * 组合一次脚本执行的取消语义：外部取消信号（用户停止 / agent 回合取消）
 * 与执行预算超时合并为一个 AbortSignal。两者皆无时返回永不中止的信号，
 * 使内部 tools.* 调用不再被任何隐性超时截断。
 */
function createRunSignal(outer?: AbortSignal, budgetMs?: number): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  const budget = normalizeBudgetMs(budgetMs);
  const noOuter = outer === undefined;
  const noBudget = budget === undefined;

  if (outer?.aborted) {
    controller.abort(outer.reason);
    return { signal: controller.signal, dispose() {} };
  }
  if (noOuter && noBudget) {
    // 无外部取消、无预算：仅返回一个永不中止的信号（无人会 abort 它）
    return { signal: controller.signal, dispose() {} };
  }

  const onOuterAbort = () => controller.abort(outer?.reason);
  const onBudgetAbort = () => controller.abort('script execution exceeded timeout of ' + budget + 'ms');
  outer?.addEventListener('abort', onOuterAbort, { once: true });
  const timer = noBudget ? undefined : setTimeout(onBudgetAbort, budget as number);

  return {
    signal: controller.signal,
    dispose() {
      if (!noOuter) outer?.removeEventListener('abort', onOuterAbort);
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}

/** 脚本执行器 */
export class ScriptRunner {
  private defaultTimeoutMs: number;

  constructor(
    private store: ScriptStore,
    private ctx: Context,
    options: ScriptRunnerOptions = {},
  ) {
    this.defaultTimeoutMs = normalizeBudgetMs(options.defaultTimeoutMs) ?? 0;
  }

  /**
   * Execute a registered script.
   *
   * 超时预算优先级：overrideTimeoutMs（script_run 调用级）> 脚本定义
   * script.timeoutMs > 插件默认 defaultTimeoutMs；均未设置则无超时限制
   * （仅外部取消信号与 DSH 平台护栏可中止）。
   *
   * @param scriptId - the script to run
   * @param signal - optional cancellation signal (user stop / caller turn)
   * @param agent - the calling agent (for tool scope resolution)
   * @param parentToken - the caller execution token used as parent so DSH
   *   treats inner tools as sub-dispatches (bypasses the mode:code rule that
   *   only allows run_code directly).
   * @param overrideTimeoutMs - per-run budget (ms) overriding script/plugin defaults
   * @param outer - 外层执行身份（script_run 的 exec.callId / rootCallId）。提供时
   *   runner 为每个内层 tools.* 调用向 agent.session 追加 log-only 的
   *   tool/code-dispatch-start / tool/code-dispatch 事件，使 Web GUI 能像 run_code
   *   一样把脚本内部工具调用渲染为嵌套层级（rootCallId 挂在本调用之下）。
   * @param params - 本次执行的输入参数(键为声明参数名)。必输缺失/类型不匹配会
   *   在执行前抛错;未知键忽略并记入 runResult.unknownParams;选输缺省用默认值。
   */
  async run(
    scriptId: string,
    signal?: AbortSignal,
    agent?: Agent,
    parentToken?: ToolExecutionToken,
    overrideTimeoutMs?: number,
    outer?: ScriptDispatchIdentity,
    params?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const script = await this.store.get(scriptId);
    if (!script) {
      throw new Error('Script not found: ' + scriptId);
    }

    const budgetMs = normalizeBudgetMs(overrideTimeoutMs ?? script.timeoutMs ?? this.defaultTimeoutMs);
    const runSignal = createRunSignal(signal, budgetMs);
    const startTime = Date.now();
    // 子分发事件身份：有外层调用时挂在外层调用下，否则（无会话可写）降级为空。
    const dispatchRoot = outer?.rootCallId ?? outer?.callId ?? '';
    const dispatchParent = outer?.callId ?? '';

    try {
      // 参数解析与校验(仅带参脚本;无 parameters 时原样执行且忽略传入)
      const hasParams = Array.isArray(script.parameters) && script.parameters.length > 0;
      const resolved = hasParams ? resolveScriptParams(script.parameters, params) : null;
      if (resolved && resolved.missing.length > 0) {
        throw new Error('Missing required parameter(s): ' + resolved.missing.join(', '));
      }
      if (resolved && resolved.invalid.length > 0) {
        const bad = resolved.invalid.map((i) => i.name + ' (expected ' + i.expected + ')').join(', ');
        throw new Error('Invalid parameter type for: ' + bad);
      }
      const program = hasParams ? buildParamInjection(resolved!.value) + script.code : script.code;

      const bindings: CodeBindingNamespace[] = [{
        global: 'tools',
        functions: this.createToolBindings(agent, parentToken, runSignal.signal, dispatchParent, dispatchRoot),
        errorClass: { name: 'ToolCallError', memberNameProperty: 'toolName' },
      }];

      const result = await this.ctx.codeRuntime.run({
        program,
        bindings,
        signal: runSignal.signal,
      });

      await this.store.recordExecution(scriptId, result.error?.message);

      const runResult: Record<string, unknown> = {
        success: !result.error,
        scriptId,
        scriptName: script.name,
        scriptCode: script.code,
        logs: result.logs || [],
        executionTime: Date.now() - startTime,
      };
      if (budgetMs !== undefined) runResult.timeoutMs = budgetMs;
      // 本次生效参数(仅带参脚本;含默认合并),供 Params 段展示与 agent 对照验收
      if (hasParams && resolved) {
        runResult.params = resolved.value;
        if (resolved.unknown.length > 0) runResult.unknownParams = resolved.unknown;
      }
      // 执行契约直传（仅定义时有值才写入；供 formatScriptResult 展示与 agent 对照验收）
      if (script.expectedOutcome !== undefined) runResult.expectedOutcome = script.expectedOutcome;
      if (script.successCriteria !== undefined) runResult.successCriteria = script.successCriteria;
      if (script.failureGuidance !== undefined) runResult.failureGuidance = script.failureGuidance;

      if (result.value !== undefined) {
        runResult.value = result.value;
      }

      if (result.error) {
        runResult.error = result.error.message;
      }

      return runResult;
    } finally {
      runSignal.dispose();
    }
  }

  /**
   * Create tool bindings for the code runtime worker.
   *
   * Each binding bridges worker to host: the worker calls tools.xxx(args),
   * the host resolves the tool through ctx.tools.execute(), and returns the
   * plain JSON value back to the worker.
   *
   * Key requirements (learned through iterative debugging):
   * 1. agent: passed to both schemas() and execute() so agent-scoped tools
   *    are visible and resolvable.
   * 2. parentToken: set to the caller exec.token so DSH treats the call as a
   *    sub-dispatch (bypassing the mode:code restriction).
   * 3. callId: must use CallId(string) factory, not CallId.create().
   * 4. return value: plain lossless JSON — extract .value from ToolResult.
   * 5. signal: every inner tools.* call shares the run composed signal
   *    (external cancellation + execution budget). No per-call implicit
   *    timeout is applied — scripts run without a timeout limit by default.
   * 6. Hierarchy events: when a session is available (agent + outer identity),
   *    every inner call logs `tool/code-dispatch-start` before dispatch and
   *    `tool/code-dispatch` after settle — the same log-only event vocabulary
   *    dsh-tools' run_code dispatcher uses — so the Web GUI renders script
   *    internals as nested tool cards under the outer script_run call.
   */
  private createToolBindings(
    agent?: Agent,
    parentToken?: ToolExecutionToken,
    signal?: AbortSignal,
    parentCallId?: string,
    rootCallId?: string,
  ): Record<string, CodeBindingFunction> {
    const toolBindings: Record<string, CodeBindingFunction> = {};
    const schemas = this.ctx.tools.schemas(agent);
    const session = (agent as unknown as { session?: SessionLike } | undefined)?.session;
    const logDispatch = parentCallId !== '' && rootCallId !== '' && session !== undefined;
    // 每次脚本 run 内按提交顺序编号（并发调用也互不冲突：进入时先自增取号）
    let dispatchCounter = 0;

    for (const schema of schemas) {
      toolBindings[schema.name] = async (args: unknown) => {
        // 确定性子调用 id（<parentCallId>:code:<n>），与 dsh-tools 同构
        const subCallId = CallId(parentCallId + ':code:' + (++dispatchCounter));
        const loggedArgs = normalizeEventArgs(args);

        if (logDispatch) {
          session!.append('tool/code-dispatch-start', {
            rootCallId,
            parentCallId,
            subCallId,
            name: schema.name,
            arguments: loggedArgs,
          });
        }

        // 统一收口 settle 结果：注册表失败(isError)或框架抛错都只写一条 settle
        let settled: { isError: boolean; content: unknown[]; value?: unknown; message?: string };
        try {
          const result = await this.ctx.tools.execute({
            callId: subCallId,
            rootCallId: rootCallId as never,
            name: schema.name,
            arguments: args,
            agent,
            parent: parentToken,
            ...(signal !== undefined ? { signal } : {}),
          });
          settled = result.isError
            ? {
                isError: true,
                content: result.content,
                value: undefined,
                message: result.error.message,
              }
            : { isError: false, content: result.content, value: result.value };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          settled = {
            isError: true,
            content: [{ type: 'text', text: 'Error: ' + message }],
            value: undefined,
            message,
          };
        }

        if (logDispatch) {
          session!.append('tool/code-dispatch', {
            rootCallId,
            parentCallId,
            subCallId,
            name: schema.name,
            arguments: loggedArgs,
            isError: settled.isError,
            content: settled.content.length > 0
              ? settled.content
              : [{ type: 'text', text: settled.value === undefined ? '' : String(settled.value) }],
          });
        }

        if (settled.isError) {
          throw new Error(settled.message ?? 'tool call failed');
        }
        return settled.value;
      };
    }
    return toolBindings;
  }
}

/** 把待记录的事件参数归一为纯 JSON（与 code-mode 的 jsonNormalizeArgs 同意图）。 */
function normalizeEventArgs(args: unknown): unknown {
  if (args === undefined || typeof args === 'function' || typeof args === 'symbol') {
    return undefined;
  }
  if (typeof args === 'string' || typeof args === 'number' || typeof args === 'boolean' || args === null) {
    return args;
  }
  try {
    return JSON.parse(JSON.stringify(args));
  } catch {
    return String(args);
  }
}
