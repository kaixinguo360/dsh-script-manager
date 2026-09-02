/**
 * DSH Script Manager Plugin - Script Store
 * 脚本持久化存储（文件系统）
 * @module dsh-script-manager/script-store
 */

import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { ScriptDefinition, ScriptMetadata, ScriptSummary } from './types.js';
import { isValidToolName } from './script-tool-registry.js';

/** 输入校验错误（REST 层映射为 HTTP 400）。 */
export class ValidationError extends Error {}

/** 校验单个字段；返回规范化后的值或抛 ValidationError。 */
function requireNonEmpty(value: unknown, field: string): string {
  const text = value === undefined || value === null ? '' : String(value).trim();
  if (!text) throw new ValidationError(field + ' is required');
  return text;
}
function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text === '' ? undefined : text;
}
function validateToolName(value: unknown): string | undefined {
  const text = optionalString(value);
  if (text !== undefined && !isValidToolName(text)) {
    throw new ValidationError('toolName must match ^[a-z_][a-z0-9_]*$ when provided');
  }
  return text;
}

/** 校验执行超时预算：必须为正整数（缺省 = 未设置，跟随插件默认）。 */
function validateTimeoutMs(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const ms = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(ms) || ms <= 0 || !Number.isInteger(ms)) {
    throw new ValidationError('timeoutMs must be a positive integer (milliseconds)');
  }
  return ms;
}

/** 展开 ~ 为用户主目录 */
function expandPath(path: string): string {
  if (path.startsWith('~')) {
    return join(homedir(), path.slice(1));
  }
  return path;
}

/** 脚本存储类 */
export class ScriptStore {
  private scriptsDir: string;
  private indexFile: string;
  private index: Map<string, ScriptSummary> = new Map();

  constructor(scriptsDir: string) {
    this.scriptsDir = expandPath(scriptsDir);
    this.indexFile = join(this.scriptsDir, 'index.json');
  }

  /** 初始化存储目录 */
  async init(): Promise<void> {
    await mkdir(this.scriptsDir, { recursive: true });
    await this.loadIndex();
  }

  /** 加载索引文件 */
  private async loadIndex(): Promise<void> {
    try {
      const content = await readFile(this.indexFile, 'utf-8');
      const entries: ScriptSummary[] = JSON.parse(content);
      this.index.clear();
      for (const entry of entries) {
        this.index.set(entry.id, this.stripUndefined(entry));
      }
    } catch {
      this.index.clear();
    }
  }

  /** Remove undefined properties from an object (lossless JSON requirement) */
  private stripUndefined<T extends Record<string, unknown>>(obj: T): T {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined) continue;
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        cleaned[key] = this.stripUndefined(value as Record<string, unknown>);
      } else {
        cleaned[key] = value;
      }
    }
    return cleaned as T;
  }

  /** 保存索引文件 */
  private async saveIndex(): Promise<void> {
    const entries = Array.from(this.index.values());
    await writeFile(this.indexFile, JSON.stringify(entries, null, 2), 'utf-8');
  }

  /** 获取脚本文件路径 */
  private getScriptPath(scriptId: string): string {
    return join(this.scriptsDir, scriptId + '.json');
  }

  /** 列出所有脚本摘要 */
  async list(options?: { tags?: string[]; limit?: number }): Promise<ScriptSummary[]> {
    let scripts = Array.from(this.index.values()).map(s => this.stripUndefined(s));
    if (options?.tags && options.tags.length > 0) {
      scripts = scripts.filter(s => options.tags!.some(tag => s.tags.includes(tag)));
    }
    scripts.sort((a, b) => new Date(b.metadata.updatedAt).getTime() - new Date(a.metadata.updatedAt).getTime());
    if (options?.limit && options.limit > 0) {
      scripts = scripts.slice(0, options.limit);
    }
    return scripts;
  }

  /** 获取脚本完整定义 */
  async get(scriptId: string): Promise<ScriptDefinition | undefined> {
    try {
      const content = await readFile(this.getScriptPath(scriptId), 'utf-8');
      return JSON.parse(content) as ScriptDefinition;
    } catch {
      return undefined;
    }
  }

  /** 创建脚本（全字段校验） */
  async create(script: Omit<ScriptDefinition, 'metadata'>): Promise<ScriptDefinition> {
    // id：非空、合法字符、不重复（避免覆盖同名脚本与路径穿越）
    const id = (script.id ?? '').trim();
    if (!id) throw new ValidationError('Script id is required');
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      throw new ValidationError('Script id must match ^[a-z0-9][a-z0-9-]*$ (lowercase letters, digits, hyphens)');
    }
    if (this.index.has(id) || await this.get(id) !== undefined) {
      throw new ValidationError('Script already exists: ' + id);
    }
    // name / code：必填（执行与回显必需）
    const name = requireNonEmpty(script.name, 'Script name');
    const code = requireNonEmpty(script.code, 'Script code');
    // registerAsTool：必须为布尔
    if (script.registerAsTool !== undefined && typeof script.registerAsTool !== 'boolean') {
      throw new ValidationError('registerAsTool must be a boolean');
    }
    // tags：必须为字符串数组
    if (script.tags !== undefined &&
        (!Array.isArray(script.tags) || script.tags.some(t => typeof t !== 'string'))) {
      throw new ValidationError('tags must be an array of strings');
    }
    // toolName：提供且非空时必须合法
    const toolName = validateToolName(script.toolName);
    // timeoutMs：可选，正整数毫秒
    const timeoutMs = validateTimeoutMs(script.timeoutMs);
    const description = optionalString(script.description) ?? '';
    const version = optionalString(script.version) ?? '0.1.0';
    const author = optionalString(script.author) ?? '';

    const now = new Date().toISOString();
    // 注意：不要残留值为 undefined 的 toolName 键（lossless JSON 校验要求）
    const fullScript: ScriptDefinition = {
      ...script,
      id,
      name,
      code,
      description,
      version,
      author,
      tags: script.tags ? (script.tags as string[]) : [],
      registerAsTool: script.registerAsTool === true,
      ...(toolName !== undefined ? { toolName } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      metadata: { createdAt: now, updatedAt: now, executionCount: 0 },
    } as ScriptDefinition;
    await writeFile(this.getScriptPath(id), JSON.stringify(fullScript, null, 2), 'utf-8');
    this.index.set(id, {
      id: fullScript.id, name: fullScript.name, description: fullScript.description,
      version: fullScript.version, author: fullScript.author, tags: fullScript.tags,
      registerAsTool: fullScript.registerAsTool, ...(fullScript.toolName !== undefined ? { toolName: fullScript.toolName } : {}), ...(fullScript.timeoutMs !== undefined ? { timeoutMs: fullScript.timeoutMs } : {}), metadata: fullScript.metadata,
    });
    await this.saveIndex();
    return fullScript;
  }

  /** 更新脚本；patch.id 变更时执行重命名（旧文件删除、新文件写入、索引同步） */
  async update(scriptId: string, patch: Partial<ScriptDefinition>): Promise<ScriptDefinition> {
    const existing = await this.get(scriptId);
    if (!existing) throw new Error("Script not found: " + scriptId);
    const nextId = (patch.id !== undefined ? String(patch.id).trim() : scriptId) || scriptId;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(nextId)) {
      throw new ValidationError('Script id must match ^[a-z0-9][a-z0-9-]*$ (lowercase letters, digits, hyphens)');
    }
    if (nextId !== scriptId && await this.get(nextId) !== undefined) {
      throw new ValidationError("Script already exists: " + nextId);
    }
    // patch 字段校验（仅校验显式提供的字段）
    if (patch.name !== undefined) requireNonEmpty(patch.name, 'Script name');
    if (patch.code !== undefined) requireNonEmpty(patch.code, 'Script code');
    if (patch.registerAsTool !== undefined && typeof patch.registerAsTool !== 'boolean') {
      throw new ValidationError('registerAsTool must be a boolean');
    }
    if (patch.tags !== undefined &&
        (!Array.isArray(patch.tags) || patch.tags.some(t => typeof t !== 'string'))) {
      throw new ValidationError('tags must be an array of strings');
    }
    if (patch.toolName !== undefined) validateToolName(patch.toolName);
    if (patch.timeoutMs !== undefined) validateTimeoutMs(patch.timeoutMs);

    const updated: ScriptDefinition = {
      ...existing, ...patch, id: nextId,
      metadata: { ...existing.metadata, ...patch.metadata, updatedAt: new Date().toISOString() },
    };
    await writeFile(this.getScriptPath(nextId), JSON.stringify(updated, null, 2), 'utf-8');
    if (nextId !== scriptId) {
      try { await unlink(this.getScriptPath(scriptId)); } catch { /* 源文件可能不存在 */ }
    }
    this.index.delete(scriptId);
    this.index.set(nextId, {
      id: updated.id, name: updated.name, description: updated.description,
      version: updated.version, author: updated.author, tags: updated.tags,
      registerAsTool: updated.registerAsTool, ...(updated.toolName !== undefined ? { toolName: updated.toolName } : {}), ...(updated.timeoutMs !== undefined ? { timeoutMs: updated.timeoutMs } : {}), metadata: updated.metadata,
    });
    await this.saveIndex();
    return updated;
  }

  /** 删除脚本 */
  async delete(scriptId: string): Promise<boolean> {
    try {
      await unlink(this.getScriptPath(scriptId));
      this.index.delete(scriptId);
      await this.saveIndex();
      return true;
    } catch {
      return false;
    }
  }

  /** 搜索脚本 */
  async search(query: string, options?: { tags?: string[] }): Promise<ScriptSummary[]> {
    const scripts = Array.from(this.index.values());
    const lowerQuery = query.toLowerCase();
    return scripts.filter(s => {
      const matchesQuery = !query || s.name.toLowerCase().includes(lowerQuery) ||
        s.description.toLowerCase().includes(lowerQuery) || s.id.toLowerCase().includes(lowerQuery);
      const matchesTags = !options?.tags || options.tags.length === 0 ||
        options.tags.some(tag => s.tags.includes(tag));
      return matchesQuery && matchesTags;
    });
  }

  /** 记录执行统计 */
  async recordExecution(scriptId: string, error?: string): Promise<void> {
    const script = await this.get(scriptId);
    if (!script) return;
    script.metadata.executionCount++;
    script.metadata.lastExecutedAt = new Date().toISOString();
    if (error !== undefined) {
      script.metadata.lastError = error;
    } else {
      delete script.metadata.lastError;
    }
    await writeFile(this.getScriptPath(scriptId), JSON.stringify(script, null, 2), 'utf-8');
    const summary = this.index.get(scriptId);
    if (summary) { summary.metadata = { ...script.metadata }; await this.saveIndex(); }
  }
}