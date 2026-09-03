/**
 * DSH Script Manager Plugin - Script Parameter Helpers
 * 参数定义校验与执行时参数解析(纯函数,store/runner 共用,避免规则分叉)。
 *
 * 规则:
 * - name 为合法标识符 [A-Za-z_][A-Za-z0-9_]*(脚本内以 params.<name> 读取);
 * - required=true 不得提供 default;required=false 必须提供 default 且类型匹配 type;
 * - type 缺省 'string'。
 */

export type ScriptParamType = 'string' | 'number' | 'boolean';

export interface ScriptParameter {
  /** 参数名(合法标识符);脚本内即 params.<name>。 */
  name: string;
  /** 值类型,缺省 string。 */
  type?: ScriptParamType;
  /** 展示名,缺省=name。 */
  label?: string;
  description?: string;
  /** 必输参数:无默认,执行时必须提供。 */
  required: boolean;
  /** 选输参数必须提供默认值,且与 type 匹配。 */
  default?: string | number | boolean;
}

/** 归一后的参数(去除空可选键,保证 lossless JSON)。 */
export type NormalizedScriptParameter = ScriptParameter & { type: ScriptParamType; label?: string; description?: string } &
  (
    | { required: true; default?: undefined }
    | { required: false; default: string | number | boolean }
  );

const PARAM_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 参数名的模型可见描述(错误消息复用)。 */
export function paramTypeOf(type: ScriptParamType): string { return type; }

/**
 * 校验并归一一段参数定义(脚本创建/更新时调用)。
 * @param raw - 待校验的 ScriptParameter[] 或 undefined/空。
 * @param field - 错误前缀(如 'parameters')。
 * @returns 归一后的数组(空输入返回 undefined);违规抛 Error(message 可读)。
 */
export function normalizeScriptParameters(raw: unknown, field = 'parameters'): NormalizedScriptParameter[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) throw new Error(field + ' must be an array when provided');

  const seen = new Set<string>();
  const out: NormalizedScriptParameter[] = [];
  raw.forEach((entry, index) => {
    const at = field + '[' + index + ']';
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(at + ' must be an object');
    }
    const e = entry as Record<string, unknown>;

    // name:必填、标识符、不重复
    const name = typeof e.name === 'string' ? e.name.trim() : '';
    if (!name) throw new Error(at + '.name is required');
    if (!PARAM_NAME_RE.test(name)) {
      throw new Error(at + '.name must match ^[A-Za-z_][A-Za-z0-9_]*$ (identifier accessible as params.<name>)');
    }
    if (seen.has(name)) throw new Error(at + '.name duplicates parameter ' + name);
    seen.add(name);

    // type:枚举,缺省 string
    const type: ScriptParamType = e.type === undefined || e.type === null || e.type === '' ? 'string'
      : e.type === 'string' || e.type === 'number' || e.type === 'boolean' ? e.type
        : (() => { throw new Error(at + '.type must be one of string|number|boolean'); })();

    // label / description:可选字符串
    const label = e.label === undefined || e.label === null ? undefined : String(e.label).trim() || undefined;
    const description = e.description === undefined || e.description === null ? undefined : String(e.description).trim() || undefined;

    // required:布尔,缺省 false(选输)
    const required = e.required === undefined ? false : e.required;
    if (typeof required !== 'boolean') throw new Error(at + '.required must be a boolean');

    // default:required=true 不得提供(即使空串);required=false 必须声明默认值。
    // "已声明"仅以键存在且非 null/undefined 判定——空字符串是 string 参数的合法默认值,
    // 不能把 default:'' 误判为"未声明"(否则可选 string 无法以空串为默认)。
    const hasDefault = e.default !== undefined && e.default !== null;
    if (required && hasDefault) throw new Error(at + ': a required parameter must not declare a default');
    if (!required && !hasDefault) throw new Error(at + ': an optional parameter must declare a default value');

    let def: string | number | boolean | undefined;
    if (hasDefault) {
      const dv = e.default;
      if (type === 'string') {
        if (typeof dv !== 'string') throw new Error(at + '.default must be a string for type string');
        def = dv; // 空串合法默认值,原样保留
      } else if (type === 'number') {
        if (typeof dv === 'number' && Number.isFinite(dv)) def = dv;
        else if (typeof dv === 'string' && dv.trim() !== '' && Number.isFinite(Number(dv))) def = Number(dv);
        else throw new Error(at + '.default must be a finite number for type number');
      } else {
        if (typeof dv === 'boolean') def = dv;
        else if (typeof dv === 'string' && (dv === 'true' || dv === 'false')) def = dv === 'true';
        else throw new Error(at + '.default must be a boolean for type boolean');
      }
    }

    const normalized = { name, type, required } as NormalizedScriptParameter;
    if (label !== undefined) normalized.label = label;
    if (description !== undefined) normalized.description = description;
    if (def !== undefined) normalized.default = def;
    out.push(normalized);
  });

  return out.length > 0 ? out : undefined;
}

export interface ResolvedParams {
  /** 实际生效参数(输入合并默认;仅声明参数)。 */
  value: Record<string, string | number | boolean>;
  /** 缺失的必输参数名。 */
  missing: string[];
  /** 传入但未声明的参数名(忽略不阻塞)。 */
  unknown: string[];
  /** 类型不匹配的传入参数(宽松同构转换失败才计入)。 */
  invalid: { name: string; expected: ScriptParamType }[];
}

/**
 * 解析本次执行的输入参数:合并默认、宽松同构转换、收集缺失/未知/类型错。
 * @param parameters - 脚本参数定义(undefined = 无参数脚本)。
 * @param input - 调用方传入的原始参数(未定义 = 全默认)。
 */
export function resolveScriptParams(
  parameters: NormalizedScriptParameter[] | undefined,
  input?: Record<string, unknown> | null,
): ResolvedParams {
  if (!parameters || parameters.length === 0) {
    return { value: {}, missing: [], unknown: [], invalid: [] };
  }
  const inputObj = (typeof input === 'object' && input !== null && !Array.isArray(input)) ? input as Record<string, unknown> : {};
  const value: Record<string, string | number | boolean> = {};
  const missing: string[] = [];
  const unknown: string[] = [];
  const invalid: { name: string; expected: ScriptParamType }[] = [];

  for (const p of parameters) {
    // "是否提供"= 对象里存在该键且值非 null/undefined。空字符串是 string 参数的合法值
    // (显式传空串 ≠ 未提供;不应被吞成默认值)。选输省略键才走默认。
    const present = p.name in inputObj && inputObj[p.name] !== undefined && inputObj[p.name] !== null;
    let raw = present ? inputObj[p.name] : undefined;
    if (!present) {
      if (p.required) {
        // 必输:无默认,缺失即记 missing(不以 default 兜底)
        if (p.default === undefined) { missing.push(p.name); continue; }
      }
      raw = p.default;
    }
    // 宽松同构转换(显式提供但类型不符 → invalid,不静默吞)
    if (p.type === 'number') {
      if (typeof raw === 'number' && Number.isFinite(raw)) value[p.name] = raw;
      else if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) value[p.name] = Number(raw);
      else if (raw === undefined) value[p.name] = 0; // 极端兜底(理论不可达:未提供必输已记 missing,选输必有默认)
      else invalid.push({ name: p.name, expected: 'number' });
    } else if (p.type === 'boolean') {
      if (typeof raw === 'boolean') value[p.name] = raw;
      else if (raw === 'true') value[p.name] = true;
      else if (raw === 'false') value[p.name] = false;
      else if (raw === undefined) value[p.name] = false; // 同上极端兜底
      else invalid.push({ name: p.name, expected: 'boolean' });
    } else {
      value[p.name] = raw === undefined || raw === null ? '' : String(raw);
    }
  }
  for (const key of Object.keys(inputObj)) {
    if (!parameters.some((p) => p.name === key)) unknown.push(key);
  }
  return { value, missing, unknown, invalid };
}

/** 把生效参数对象序列化为注入代码前缀(安全单行;含空行便于定位)。 */
export function buildParamInjection(value: Record<string, string | number | boolean>): string {
  // JSON.stringify(value) 为 JSON 文本;再 JSON.stringify 一次生成合法 JS 单行字符串字面量
  const literal = JSON.stringify(JSON.stringify(value));
  return 'const params = JSON.parse(' + literal + ');\n';
}