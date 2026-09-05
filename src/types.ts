/**
 * DSH Script Manager Plugin - Type Definitions
 * @module dsh-script-manager/types
 */

import type { ParameterSchemaSpec, ValueSchemaSpec } from '@deepseek-ai/dsh-tools';
import type { NormalizedScriptParameter } from './script-params.js';

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
   * 参数化脚本声明：每个参数必输或选输（选输必须有默认值）。
   * 执行时输入经校验/合并后以 params.<name> 注入脚本。
   */
  parameters?: NormalizedScriptParameter[];
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
  /** 参数声明（带参脚本的候选/动态工具需要；无参脚本缺省） */
  parameters?: NormalizedScriptParameter[];
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
  /** 本次实际生效参数（输入合并默认；仅带参脚本）。 */
  params?: Record<string, string | number | boolean>;
  /** 传入但未声明的参数名（忽略不阻塞，展示供审查）。 */
  unknownParams?: string[];
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

/* ===== 脚本历史（与脚本本体存储分离；按脚本分储于 stateDir/<scriptId>/） ===== */

/** 变更来源（入口面）：REST(Web UI)=web；script_* 工具=tool；未知留空。 */
export type ScriptChangeSource = 'web' | 'tool' | '';

/** 变更动作 */
export type ScriptChangeAction = 'create' | 'update' | 'rename';

/**
 * 变更历史条目（changes.jsonl 一行）。
 * revision 为该脚本定义代次：create=1，之后每次 update/rename 递增 1；
 * 与脚本自定义展示版本 version（如 0.1.0）无关。
 */
export interface ScriptHistoryChange {
  /** ISO 时间戳（记录时自动填）。 */
  ts: string;
  /** 脚本 id。 */
  scriptId: string;
  /** 修订号（第 N 版定义）。 */
  revision: number;
  action: ScriptChangeAction;
  /** 变更入口面。 */
  source?: ScriptChangeSource;
  /** 相对上一快照变更的顶层字段（create 为全部字段，rename 含 id）。 */
  fields?: string[];
  /** 该版本完整脚本定义快照（含 code）。 */
  snapshot?: ScriptDefinition;
}

/** 变更记录入参（ts 由记录层自动填）。 */
export type ScriptChangeRecord = Omit<ScriptHistoryChange, 'ts'>;

/**
 * 执行历史条目（runs.jsonl 一行）。
 * revision = 执行启动时该脚本的最新修订号，用于回答"哪个版本执行的"，
 * 可与变更历史同 revision 的 snapshot 联动取回当时代码。
 */
export interface ScriptHistoryRun {
  /** ISO 时间戳（记录时自动填）。 */
  ts: string;
  scriptId: string;
  /** 执行所基于的修订号；无变更历史时为 undefined。 */
  revision?: number;
  /** 调用面：script_run | dynamic-tool:<toolName> | script_run(/script)。 */
  caller?: string;
  /** 本次生效参数（含默认合并；仅带参脚本）。 */
  params?: Record<string, string | number | boolean>;
  success: boolean;
  executionTime: number;
  /** 错误消息（截断）。 */
  error?: string;
  /** 返回值 JSON 摘要（截断）。 */
  value?: string;
  valueTruncated?: boolean;
}

/** 执行记录入参（ts 由记录层自动填）。 */
export type ScriptRunRecord = Omit<ScriptHistoryRun, 'ts'>;

/** 历史查询种类。 */
export type ScriptHistoryKind = 'changes' | 'runs';

/** 写操作来源元数据（store.create/update/delete 可选入参）。 */
export interface ScriptWriteMeta {
  /** 入口面：web / tool / ''。 */
  source?: ScriptChangeSource;
}
