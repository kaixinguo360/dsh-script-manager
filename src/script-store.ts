/**
 * DSH Script Manager Plugin - Script Store
 * 脚本持久化存储（文件系统）
 * @module dsh-script-manager/script-store
 */

import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { ScriptDefinition, ScriptMetadata, ScriptSummary } from './types.js';

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

  /** 创建脚本 */
  async create(script: Omit<ScriptDefinition, 'metadata'>): Promise<ScriptDefinition> {
    // 校验：id 非空、合法字符、不重复（避免覆盖同名脚本）
    const id = (script.id ?? '').trim();
    if (!id) throw new Error('Script id is required');
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      throw new Error('Script id must match ^[a-z0-9][a-z0-9-]*$ (lowercase letters, digits, hyphens)');
    }
    if (this.index.has(id) || await this.get(id) !== undefined) {
      throw new Error('Script already exists: ' + id);
    }
    const now = new Date().toISOString();
    const fullScript: ScriptDefinition = {
      ...script,
      id,
      metadata: { createdAt: now, updatedAt: now, executionCount: 0 },
    };
    await writeFile(this.getScriptPath(id), JSON.stringify(fullScript, null, 2), 'utf-8');
    this.index.set(id, {
      id: fullScript.id, name: fullScript.name, description: fullScript.description,
      version: fullScript.version, author: fullScript.author, tags: fullScript.tags,
      registerAsTool: fullScript.registerAsTool, metadata: fullScript.metadata,
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
      throw new Error('Script id must match ^[a-z0-9][a-z0-9-]*$ (lowercase letters, digits, hyphens)');
    }
    if (nextId !== scriptId && await this.get(nextId) !== undefined) {
      throw new Error("Script already exists: " + nextId);
    }
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
      registerAsTool: updated.registerAsTool, metadata: updated.metadata,
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