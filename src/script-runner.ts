/**
 * DSH Script Manager Plugin - Script Runner
 * 脚本执行引擎（基于 ctx.ptcRuntime）。
 *
 * 每次执行都持有真实的工具执行身份（ToolRunContext）：script_run 与动态工具由模型
 * 直接调用；/script 由命令经 script-transport 投递到框架原生的工具回合后，同样以真实
 * 身份分派。因此脚本内层 tools.* 一律以该身份为父调用，其 tool/ptc-dispatch* 事件写在
 * 已打开的回合里（dsh-tools 的 invariant 要求分发事件处于回合内），GUI 渲染为嵌套卡片。
 */

import type { Context } from '@deepseek-ai/cordis';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type {
  ToolExecutionToken,
  ToolRunContext,
  PtcDispatchLog,
} from '@deepseek-ai/dsh-tools';
import { scopeTarget } from '@deepseek-ai/dsh-scope';
import type {
  PtcBindingFunction,
  PtcBindingNamespace,
  PtcJsonValue,
  PtcRunRequest,
  PtcRunResult,
  PtcRuntime,
} from '@deepseek-ai/dsh-ptc-runtime';
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy';
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox';
import type { ScriptStore } from './script-store.js';
import type { HistoryStore } from './history-store.js';
import type { ScriptRunRecord } from './types.js';
import { resolveScriptParams, buildParamInjection } from './script-params.js';

/** 执行记录中的 error / value 截断上限（控制单行体积）。 */
const RUN_ERROR_MAX = 2000;
const RUN_VALUE_MAX = 4000;

/** 脚本执行器构造选项 */
export interface ScriptRunnerOptions {
  /**
   * 插件级默认执行预算（毫秒）。0 / 未提供 = 不施加默认预算（无限制）。
   * 生效优先级：调用级 > 脚本级 > 本默认值。
   */
  defaultTimeoutMs?: number;
  /** 历史存储：提供时每次执行向该脚本 runs.jsonl 记一条摘要（失败不影响执行）。 */
  history?: HistoryStore;
}

/** 将超时预算归一为可选正整数；非正/非法/缺省一律视为无预算。 */
function normalizeBudgetMs(value: unknown): number | undefined {
  const ms = typeof value === 'number' ? value : undefined;
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : undefined;
}

/**
 * 组合一次脚本执行的取消语义：外部取消信号与执行预算合并为一个 AbortSignal。
 * 预算到期时以固定文案 abort（错误消息保持可读）。两者皆无时返回永不中止的信号。
 */
function createRunSignal(outer?: AbortSignal, budgetMs?: number): {
  signal: AbortSignal;
  dispose(): void;
  budgetFired(): boolean;
} {
  const controller = new AbortController();
  const budget = normalizeBudgetMs(budgetMs);
  let budgetFired = false;

  if (outer?.aborted) {
    controller.abort(outer.reason);
    return { signal: controller.signal, dispose() {}, budgetFired: () => budgetFired };
  }

  const onOuterAbort = () => controller.abort(outer?.reason);
  const onBudgetAbort = () => {
    budgetFired = true;
    controller.abort('script execution exceeded timeout of ' + budget + 'ms');
  };
  outer?.addEventListener('abort', onOuterAbort, { once: true });
  const timer = budget === undefined ? undefined : setTimeout(onBudgetAbort, budget);

  return {
    signal: controller.signal,
    dispose() {
      if (outer !== undefined) outer.removeEventListener('abort', onOuterAbort);
      if (timer !== undefined) clearTimeout(timer);
    },
    budgetFired: () => budgetFired,
  };
}

/** 脚本执行器 */
export class ScriptRunner {
  private defaultTimeoutMs: number;
  private history?: HistoryStore;

  constructor(
    private store: ScriptStore,
    private ctx: Context,
    options: ScriptRunnerOptions = {},
  ) {
    this.defaultTimeoutMs = normalizeBudgetMs(options.defaultTimeoutMs) ?? 0;
    this.history = options.history;
  }

  /**
   * 读取 PTC 运行时；未挂载时报出可操作的错误。运行时在真正执行处读取而非
   * 在 inject 中静态声明，避免脚本管理面在没有 PTC 运行时的情况下整体不激活。
   */
  private requireRuntime(): PtcRuntime {
    const runtime = this.ctx.get('ptcRuntime');
    if (runtime === undefined) {
      throw new Error('[dsh-script-manager] script execution requires a PTC runtime; mount @deepseek-ai/dsh-ptc-runtime-node');
    }
    return runtime;
  }

  /**
   * Execute a registered script.
   *
   * @param scriptId - the script to run
   * @param exec - 本次执行的工具执行身份（调用方 agent、取消信号、父调用 id）
   * @param params - 本次执行的输入参数（键为声明参数名）
   * @param runSource - 本次执行来源面（'script_run' / 'dynamic-tool:<name>'）
   * @param overrideTimeoutMs - 调用级执行预算（毫秒），覆盖脚本级与插件级默认
   */
  async run(
    scriptId: string,
    exec: ToolRunContext,
    params?: Record<string, unknown>,
    runSource?: string,
    overrideTimeoutMs?: number,
  ): Promise<Record<string, unknown>> {
    const script = await this.store.get(scriptId);
    if (!script) {
      throw new Error('Script not found: ' + scriptId);
    }

    const agent = exec.agent;
    const callId = exec.callId;
    const rootCallId = exec.rootCallId;
    const runRevision = this.history ? await this.history.lastRevisionOf(scriptId) : undefined;

    const budgetMs = normalizeBudgetMs(overrideTimeoutMs ?? script.timeoutMs ?? this.defaultTimeoutMs);
    const runSignal = createRunSignal(exec.signal, budgetMs);
    const startTime = Date.now();

    try {
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

      const bindings: PtcBindingNamespace[] = [{
        global: 'tools',
        functions: this.createToolBindings(runSignal.signal, agent, exec.token, callId, rootCallId, exec),
        errorClass: { name: 'ToolCallError', memberNameProperty: 'toolName' },
      }];

      const runtime = this.requireRuntime();
      const cwd = agent?.session.header.cwd;
      const sandboxPolicy = this.resolveSandboxPolicy(agent);
      const request: PtcRunRequest = {
        program,
        bindings,
        signal: runSignal.signal,
        timeoutMs: null,
        ...(cwd !== undefined ? { cwd } : {}),
        ...(sandboxPolicy !== undefined ? { sandboxPolicy } : {}),
      };

      const result: PtcRunResult = await runtime.run(runtime.resolve(request));

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
      if (hasParams && resolved) {
        runResult.params = resolved.value;
        if (resolved.unknown.length > 0) runResult.unknownParams = resolved.unknown;
      }
      if (script.expectedOutcome !== undefined) runResult.expectedOutcome = script.expectedOutcome;
      if (script.successCriteria !== undefined) runResult.successCriteria = script.successCriteria;
      if (script.failureGuidance !== undefined) runResult.failureGuidance = script.failureGuidance;
      if (result.value !== undefined) runResult.value = result.value;
      if (result.sandbox !== undefined) {
        runResult.sandbox = {
          mode: result.sandbox.mode,
          denied: result.sandbox.denied,
          ...(result.sandbox.enforcement !== undefined ? { enforcement: result.sandbox.enforcement } : {}),
        };
      }
      if (result.error) {
        runResult.error = result.error.message;
        // 预算到期时经信号 abort 触发，框架报 kind='abort'；这里还原为语义上的 timeout。
        runResult.errorKind = runSignal.budgetFired() && result.error.kind === 'abort'
          ? 'timeout'
          : result.error.kind;
      }

      if (this.history) {
        try {
          const runRecord: ScriptRunRecord = {
            scriptId,
            revision: runRevision,
            caller: (runSource ?? '').trim().slice(0, 64) || undefined,
            success: !result.error,
            executionTime: Date.now() - startTime,
          };
          if (hasParams && resolved) runRecord.params = resolved.value;
          if (result.error) {
            runRecord.error = truncateText(result.error.message, RUN_ERROR_MAX);
            runRecord.errorKind = runResult.errorKind as string | undefined;
          }
          if (result.sandbox?.denied) runRecord.sandboxDenied = true;
          if (result.value !== undefined) {
            const text = safeStringify(result.value);
            runRecord.value = truncateText(text, RUN_VALUE_MAX);
            runRecord.valueTruncated = text.length > RUN_VALUE_MAX;
          }
          await this.history.recordRun(scriptId, runRecord);
        } catch (error) {
          console.warn('[dsh-script-manager] failed to record run history: ' + (error instanceof Error ? error.message : String(error)));
        }
      }

      return runResult;
    } finally {
      runSignal.dispose();
    }
  }

  /** 按会话解析沙箱策略；无会话或未挂载沙箱服务时返回 undefined（由运行时自行解析）。 */
  private resolveSandboxPolicy(agent: Agent | undefined): SandboxExecutionPolicy | undefined {
    const service: SandboxPolicyService | undefined = this.ctx.get('sandboxPolicy');
    if (service === undefined) return undefined;
    return service.resolve(agent !== undefined ? { session: agent.session } : {});
  }

  /**
   * Create tool bindings for the code runtime worker.
   *
   * Each binding bridges worker to host: the worker calls tools.xxx(args),
   * the host resolves the tool through ctx.tools.execute(), and returns the
   * plain JSON value back to the worker. The parent token marks every inner
   * call as a nested transport dispatch, so PTC 模式的直调折叠不会拦截脚本内层工具。
   *
   * 层级事件：每次内层调用写入 tool/ptc-dispatch-start / tool/ptc-dispatch，
   * 且 settle 内容经 tools/ptc-dispatch-log waterfall 塑形，与 run_code 桥保持一致。
   */
  private createToolBindings(
    signal: AbortSignal,
    agent: Agent | undefined,
    token: ToolExecutionToken,
    parentCallId: ReturnType<typeof ToolCallId>,
    rootCallId: ReturnType<typeof ToolCallId>,
    exec: ToolRunContext,
  ): Record<string, PtcBindingFunction> {
    const toolBindings: Record<string, PtcBindingFunction> = {};
    const schemas = this.ctx.tools.schemas(agent).filter((s) => s.name !== 'run_code');
    const session = agent?.session;
    const emitDispatch = session !== undefined;
    let dispatchCounter = 0;

    for (const schema of schemas) {
      toolBindings[schema.name] = async (args: unknown): Promise<PtcJsonValue> => {
        const subCallId = ToolCallId(String(parentCallId) + ':ptc:' + (++dispatchCounter));
        const loggedArgs = normalizeEventArgs(args);

        if (emitDispatch) {
          session!.append('tool/ptc-dispatch-start', {
            rootCallId,
            parentCallId,
            subCallId,
            name: schema.name,
            arguments: loggedArgs,
          });
        }

        let settled: { isError: boolean; value?: unknown; message?: string; content: ContentBlock[] };
        try {
          const outcome = await this.ctx.tools.execute({
            callId: subCallId,
            rootCallId,
            name: schema.name,
            arguments: args,
            ...(agent !== undefined ? { agent } : {}),
            parent: token,
            signal,
          });
          settled = outcome.isError
            ? { isError: true, value: undefined, message: outcome.error.message, content: outcome.content }
            : { isError: false, value: outcome.value, content: outcome.content };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          settled = {
            isError: true,
            value: undefined,
            message,
            content: [{ type: 'text', text: 'Error: ' + message }],
          };
        }

        if (emitDispatch) {
          const logged = await this.shapeDispatchLog({
            exec,
            agent,
            subCallId,
            name: schema.name,
            isError: settled.isError,
            content: settled.content,
          });
          session!.append('tool/ptc-dispatch', {
            rootCallId,
            parentCallId,
            subCallId,
            name: schema.name,
            arguments: loggedArgs,
            isError: settled.isError,
            content: logged,
          });
        }

        if (settled.isError) {
          throw new Error(settled.message ?? 'tool call failed');
        }
        return settled.value as PtcJsonValue;
      };
    }
    return toolBindings;
  }

  /** 经 tools/ptc-dispatch-log waterfall 塑形一条子分发 settle 内容；监听器失败回退原文。 */
  private async shapeDispatchLog(dispatch: PtcDispatchLog): Promise<ContentBlock[]> {
    try {
      return await this.ctx.waterfall(
        scopeTarget(this.ctx.tools, dispatch.agent),
        'tools/ptc-dispatch-log',
        dispatch,
        () => Promise.resolve(dispatch.content),
      );
    } catch {
      return dispatch.content;
    }
  }
}

/** 把待记录的事件参数归一为纯 JSON（与 run_code 桥的 jsonNormalizeArgs 同意图）。 */
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

/** 截断长文本至上限（短文本原样不动）。 */
function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max);
}

/** 返回值安全序列化（runtime 返回值本为 lossless JSON；异常兜底 String）。 */
function safeStringify(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}
