/**
 * DSH Script Manager Plugin - History Store
 * 脚本变更/执行历史存储（按脚本分储的追加式 JSONL，与脚本本体存储分离）。
 *
 * 布局（stateDir/<scriptId>/ 每脚本一个目录，为后续每脚本扩展预留并列空间）：
 *   <stateDir>/<scriptId>/changes.jsonl   变更日志（行序=顺序）
 *   <stateDir>/<scriptId>/runs.jsonl      执行日志
 *
 * 设计约束：
 * - 轻量：纯 node:fs 追加写，零第三方依赖；不做进程内全量状态重写
 *   （仅保留策略触发的整文件压缩会重写一次）。
 * - 分离：历史绝不写入脚本 <id>.json 或 index.json；删脚本时由调用方
 *   同步调用 deleteScriptHistory 整删该脚本目录。
 * - fail-open：任何读写失败只 console.warn（节流），绝不影响脚本 CRUD/执行。
 * - 修订号（revision）：每脚本 create=1，每次 update/rename +1；内存缓存，
 *   进程重启后首次访问扫文件尾部取最大修订号对齐；保留裁剪只裁最旧，
 *   因此最新修订号不回退（不会造成执行记录指向错误的版本）。
 */
import { mkdir, readFile, writeFile, appendFile, readdir, rm, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type {
  ScriptHistoryChange,
  ScriptHistoryRun,
  ScriptChangeRecord,
  ScriptRunRecord,
} from './types.js';

/** 合法脚本 id（与 ScriptStore 校验一致；兼作目录名安全校验）。 */
const SCRIPT_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** 展开 ~ 为用户主目录 */
function expandPath(path: string): string {
  if (path.startsWith('~')) return join(homedir(), path.slice(1));
  return path;
}

/** 节流 console.warn：同类消息每 60s 至多一条。 */
const warnThrottle = new Map<string, number>();
function warnOnce(key: string, message: string): void {
  const now = Date.now();
  const last = warnThrottle.get(key) ?? 0;
  if (now - last < 60_000) return;
  warnThrottle.set(key, now);
  console.warn('[dsh-script-manager] ' + message);
}

/** HistoryStore 构造选项 */
export interface HistoryStoreOptions {
  /** 单脚本 changes.jsonl 保留行数（默认 200）。 */
  changesMax?: number;
  /** 单脚本 runs.jsonl 保留行数（默认 500）。 */
  runsMax?: number;
}

/** 查询选项 */
export interface HistoryQueryOptions {
  scriptId?: string;
  limit?: number;
  offset?: number;
  /** changes 查询是否返回 snapshot（默认 false：快照可能很大，避免撑爆上下文/响应）。 */
  includeSnapshot?: boolean;
}

export class HistoryStore {
  private dir: string;
  private changesMax: number;
  private runsMax: number;
  /** 修订号缓存：scriptId -> 最新 revision。 */
  private revCache = new Map<string, number>();
  /** 行数计数：文件绝对路径 -> 当前行数（追加时递增，压缩后重置）。 */
  private lineCounts = new Map<string, number>();
  /** 追加/压缩串行队列（防并发交错写坏文件）。 */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(dir: string, options: HistoryStoreOptions = {}) {
    this.dir = expandPath(dir);
    this.changesMax = options.changesMax ?? 200;
    this.runsMax = options.runsMax ?? 500;
  }

  /** 初始化基目录（幂等）。 */
  async init(): Promise<void> {
    try {
      await mkdir(this.dir, { recursive: true });
      // 预扫行数，避免重启后第一笔追加触发过度压缩判断
      const children = await this.safeReaddir();
      for (const child of children) {
        if (!SCRIPT_ID_RE.test(child)) continue;
        const stats = await stat(join(this.dir, child)).catch(() => undefined);
        if (!stats || !stats.isDirectory()) continue;
        const changesFile = this.fileFor(child, 'changes');
        const runsFile = this.fileFor(child, 'runs');
        const c = await this.countLines(changesFile);
        if (c > 0) this.lineCounts.set(changesFile, c);
        const r = await this.countLines(runsFile);
        if (r > 0) this.lineCounts.set(runsFile, r);
      }
    } catch (error) {
      warnOnce('init', 'history init failed: ' + msg(error));
    }
  }

  /* ===== 记录 ===== */

  /** 追加一条变更记录（返回写入的完整条目）。失败 warn，不抛出。 */
  async recordChange(scriptId: string, rec: ScriptChangeRecord): Promise<ScriptHistoryChange | undefined> {
    if (!SCRIPT_ID_RE.test(scriptId)) return undefined;
    const entry: ScriptHistoryChange = { ...rec, scriptId, ts: new Date().toISOString() };
    const file = this.fileFor(scriptId, 'changes');
    return this.enqueue(async () => {
      await this.appendJsonl(file, entry);
      if (entry.revision !== undefined && entry.revision > (this.revCache.get(scriptId) ?? 0)) {
        this.revCache.set(scriptId, entry.revision);
      }
      await this.maybeCompact(file, this.changesMax);
      return entry;
    });
  }

  /** 追加一条执行记录。失败 warn，不抛出。 */
  async recordRun(scriptId: string, rec: ScriptRunRecord): Promise<ScriptHistoryRun | undefined> {
    if (!SCRIPT_ID_RE.test(scriptId)) return undefined;
    const entry: ScriptHistoryRun = { ...rec, scriptId, ts: new Date().toISOString() };
    const file = this.fileFor(scriptId, 'runs');
    return this.enqueue(async () => {
      await this.appendJsonl(file, entry);
      await this.maybeCompact(file, this.runsMax);
      return entry;
    });
  }

  /* ===== 修订号 ===== */

  /** 某脚本最新修订号；无记录/读取失败返回 undefined（不抛出）。 */
  async lastRevisionOf(scriptId: string): Promise<number | undefined> {
    if (!SCRIPT_ID_RE.test(scriptId)) return undefined;
    const cached = this.revCache.get(scriptId);
    if (cached !== undefined) return cached;
    // 缓存未命中：扫文件取最大修订号（首次访问对齐；裁剪只裁旧故不回退）
    const rows = await this.readRows<{ revision?: unknown }>(this.fileFor(scriptId, 'changes'));
    let max = 0;
    for (const row of rows) {
      if (typeof row.revision === 'number' && row.revision > max) max = row.revision;
    }
    if (max > 0) this.revCache.set(scriptId, max);
    return max > 0 ? max : undefined;
  }

  /** 计算该脚本下一修订号：最新 +1；无历史则为 1。 */
  async nextRevision(scriptId: string): Promise<number> {
    const last = await this.lastRevisionOf(scriptId);
    return last === undefined ? 1 : last + 1;
  }

  /* ===== 生命周期联动 ===== */

  /** 整删某脚本历史目录（删脚本时同步调用）。目录不存在静默成功；失败 warn。 */
  async deleteScriptHistory(scriptId: string): Promise<void> {
    if (!SCRIPT_ID_RE.test(scriptId)) return;
    this.revCache.delete(scriptId);
    const target = join(this.dir, scriptId);
    try {
      await rm(target, { recursive: true, force: true });
    } catch (error) {
      warnOnce('del-' + scriptId, 'failed to remove history of ' + scriptId + ': ' + msg(error));
    }
  }

  /** 脚本改名时迁移历史目录（含 runs 与修订号缓存）。目标已存在（罕见）时先合并再删源。 */
  async renameScriptHistory(oldId: string, newId: string): Promise<void> {
    if (!SCRIPT_ID_RE.test(oldId) || !SCRIPT_ID_RE.test(newId) || oldId === newId) return;
    const from = join(this.dir, oldId);
    const to = join(this.dir, newId);
    try {
      const fromStat = await stat(from).catch(() => undefined);
      if (!fromStat || !fromStat.isDirectory()) {
        // 源目录不存在：无历史可迁，仅迁移修订号缓存
        const rev = this.revCache.get(oldId);
        this.revCache.delete(oldId);
        if (rev !== undefined) this.revCache.set(newId, rev);
        return;
      }
      const toStat = await stat(to).catch(() => undefined);
      if (toStat && toStat.isDirectory()) {
        // 目标已存在：逐文件合并（追加源行），再删源目录
        for (const kind of ['changes', 'runs'] as const) {
          const srcFile = this.fileFor(oldId, kind);
          const dstFile = this.fileFor(newId, kind);
          const rows = await this.readRawLines(srcFile).catch(() => []);
          if (rows.length > 0) await appendFile(dstFile, rows.join('\n') + (rows.length > 0 ? '\n' : ''), 'utf-8');
          this.lineCounts.delete(srcFile);
        }
        await rm(from, { recursive: true, force: true });
      } else {
        await rename(from, to);
      }
      const rev = this.revCache.get(oldId);
      this.revCache.delete(oldId);
      if (rev !== undefined) this.revCache.set(newId, rev);
    } catch (error) {
      warnOnce('ren-' + oldId, 'failed to migrate history ' + oldId + ' -> ' + newId + ': ' + msg(error));
    }
  }

  /* ===== 查询 ===== */

  /** 变更历史（倒序=最新在前）。scriptId 缺省时聚合全部脚本；snapshot 默认剔除。 */
  async listChanges(options: HistoryQueryOptions = {}): Promise<ScriptHistoryChange[]> {
    const rows = await this.readAll<ScriptHistoryChange>(options.scriptId, 'changes');
    return this.sliceRows(rows, options.limit, options.offset, !options.includeSnapshot);
  }

  /** 执行历史（倒序=最新在前）。 */
  async listRuns(options: HistoryQueryOptions = {}): Promise<ScriptHistoryRun[]> {
    const rows = await this.readAll<ScriptHistoryRun>(options.scriptId, 'runs');
    return this.sliceRows(rows, options.limit, options.offset, true);
  }

  /* ===== 私有 ===== */

  private fileFor(scriptId: string, kind: 'changes' | 'runs'): string {
    return join(this.dir, scriptId, kind + '.jsonl');
  }

  /** 读全部行（含跨脚本聚合），按 ts 降序。 */
  private async readAll<T extends { ts?: unknown }>(scriptId: string | undefined, kind: 'changes' | 'runs'): Promise<T[]> {
    if (scriptId !== undefined) {
      if (!SCRIPT_ID_RE.test(scriptId)) return [];
      return this.readRows<T>(this.fileFor(scriptId, kind));
    }
    const out: T[] = [];
    const children = await this.safeReaddir();
    for (const child of children) {
      if (!SCRIPT_ID_RE.test(child)) continue;
      const stats = await stat(join(this.dir, child)).catch(() => undefined);
      if (!stats || !stats.isDirectory()) continue;
      out.push(...await this.readRows<T>(this.fileFor(child, kind)));
    }
    out.sort((a, b) => tsOf(b) - tsOf(a));
    return out;
  }

  private async safeReaddir(): Promise<string[]> {
    try { return await readdir(this.dir); } catch { return []; }
  }

  private async readRows<T>(file: string): Promise<T[]> {
    const lines = await this.readRawLines(file).catch(() => []);
    const rows: T[] = [];
    for (const line of lines) {
      const text = line.trim();
      if (text === '') continue;
      try {
        const parsed = JSON.parse(text) as unknown;
        if (parsed && typeof parsed === 'object') rows.push(parsed as T);
      } catch { /* 跳过损坏行 */ }
    }
    // 追加顺序=时间顺序 → 倒序即最新在前（跨脚本已按 ts 排序，此处同脚本无需再排）
    return rows.reverse();
  }

  private async readRawLines(file: string): Promise<string[]> {
    const content = await readFile(file, 'utf-8');
    return content.split('\n').filter((l: string) => l.trim() !== '');
  }

  private async countLines(file: string): Promise<number> {
    try {
      const lines = await this.readRawLines(file);
      return lines.length;
    } catch { return 0; }
  }

  private async appendJsonl(file: string, entry: unknown): Promise<void> {
    try {
      await mkdir(join(this.dir, (entry as { scriptId: string }).scriptId), { recursive: true });
    } catch { /* 目录创建失败由 append 失败兜底 */ }
    const line = JSON.stringify(entry) + '\n';
    await appendFile(file, line, 'utf-8');
    this.lineCounts.set(file, (this.lineCounts.get(file) ?? 0) + 1);
  }

  /** 超限触发异步整文件压缩（保留最新 N 行），经同一队列串行。 */
  private async maybeCompact(file: string, max: number): Promise<void> {
    const count = this.lineCounts.get(file) ?? 0;
    if (count <= max) return;
    const rows = await this.readRawLines(file).catch(() => []);
    const keep = rows.slice(-max);
    const tmp = file + '.tmp';
    try {
      await writeFile(tmp, keep.length > 0 ? keep.join('\n') + '\n' : '', 'utf-8');
      await rename(tmp, file);
      this.lineCounts.set(file, keep.length);
    } catch (error) {
      warnOnce('compact', 'history compaction failed for ' + file + ': ' + msg(error));
      try { await rm(tmp, { force: true }); } catch { /* ignore */ }
    }
  }

  private sliceRows<T>(rows: T[], limit: number | undefined, offset: number | undefined, dropSnapshot: boolean): T[] {
    const off = offset !== undefined && Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
    let out = off > 0 ? rows.slice(off) : rows;
    if (limit !== undefined && Number.isFinite(limit) && limit > 0) out = out.slice(0, Math.floor(limit));
    if (dropSnapshot) {
      out = out.map(row => {
        const { snapshot: _snapshot, ...rest } = row as unknown as Record<string, unknown>;
        return rest as unknown as T;
      });
    }
    return out;
  }

  /** 追加与压缩串行执行；失败 warn 不抛出。 */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    // 吞掉队列里已失败的尾巴，保证后续任务继续
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }
}

function msg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function tsOf(row: Record<string, unknown>): number {
  const t = typeof row.ts === 'string' ? new Date(row.ts).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
}
