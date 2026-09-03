/**
 * DSH Script Manager Plugin - Format Script Result
 * 统一的输出格式化函数
 *
 * 契约段说明：脚本可声明 expectedOutcome / successCriteria / failureGuidance
 * （执行契约，供执行完成后 agent 对照判断是否达预期、如何保证预期行为）。
 * 契约段置于过程/日志之前，方便 agent 先对照预期再检查过程。
 * B 层自绘卡(src/client.js ScriptRunToolView)解析首行 [Script] <name> 与 Time: —
 * 改动本文件时保持这两个标记仍可从文本定位。
 */

/** 格式化脚本执行结果 */
export function formatScriptResult(result: Record<string, unknown>): string {
  const parts: string[] = [];

  parts.push("[Script] " + (result.scriptName || "Unknown"));

  parts.push("Source code:");
  parts.push("```typescript");
  parts.push(String(result.scriptCode || ""));
  parts.push("```");

  parts.push("Result: " + (result.success ? "Success" : "Failed"));
  parts.push("Time: " + String(result.executionTime || 0) + "ms");

  // 执行契约段（有值才输出；先于 Logs，便于先对照预期再检查过程）
  const hasContract = result.expectedOutcome !== undefined || result.successCriteria !== undefined || result.failureGuidance !== undefined;
  if (result.expectedOutcome !== undefined) {
    parts.push("Expected:");
    parts.push(indentLines(String(result.expectedOutcome)));
  }
  if (result.successCriteria !== undefined) {
    parts.push("Verify:");
    parts.push(indentLines(String(result.successCriteria)));
  }
  if (result.failureGuidance !== undefined) {
    parts.push("On failure:");
    parts.push(indentLines(String(result.failureGuidance)));
  }

  // 本次生效参数（带参脚本；含默认合并后的实际值）
  if (result.params !== undefined) {
    parts.push("Params:");
    parts.push(JSON.stringify(result.params, null, 2));
  }
  const unknown = result.unknownParams as string[] | undefined;
  if (Array.isArray(unknown) && unknown.length > 0) {
    parts.push("Unknown params ignored: " + unknown.join(", "));
  }

  const logs = result.logs as string[] || [];
  if (logs.length > 0) {
    parts.push("Logs:");
    parts.push(logs.join("\n"));
  }

  if (result.value !== undefined) {
    parts.push("Return value:");
    parts.push(JSON.stringify(result.value, null, 2));
  }

  if (result.error) {
    parts.push("Error:");
    parts.push(String(result.error));
  }

  // 末尾核对行：引导 agent 对照契约判断是否达预期（有契约时）
  if (hasContract) {
    parts.push("Review: check Expected/Verify against the result to decide whether the script reached its intended behavior. If it did, stop here; otherwise intervene per On failure (fix inputs/state, or script_update then rerun script_run).");
  } else {
    parts.push("Note: this script declares no expectedOutcome/successCriteria. If its behavior proves unreliable, add them via script_update so future runs can be checked against expectations.");
  }

  return parts.join("\n");
}

/** 多行文本缩进两个空格（契约展示用）；空输入返回空串。 */
function indentLines(text: string): string {
  if (text === "") return "";
  return text
    .split("\n")
    .map(line => "  " + line)
    .join("\n");
}