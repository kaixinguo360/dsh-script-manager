/**
 * DSH Script Manager Plugin - Type Definitions
 * @module dsh-script-manager/types
 */

import type { ParameterSchemaSpec, ValueSchemaSpec } from '@deepseek-ai/dsh-tools';

/** 脚本定义：一个独立可执行的 PTC 单元 */
export interface ScriptDefinition {
  /** 脚本唯一标识（文件名即 ID） */
  id: string;
  /** 脚本显示名称 */
  name: string;
  /** 脚本描述（发送给 model） */
  description: string;
  /** 版本号 */
  version: string;
  /** 作者 */
  author: string;
  /** 标签 */
  tags: string[];
  /** 脚本代码（TypeScript async function body） */
  code: string;
  /** 是否注册为 agent 可调用的 tool */
  registerAsTool: boolean;
  /** 若 registerAsTool=true，动态注册的 tool 名称 */
  toolName?: string;
  /**
   * 单次执行超时预算（毫秒，正整数）。缺省 = 跟随插件配置 maxExecutionTime
   * （默认 0 = 不限制）；调用级 script_run({ timeoutMs }) 可临时覆盖。
   * 0 与缺省等价（不设置）。
   */
  timeoutMs?: number;
  /**
   * 执行契约（可选，多行文本）：脚本执行完成后 agent 应达成的结果。
   * 随执行结果一并提供给 agent 对照判断脚本是否达到预期行为。
   * 改动 formatScriptResult 的契约段展示时须同步本字段语义。
   */
  expectedOutcome?: string;
  /** 执行契约（可选）：如何验证脚本达到预期——可检查的迹象/检查点清单。 */
  successCriteria?: string;
  /** 执行契约（可选）：未达预期/失败时 agent 应如何介入调整的指引。 */
  failureGuidance?: string;
  /** 元数据 */
  metadata: ScriptMetadata;
}

/** 脚本元数据 */
export interface ScriptMetadata {
  createdAt: string;
  updatedAt: string;
  executionCount: number;
  lastExecutedAt?: string;
  lastError?: string;
}

/** 脚本摘要（列表展示用） */
export interface ScriptSummary {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  tags: string[];
  registerAsTool: boolean;
  /** 若 registerAsTool=true，动态注册的 tool 名称（缺省按 id 派生） */
  toolName?: string;
  metadata: ScriptMetadata;
}

/** 脚本执行结果 */
export interface ScriptRunResult {
  success: boolean;
  scriptId: string;
  scriptName: string;
  scriptCode: string;
  value?: unknown;
  logs: string[];
  error?: string;
  executionTime: number;
  /** 执行契约直传（供 formatScriptResult 展示与 agent 对照验收）。 */
  expectedOutcome?: string;
  successCriteria?: string;
  failureGuidance?: string;
}

/** 脚本管理操作参数 */
export interface ScriptManageArgs {
  action: 'create' | 'update' | 'delete' | 'get' | 'list' | 'search';
  scriptId?: string;
  script?: Partial<ScriptDefinition>;
  query?: string;
  tags?: string[];
  limit?: number;
}

/** 插件配置 */
export interface PluginConfig {
  scriptsDir: string;
  /** 默认执行超时预算（毫秒）；0 = 不限制（脚本级/调用级可单独覆盖）。 */
  maxExecutionTime: number;
  enableWebUI: boolean;
}
