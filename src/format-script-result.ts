/**
 * DSH Script Manager Plugin - Format Script Result
 * 统一的输出格式化函数
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

  return parts.join("\n");
}