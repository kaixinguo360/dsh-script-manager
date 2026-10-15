/**
 * DSH Script Manager Plugin - Script Transport
 *
 * 用户键入 /script 时并没有模型在调用工具，因此不存在工具执行身份。本模块把这次
 * 用户触发的执行接入框架原生的工具回合：登记一次"待派发"意图，在该会话的下一次
 * 模型请求上短路（不经过任何 provider HTTP），直接产出一个工具调用流；dsh-agent-loop
 * 随后以真实执行身份分派该工具。脚本内层 tools.* 因此拿到真实的父令牌与 callId，
 * 其 tool/ptc-dispatch* 事件写在已打开的回合里，GUI 得以渲染为嵌套卡片 —— 与
 * script_run 路径完全同构。
 *
 * 直调工具的选名由该 agent 自己可见的工具面决定：
 * - PTC 模式：dsh-tools 的 collapses() 只允许"模型直调"命名保留传输 run_code，
 *   其余工具名一律折叠为 UNKNOWN_TOOL。故直调 run_code，由其程序内部以子分发
 *   身份调用 script_run —— 子分发带父令牌，不受该折叠约束。
 * - native / both 模式：script_run 本身可直调，直接命名，省去一层 worker。
 */

import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, StreamChunk, ToolCallBlock } from '@deepseek-ai/dsh-llm';

/**
 * 合成回合里那次工具调用的 id 前缀。它同时是入口面的判据：dsh-tools 给子分发
 * 生成的 id 是 `<父 callId>:ptc:<n>`，并原样继承父的 rootCallId，因此下游工具
 * （script_run）凭前缀即可认出"这次执行来自 /script 的合成回合"，无需任何状态。
 */
export const SCRIPT_DISPATCH_CALL_PREFIX = 'script-dispatch-';

/** PTC 模式的保留传输名（dsh-tools 的 RUN_CODE_NAME）。 */
const RUN_CODE_NAME = 'run_code';
/** 本插件注册的脚本执行工具名。 */
const SCRIPT_RUN_NAME = 'script_run';

/**
 * 未消费意图的有效期。登记后紧跟的 followup 会立刻唤醒一次模型请求并消费它；
 * 超期说明那次回合没有发生（agent 被销毁等），此时必须作废，绝不劫持后续无关请求。
 */
const ARM_TTL_MS = 30_000;

/** 一次待派发的脚本执行：直调工具名与其参数（lossless JSON）。 */
interface PendingDispatch {
  readonly name: string;
  readonly args: Record<string, unknown>;
  /** 登记时刻，用于丢弃过期意图。 */
  readonly armedAt: number;
}

/**
 * /script 的传输层：把用户触发的脚本执行投递到框架原生的工具回合。
 * 每个会话至多一个待派发意图，消费即清除。
 */
export class ScriptTransport {
  private readonly pending = new Map<string, PendingDispatch>();

  constructor(private readonly ctx: Context) {}

  /**
   * 安装模型请求拦截器。
   * @returns 清理函数（插件卸载时调用）。
   */
  install(): () => void {
    return this.ctx.on('llm/stream', (options, next) => {
      const dispatch = this.take(options);
      return dispatch === undefined ? next() : synthesizeToolCall(dispatch);
    });
  }

  /**
   * 为下一次该 agent 的模型请求登记一次脚本派发。
   * @param agent - 发起执行的 agent（其会话承载这次工具回合）。
   * @param scriptId - 待执行的脚本 id。
   * @param params - 调用方传入的脚本参数（未声明/缺省由 runner 照常处理）。
   * @returns 是否登记成功；false 表示该 agent 的工具面里两个候选直调工具都不可见。
   */
  arm(agent: Agent, scriptId: string, params?: Record<string, unknown>): boolean {
    const visible = new Set(this.ctx.tools.schemas(agent).map((schema) => schema.name));
    const runArguments = scriptRunArguments(scriptId, params);
    const dispatch = visible.has(RUN_CODE_NAME)
      ? throughRunCode(scriptId, runArguments)
      : visible.has(SCRIPT_RUN_NAME)
        ? { name: SCRIPT_RUN_NAME, args: runArguments }
        : undefined;
    if (dispatch === undefined) return false;
    this.pending.set(String(agent.session.id), { ...dispatch, armedAt: Date.now() });
    return true;
  }

  /** 取出并清除该请求所属会话的待派发意图；缺失或过期返回 undefined。 */
  private take(options: GenerateOptions): PendingDispatch | undefined {
    const sessionId = options.sessionId;
    if (sessionId === undefined) return undefined;
    const key = String(sessionId);
    const entry = this.pending.get(key);
    if (entry === undefined) return undefined;
    this.pending.delete(key);
    return Date.now() - entry.armedAt <= ARM_TTL_MS ? entry : undefined;
  }
}

/** script_run 的调用参数（未传参数时省略 params，交由 runner 用脚本默认值）。 */
function scriptRunArguments(scriptId: string, params?: Record<string, unknown>): Record<string, unknown> {
  return params === undefined ? { scriptId } : { scriptId, params };
}

/**
 * 把一次脚本执行包装成 run_code 直调：程序体以子分发身份调用 script_run。
 * 参数以 JSON 字面量内联，脚本 id 与参数值均按 JSON 转义，无需额外引用处理。
 */
function throughRunCode(scriptId: string, runArguments: Record<string, unknown>): { name: string; args: Record<string, unknown> } {
  return {
    name: RUN_CODE_NAME,
    args: {
      code: 'return await tools.' + SCRIPT_RUN_NAME + '(' + JSON.stringify(runArguments) + ');',
      description: 'Run script "' + scriptId + '" (invoked by the user through /script)',
    },
  };
}

/**
 * 短路合成"模型请求调用某工具"的流：不发任何 provider 请求，只产出该工具调用块与
 * 终态 finish。块序列与真实适配器一致（block-start → 增量 → 带权威块的 block-end），
 * 因此 dsh-llm 的 BlockAssembler 会装配出同一个工具调用块，会话里留下真实的
 * assistant/message（含内嵌流）与 tool/call。
 */
async function* synthesizeToolCall(dispatch: PendingDispatch): AsyncGenerator<StreamChunk> {
  const callId = ToolCallId(SCRIPT_DISPATCH_CALL_PREFIX + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
  const args = JSON.stringify(dispatch.args);
  const block: ToolCallBlock = { type: 'tool-call', id: callId, name: dispatch.name, arguments: args };

  yield { type: 'block-start', index: 0, blockType: 'tool-call' };
  yield { type: 'tool-call-delta', index: 0, id: callId, name: dispatch.name, argumentsDelta: args };
  yield { type: 'block-end', index: 0, block };
  yield { type: 'finish', reason: { kind: 'tool-calls' } };
}
