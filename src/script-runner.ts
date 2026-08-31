/**
 * DSH Script Manager Plugin - Script Runner
 * 脚本执行引擎（基于 ctx.codeRuntime）
 */

import type { Context } from '@deepseek-ai/cordis';
import { CallId } from '@deepseek-ai/dsh-llm';
import type { Agent, ToolExecutionToken } from '@deepseek-ai/dsh-tools';
import type { CodeBindingFunction, CodeBindingNamespace } from '@deepseek-ai/dsh-code-runtime';
import type { ScriptStore } from './script-store.js';

let callCounter = 0;

/** 脚本执行器 */
export class ScriptRunner {
  constructor(
    private store: ScriptStore,
    private ctx: Context,
  ) {}

  /**
   * Execute a registered script.
   *
   * @param scriptId - the script to run
   * @param signal - optional cancellation signal
   * @param agent - the calling agent (for tool scope resolution)
   * @param parentToken - the caller's execution token, used as `parent` in
   *   tool bindings so DSH treats them as sub-dispatches (required to bypass
   *   the `mode: 'code'` restriction that only allows `run_code` directly).
   */
  async run(
    scriptId: string,
    signal?: AbortSignal,
    agent?: Agent,
    parentToken?: ToolExecutionToken,
  ): Promise<Record<string, unknown>> {
    const script = await this.store.get(scriptId);
    if (!script) {
      throw new Error("Script not found: " + scriptId);
    }

    const startTime = Date.now();

    const bindings: CodeBindingNamespace[] = [{
      global: 'tools',
      functions: this.createToolBindings(agent, parentToken),
      errorClass: { name: 'ToolCallError', memberNameProperty: 'toolName' },
    }];

    const result = await this.ctx.codeRuntime.run({
      program: script.code,
      bindings,
      signal,
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

    if (result.value !== undefined) {
      runResult.value = result.value;
    }

    if (result.error) {
      runResult.error = result.error.message;
    }

    return runResult;
  }

  /**
   * Create tool bindings for the code runtime worker.
   *
   * Each binding bridges worker → host: the worker calls tools.xxx(args),
   * the host resolves the tool through ctx.tools.execute(), and returns
   * the plain JSON value back to the worker.
   *
   * Key requirements (learned through iterative debugging):
   * 1. agent: must be passed to both schemas() and execute() so that
   *    agent-scoped tools (read, write, bash, etc.) are visible and resolvable.
   * 2. parentToken: must be set to the caller's exec.token so DSH treats the
   *    call as a sub-dispatch, bypassing the mode: 'code' restriction that
   *    only allows 'run_code' to be called directly.
   * 3. callId: must use CallId(string) — the branded factory function, NOT
   *    CallId.create() which doesn't exist.
   * 4. return value: must be plain lossless JSON — extract .value from the
   *    ToolResult, not the full ToolResult object.
   */
  private createToolBindings(agent?: Agent, parentToken?: ToolExecutionToken): Record<string, CodeBindingFunction> {
    const toolBindings: Record<string, CodeBindingFunction> = {};
    const schemas = this.ctx.tools.schemas(agent);
    for (const schema of schemas) {
      toolBindings[schema.name] = async (args: unknown) => {
        const result = await this.ctx.tools.execute({
          callId: CallId('script-' + Date.now() + '-' + (++callCounter)),
          name: schema.name,
          arguments: args,
          agent,
          parent: parentToken,
          signal: AbortSignal.timeout(30000),
        });
        if (result.isError) {
          throw new Error(result.error.message);
        }
        return result.value;
      };
    }
    return toolBindings;
  }
}
