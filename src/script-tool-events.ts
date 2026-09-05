/**
 * DSH Script Manager Plugin - Tool Event Recording
 * 模拟 agent-loop 的工具调用回合，在会话中写入与 agent 方式完全一致的
 * 事件序列。
 *
 * 真实 agent 路径（模型调用 script_run）产生的会话事件序列：
 *   turn/start → step/start → assistant/message(含 tool-call block)
 *     → tool/call → tool/result → step/end → turn/end
 *
 * 关键约束（从 dsh-agent-loop 源码核对）：
 * - assistant/message 必须先于 tool/call 写入：只有它携带 tool-call block，
 *   deriveMessages 才能折叠出 assistant tool_calls 消息，使后续 tool/result
 *   派生的 {role:"tool"} wire 消息通过 LLM API 的序列校验
 *   （"Messages with role 'tool' must be a response to a preceding message
 *   with 'tool_calls'"）。真实路径中该消息由模型输出；此处为合成。
 * - tool/call 的 arguments 是 JSON 字符串（BlockAssembler 累积 argumentsDelta
 *   生成，与 deepseek 适配器 serializeAssistant 的 function.arguments 一致）。
 * - assistant/message 与 tool/result 都是 surface-eligible 事件，必须带
 *   surfaceOp: "append"；tool/result 还需 sourceEventSeqs 引用 tool/call。
 */

import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { CallId, createAssistantMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm';
import type { ToolExecutionResult, ToolExecutionToken } from '@deepseek-ai/dsh-tools';

interface SessionLike {
  events: readonly { type: string; data: Record<string, unknown> }[];
  append(type: string, data: Record<string, unknown>, opts?: Record<string, unknown>): { seq: number };
}

/** 从会话最近的 assistant/message 推导 provider/model（保持跨回合一致）。 */
function deriveModelSource(session: SessionLike): { provider: string; model: string } {
  for (let i = session.events.length - 1; i >= 0; i -= 1) {
    const event = session.events[i];
    if (event.type !== 'assistant/message') continue;
    const source = (event.data as { message?: { source?: { provider?: unknown; model?: unknown } } }).message?.source;
    if (source && typeof source.provider === 'string' && typeof source.model === 'string') {
      return { provider: source.provider, model: source.model };
    }
  }
  return { provider: '', model: '' };
}

/**
 * 模拟一次工具调用回合并写入会话。
 *
 * @param ctx - 插件上下文（访问 tools）
 * @param agent - 目标 agent（其 session 是写入目标）
 * @param toolName - 工具名（如 script_run）
 * @param args - 工具参数（lossless JSON，用于执行；事件中以 JSON 字符串记录）
 * @param signal - 取消信号
 * @param parentToken - 底层执行的 parent token（绕过 mode: 'code' collapse；
 *   只影响工具执行管道，不影响会话记录的 tool/call 事件结构）
 * @returns 工具执行结果
 */
export async function executeToolCallWithEvents(
  ctx: Context,
  agent: Agent,
  toolName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
  parentToken?: ToolExecutionToken,
  /** 自定义执行器：提供时绕过 ctx.tools.execute，直接调用目标逻辑。
   *  调用方负责构造完整的 ToolExecutionResult（含 content/isError/value）。 */
  execFn?: (callId: string) => Promise<ToolExecutionResult>,
): Promise<ToolExecutionResult> {
  const session = agent.session as unknown as SessionLike;

  // 1. 确定下一个 turn 号（从 session 事件推导，与 agent-loop 一致）
  const lastTurn = session.events.findLast((e) => e.type === 'turn/start')?.data.turn as number | undefined ?? 0;
  const turn = lastTurn + 1;
  const step = 1;

  // 2. 打开 turn/step（模拟 agent 回合）
  session.append('turn/start', { turn });
  session.append('step/start', { turn, step });

  // 3. 写入 assistant/message（合成 tool-call block，与模型输出结构一致：
  //    id/name/arguments，其中 arguments 是 JSON 字符串）
  const callId = CallId('script-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
  const toolCallBlock = {
    type: 'tool-call',
    id: callId,
    name: toolName,
    arguments: JSON.stringify(args),
  };
  // 触发来源不内嵌在 assistant 回合（避免视觉噪音），统一由命令处理器的
  // 插件来源说明（系统性质）向模型交代：tool/call 事件本身已含 name/scriptId。
  const assistantMessage = createAssistantMessage({
    content: [toolCallBlock],
    source: deriveModelSource(session),
  });
  session.append('assistant/message', {
    turn,
    step,
    message: assistantMessage,
  }, { surfaceOp: 'append' });

  // 4. 写入 tool/call（与 appendToolCall 一致：arguments 为 JSON 字符串）
  const callSeq = session.append('tool/call', {
    turn,
    step,
    callId,
    name: toolName,
    arguments: JSON.stringify(args),
  }).seq;

  // 5. 执行工具
  //    execFn: 调用方提供自定义执行器（如直接调用 runner.run），绕过工具管道
  //    默认: 走完整工具管道（pre-execute、审批、body、post-execute）
  let result: ToolExecutionResult;
  try {
    if (execFn) {
      result = await execFn(callId);
    } else {
      const outcome = await ctx.tools.execute({
        callId,
        name: toolName,
        arguments: args,
        agent,
        ...(parentToken !== undefined ? { parent: parentToken } : {}),
        signal: signal ?? new AbortController().signal,
      });
      result = outcome as unknown as ToolExecutionResult;
    }
  } catch (error) {
    // 工具框架失败：构造错误结果
    const message = error instanceof Error ? error.message : String(error);
    result = {
      isError: true,
      error: { message },
      content: [{ type: 'text', text: 'Error: ' + message }],
    } as unknown as ToolExecutionResult;
  }

  // 6. 写入 tool/result（与 appendToolResult 一致）
  const toolResultMessage = createToolResultMessage({
    callId,
    content: result.content,
    isError: result.isError,
  });
  session.append('tool/result', {
    turn,
    step,
    message: toolResultMessage,
    ...(result.error?.info !== undefined ? { error: result.error.info } : {}),
    ...(result.meta !== undefined ? { meta: result.meta } : {}),
  }, {
    surfaceOp: 'append',
    sourceEventSeqs: [callSeq],
  });

  // 7. 关闭 step/turn
  session.append('step/end', { turn, step });
  session.append('turn/end', { turn, reason: result.isError ? { kind: 'error', error: result.error } : { kind: 'completed' } });

  // 8. 同步 agent 的 lastTurn 状态（避免下次 agent 回合冲突；
  //    whenIdle 之后 agent 处于 idle 相位，字段为 lastTurn）
  const phase = (agent as unknown as { phase?: { lastTurn?: number } }).phase;
  if (phase && typeof phase.lastTurn === 'number') {
    phase.lastTurn = turn;
  }

  return result;
}
