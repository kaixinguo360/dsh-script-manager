/**
 * DSH Script Manager Plugin - Web Routes
 * 脚本管理 REST API（node:http 原生，挂载为 /api/scripts 前缀路由）
 *
 * 路由语义（kind: "prefixes"，长前缀优先）：
 *   GET    /api/scripts            → 列表（支持 tags/limit 查询参数）
 *   GET    /api/scripts/<id>       → 详情
 *   POST   /api/scripts            → 创建（body 为脚本字段）
 *   PUT    /api/scripts/<id>       → 更新（body 为补丁字段）
 *   DELETE /api/scripts/<id>       → 删除
 *
 * 说明：本 API 不提供执行端点——脚本执行必须走 /script 命令管道
 * （client 端 ctx.remote.commands.execute），以携带 agent/parentToken
 * 上下文，保证脚本内 tools.* 绑定完整可用。
 */

import type { ScriptStore } from '../script-store.js';
import { ValidationError } from '../script-store.js';
import type { HistoryStore } from '../history-store.js';

interface WebServerRoute {
  kind: 'exact' | 'prefixes';
  path: string;
  handler: (req: any, res: any) => void | Promise<void>;
}

interface WebServerContext {
  register(route: WebServerRoute): () => void;
}

/** 读取请求体（JSON）。空体返回 {}；解析失败抛错由调用方转 400。 */
async function readBody(req: any): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (raw === '') return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

/** 统一 JSON 响应 */
function json(res: any, status: number, body: unknown): void {
  const payload = JSON.stringify(body ?? {});
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
}

/** 从 URL 解析查询参数 */
function parseQuery(req: any): Record<string, string> {
  const url = new URL(req.url ?? '/', 'http://x');
  const out: Record<string, string> = {};
  url.searchParams.forEach((v, k) => { out[k] = v; });
  return out;
}

/** 注册所有脚本管理路由；返回清理函数。 */
export function registerScriptRoutes(
  injected: { webServer?: WebServerContext },
  store: ScriptStore,
  onChanged?: () => Promise<void> | void,
  history?: HistoryStore,
): () => void {
  const webServer = injected?.webServer;
  if (!webServer || typeof webServer.register !== 'function') {
    return () => {};
  }
  const disposers: (() => void)[] = [];

  disposers.push(webServer.register({
    kind: 'prefixes',
    path: '/api/scripts',
    handler: async (req: any, res: any) => {
      const method = (req.method ?? 'GET').toUpperCase();
      const pathname = new URL(req.url ?? '/', 'http://x').pathname;
      // 前缀匹配下路径形如 /api/scripts 或 /api/scripts/<id>
      const rest = pathname === '/api/scripts' ? '' : pathname.slice('/api/scripts/'.length);
      const id = rest === '' ? null : decodeURIComponent(rest);

      try {
        if (method === 'GET') {
          if (id === null) {
            const query = parseQuery(req);
            const scripts = await store.list({
              ...(query.tags !== undefined ? { tags: query.tags.split(',').filter(Boolean) } : {}),
              ...(query.limit !== undefined ? { limit: Number(query.limit) || undefined } : {}),
            });
            return json(res, 200, scripts);
          }
          const script = await store.get(id);
          if (!script) return json(res, 404, { error: 'Script not found: ' + id });
          return json(res, 200, script);
        }

        if (method === 'POST') {
          if (id !== null) return json(res, 400, { error: 'POST /api/scripts does not accept an id path segment' });
          const body = await readBody(req);
          const script = await store.create(body as any, { source: 'web' });
          if (onChanged) await onChanged();
          return json(res, 200, script);
        }

        if (method === 'PUT') {
          if (id === null) return json(res, 400, { error: 'PUT /api/scripts requires /<id>' });
          const body = await readBody(req);
          const script = await store.update(id, body as any, { source: 'web' });
          if (onChanged) await onChanged();
          return json(res, 200, script);
        }

        if (method === 'DELETE') {
          if (id === null) return json(res, 400, { error: 'DELETE /api/scripts requires /<id>' });
          const ok = await store.delete(id, { source: 'web' });
          if (!ok) return json(res, 404, { error: 'Script not found: ' + id });
          if (onChanged) await onChanged();
          return json(res, 200, { success: true });
        }

        return json(res, 405, { error: 'Method not allowed: ' + method });
      } catch (error: any) {
        const status = (error instanceof SyntaxError || error instanceof ValidationError) ? 400 : 500;
        json(res, status, { error: error instanceof Error ? error.message : String(error) });
      }
    },
  }));

  // 历史查询端点：GET /api/script-history/<changes|runs>?scriptId=&limit=&offset=&includeSnapshot=1
  disposers.push(webServer.register({
    kind: 'prefixes',
    path: '/api/script-history',
    handler: async (req: any, res: any) => {
      const method = (req.method ?? 'GET').toUpperCase();
      const pathname = new URL(req.url ?? '/', 'http://x').pathname;
      const rest = pathname === '/api/script-history' ? '' : pathname.slice('/api/script-history/'.length);
      const kind = rest === '' ? 'runs' : decodeURIComponent(rest);
      if (method !== 'GET') {
        return json(res, 405, { error: 'Method not allowed: ' + method });
      }
      if (kind !== 'changes' && kind !== 'runs') {
        return json(res, 400, { error: 'History kind must be changes or runs: ' + kind });
      }
      try {
        const query = parseQuery(req);
        const options = {
          scriptId: query.scriptId ? decodeURIComponent(query.scriptId) : undefined,
          limit: query.limit !== undefined ? (Number(query.limit) || 50) : 50,
          offset: query.offset !== undefined ? (Number(query.offset) || 0) : undefined,
          includeSnapshot: query.includeSnapshot === '1' || query.includeSnapshot === 'true',
        };
        if (!history) {
          return json(res, 200, { kind, entries: [], disabled: true });
        }
        const entries = kind === 'changes'
          ? await history.listChanges(options)
          : await history.listRuns(options);
        return json(res, 200, { kind, entries });
      } catch (error: any) {
        json(res, 500, { error: error instanceof Error ? error.message : String(error) });
      }
    },
  }));

  return () => { for (const d of disposers) d(); };
}
