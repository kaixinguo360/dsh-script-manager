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
  maxExecutionTime: number;
  enableWebUI: boolean;
}
