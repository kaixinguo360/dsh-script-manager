import Schema from "@deepseek-ai/schemastery";
import { join } from "node:path";
import { homedir } from "node:os";
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { CallId, createAssistantMessage, createToolResultMessage, createUserMessage } from "@deepseek-ai/dsh-llm";
//#region src/format-script-result.ts
/**
* DSH Script Manager Plugin - Format Script Result
* 统一的输出格式化函数
*
* 契约段说明：脚本可声明 expectedOutcome / successCriteria / failureGuidance
* （执行契约，供执行完成后 agent 对照判断是否达预期、如何保证预期行为）。
* 契约段置于过程/日志之前，方便 agent 先对照预期再检查过程。
* B 层自绘卡(src/client.js ScriptRunToolView)解析首行 [Script] <name> 与 Time: —
* 改动本文件时保持这两个标记仍可从文本定位。
*/
/** 格式化脚本执行结果 */
function formatScriptResult(result) {
	const parts = [];
	parts.push("[Script] " + (result.scriptName || "Unknown"));
	parts.push("Source code:");
	parts.push("```typescript");
	parts.push(String(result.scriptCode || ""));
	parts.push("```");
	parts.push("Result: " + (result.success ? "Success" : "Failed"));
	parts.push("Time: " + String(result.executionTime || 0) + "ms");
	const hasContract = result.expectedOutcome !== void 0 || result.successCriteria !== void 0 || result.failureGuidance !== void 0;
	if (result.expectedOutcome !== void 0) {
		parts.push("Expected:");
		parts.push(indentLines(String(result.expectedOutcome)));
	}
	if (result.successCriteria !== void 0) {
		parts.push("Verify:");
		parts.push(indentLines(String(result.successCriteria)));
	}
	if (result.failureGuidance !== void 0) {
		parts.push("On failure:");
		parts.push(indentLines(String(result.failureGuidance)));
	}
	if (result.params !== void 0) {
		parts.push("Params:");
		parts.push(JSON.stringify(result.params, null, 2));
	}
	const unknown = result.unknownParams;
	if (Array.isArray(unknown) && unknown.length > 0) parts.push("Unknown params ignored: " + unknown.join(", "));
	const logs = result.logs || [];
	if (logs.length > 0) {
		parts.push("Logs:");
		parts.push(logs.join("\n"));
	}
	if (result.value !== void 0) {
		parts.push("Return value:");
		parts.push(JSON.stringify(result.value, null, 2));
	}
	if (result.error) {
		parts.push("Error:");
		parts.push(String(result.error));
	}
	if (hasContract) parts.push("Review: check Expected/Verify against the result to decide whether the script reached its intended behavior. If it did, stop here; otherwise intervene per On failure (fix inputs/state, or script_update then rerun script_run).");
	else parts.push("Note: this script declares no expectedOutcome/successCriteria. If its behavior proves unreliable, add them via script_update so future runs can be checked against expectations.");
	return parts.join("\n");
}
/** 多行文本缩进两个空格（契约展示用）；空输入返回空串。 */
function indentLines(text) {
	if (text === "") return "";
	return text.split("\n").map((line) => "  " + line).join("\n");
}
//#endregion
//#region src/script-tool-registry.ts
/** 从脚本 id 派生默认工具名（连字符转下划线，script_ 前缀）。 */
function defaultToolName(id) {
	return "script_" + id.replace(/-/g, "_");
}
/** 工具名合法性：小写字母/数字/下划线，字母或下划线开头。 */
function isValidToolName(name) {
	return /^[a-z_][a-z0-9_]*$/.test(name);
}
/** 动态工具注册表：保持注册状态与脚本存储一致。 */
var ScriptToolRegistry = class {
	ctx;
	store;
	runner;
	/** 已注册工具:键=工具名,值含脚本 id、定义指纹(描述+参数,变更即需刷新)与卸载器。 */
	registered = /* @__PURE__ */ new Map();
	constructor(ctx, store, runner) {
		this.ctx = ctx;
		this.store = store;
		this.runner = runner;
	}
	/** 同步注册表：按 store 现状注册新增、卸载失效的动态工具。 */
	async sync() {
		const scripts = await this.store.list();
		const wanted = /* @__PURE__ */ new Map();
		for (const s of scripts) {
			if (!s.registerAsTool) continue;
			const toolName = (s.toolName ?? "").trim() || defaultToolName(s.id);
			if (!isValidToolName(toolName)) continue;
			wanted.set(toolName, {
				scriptId: s.id,
				name: s.name,
				description: s.description || "",
				parameters: s.parameters
			});
		}
		for (const [toolName, entry] of this.registered) {
			const want = wanted.get(toolName);
			const stale = want && entry.fingerprint !== dynamicFingerprint(want);
			if (!want || want.scriptId !== entry.scriptId || stale) {
				try {
					entry.dispose();
				} catch {}
				this.registered.delete(toolName);
			}
		}
		for (const [toolName, want] of wanted) {
			if (this.registered.has(toolName)) continue;
			const paramsSpec = buildDynamicParamSpec(want.parameters);
			const description = "Execute the custom script \"" + want.name + "\"" + (want.description ? " - " + want.description : "") + (paramsSpec.hasParams ? " Arguments: " + (want.parameters || []).map((p) => p.name).join(", ") + "." : " No arguments.");
			try {
				const dispose = this.ctx.tools.register(defineTool({
					name: toolName,
					description,
					parameters: paramsSpec.props,
					output: {
						schema: { type: "json" },
						render: (_a, v) => [{
							type: "text",
							text: formatScriptResult(v)
						}]
					},
					execute: async (args, exec) => {
						const runContext = exec;
						const params = typeof args === "object" && args !== null && !Array.isArray(args) ? args : void 0;
						return await this.runner.run(want.scriptId, runContext?.signal, runContext?.agent, runContext?.token, void 0, runContext?.callId !== void 0 && runContext?.callId !== "" ? {
							callId: String(runContext.callId),
							rootCallId: String(runContext.rootCallId ?? runContext.callId)
						} : void 0, params, "dynamic-tool:" + toolName);
					}
				}));
				this.registered.set(toolName, {
					scriptId: want.scriptId,
					fingerprint: dynamicFingerprint(want),
					dispose
				});
			} catch (error) {
				console.error("[dsh-script-manager] failed to register dynamic tool " + toolName + ":", error);
			}
		}
	}
	/** 卸载全部动态工具（插件卸载时调用）。 */
	dispose() {
		for (const entry of this.registered.values()) try {
			entry.dispose();
		} catch {}
		this.registered.clear();
	}
};
/** 动态工具参数 schema:脚本声明参数映射为具名属性(必输/类型/说明),无参脚本返回空。 */
function buildDynamicParamSpec(parameters) {
	const props = {};
	if (!parameters || parameters.length === 0) return {
		props,
		hasParams: false
	};
	for (const p of parameters) {
		const bits = ["parameter \"" + p.name + "\""];
		if (p.label && p.label !== p.name) bits.push(p.label);
		if (p.description) bits.push(p.description);
		bits.push("type: " + p.type);
		if (p.required) bits.push("REQUIRED - must be provided");
		else bits.push("optional - default: " + JSON.stringify(p.default));
		const prop = {
			type: p.type === "number" ? "number" : p.type === "boolean" ? "boolean" : "string",
			description: bits.join("; ") + "."
		};
		if (p.required) prop.required = true;
		props[p.name] = prop;
	}
	return {
		props,
		hasParams: true
	};
}
/** 动态工具定义指纹:描述 + 参数声明(名称/类型/必输/默认)。任一变化 → 已注册工具需刷新 schema。 */
function dynamicFingerprint(want) {
	const params = (want.parameters || []).map((p) => p.name + ":" + p.type + ":" + (p.required ? "req" : "opt") + ":" + JSON.stringify(p.default)).join("|");
	return want.name + "\0" + want.description + "\0" + params;
}
//#endregion
//#region src/script-params.ts
const PARAM_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
/**
* 校验并归一一段参数定义(脚本创建/更新时调用)。
* @param raw - 待校验的 ScriptParameter[] 或 undefined/空。
* @param field - 错误前缀(如 'parameters')。
* @returns 归一后的数组(空输入返回 undefined);违规抛 Error(message 可读)。
*/
function normalizeScriptParameters(raw, field = "parameters") {
	if (raw === void 0 || raw === null) return void 0;
	if (!Array.isArray(raw)) throw new Error(field + " must be an array when provided");
	const seen = /* @__PURE__ */ new Set();
	const out = [];
	raw.forEach((entry, index) => {
		const at = field + "[" + index + "]";
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) throw new Error(at + " must be an object");
		const e = entry;
		const name = typeof e.name === "string" ? e.name.trim() : "";
		if (!name) throw new Error(at + ".name is required");
		if (!PARAM_NAME_RE.test(name)) throw new Error(at + ".name must match ^[A-Za-z_][A-Za-z0-9_]*$ (identifier accessible as params.<name>)");
		if (seen.has(name)) throw new Error(at + ".name duplicates parameter " + name);
		seen.add(name);
		const type = e.type === void 0 || e.type === null || e.type === "" ? "string" : e.type === "string" || e.type === "number" || e.type === "boolean" ? e.type : (() => {
			throw new Error(at + ".type must be one of string|number|boolean");
		})();
		const label = e.label === void 0 || e.label === null ? void 0 : String(e.label).trim() || void 0;
		const description = e.description === void 0 || e.description === null ? void 0 : String(e.description).trim() || void 0;
		const required = e.required === void 0 ? false : e.required;
		if (typeof required !== "boolean") throw new Error(at + ".required must be a boolean");
		const hasDefault = e.default !== void 0 && e.default !== null;
		if (required && hasDefault) throw new Error(at + ": a required parameter must not declare a default");
		if (!required && !hasDefault) throw new Error(at + ": an optional parameter must declare a default value");
		let def;
		if (hasDefault) {
			const dv = e.default;
			if (type === "string") {
				if (typeof dv !== "string") throw new Error(at + ".default must be a string for type string");
				def = dv;
			} else if (type === "number") {
				if (typeof dv === "number" && Number.isFinite(dv)) def = dv;
				else if (typeof dv === "string" && dv.trim() !== "" && Number.isFinite(Number(dv))) def = Number(dv);
				else throw new Error(at + ".default must be a finite number for type number");
			} else if (typeof dv === "boolean") def = dv;
			else if (typeof dv === "string" && (dv === "true" || dv === "false")) def = dv === "true";
			else throw new Error(at + ".default must be a boolean for type boolean");
		}
		const normalized = {
			name,
			type,
			required
		};
		if (label !== void 0) normalized.label = label;
		if (description !== void 0) normalized.description = description;
		if (def !== void 0) normalized.default = def;
		out.push(normalized);
	});
	return out.length > 0 ? out : void 0;
}
/**
* 解析本次执行的输入参数:合并默认、宽松同构转换、收集缺失/未知/类型错。
* @param parameters - 脚本参数定义(undefined = 无参数脚本)。
* @param input - 调用方传入的原始参数(未定义 = 全默认)。
*/
function resolveScriptParams(parameters, input) {
	if (!parameters || parameters.length === 0) return {
		value: {},
		missing: [],
		unknown: [],
		invalid: []
	};
	const inputObj = typeof input === "object" && input !== null && !Array.isArray(input) ? input : {};
	const value = {};
	const missing = [];
	const unknown = [];
	const invalid = [];
	for (const p of parameters) {
		const present = p.name in inputObj && inputObj[p.name] !== void 0 && inputObj[p.name] !== null;
		let raw = present ? inputObj[p.name] : void 0;
		if (!present) {
			if (p.required) {
				if (p.default === void 0) {
					missing.push(p.name);
					continue;
				}
			}
			raw = p.default;
		}
		if (p.type === "number") {
			if (typeof raw === "number" && Number.isFinite(raw)) value[p.name] = raw;
			else if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) value[p.name] = Number(raw);
			else if (raw === void 0) value[p.name] = 0;
			else invalid.push({
				name: p.name,
				expected: "number"
			});
		} else if (p.type === "boolean") {
			if (typeof raw === "boolean") value[p.name] = raw;
			else if (raw === "true") value[p.name] = true;
			else if (raw === "false") value[p.name] = false;
			else if (raw === void 0) value[p.name] = false;
			else invalid.push({
				name: p.name,
				expected: "boolean"
			});
		} else value[p.name] = raw === void 0 || raw === null ? "" : String(raw);
	}
	for (const key of Object.keys(inputObj)) if (!parameters.some((p) => p.name === key)) unknown.push(key);
	return {
		value,
		missing,
		unknown,
		invalid
	};
}
/** 把生效参数对象序列化为注入代码前缀(安全单行;含空行便于定位)。 */
function buildParamInjection(value) {
	return "const params = JSON.parse(" + JSON.stringify(JSON.stringify(value)) + ");\n";
}
//#endregion
//#region src/script-store.ts
/**
* DSH Script Manager Plugin - Script Store
* 脚本持久化存储（文件系统）
* @module dsh-script-manager/script-store
*/
/** 输入校验错误（REST 层映射为 HTTP 400）。 */
var ValidationError = class extends Error {};
/** 校验单个字段；返回规范化后的值或抛 ValidationError。 */
function requireNonEmpty(value, field) {
	const text = value === void 0 || value === null ? "" : String(value).trim();
	if (!text) throw new ValidationError(field + " is required");
	return text;
}
function optionalString(value) {
	if (value === void 0 || value === null) return void 0;
	const text = String(value).trim();
	return text === "" ? void 0 : text;
}
function validateToolName(value) {
	const text = optionalString(value);
	if (text !== void 0 && !isValidToolName(text)) throw new ValidationError("toolName must match ^[a-z_][a-z0-9_]*$ when provided");
	return text;
}
/** 校验执行超时预算：必须为正整数（缺省 = 未设置，跟随插件默认）。 */
function validateTimeoutMs(value) {
	if (value === void 0 || value === null || value === "") return void 0;
	const ms = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(ms) || ms <= 0 || !Number.isInteger(ms)) throw new ValidationError("timeoutMs must be a positive integer (milliseconds)");
	return ms;
}
/** 执行契约字段（expectedOutcome/successCriteria/failureGuidance）：多行文本，trim 首尾；空串视为未设置。 */
function validateContractField(value, field) {
	if (value === void 0 || value === null) return void 0;
	if (typeof value !== "string") throw new ValidationError(field + " must be a string when provided");
	const text = value.trim();
	return text === "" ? void 0 : text;
}
/** 参数声明整段归一：非数组/违规 → ValidationError(400 语义)；空/空数组 → undefined。 */
function normalizeParamsOrThrow(raw) {
	try {
		return normalizeScriptParameters(raw, "parameters");
	} catch (error) {
		throw new ValidationError(error instanceof Error ? error.message : String(error));
	}
}
/** 展开 ~ 为用户主目录 */
function expandPath$1(path) {
	if (path.startsWith("~")) return join(homedir(), path.slice(1));
	return path;
}
/** 脚本存储类 */
var ScriptStore = class {
	history;
	scriptsDir;
	indexFile;
	index = /* @__PURE__ */ new Map();
	constructor(scriptsDir, history) {
		this.history = history;
		this.scriptsDir = expandPath$1(scriptsDir);
		this.indexFile = join(this.scriptsDir, "index.json");
	}
	/** 初始化存储目录 */
	async init() {
		await mkdir(this.scriptsDir, { recursive: true });
		await this.loadIndex();
	}
	/** 加载索引文件 */
	async loadIndex() {
		try {
			const content = await readFile(this.indexFile, "utf-8");
			const entries = JSON.parse(content);
			this.index.clear();
			for (const entry of entries) this.index.set(entry.id, this.stripUndefined(entry));
		} catch {
			this.index.clear();
		}
	}
	/** Remove undefined properties from an object (lossless JSON requirement) */
	stripUndefined(obj) {
		if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return obj;
		const cleaned = {};
		for (const [key, value] of Object.entries(obj)) {
			if (value === void 0) continue;
			if (value !== null && typeof value === "object" && !Array.isArray(value)) cleaned[key] = this.stripUndefined(value);
			else cleaned[key] = value;
		}
		return cleaned;
	}
	/** 保存索引文件 */
	async saveIndex() {
		const entries = Array.from(this.index.values());
		await writeFile(this.indexFile, JSON.stringify(entries, null, 2), "utf-8");
	}
	/** 获取脚本文件路径 */
	getScriptPath(scriptId) {
		return join(this.scriptsDir, scriptId + ".json");
	}
	/** 列出所有脚本摘要 */
	async list(options) {
		let scripts = Array.from(this.index.values()).map((s) => this.stripUndefined(s));
		if (options?.tags && options.tags.length > 0) scripts = scripts.filter((s) => options.tags.some((tag) => s.tags.includes(tag)));
		scripts.sort((a, b) => new Date(b.metadata.updatedAt).getTime() - new Date(a.metadata.updatedAt).getTime());
		if (options?.limit && options.limit > 0) scripts = scripts.slice(0, options.limit);
		return scripts;
	}
	/** 获取脚本完整定义 */
	async get(scriptId) {
		try {
			const content = await readFile(this.getScriptPath(scriptId), "utf-8");
			return JSON.parse(content);
		} catch {
			return;
		}
	}
	/** 创建脚本（全字段校验）；成功后向历史记录 create 变更（revision=1）。 */
	async create(script, meta) {
		const id = (script.id ?? "").trim();
		if (!id) throw new ValidationError("Script id is required");
		if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new ValidationError("Script id must match ^[a-z0-9][a-z0-9-]*$ (lowercase letters, digits, hyphens)");
		if (this.index.has(id) || await this.get(id) !== void 0) throw new ValidationError("Script already exists: " + id);
		const name = requireNonEmpty(script.name, "Script name");
		const code = requireNonEmpty(script.code, "Script code");
		if (script.registerAsTool !== void 0 && typeof script.registerAsTool !== "boolean") throw new ValidationError("registerAsTool must be a boolean");
		if (script.tags !== void 0 && (!Array.isArray(script.tags) || script.tags.some((t) => typeof t !== "string"))) throw new ValidationError("tags must be an array of strings");
		const toolName = validateToolName(script.toolName);
		const timeoutMs = validateTimeoutMs(script.timeoutMs);
		const expectedOutcome = validateContractField(script.expectedOutcome, "expectedOutcome");
		const successCriteria = validateContractField(script.successCriteria, "successCriteria");
		const failureGuidance = validateContractField(script.failureGuidance, "failureGuidance");
		const parameters = normalizeParamsOrThrow(script.parameters);
		const description = optionalString(script.description) ?? "";
		const version = optionalString(script.version) ?? "0.1.0";
		const author = optionalString(script.author) ?? "";
		const now = (/* @__PURE__ */ new Date()).toISOString();
		const fullScript = {
			...script,
			id,
			name,
			code,
			description,
			version,
			author,
			tags: script.tags ? script.tags : [],
			registerAsTool: script.registerAsTool === true,
			...toolName !== void 0 ? { toolName } : {},
			...timeoutMs !== void 0 ? { timeoutMs } : {},
			...expectedOutcome !== void 0 ? { expectedOutcome } : {},
			...successCriteria !== void 0 ? { successCriteria } : {},
			...failureGuidance !== void 0 ? { failureGuidance } : {},
			...parameters !== void 0 ? { parameters } : {},
			metadata: {
				createdAt: now,
				updatedAt: now,
				executionCount: 0
			}
		};
		await writeFile(this.getScriptPath(id), JSON.stringify(fullScript, null, 2), "utf-8");
		this.index.set(id, this.toSummary(fullScript));
		await this.saveIndex();
		if (this.history) {
			await this.history.deleteScriptHistory(id);
			await this.history.recordChange(id, {
				scriptId: id,
				revision: 1,
				action: "create",
				source: meta?.source,
				fields: definitionFields(fullScript),
				snapshot: fullScript
			});
		}
		return fullScript;
	}
	/** 更新脚本；patch.id 变更时执行重命名（旧文件删除、新文件写入、索引同步）。成功后记录变更（含改名随迁历史）。 */
	async update(scriptId, patch, meta) {
		const existing = await this.get(scriptId);
		if (!existing) throw new Error("Script not found: " + scriptId);
		const nextId = (patch.id !== void 0 ? String(patch.id).trim() : scriptId) || scriptId;
		if (!/^[a-z0-9][a-z0-9-]*$/.test(nextId)) throw new ValidationError("Script id must match ^[a-z0-9][a-z0-9-]*$ (lowercase letters, digits, hyphens)");
		if (nextId !== scriptId && await this.get(nextId) !== void 0) throw new ValidationError("Script already exists: " + nextId);
		if (patch.name !== void 0) requireNonEmpty(patch.name, "Script name");
		if (patch.code !== void 0) requireNonEmpty(patch.code, "Script code");
		if (patch.registerAsTool !== void 0 && typeof patch.registerAsTool !== "boolean") throw new ValidationError("registerAsTool must be a boolean");
		if (patch.tags !== void 0 && (!Array.isArray(patch.tags) || patch.tags.some((t) => typeof t !== "string"))) throw new ValidationError("tags must be an array of strings");
		if (patch.toolName !== void 0) validateToolName(patch.toolName);
		if (patch.timeoutMs !== void 0) validateTimeoutMs(patch.timeoutMs);
		const parametersPatch = patch.parameters !== void 0 ? normalizeParamsOrThrow(patch.parameters) : void 0;
		const clearParameters = patch.parameters !== void 0 && parametersPatch === void 0;
		const contractPatch = {};
		for (const key of [
			"expectedOutcome",
			"successCriteria",
			"failureGuidance"
		]) {
			const v = patch[key];
			if (v === void 0) continue;
			const normalized = validateContractField(v, key);
			if (normalized !== void 0) contractPatch[key] = normalized;
		}
		const updated = {
			...existing,
			...patch,
			id: nextId,
			...Object.keys(contractPatch).length > 0 ? contractPatch : {},
			...parametersPatch !== void 0 ? { parameters: parametersPatch } : {},
			metadata: {
				...existing.metadata,
				...patch.metadata,
				updatedAt: (/* @__PURE__ */ new Date()).toISOString()
			}
		};
		if (clearParameters) delete updated.parameters;
		for (const key of [
			"expectedOutcome",
			"successCriteria",
			"failureGuidance"
		]) if (patch[key] !== void 0 && contractPatch[key] === void 0) delete updated[key];
		await writeFile(this.getScriptPath(nextId), JSON.stringify(updated, null, 2), "utf-8");
		if (nextId !== scriptId) try {
			await unlink(this.getScriptPath(scriptId));
		} catch {}
		this.index.delete(scriptId);
		this.index.set(nextId, this.toSummary(updated));
		await this.saveIndex();
		if (this.history) {
			if (nextId !== scriptId) {
				await this.history.renameScriptHistory(scriptId, nextId);
				await this.history.recordChange(nextId, {
					scriptId: nextId,
					revision: await this.history.nextRevision(nextId),
					action: "rename",
					source: meta?.source,
					fields: diffFields(existing, updated),
					snapshot: updated
				});
			} else await this.history.recordChange(scriptId, {
				scriptId,
				revision: await this.history.nextRevision(scriptId),
				action: "update",
				source: meta?.source,
				fields: diffFields(existing, updated),
				snapshot: updated
			});
		}
		return updated;
	}
	/** 删除脚本；成功后同步整删该脚本历史目录（清理失败仅 warn，不阻塞删除）。 */
	async delete(scriptId, meta) {
		try {
			await unlink(this.getScriptPath(scriptId));
			this.index.delete(scriptId);
			await this.saveIndex();
			if (this.history) await this.history.deleteScriptHistory(scriptId);
			return true;
		} catch {
			return false;
		}
	}
	/** 搜索脚本 */
	async search(query, options) {
		const scripts = Array.from(this.index.values());
		const lowerQuery = query.toLowerCase();
		return scripts.filter((s) => {
			const matchesQuery = !query || s.name.toLowerCase().includes(lowerQuery) || s.description.toLowerCase().includes(lowerQuery) || s.id.toLowerCase().includes(lowerQuery);
			const matchesTags = !options?.tags || options.tags.length === 0 || options.tags.some((tag) => s.tags.includes(tag));
			return matchesQuery && matchesTags;
		});
	}
	/** 由完整定义构造摘要（含可选字段展开,无 undefined 键）。 */
	toSummary(full) {
		return {
			id: full.id,
			name: full.name,
			description: full.description,
			version: full.version,
			author: full.author,
			tags: full.tags,
			registerAsTool: full.registerAsTool,
			...full.toolName !== void 0 ? { toolName: full.toolName } : {},
			...full.timeoutMs !== void 0 ? { timeoutMs: full.timeoutMs } : {},
			...full.parameters !== void 0 ? { parameters: full.parameters } : {},
			metadata: full.metadata
		};
	}
	/** 记录执行统计 */
	async recordExecution(scriptId, error) {
		const script = await this.get(scriptId);
		if (!script) return;
		script.metadata.executionCount++;
		script.metadata.lastExecutedAt = (/* @__PURE__ */ new Date()).toISOString();
		if (error !== void 0) script.metadata.lastError = error;
		else delete script.metadata.lastError;
		await writeFile(this.getScriptPath(scriptId), JSON.stringify(script, null, 2), "utf-8");
		const summary = this.index.get(scriptId);
		if (summary) {
			summary.metadata = { ...script.metadata };
			await this.saveIndex();
		}
	}
};
/** 参与快照 diff 的字段：全部顶层定义字段，剔除 metadata（其 updatedAt 每次写都变，非定义变化）。 */
const DIFF_EXCLUDE = /* @__PURE__ */ new Set(["metadata"]);
/** 变更涉及的顶层字段名（create 用：全部定义字段）。 */
function definitionFields(script) {
	return Object.keys(script).filter((k) => !DIFF_EXCLUDE.has(k));
}
/** 两次定义间实际变化的顶层字段（不含 metadata；无变化时记 updatedAt 以保留一条触摸记录）。 */
function diffFields(before, after) {
	const keys = /* @__PURE__ */ new Set([...Object.keys(before), ...Object.keys(after)]);
	const changed = [];
	for (const key of keys) {
		if (DIFF_EXCLUDE.has(key)) continue;
		if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changed.push(key);
	}
	if (changed.length === 0) changed.push("updatedAt");
	return changed;
}
//#endregion
//#region src/script-runner.ts
/** 执行记录中的 error / value 截断上限（控制单行体积）。 */
const RUN_ERROR_MAX = 2e3;
const RUN_VALUE_MAX = 4e3;
/** 将超时预算归一为可选数字：非正/非法/缺省一律视为无预算。 */
function normalizeBudgetMs(value) {
	const ms = typeof value === "number" ? value : void 0;
	return typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : void 0;
}
/**
* 组合一次脚本执行的取消语义：外部取消信号（用户停止 / agent 回合取消）
* 与执行预算超时合并为一个 AbortSignal。两者皆无时返回永不中止的信号，
* 使内部 tools.* 调用不再被任何隐性超时截断。
*/
function createRunSignal(outer, budgetMs) {
	const controller = new AbortController();
	const budget = normalizeBudgetMs(budgetMs);
	const noOuter = outer === void 0;
	const noBudget = budget === void 0;
	if (outer?.aborted) {
		controller.abort(outer.reason);
		return {
			signal: controller.signal,
			dispose() {}
		};
	}
	if (noOuter && noBudget) return {
		signal: controller.signal,
		dispose() {}
	};
	const onOuterAbort = () => controller.abort(outer?.reason);
	const onBudgetAbort = () => controller.abort("script execution exceeded timeout of " + budget + "ms");
	outer?.addEventListener("abort", onOuterAbort, { once: true });
	const timer = noBudget ? void 0 : setTimeout(onBudgetAbort, budget);
	return {
		signal: controller.signal,
		dispose() {
			if (!noOuter) outer?.removeEventListener("abort", onOuterAbort);
			if (timer !== void 0) clearTimeout(timer);
		}
	};
}
/** 脚本执行器 */
var ScriptRunner = class {
	store;
	ctx;
	defaultTimeoutMs;
	history;
	constructor(store, ctx, options = {}) {
		this.store = store;
		this.ctx = ctx;
		this.defaultTimeoutMs = normalizeBudgetMs(options.defaultTimeoutMs) ?? 0;
		this.history = options.history;
	}
	/**
	* Execute a registered script.
	*
	* 超时预算优先级：overrideTimeoutMs（script_run 调用级）> 脚本定义
	* script.timeoutMs > 插件默认 defaultTimeoutMs；均未设置则无超时限制
	* （仅外部取消信号与 DSH 平台护栏可中止）。
	*
	* @param scriptId - the script to run
	* @param signal - optional cancellation signal (user stop / caller turn)
	* @param agent - the calling agent (for tool scope resolution)
	* @param parentToken - the caller execution token used as parent so DSH
	*   treats inner tools as sub-dispatches (bypasses the mode:code rule that
	*   only allows run_code directly).
	* @param overrideTimeoutMs - per-run budget (ms) overriding script/plugin defaults
	* @param outer - 外层执行身份（script_run 的 exec.callId / rootCallId）。提供时
	*   runner 为每个内层 tools.* 调用向 agent.session 追加 log-only 的
	*   tool/code-dispatch-start / tool/code-dispatch 事件，使 Web GUI 能像 run_code
	*   一样把脚本内部工具调用渲染为嵌套层级（rootCallId 挂在本调用之下）。
	* @param params - 本次执行的输入参数(键为声明参数名)。必输缺失/类型不匹配会
	*   在执行前抛错;未知键忽略并记入 runResult.unknownParams;选输缺省用默认值。
	* @param runSource - 本次执行来源面（'script_run' / 'dynamic-tool:<name>' 等），
	*   写入执行历史 caller 字段；缺省不标。
	*/
	async run(scriptId, signal, agent, parentToken, overrideTimeoutMs, outer, params, runSource) {
		const script = await this.store.get(scriptId);
		if (!script) throw new Error("Script not found: " + scriptId);
		const runRevision = this.history ? await this.history.lastRevisionOf(scriptId) : void 0;
		const budgetMs = normalizeBudgetMs(overrideTimeoutMs ?? script.timeoutMs ?? this.defaultTimeoutMs);
		const runSignal = createRunSignal(signal, budgetMs);
		const startTime = Date.now();
		const dispatchRoot = outer?.rootCallId ?? outer?.callId ?? "";
		const dispatchParent = outer?.callId ?? "";
		try {
			const hasParams = Array.isArray(script.parameters) && script.parameters.length > 0;
			const resolved = hasParams ? resolveScriptParams(script.parameters, params) : null;
			if (resolved && resolved.missing.length > 0) throw new Error("Missing required parameter(s): " + resolved.missing.join(", "));
			if (resolved && resolved.invalid.length > 0) {
				const bad = resolved.invalid.map((i) => i.name + " (expected " + i.expected + ")").join(", ");
				throw new Error("Invalid parameter type for: " + bad);
			}
			const program = hasParams ? buildParamInjection(resolved.value) + script.code : script.code;
			const bindings = [{
				global: "tools",
				functions: this.createToolBindings(runSignal.signal, agent, parentToken, dispatchParent, dispatchRoot),
				errorClass: {
					name: "ToolCallError",
					memberNameProperty: "toolName"
				}
			}];
			const result = await this.ctx.codeRuntime.run({
				program,
				bindings,
				signal: runSignal.signal
			});
			await this.store.recordExecution(scriptId, result.error?.message);
			const runResult = {
				success: !result.error,
				scriptId,
				scriptName: script.name,
				scriptCode: script.code,
				logs: result.logs || [],
				executionTime: Date.now() - startTime
			};
			if (budgetMs !== void 0) runResult.timeoutMs = budgetMs;
			if (hasParams && resolved) {
				runResult.params = resolved.value;
				if (resolved.unknown.length > 0) runResult.unknownParams = resolved.unknown;
			}
			if (script.expectedOutcome !== void 0) runResult.expectedOutcome = script.expectedOutcome;
			if (script.successCriteria !== void 0) runResult.successCriteria = script.successCriteria;
			if (script.failureGuidance !== void 0) runResult.failureGuidance = script.failureGuidance;
			if (result.value !== void 0) runResult.value = result.value;
			if (result.error) runResult.error = result.error.message;
			if (this.history) try {
				const runRecord = {
					scriptId,
					revision: runRevision,
					caller: (runSource ?? "").trim().slice(0, 64) || void 0,
					success: !result.error,
					executionTime: Date.now() - startTime
				};
				if (hasParams && resolved) runRecord.params = resolved.value;
				if (result.error?.message) runRecord.error = truncateText(result.error.message, RUN_ERROR_MAX);
				if (result.value !== void 0) {
					const text = safeStringify(result.value);
					runRecord.value = truncateText(text, RUN_VALUE_MAX);
					runRecord.valueTruncated = text.length > RUN_VALUE_MAX;
				}
				await this.history.recordRun(scriptId, runRecord);
			} catch (error) {
				console.warn("[dsh-script-manager] failed to record run history: " + (error instanceof Error ? error.message : String(error)));
			}
			return runResult;
		} finally {
			runSignal.dispose();
		}
	}
	/**
	* Create tool bindings for the code runtime worker.
	*
	* Each binding bridges worker to host: the worker calls tools.xxx(args),
	* the host resolves the tool through ctx.tools.execute(), and returns the
	* plain JSON value back to the worker.
	*
	* Key requirements (learned through iterative debugging):
	* 1. agent: passed to both schemas() and execute() so agent-scoped tools
	*    are visible and resolvable.
	* 2. parentToken: set to the caller exec.token so DSH treats the call as a
	*    sub-dispatch (bypassing the mode:code restriction).
	* 3. callId: must use CallId(string) factory, not CallId.create().
	* 4. return value: plain lossless JSON — extract .value from ToolResult.
	* 5. signal: every inner tools.* call shares the run composed signal
	*    (external cancellation + execution budget). No per-call implicit
	*    timeout is applied — scripts run without a timeout limit by default.
	* 6. Hierarchy events: when a session is available (agent + outer identity),
	*    every inner call logs `tool/code-dispatch-start` before dispatch and
	*    `tool/code-dispatch` after settle — the same log-only event vocabulary
	*    dsh-tools' run_code dispatcher uses — so the Web GUI renders script
	*    internals as nested tool cards under the outer script_run call.
	*/
	createToolBindings(signal, agent, parentToken, parentCallId, rootCallId) {
		const toolBindings = {};
		const schemas = this.ctx.tools.schemas(agent);
		const session = agent?.session;
		const logDispatch = parentCallId !== "" && rootCallId !== "" && session !== void 0;
		let dispatchCounter = 0;
		for (const schema of schemas) toolBindings[schema.name] = async (args) => {
			const subCallId = CallId(parentCallId + ":code:" + ++dispatchCounter);
			const loggedArgs = normalizeEventArgs(args);
			if (logDispatch) session.append("tool/code-dispatch-start", {
				rootCallId,
				parentCallId,
				subCallId,
				name: schema.name,
				arguments: loggedArgs
			});
			let settled;
			try {
				const result = await this.ctx.tools.execute({
					callId: subCallId,
					...rootCallId !== void 0 && rootCallId !== "" ? { rootCallId: CallId(rootCallId) } : {},
					name: schema.name,
					arguments: args,
					agent,
					...parentToken !== void 0 ? { parent: parentToken } : {},
					signal
				});
				settled = result.isError ? {
					isError: true,
					content: result.content,
					value: void 0,
					message: result.error.message
				} : {
					isError: false,
					content: result.content,
					value: result.value
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				settled = {
					isError: true,
					content: [{
						type: "text",
						text: "Error: " + message
					}],
					value: void 0,
					message
				};
			}
			if (logDispatch) session.append("tool/code-dispatch", {
				rootCallId,
				parentCallId,
				subCallId,
				name: schema.name,
				arguments: loggedArgs,
				isError: settled.isError,
				content: settled.content.length > 0 ? settled.content : [{
					type: "text",
					text: settled.value === void 0 ? "" : String(settled.value)
				}]
			});
			if (settled.isError) throw new Error(settled.message ?? "tool call failed");
			return settled.value;
		};
		return toolBindings;
	}
};
/** 把待记录的事件参数归一为纯 JSON（与 code-mode 的 jsonNormalizeArgs 同意图）。 */
function normalizeEventArgs(args) {
	if (args === void 0 || typeof args === "function" || typeof args === "symbol") return;
	if (typeof args === "string" || typeof args === "number" || typeof args === "boolean" || args === null) return args;
	try {
		return JSON.parse(JSON.stringify(args));
	} catch {
		return String(args);
	}
}
/** 截断长文本至上限（原样短文本不动）。 */
function truncateText(text, max) {
	if (text.length <= max) return text;
	return text.slice(0, max);
}
/** 返回值安全序列化（runtime 返回值本为 lossless JSON；异常兜底 String）。 */
function safeStringify(value) {
	try {
		const json = JSON.stringify(value);
		return json === void 0 ? String(value) : json;
	} catch {
		return String(value);
	}
}
//#endregion
//#region src/history-store.ts
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
/** 合法脚本 id（与 ScriptStore 校验一致；兼作目录名安全校验）。 */
const SCRIPT_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
/** 展开 ~ 为用户主目录 */
function expandPath(path) {
	if (path.startsWith("~")) return join(homedir(), path.slice(1));
	return path;
}
/** 节流 console.warn：同类消息每 60s 至多一条。 */
const warnThrottle = /* @__PURE__ */ new Map();
function warnOnce(key, message) {
	const now = Date.now();
	if (now - (warnThrottle.get(key) ?? 0) < 6e4) return;
	warnThrottle.set(key, now);
	console.warn("[dsh-script-manager] " + message);
}
var HistoryStore = class {
	dir;
	changesMax;
	runsMax;
	/** 修订号缓存：scriptId -> 最新 revision。 */
	revCache = /* @__PURE__ */ new Map();
	/** 行数计数：文件绝对路径 -> 当前行数（追加时递增，压缩后重置）。 */
	lineCounts = /* @__PURE__ */ new Map();
	/** 追加/压缩串行队列（防并发交错写坏文件）。 */
	queue = Promise.resolve();
	constructor(dir, options = {}) {
		this.dir = expandPath(dir);
		this.changesMax = options.changesMax ?? 200;
		this.runsMax = options.runsMax ?? 500;
	}
	/** 初始化基目录（幂等）。 */
	async init() {
		try {
			await mkdir(this.dir, { recursive: true });
			const children = await this.safeReaddir();
			for (const child of children) {
				if (!SCRIPT_ID_RE.test(child)) continue;
				const stats = await stat(join(this.dir, child)).catch(() => void 0);
				if (!stats || !stats.isDirectory()) continue;
				const changesFile = this.fileFor(child, "changes");
				const runsFile = this.fileFor(child, "runs");
				const c = await this.countLines(changesFile);
				if (c > 0) this.lineCounts.set(changesFile, c);
				const r = await this.countLines(runsFile);
				if (r > 0) this.lineCounts.set(runsFile, r);
			}
		} catch (error) {
			warnOnce("init", "history init failed: " + msg(error));
		}
	}
	/** 追加一条变更记录（返回写入的完整条目）。失败 warn，不抛出。 */
	async recordChange(scriptId, rec) {
		if (!SCRIPT_ID_RE.test(scriptId)) return void 0;
		const entry = {
			...rec,
			scriptId,
			ts: (/* @__PURE__ */ new Date()).toISOString()
		};
		const file = this.fileFor(scriptId, "changes");
		return this.enqueue(async () => {
			await this.appendJsonl(file, entry);
			if (entry.revision !== void 0 && entry.revision > (this.revCache.get(scriptId) ?? 0)) this.revCache.set(scriptId, entry.revision);
			await this.maybeCompact(file, this.changesMax);
			return entry;
		});
	}
	/** 追加一条执行记录。失败 warn，不抛出。 */
	async recordRun(scriptId, rec) {
		if (!SCRIPT_ID_RE.test(scriptId)) return void 0;
		const entry = {
			...rec,
			scriptId,
			ts: (/* @__PURE__ */ new Date()).toISOString()
		};
		const file = this.fileFor(scriptId, "runs");
		return this.enqueue(async () => {
			await this.appendJsonl(file, entry);
			await this.maybeCompact(file, this.runsMax);
			return entry;
		});
	}
	/** 某脚本最新修订号；无记录/读取失败返回 undefined（不抛出）。 */
	async lastRevisionOf(scriptId) {
		if (!SCRIPT_ID_RE.test(scriptId)) return void 0;
		const cached = this.revCache.get(scriptId);
		if (cached !== void 0) return cached;
		const rows = await this.readRows(this.fileFor(scriptId, "changes"));
		let max = 0;
		for (const row of rows) if (typeof row.revision === "number" && row.revision > max) max = row.revision;
		if (max > 0) this.revCache.set(scriptId, max);
		return max > 0 ? max : void 0;
	}
	/** 计算该脚本下一修订号：最新 +1；无历史则为 1。 */
	async nextRevision(scriptId) {
		const last = await this.lastRevisionOf(scriptId);
		return last === void 0 ? 1 : last + 1;
	}
	/** 整删某脚本历史目录（删脚本时同步调用）。目录不存在静默成功；失败 warn。 */
	async deleteScriptHistory(scriptId) {
		if (!SCRIPT_ID_RE.test(scriptId)) return;
		this.revCache.delete(scriptId);
		const target = join(this.dir, scriptId);
		try {
			await rm(target, {
				recursive: true,
				force: true
			});
		} catch (error) {
			warnOnce("del-" + scriptId, "failed to remove history of " + scriptId + ": " + msg(error));
		}
	}
	/** 脚本改名时迁移历史目录（含 runs 与修订号缓存）。目标已存在（罕见）时先合并再删源。 */
	async renameScriptHistory(oldId, newId) {
		if (!SCRIPT_ID_RE.test(oldId) || !SCRIPT_ID_RE.test(newId) || oldId === newId) return;
		const from = join(this.dir, oldId);
		const to = join(this.dir, newId);
		try {
			const fromStat = await stat(from).catch(() => void 0);
			if (!fromStat || !fromStat.isDirectory()) {
				const rev = this.revCache.get(oldId);
				this.revCache.delete(oldId);
				if (rev !== void 0) this.revCache.set(newId, rev);
				return;
			}
			const toStat = await stat(to).catch(() => void 0);
			if (toStat && toStat.isDirectory()) {
				for (const kind of ["changes", "runs"]) {
					const srcFile = this.fileFor(oldId, kind);
					const dstFile = this.fileFor(newId, kind);
					const rows = await this.readRawLines(srcFile).catch(() => []);
					if (rows.length > 0) await appendFile(dstFile, rows.join("\n") + (rows.length > 0 ? "\n" : ""), "utf-8");
					this.lineCounts.delete(srcFile);
				}
				await rm(from, {
					recursive: true,
					force: true
				});
			} else await rename(from, to);
			const rev = this.revCache.get(oldId);
			this.revCache.delete(oldId);
			if (rev !== void 0) this.revCache.set(newId, rev);
		} catch (error) {
			warnOnce("ren-" + oldId, "failed to migrate history " + oldId + " -> " + newId + ": " + msg(error));
		}
	}
	/** 变更历史（倒序=最新在前）。scriptId 缺省时聚合全部脚本；snapshot 默认剔除。 */
	async listChanges(options = {}) {
		const rows = await this.readAll(options.scriptId, "changes");
		return this.sliceRows(rows, options.limit, options.offset, !options.includeSnapshot);
	}
	/** 执行历史（倒序=最新在前）。 */
	async listRuns(options = {}) {
		const rows = await this.readAll(options.scriptId, "runs");
		return this.sliceRows(rows, options.limit, options.offset, true);
	}
	fileFor(scriptId, kind) {
		return join(this.dir, scriptId, kind + ".jsonl");
	}
	/** 读全部行（含跨脚本聚合），按 ts 降序。 */
	async readAll(scriptId, kind) {
		if (scriptId !== void 0) {
			if (!SCRIPT_ID_RE.test(scriptId)) return [];
			return this.readRows(this.fileFor(scriptId, kind));
		}
		const out = [];
		const children = await this.safeReaddir();
		for (const child of children) {
			if (!SCRIPT_ID_RE.test(child)) continue;
			const stats = await stat(join(this.dir, child)).catch(() => void 0);
			if (!stats || !stats.isDirectory()) continue;
			out.push(...await this.readRows(this.fileFor(child, kind)));
		}
		out.sort((a, b) => tsOf(b) - tsOf(a));
		return out;
	}
	async safeReaddir() {
		try {
			return await readdir(this.dir);
		} catch {
			return [];
		}
	}
	async readRows(file) {
		const lines = await this.readRawLines(file).catch(() => []);
		const rows = [];
		for (const line of lines) {
			const text = line.trim();
			if (text === "") continue;
			try {
				const parsed = JSON.parse(text);
				if (parsed && typeof parsed === "object") rows.push(parsed);
			} catch {}
		}
		return rows.reverse();
	}
	async readRawLines(file) {
		return (await readFile(file, "utf-8")).split("\n").filter((l) => l.trim() !== "");
	}
	async countLines(file) {
		try {
			return (await this.readRawLines(file)).length;
		} catch {
			return 0;
		}
	}
	async appendJsonl(file, entry) {
		try {
			await mkdir(join(this.dir, entry.scriptId), { recursive: true });
		} catch {}
		const line = JSON.stringify(entry) + "\n";
		await appendFile(file, line, "utf-8");
		this.lineCounts.set(file, (this.lineCounts.get(file) ?? 0) + 1);
	}
	/** 超限触发异步整文件压缩（保留最新 N 行），经同一队列串行。 */
	async maybeCompact(file, max) {
		if ((this.lineCounts.get(file) ?? 0) <= max) return;
		const keep = (await this.readRawLines(file).catch(() => [])).slice(-max);
		const tmp = file + ".tmp";
		try {
			await writeFile(tmp, keep.length > 0 ? keep.join("\n") + "\n" : "", "utf-8");
			await rename(tmp, file);
			this.lineCounts.set(file, keep.length);
		} catch (error) {
			warnOnce("compact", "history compaction failed for " + file + ": " + msg(error));
			try {
				await rm(tmp, { force: true });
			} catch {}
		}
	}
	sliceRows(rows, limit, offset, dropSnapshot) {
		const off = offset !== void 0 && Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
		let out = off > 0 ? rows.slice(off) : rows;
		if (limit !== void 0 && Number.isFinite(limit) && limit > 0) out = out.slice(0, Math.floor(limit));
		if (dropSnapshot) out = out.map((row) => {
			const { snapshot: _snapshot, ...rest } = row;
			return rest;
		});
		return out;
	}
	/** 追加与压缩串行执行；失败 warn 不抛出。 */
	enqueue(task) {
		const run = this.queue.then(task);
		this.queue = run.then(() => void 0, () => void 0);
		return run;
	}
};
function msg(error) {
	return error instanceof Error ? error.message : String(error);
}
function tsOf(row) {
	const t = typeof row.ts === "string" ? new Date(row.ts).getTime() : NaN;
	return Number.isFinite(t) ? t : 0;
}
//#endregion
//#region src/script-tool-events.ts
/** 从会话最近的 assistant/message 推导 provider/model（保持跨回合一致）。 */
function deriveModelSource(session) {
	for (let i = session.events.length - 1; i >= 0; i -= 1) {
		const event = session.events[i];
		if (event.type !== "assistant/message") continue;
		const source = event.data.message?.source;
		if (source && typeof source.provider === "string" && typeof source.model === "string") return {
			provider: source.provider,
			model: source.model
		};
	}
	return {
		provider: "",
		model: ""
	};
}
/**
* 模拟一次工具调用回合并写入会话。
*
* @param ctx - 插件上下文（访问 tools）
* @param agent - 目标 agent（其 session 是写入目标）
* @param toolName - 工具名（如 script_run）
* @param args - 工具参数（lossless JSON，用于执行；事件中以 JSON 字符串记录）
* @param signal - 取消信号
* @param parentToken - 底层执行的 parent token（绕过 mode: 'code' collapse；
*   只影响工具执行管道，不影响会话记录的 tool/call 事件结构）
* @returns 工具执行结果
*/
async function executeToolCallWithEvents(ctx, agent, toolName, args, signal, parentToken, execFn) {
	const session = agent.session;
	const turn = (session.events.findLast((e) => e.type === "turn/start")?.data.turn ?? 0) + 1;
	const step = 1;
	session.append("turn/start", { turn });
	session.append("step/start", {
		turn,
		step
	});
	const callId = CallId("script-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8));
	const toolCallBlock = {
		type: "tool-call",
		id: callId,
		name: toolName,
		arguments: JSON.stringify(args)
	};
	const assistantMessage = createAssistantMessage({
		content: [toolCallBlock],
		source: deriveModelSource(session)
	});
	session.append("assistant/message", {
		turn,
		step,
		message: assistantMessage
	}, { surfaceOp: "append" });
	const callSeq = session.append("tool/call", {
		turn,
		step,
		callId,
		name: toolName,
		arguments: JSON.stringify(args)
	}).seq;
	let result;
	try {
		if (execFn) result = await execFn(callId);
		else result = await ctx.tools.execute({
			callId,
			name: toolName,
			arguments: args,
			agent,
			...parentToken !== void 0 ? { parent: parentToken } : {},
			signal: signal ?? new AbortController().signal
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		result = {
			isError: true,
			error: { message },
			content: [{
				type: "text",
				text: "Error: " + message
			}]
		};
	}
	const toolResultMessage = createToolResultMessage({
		callId,
		content: result.content,
		isError: result.isError
	});
	session.append("tool/result", {
		turn,
		step,
		message: toolResultMessage,
		...result.error?.info !== void 0 ? { error: result.error.info } : {},
		...result.meta !== void 0 ? { meta: result.meta } : {}
	}, {
		surfaceOp: "append",
		sourceEventSeqs: [callSeq]
	});
	session.append("step/end", {
		turn,
		step
	});
	session.append("turn/end", {
		turn,
		reason: result.isError ? {
			kind: "error",
			error: result.error
		} : { kind: "completed" }
	});
	const phase = agent.phase;
	if (phase && typeof phase.lastTurn === "number") phase.lastTurn = turn;
	return result;
}
//#endregion
//#region src/script-command.ts
/** 拆分 /script 输入:首个空格前为脚本名,其后为可选 JSON 参数文本。 */
function splitScriptInvocation(input) {
	const trimmed = input.trim();
	if (!trimmed) return {
		name: null,
		argsText: ""
	};
	const spaceIndex = trimmed.indexOf(" ");
	if (spaceIndex === -1) return {
		name: trimmed,
		argsText: ""
	};
	return {
		name: trimmed.substring(0, spaceIndex),
		argsText: trimmed.substring(spaceIndex + 1).trim()
	};
}
/** 解析可选的 JSON 参数文本;非法返回错误消息。 */
function parseJsonArgs(argsText) {
	if (!argsText) return {};
	try {
		const parsed = JSON.parse(argsText);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { error: "Script arguments must be a JSON object, e.g. /script <id> {\"key\":\"value\"}" };
		return { params: parsed };
	} catch {
		return { error: "Script arguments are not valid JSON. Use /script <script-id> {\"param\":\"value\"} or pick the script in the candidate list to fill parameters." };
	}
}
/**
* /create_script 命令：把任务指令注入会话并唤醒 agent，
* 由模型按环境规范用 script_create 工具创建新脚本。
*
* bare 调用（无指令）不立即处理、不唤醒 agent、无副作用：
* 仅温和提示，等待用户补充完整指令后再次执行（参考 /plan 的轻量行为）。
*/
function registerCreateScriptCommand(ctx) {
	const commands = ctx.get("commands");
	if (!commands || typeof commands.register !== "function") return () => {};
	return commands.register({
		name: "create_script",
		description: "Create a new reusable script from a task instruction. Usage: /create_script <task description>",
		input: {
			hint: "[task instruction]",
			images: false
		},
		async handler(invocation) {
			const instruction = (invocation.rawInput ?? "").trim();
			if (!instruction) return {
				kind: "success",
				text: "create_script ready - append a task instruction: /create_script <task description>"
			};
			const agent = invocation.agent;
			if (agent && typeof agent.whenIdle === "function") await agent.whenIdle();
			if (!agent || typeof agent.steer !== "function") return {
				kind: "error",
				text: "No agent context available to create a script."
			};
			agent.steer(createUserMessage({
				content: [{
					type: "text",
					text: "Please create a PTC script using the script_create tool per the instruction below (follow the env guidance: dedupe first, create, verify, then tell the user how to invoke it).\n\nPTC (programmatic tool call) spec: a standalone execution unit — an async TypeScript body that runs with the code runtime, has tools.* bindings (tools.read / tools.bash ...) available inside, executes without a model roundtrip, and returns a lossless-JSON value (console.log for logs). Scripts live under ~/.dsh/scripts; can be registered as direct agent tools (registerAsTool + toolName); invoked via script_run or /script <id>. Keep the script self-contained (resolve inputs inside) and generic; always verify with script_run after creating.\n\nWhen the operation result needs verifying, also set the execution contract fields on the script: expectedOutcome (intended result once finished), successCriteria (how to verify it - artifacts/exit codes/output patterns/return fields), failureGuidance (how to intervene when not as expected or failed - adjust inputs/manual steps/script_update then rerun). They are surfaced with the run result so the post-run agent can check the intended behavior and decide whether to intervene.\n\nWhen the operation takes inputs, declare a parameters array on the script: each entry { name (identifier, read as params.<name> in the script), type (string/number/boolean, default string), label?, description?, required, default }. Rule: required parameters must NOT declare a default and must be provided at run time; optional parameters MUST declare a default matching type. Callers then run with script_run({ scriptId, params: {...} }), and the effective params (defaults merged) are surfaced in the run result. Optional parameters with defaults let the /script candidate list run directly.\n\nTask instruction:\n" + instruction
				}],
				source: {
					kind: "plugin",
					plugin: "dsh-script-manager"
				}
			}));
			return {
				kind: "success",
				text: "Create-script task submitted; the model will create the script per the instruction."
			};
		}
	});
}
function registerScriptCommand(ctx, store, runner) {
	const commands = ctx.get("commands");
	if (!commands || typeof commands.register !== "function") return () => {};
	return commands.register({
		name: "script",
		description: "Execute custom script. Usage: /script <script-name> [{\"param\":\"value\"}]",
		async handler(invocation) {
			const { name: scriptName, argsText } = splitScriptInvocation(invocation.rawInput);
			if (!scriptName) {
				const scripts = await store.list();
				if (scripts.length === 0) return {
					kind: "error",
					text: "No scripts available. Use script_create to add one."
				};
				const lines = scripts.map((s) => "  " + s.id + " - " + s.description);
				lines.unshift("Usage: /script <script-name>\n\nAvailable scripts:");
				return {
					kind: "error",
					text: lines.join("\n")
				};
			}
			const script = await store.get(scriptName);
			if (!script) return {
				kind: "error",
				text: "Script not found: " + scriptName
			};
			const jsonArgs = parseJsonArgs(argsText);
			if (jsonArgs.error) return {
				kind: "error",
				text: jsonArgs.error
			};
			const runArgs = { scriptId: scriptName };
			if (jsonArgs.params) runArgs.params = jsonArgs.params;
			const agent = invocation.agent;
			if (agent && typeof agent.whenIdle === "function") await agent.whenIdle();
			const parentToken = Symbol("dsh.tool.execution");
			let toolResult;
			if (agent && agent.session) toolResult = await executeToolCallWithEvents(ctx, agent, "script_run", runArgs, invocation.signal, parentToken, async (_callId) => {
				const runResult = await runner.run(scriptName, invocation.signal, agent, parentToken, void 0, {
					callId: _callId,
					rootCallId: _callId
				}, jsonArgs.params, "/script");
				return {
					isError: false,
					content: [{
						type: "text",
						text: formatScriptResult(runResult)
					}],
					value: runResult
				};
			});
			else toolResult = await ctx.tools.execute({
				callId: CallId("script-cmd-" + Date.now()),
				name: "script_run",
				arguments: runArgs,
				agent,
				parent: parentToken,
				signal: invocation.signal
			});
			if (toolResult.isError) return {
				kind: "error",
				text: "Script failed: " + script.name + "\n" + toolResult.error.message
			};
			const runResult = toolResult.value;
			if (agent && typeof agent.followup === "function") agent.followup(createUserMessage({
				content: [{
					type: "text",
					text: "Script " + script.name + " executed (triggered by your /script command); see the tool call above."
				}],
				source: {
					kind: "plugin",
					plugin: "dsh-script-manager"
				}
			}));
			return {
				kind: runResult.success ? "success" : "error",
				text: runResult.success ? "Script executed: " + script.name : "Script failed: " + script.name
			};
		}
	});
}
//#endregion
//#region src/script-tools.ts
/** 通用 JSON 输出渲染：schema 字面量驱动 defineTool 的 O=json 推断；render 以 text 块承载 JSON
* （宿主 LLM adapter 仅把 text 块拼进模型可见内容，其余块类型会被丢弃，故不能用自定义 json 块）。 */
function jsonOutput() {
	return {
		schema: { type: "json" },
		render: (_a, v) => [{
			type: "text",
			text: jsonToText(v)
		}]
	};
}
/** JsonValue → 文本（undefined 兜底空串）。 */
function jsonToText(v) {
	try {
		const text = JSON.stringify(v, null, 2);
		return text === void 0 ? "" : text;
	} catch {
		return String(v);
	}
}
function registerScriptTools(ctx, store, runner, onChanged, history) {
	const disposers = [];
	const SCRIPT_FIELDS = {
		id: {
			type: "string",
			description: "Unique script id (lowercase letters/digits/hyphens, file name base)."
		},
		name: {
			type: "string",
			description: "Display name of the script."
		},
		description: {
			type: "string",
			description: "Script purpose note sent to the model."
		},
		version: {
			type: "string",
			description: "Version string (defaults to 0.1.0)."
		},
		author: {
			type: "string",
			description: "Author name (optional)."
		},
		tags: {
			type: "array",
			items: { type: "string" },
			description: "Optional tags."
		},
		code: {
			type: "string",
			description: "The TypeScript async function body; may return a value; runs with tools.* bindings (tools.read, tools.bash, ...) available."
		},
		registerAsTool: {
			type: "boolean",
			description: "When true, register the script as a no-argument agent tool named by toolName."
		},
		toolName: {
			type: "string",
			description: "Dynamic tool name when registerAsTool is true; must match ^[a-z_][a-z0-9_]*$; defaults to script_<id>."
		},
		timeoutMs: {
			type: "number",
			description: "Optional per-run timeout budget in milliseconds (positive integer). Defaults to the plugin maxExecutionTime config (0 = unlimited); a script_run({ timeoutMs }) call overrides it for one run."
		},
		parameters: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					name: {
						type: "string",
						description: "Parameter name - a valid identifier ([A-Za-z_][A-Za-z0-9_]*); the script reads it as params.<name>."
					},
					type: {
						type: "string",
						enum: [
							"string",
							"number",
							"boolean"
						],
						description: "Value type (default string)."
					},
					label: {
						type: "string",
						description: "Display label (defaults to name)."
					},
					description: {
						type: "string",
						description: "Short description shown to callers."
					},
					required: {
						type: "boolean",
						description: "Required parameters have no default and must be provided at run time."
					},
					default: {
						type: "json",
						description: "Default value for optional parameters (must match type; JSON-scalar string/number/boolean)."
					}
				}
			},
			description: "Parameter declarations (optional). Rule: required=true must NOT declare a default; required=false MUST declare a default matching type. Optional parameters run with defaults when omitted."
		},
		expectedOutcome: {
			type: "string",
			description: "Execution contract (optional, multi-line): the outcome the script is intended to achieve once finished. Surfaced with the run result so the agent can check whether the intended behavior was reached."
		},
		successCriteria: {
			type: "string",
			description: "Execution contract (optional, multi-line): how to verify the script reached its intended outcome - concrete checkpoints (artifacts, exit codes, output patterns, return fields). Surfaced with the run result."
		},
		failureGuidance: {
			type: "string",
			description: "Execution contract (optional, multi-line): how the agent should intervene when the outcome is not as expected or the run failed - inputs to adjust, manual steps, or updating the script then rerunning. Surfaced with the run result."
		}
	};
	const CREATE_SCRIPT_SCHEMA = {
		type: "object",
		additionalProperties: false,
		properties: {
			...SCRIPT_FIELDS,
			id: {
				...SCRIPT_FIELDS.id,
				required: true
			},
			name: {
				...SCRIPT_FIELDS.name,
				required: true
			},
			code: {
				...SCRIPT_FIELDS.code,
				required: true
			}
		}
	};
	const UPDATE_SCRIPT_SCHEMA = {
		type: "object",
		additionalProperties: false,
		properties: SCRIPT_FIELDS
	};
	const definitions = [
		{
			name: "script_list",
			description: "List custom script summaries (id/name/description/version/tags/metadata), optionally filtered by tags or limited.",
			parameters: {
				tags: {
					type: "array",
					items: { type: "string" },
					description: "Optional tag filter."
				},
				limit: {
					type: "number",
					description: "Optional maximum number of results."
				}
			},
			execute: (args) => store.list({
				tags: args.tags,
				limit: args.limit
			})
		},
		{
			name: "script_get",
			description: "Fetch the full definition of one custom script by id (includes its code).",
			parameters: { scriptId: {
				type: "string",
				required: true,
				description: "Unique script id (lowercase letters/digits/hyphens), e.g. hello-world."
			} },
			execute: async (args) => {
				if (!args.scriptId) throw new Error("scriptId required");
				const script = await store.get(args.scriptId);
				if (!script) throw new Error("Script not found: " + args.scriptId);
				return script;
			}
		},
		{
			name: "script_create",
			description: "Create a new custom script. The script body runs in an async TypeScript context with tools.* bindings (e.g. tools.read, tools.bash) available.",
			parameters: { script: {
				type: "object",
				required: true,
				additionalProperties: false,
				properties: CREATE_SCRIPT_SCHEMA.properties,
				description: "Script definition object; see properties for field formats. Required: id, name, code."
			} },
			execute: async (args) => {
				if (!args.script) throw new Error("script required");
				const created = await store.create(args.script, { source: "tool" });
				if (onChanged) await onChanged();
				return created;
			}
		},
		{
			name: "script_update",
			description: "Update an existing custom script by id (partial patch; changing id renames the script file).",
			parameters: {
				scriptId: {
					type: "string",
					required: true,
					description: "Unique script id to update, e.g. hello-world."
				},
				script: {
					type: "object",
					required: true,
					additionalProperties: false,
					properties: UPDATE_SCRIPT_SCHEMA.properties,
					description: "Partial patch object; accepted fields are the same as script_create (id, name, description, version, author, tags, code, registerAsTool, toolName). Unset fields keep current values."
				}
			},
			execute: async (args) => {
				if (!args.scriptId) throw new Error("scriptId required");
				const updated = await store.update(args.scriptId, args.script || {}, { source: "tool" });
				if (onChanged) await onChanged();
				return updated;
			}
		},
		{
			name: "script_delete",
			description: "Delete a custom script by id (removes its file and any registered dynamic tool).",
			parameters: { scriptId: {
				type: "string",
				required: true,
				description: "Unique script id to delete."
			} },
			execute: async (args) => {
				if (!args.scriptId) throw new Error("scriptId required");
				const ok = await store.delete(args.scriptId, { source: "tool" });
				if (onChanged) await onChanged();
				if (!ok) throw new Error("Script not found: " + args.scriptId);
				return { success: true };
			}
		},
		{
			name: "script_search",
			description: "Search custom scripts by text matched against id/name/description, optionally filtered by tags.",
			parameters: {
				query: {
					type: "string",
					required: true,
					description: "Search text."
				},
				tags: {
					type: "array",
					items: { type: "string" },
					description: "Optional tag filter."
				}
			},
			execute: (args) => store.search(args.query || "", { tags: args.tags })
		},
		{
			name: "script_change_history",
			description: "Query the change history of custom scripts (create/update/rename with revision number, changed fields and optional full snapshot of each version). Useful to see what changed when and which definition revision a version had. Per-script storage keeps each script separate; deleting a script also deletes its history.",
			parameters: {
				scriptId: {
					type: "string",
					description: "Optional script id filter (omit to query across all scripts)."
				},
				limit: {
					type: "number",
					description: "Optional max entries (default 20, cap 100)."
				},
				offset: {
					type: "number",
					description: "Optional offset into newest-first results."
				},
				includeSnapshot: {
					type: "boolean",
					description: "Include the full definition snapshot (with code) of each version. Default false to keep responses small."
				}
			},
			execute: async (args) => {
				if (!history) throw new Error("History is disabled (historyEnabled=false)");
				const limit = clampLimit(args.limit, 20, 100);
				return history.listChanges({
					scriptId: args.scriptId || void 0,
					limit,
					offset: args.offset,
					includeSnapshot: args.includeSnapshot === true
				});
			}
		},
		{
			name: "script_run_history",
			description: "Query the execution history of custom scripts (timestamp, revision the script was at when executed, caller, params, success/error, duration, return summary). Useful to see when a script started failing and with which params, and which definition revision each run used.",
			parameters: {
				scriptId: {
					type: "string",
					description: "Optional script id filter (omit to query across all scripts)."
				},
				limit: {
					type: "number",
					description: "Optional max entries (default 20, cap 100)."
				},
				offset: {
					type: "number",
					description: "Optional offset into newest-first results."
				}
			},
			execute: async (args) => {
				if (!history) throw new Error("History is disabled (historyEnabled=false)");
				return history.listRuns({
					scriptId: args.scriptId || void 0,
					limit: clampLimit(args.limit, 20, 100),
					offset: args.offset
				});
			}
		}
	];
	for (const def of definitions) disposers.push(ctx.tools.register(defineTool({
		name: def.name,
		description: def.description,
		parameters: def.parameters,
		output: jsonOutput(),
		async execute(args) {
			return def.execute(args);
		}
	})));
	disposers.push(ctx.tools.register(defineTool({
		name: "script_run",
		description: "Execute a registered custom script by its id. The script runs in an async TypeScript context with tools.* bindings (e.g. tools.read, tools.bash) available.",
		parameters: {
			scriptId: {
				type: "string",
				required: true,
				description: "The script id to execute (e.g. hello-world, project-info). Fetch available ids via script_list."
			},
			timeoutMs: {
				type: "number",
				description: "Optional per-run timeout budget in milliseconds (positive integer). Overrides the script/plugin default for this run only. Omit for no override."
			},
			params: {
				type: "object",
				additionalProperties: true,
				description: "Input parameters keyed by the script's declared parameter names (script_get/script_list expose the declarations). Required parameters must be provided; omitted optional parameters fall back to their defaults. Unknown keys are ignored but reported. Value types follow each parameter's declared type (string/number/boolean)."
			}
		},
		output: {
			schema: { type: "json" },
			render: (_a, v) => [{
				type: "text",
				text: formatScriptResult(v)
			}]
		},
		async execute(args, exec) {
			return await runner.run(args.scriptId, exec.signal, exec.agent, exec.token, args.timeoutMs, {
				callId: String(exec.callId),
				rootCallId: String(exec.rootCallId ?? exec.callId)
			}, args.params, "script_run");
		}
	})));
	return () => {
		for (const d of disposers) d();
	};
}
/** 限制 limit 参数到合理区间（默认 defaultN，上限 cap）。 */
function clampLimit(value, defaultN, cap) {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return defaultN;
	return Math.min(Math.floor(value), cap);
}
//#endregion
//#region src/web/routes.ts
/** 读取请求体（JSON）。空体返回 {}；解析失败抛错由调用方转 400。 */
async function readBody(req) {
	const chunks = [];
	for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	const raw = Buffer.concat(chunks).toString("utf-8").trim();
	if (raw === "") return {};
	return JSON.parse(raw);
}
/** 统一 JSON 响应 */
function json(res, status, body) {
	const payload = JSON.stringify(body ?? {});
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(payload);
}
/** 从 URL 解析查询参数 */
function parseQuery(req) {
	const url = new URL(req.url ?? "/", "http://x");
	const out = {};
	url.searchParams.forEach((v, k) => {
		out[k] = v;
	});
	return out;
}
/** 注册所有脚本管理路由；返回清理函数。 */
function registerScriptRoutes(injected, store, onChanged, history) {
	const webServer = injected?.webServer;
	if (!webServer || typeof webServer.register !== "function") return () => {};
	const disposers = [];
	disposers.push(webServer.register({
		kind: "prefixes",
		path: "/api/scripts",
		handler: async (req, res) => {
			const method = (req.method ?? "GET").toUpperCase();
			const pathname = new URL(req.url ?? "/", "http://x").pathname;
			const rest = pathname === "/api/scripts" ? "" : pathname.slice(13);
			const id = rest === "" ? null : decodeURIComponent(rest);
			try {
				if (method === "GET") {
					if (id === null) {
						const query = parseQuery(req);
						return json(res, 200, await store.list({
							...query.tags !== void 0 ? { tags: query.tags.split(",").filter(Boolean) } : {},
							...query.limit !== void 0 ? { limit: Number(query.limit) || void 0 } : {}
						}));
					}
					const script = await store.get(id);
					if (!script) return json(res, 404, { error: "Script not found: " + id });
					return json(res, 200, script);
				}
				if (method === "POST") {
					if (id !== null) return json(res, 400, { error: "POST /api/scripts does not accept an id path segment" });
					const body = await readBody(req);
					const script = await store.create(body, { source: "web" });
					if (onChanged) await onChanged();
					return json(res, 200, script);
				}
				if (method === "PUT") {
					if (id === null) return json(res, 400, { error: "PUT /api/scripts requires /<id>" });
					const body = await readBody(req);
					const script = await store.update(id, body, { source: "web" });
					if (onChanged) await onChanged();
					return json(res, 200, script);
				}
				if (method === "DELETE") {
					if (id === null) return json(res, 400, { error: "DELETE /api/scripts requires /<id>" });
					if (!await store.delete(id, { source: "web" })) return json(res, 404, { error: "Script not found: " + id });
					if (onChanged) await onChanged();
					return json(res, 200, { success: true });
				}
				return json(res, 405, { error: "Method not allowed: " + method });
			} catch (error) {
				json(res, error instanceof SyntaxError || error instanceof ValidationError ? 400 : 500, { error: error instanceof Error ? error.message : String(error) });
			}
		}
	}));
	disposers.push(webServer.register({
		kind: "prefixes",
		path: "/api/script-history",
		handler: async (req, res) => {
			const method = (req.method ?? "GET").toUpperCase();
			const pathname = new URL(req.url ?? "/", "http://x").pathname;
			const rest = pathname === "/api/script-history" ? "" : pathname.slice(20);
			const kind = rest === "" ? "runs" : decodeURIComponent(rest);
			if (method !== "GET") return json(res, 405, { error: "Method not allowed: " + method });
			if (kind !== "changes" && kind !== "runs") return json(res, 400, { error: "History kind must be changes or runs: " + kind });
			try {
				const query = parseQuery(req);
				const options = {
					scriptId: query.scriptId ? decodeURIComponent(query.scriptId) : void 0,
					limit: query.limit !== void 0 ? Number(query.limit) || 50 : 50,
					offset: query.offset !== void 0 ? Number(query.offset) || 0 : void 0,
					includeSnapshot: query.includeSnapshot === "1" || query.includeSnapshot === "true"
				};
				if (!history) return json(res, 200, {
					kind,
					entries: [],
					disabled: true
				});
				return json(res, 200, {
					kind,
					entries: kind === "changes" ? await history.listChanges(options) : await history.listRuns(options)
				});
			} catch (error) {
				json(res, 500, { error: error instanceof Error ? error.message : String(error) });
			}
		}
	}));
	return () => {
		for (const d of disposers) d();
	};
}
//#endregion
//#region src/index.ts
const name = "dsh-script-manager";
const inject = [
	"tools",
	"commands",
	"codeRuntime",
	"systemPrompt"
];
const Config = Schema.object({
	scriptsDir: Schema.string().default("~/.dsh/scripts").description("脚本存储目录"),
	maxExecutionTime: Schema.number().default(0).description("默认脚本执行超时（毫秒）；0 = 不限制（脚本级 timeoutMs / 调用级 script_run timeoutMs 可覆盖）"),
	historyEnabled: Schema.boolean().default(true).description("是否记录脚本变更/执行历史（false = 完全禁用，不建目录、不写文件、查询工具/端点返回空）"),
	stateDir: Schema.string().default("").description("历史数据目录（与脚本本体存储分离）。留空 = <scriptsDir>/.state；可填任意绝对路径，如 ~/.local/share/dsh/script-state"),
	historyChangesMax: Schema.number().default(200).description("每脚本变更历史(changes.jsonl)保留条数；超限压缩保留最新 N 条"),
	historyRunsMax: Schema.number().default(500).description("每脚本执行历史(runs.jsonl)保留条数；超限压缩保留最新 N 条")
});
/** 注入系统提示：让 agent 常态化知道 script_* 工具的存在与适用时机。 */
const SCRIPT_TOOLS_GUIDANCE = [
	"Custom script tooling is available in this environment (dsh-script-manager). ",
	"You can inspect and manage reusable operation scripts, then call them instead of repeating manual steps:",
	"- script_list / script_get: inspect registered scripts (id, name, description).",
	"- script_create: define a new script (async TypeScript body; tools.* such as tools.read / tools.bash are available inside).",
	"- script_update / script_delete: maintain existing scripts.",
	"- script_run: execute a script by its id (its result is returned; formatScriptResult output also appears in the conversation).",
	"- script_change_history / script_run_history: query per-script change/execution history. Each change is a revision (1, 2, 3...) with a full snapshot of that version; each run records the revision it executed plus caller/params/success/error/duration. Use them when debugging what changed or when a script started failing (tie run.revision to the matching change snapshot).",
	"Prefer creating a script when the same multi-step operation recurs or would otherwise be tedious to repeat.",
	"",
	"PTC (programmatic tool call) scripts: each script is a standalone, self-contained execution unit — an async TypeScript body that runs with the code runtime, has tools.* bindings (tools.read, tools.bash, ...) available inside, executes without a model roundtrip, and should return a lossless-JSON value (plus console.log for logs). Scripts live under ~/.dsh/scripts, are managed via the script_* tools, can be registered as direct agent tools (registerAsTool + toolName), and are run via script_run or /script <id>. Write scripts that are self-contained and reusable (resolve inputs inside the script), keep them generic, and always verify with script_run after creating or updating.",
	"",
	"When the user asks to distill/summarize an operation or workflow into a reusable script (e.g. \"把…总结为脚本\", \"固化为可复用脚本\"), follow this flow:",
	"1. First script_search / script_list to check whether a similar script already exists — do not duplicate.",
	"2. Compose the script with script_create: choose a clear id (lowercase-hyphen), name, and description; write a self-contained async TypeScript body using tools.* bindings that reproduces the steps, and return a useful value.",
	"3. If the script is meant to be invoked directly as a tool during this task, set registerAsTool: true with a toolName. Otherwise keep it runnable via script_run / /script <id>.",
	"4. After creation, verify it with script_run (or /script <id>) and tell the user how to invoke it (script_run, /script <id>, or the dynamic tool name).",
	"5. Keep the script generic and parameter-light unless the user asks for specific inputs; prefer editing later via script_update.",
	"",
	"Execution contracts: when a script performs an operation whose result needs verifying, declare optional fields on the script so the post-run agent can judge success and decide whether to intervene:",
	"- expectedOutcome: what the script is intended to achieve once finished.",
	"- successCriteria: how to verify it (artifacts, exit codes, output patterns, return fields).",
	"- failureGuidance: how to intervene when the outcome is not as expected or the run failed (adjust inputs, manual steps, or script_update then rerun).",
	"These fields are surfaced with the run result (text section before Logs, plus a Review line). After running a script, first check it against its contract: if the expected outcome is reached, finish; only intervene when it is not (per failureGuidance, avoiding wasteful expansion). Scripts without a contract keep working unchanged.",
	"",
	"Parameterized scripts: a script may declare a parameters array to take inputs. Each entry: { name (identifier; the script reads it as params.<name>), type (string/number/boolean, default string), label?, description?, required, default }. Rules: required=true must NOT declare a default (it must be provided per run); required=false MUST declare a default matching type. Provide inputs via script_run({ scriptId, params: {...} }) or /script <id> {'key':'value'}; the /script candidate UI offers a fill-in popup for scripts with parameters. Effective params (inputs merged with defaults) appear in the run result so the post-run agent can verify against the contract."
].join("");
function apply(ctx, config = {}) {
	try {
		ctx.systemPrompt?.section?.({
			name: "dsh-script-manager",
			order: 210,
			text: SCRIPT_TOOLS_GUIDANCE
		});
	} catch (error) {
		console.error("[" + name + "] failed to register system prompt section:", error);
	}
	const resolved = {
		scriptsDir: config.scriptsDir ?? "~/.dsh/scripts",
		maxExecutionTime: config.maxExecutionTime ?? 0,
		historyEnabled: config.historyEnabled !== false,
		stateDir: config.stateDir ?? "",
		historyChangesMax: config.historyChangesMax ?? 200,
		historyRunsMax: config.historyRunsMax ?? 500
	};
	let history;
	if (resolved.historyEnabled) {
		const scriptsDir = expandHome(resolved.scriptsDir);
		history = new HistoryStore(expandHome(resolved.stateDir.trim() !== "" ? resolved.stateDir.trim() : join(scriptsDir, ".state")), {
			changesMax: resolved.historyChangesMax,
			runsMax: resolved.historyRunsMax
		});
	}
	const store = new ScriptStore(resolved.scriptsDir, history);
	const runner = new ScriptRunner(store, ctx, {
		defaultTimeoutMs: resolved.maxExecutionTime,
		...history !== void 0 ? { history } : {}
	});
	const toolRegistry = new ScriptToolRegistry(ctx, store, runner);
	const syncDynamicTools = async () => {
		try {
			await toolRegistry.sync();
		} catch (error) {
			console.error("[" + name + "] failed to sync dynamic tools:", error);
		}
	};
	const initTasks = [store.init()];
	if (history !== void 0) initTasks.push(history.init());
	Promise.all(initTasks).then(syncDynamicTools).catch((err) => {
		console.error("[" + name + "] Failed to initialize script store:", err);
	});
	const unregisterCommand = registerScriptCommand(ctx, store, runner);
	const unregisterCreateCommand = registerCreateScriptCommand(ctx);
	const unregisterTools = registerScriptTools(ctx, store, runner, syncDynamicTools, history);
	ctx.inject(["webServer"], (injected) => {
		return registerScriptRoutes(injected, store, syncDynamicTools, history);
	});
	ctx.effect(() => {
		return () => {
			unregisterCommand();
			unregisterCreateCommand();
			unregisterTools();
			toolRegistry.dispose();
		};
	});
}
/** 展开 ~ 为用户主目录（配置路径可能含 ~）。 */
function expandHome(path) {
	return path.startsWith("~") ? join(homedir(), path.slice(1)) : path;
}
//#endregion
export { Config, apply, inject, name };

//# sourceMappingURL=index.mjs.map