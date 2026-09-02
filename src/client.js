/**
 * DSH Script Manager Client Plugin
 *
 * 1. 注册 /script 命令的 popupSelect 装饰（选择脚本执行）
 * 2. 注册设置页 "脚本管理" section：
 *    - 单行卡片式列表：每张卡片 = 标题名称 + 副标题 id + 编辑/删除，
 *      删除为行内二次确认
 *    - 编辑视图：在原界面位置替换列表，展示完整表单（所有字段可编辑，
 *      含 id 重命名），保存/取消返回列表
 *
 * 视觉复用 @deepseek-ai/dsh-client-ui-primitives（Button/Icon）与
 * DSW 设计变量；容器为透明细边框圆角卡片，去除多余色块与边距。
 */
window.__ModuleLoader__.load({
	id: "dsh-script-manager/client",
	factory: (require) => {
		var module = { exports: {} };
		module.exports = {};
		Object.defineProperty(module.exports, Symbol.toStringTag, { value: "Module" });

		var react = require("react");
		var P = require("@deepseek-ai/dsh-client-ui-primitives");
		var h = react.createElement;

		var inject = ["commandUi", "slots", "remote", "remote.commands", "sessions"];

		// ---- 样式：单行卡片列表 + 原位表单（统一 DSW 视觉） ----
		var css = [
			".smp-wrap{display:flex;flex-direction:column;gap:10px}",
			".smp-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-height:32px}",
			".smp-title{flex:1;font-size:14px;font-weight:500;line-height:24px;color:var(--dsw-alias-label-primary)}",
			".smp-actions{display:flex;gap:6px;align-items:center;white-space:nowrap}",
			".smp-error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.5;white-space:pre-wrap}",
			".smp-notice{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}",
			".smp-list{display:flex;flex-direction:column;gap:8px}",
			".smp-card{display:flex;align-items:center;gap:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:10px 14px;background:transparent}",
			".smp-card:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".smp-card-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}",
			".smp-name{font-size:13px;font-weight:500;line-height:20px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".smp-id{font-family:var(--dsh-font-mono,monospace);font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".smp-danger-btn{color:var(--dsw-alias-state-error-primary)!important}",
			".smp-empty{padding:18px 14px;font-size:12px;color:var(--dsw-alias-label-tertiary)}",
			".smp-form{padding:14px 16px;display:flex;flex-direction:column;gap:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:transparent}",
			".smp-form-head{display:flex;align-items:center;gap:8px;margin-bottom:-2px}",
			".smp-form-title{flex:1;font-size:14px;font-weight:500;line-height:24px;color:var(--dsw-alias-label-primary)}",
			".smp-field{display:flex;flex-direction:column;gap:5px}",
			".smp-field-row{display:flex;gap:10px;flex-wrap:wrap}",
			".smp-field-row>.smp-field{flex:1;min-width:120px}",
			".smp-label{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:16px}",
			".smp-input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;height:32px;padding:0 10px;font-size:13px;font-family:inherit;box-sizing:border-box;width:100%}",
			".smp-input:focus-visible{border-color:var(--dsw-alias-state-business-primary);outline:none}",
			".smp-code-editor{position:relative;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-markdown-code-block);overflow:auto}",
			".smp-code-editor:focus-within{border-color:var(--dsw-alias-state-business-primary)}",
			".smp-code-editor::-webkit-scrollbar{width:10px;height:10px}",
			".smp-code-editor::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-thumb, rgba(255,255,255,.18));border-radius:5px}",
			".smp-code-editor::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-scrollbar-thumb-hover, rgba(255,255,255,.3))}",
			".smp-code-mirror,.smp-code-input{margin:0!important;font-family:var(--dsh-font-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace)!important;font-size:12px!important;line-height:18px!important;letter-spacing:normal!important;word-spacing:0!important;font-kerning:none!important;font-variant-ligatures:none!important;font-feature-settings:none!important;text-align:left!important;direction:ltr!important;tab-size:4;white-space:pre-wrap;word-break:break-all;box-sizing:border-box;min-height:240px}",
			".smp-code-mirror{position:absolute;left:0;top:0;right:0;overflow:auto;pointer-events:none;color:var(--dsw-alias-label-primary);padding:8px 16px 8px 10px!important;scrollbar-width:none}",
			".smp-code-mirror::-webkit-scrollbar{display:none}",
			".smp-code-input{position:relative;width:100%;min-height:240px;height:auto;padding:8px 16px 8px 10px!important;overflow:hidden;resize:none;border:0;outline:none;background:transparent;color:transparent;-webkit-text-fill-color:transparent;caret-color:var(--dsw-alias-label-primary)}",
			".smp-code-input::selection{color:transparent;-webkit-text-fill-color:transparent;background:rgba(110,153,255,.38)}",
			".smp-code-input::placeholder{color:var(--dsw-alias-label-tertiary);-webkit-text-fill-color:var(--dsw-alias-label-tertiary)}",
			".smp-tk-k{color:#c678dd}",
			".smp-tk-s{color:#98c379}",
			".smp-tk-c{color:var(--dsw-alias-label-tertiary);font-style:italic}",
			".smp-tk-n{color:#d19a66}",
			".smp-check{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:var(--dsw-alias-label-primary);min-height:20px;align-self:flex-start}",
			".smp-form .smp-check{align-self:flex-start!important;display:inline-flex!important}",
			".smp-form .smp-check input[type=\"checkbox\"]{width:14px!important;max-width:14px!important;min-width:14px!important;height:14px!important;max-height:14px!important;box-sizing:border-box!important;flex:none!important;margin:0!important}",
			"@media (max-width:640px){.smp-del-narrow{display:none}}",
			"/* popupSelect（/script 弹窗）：标题不压缩、不换行（按内容完整展示）；要压缩就压缩描述 */",
			"[role=\"listbox\"] [class$=\"_label\"]{white-space:nowrap!important;text-overflow:clip!important;overflow:visible!important;min-width:auto!important;flex:0 1 auto!important;max-width:none!important}",
			"[role=\"listbox\"] [class$=\"_detail\"]{flex:1 1 auto!important;min-width:0!important;white-space:nowrap!important;text-overflow:ellipsis!important;overflow:hidden!important}",
			"/* 移动端修复：宿主把 popupSelect(/script 候选)挂载在 uV2eYG_overlayAnchor 之下；",
			"部分移动适配样式(如 dsh-bridge #dsh-bridge-mobile-styles @media<=768px)会对该锚点整体设置",
			"pointer-events:none!important，导致候选全部点击穿透——点上去触发外层 dismiss，列表消失且无动作。",
			"这里按 role 恢复弹层内容的命中测试（比桥接规则的 0,1,1 特异性更高，不受注入顺序影响）。 */",
			"div[class*=\"uV2eYG_overlayAnchor\"] div[role=\"listbox\"]{pointer-events:auto!important}",
			"div[class*=\"uV2eYG_overlayAnchor\"] div[role=\"listbox\"] *{pointer-events:auto!important}",
			"div[class*=\"uV2eYG_overlayAnchor\"] [role=\"option\"]{pointer-events:auto!important}",
			"div[class*=\"uV2eYG_overlayAnchor\"] [role=\"option\"] *{pointer-events:auto!important}",
			"div[class*=\"uV2eYG_overlayAnchor\"] input[type=\"text\"]{pointer-events:auto!important}",
			"/* script_run 自绘 toolview（B 层）：Script 根行 + 展开输出卡 */",
			".smv-card{flex-direction:column;display:flex}",
			".smv-row{align-items:center;min-width:0;height:24px;display:flex;position:relative;overflow:hidden}",
			".smv-row[data-expandable]{cursor:pointer}",
			".smv-card[data-state=running] .smv-row:after{content:\"\";background:linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--dsw-alias-bg-base) 60%, transparent) 55%, transparent 100%);pointer-events:none;width:300px;animation:2.6s ease-out infinite smv-dsh-script-row-sweep;position:absolute;inset:0 auto 0 0}@keyframes smv-dsh-script-row-sweep{0%{left:-300px}90%,to{left:100%}}",
			".smv-leading{width:16px;height:16px;color:var(--dsw-alias-label-tertiary);flex:none;justify-content:center;align-items:center;margin-right:6px;display:inline-flex;position:relative}",
			".smv-chevron{color:var(--dsw-alias-label-secondary)}",
			".smv-iconIdle{opacity:1;transition:opacity .1s;display:inline-flex}",
			".smv-chevronHover{opacity:0;margin:auto;transition:opacity .1s;position:absolute;inset:0}",
			".smv-row:hover .smv-iconIdle{opacity:0}",
			".smv-row:hover .smv-chevronHover{opacity:1}",
			".smv-title{color:var(--dsw-alias-label-secondary);flex:none;font-size:14px;line-height:24px}",
			".smv-sep{background:var(--dsw-alias-label-caption);border-radius:1px;flex:none;width:2px;height:2px;margin:0 8px}",
			".smv-summary{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-secondary);flex:auto;font-size:14px;line-height:24px;overflow:hidden}",
			".smv-errorSummary{color:var(--dsw-alias-state-error-primary)}",
			".smv-summarySuffix{white-space:nowrap;color:var(--dsw-alias-label-tertiary);flex:none;margin-left:4px;font-size:14px;line-height:24px}",
			".smv-bodyWrap{flex-direction:column;display:flex}",
			".smv-outputCard{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-markdown-code-block);border-radius:12px;flex-direction:column;max-height:320px;margin:4px 0 4px 4px;display:flex;overflow:hidden}",
			".smv-outputHeader{border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-markdown-code-block-banner);color:var(--dsw-alias-label-caption);flex:none;padding:2px 12px;font-size:11px;line-height:20px;letter-spacing:.02em;text-transform:uppercase}",
			".smv-output{white-space:pre-wrap;overflow-wrap:break-word;color:var(--dsw-alias-label-secondary);margin:0;padding:10px 14px;font:var(--dsw-font-markdown-code-block-small);font-family:var(--dsh-font-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);overflow:auto}",
			".smv-output[data-error]{color:var(--dsw-alias-state-error-primary)}",
			".smv-subCount{color:var(--dsw-alias-label-tertiary);flex:none;margin-left:auto;font-size:11px;line-height:16px;padding-right:4px}",
			".smv-visuallyHidden{clip:rect(0 0 0 0);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}",
			".smv-inspectButton{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);cursor:pointer;opacity:0;border-radius:999px;align-items:center;gap:4px;margin:4px 0 2px 4px;padding:2px 8px;font-size:11px;line-height:16px;transition:opacity .1s;display:inline-flex}",
			".smv-outputCard:hover .smv-inspectButton,.smv-inspectButton:focus-visible{opacity:1}",
			".smv-inspectButton:hover{background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary)}"
		].join("");
		var tagId = "dsh-script-manager/smp.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"" + tagId + "\"]") === null) {
			var tag = document.createElement("style");
			tag.dataset.plugin = "dsh-script-manager";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		// ---- REST 通道（仅 CRUD，无执行） ----
		function makeApi() {
			function parse(res) {
				return res.json().then(function (data) {
					if (res.ok) return data;
					if (data && data.error) return Promise.reject(new Error(data.error));
					return Promise.reject(new Error("HTTP " + res.status));
				});
			}
			return {
				list: function () { return fetch("/api/scripts").then(parse); },
				get: function (id) { return fetch("/api/scripts/" + encodeURIComponent(id)).then(parse); },
				create: function (body) {
					return fetch("/api/scripts", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body)
					}).then(parse);
				},
				update: function (id, body) {
					return fetch("/api/scripts/" + encodeURIComponent(id), {
						method: "PUT",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body)
					}).then(parse);
				},
				remove: function (id) {
					return fetch("/api/scripts/" + encodeURIComponent(id), { method: "DELETE" }).then(parse);
				}
			};
		}

		// ---- 表单映射 ----
		function emptyForm() {
			return { id: "", name: "", description: "", version: "0.1.0", author: "", tags: "", registerAsTool: false, toolName: "", timeoutMs: "", code: "" };
		}
		function scriptToForm(s) {
			return {
				id: s.id, name: s.name, description: s.description || "",
				version: s.version || "", author: s.author || "",
				tags: (s.tags || []).join(", "), registerAsTool: !!s.registerAsTool,
				toolName: s.toolName || "", timeoutMs: (s.timeoutMs === undefined || s.timeoutMs === null) ? "" : String(s.timeoutMs), code: s.code || ""
			};
		}
		function formToBody(f) {
			return {
				id: (f.id || "").trim(), name: (f.name || "").trim(), description: (f.description || "").trim(),
				version: (f.version || "").trim(), author: (f.author || "").trim(),
				tags: (f.tags || "").split(",").map(function (t) { return t.trim(); }).filter(Boolean),
				registerAsTool: !!f.registerAsTool,
				toolName: (f.toolName || "").trim() || undefined,
				timeoutMs: (function () { var v = String(f.timeoutMs || "").trim(); if (v === "") return undefined; var n = parseInt(v, 10); return (isFinite(n) && n > 0) ? n : undefined; })(),
				code: f.code || ""
			};
		}

		// ---- 字段辅助 ----
		function field(label, control) {
			return h("div", { className: "smp-field" }, h("label", { className: "smp-label" }, label), control);
		}
		function textInput(value, onChange, placeholder) {
			return h("input", {
				className: "smp-input",
				value: value,
				onChange: function (e) { onChange(e.target.value); },
				placeholder: placeholder || ""
			});
		}

		// ---- TypeScript 轻量高亮（tokenizer → 带 span 的 HTML） ----
		var TS_RE = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`)|\b(const|let|var|function|return|await|async|if|else|for|while|import|export|from|new|typeof|instanceof|class|interface|type|extends|implements|readonly|true|false|null|undefined|void|try|catch|throw|switch|case|default|break|continue|of|in|this|as|satisfies|yield)\b|\b(\d+(?:\.\d+)?)\b/g;
		function escHtml(s) {
			return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
		}
		function highlightTs(code) {
			var text = String(code || "");
			var out = "";
			var last = 0;
			var m;
			TS_RE.lastIndex = 0;
			while ((m = TS_RE.exec(text)) !== null) {
				out += escHtml(text.slice(last, m.index));
				if (m[1] !== undefined) out += "<span class=\"smp-tk-c\">" + escHtml(m[1]) + "</span>";
				else if (m[2] !== undefined) out += "<span class=\"smp-tk-s\">" + escHtml(m[2]) + "</span>";
				else if (m[3] !== undefined) out += "<span class=\"smp-tk-k\">" + escHtml(m[3]) + "</span>";
				else if (m[4] !== undefined) out += "<span class=\"smp-tk-n\">" + escHtml(m[4]) + "</span>";
				last = m.index + m[0].length;
			}
			out += escHtml(text.slice(last));
			return out;
		}

		// ---- 高亮代码编辑器（透明 textarea + pre 高亮层 + 滚动同步） ----
		function CodeEditor(props) {
			var value = props.value;
			var onChange = props.onChange;
			var placeholder = props.placeholder;
			var refs = react.useRef({});
			var html = react.useMemo(function () { return highlightTs(value); }, [value]);

			// overlay 方案（容器统一滚动）：textarea 不自行滚动（overflow:hidden），
			// 高度随内容自适应（scrollHeight）；pre 高亮层 absolute 铺满并内部滚动
			// （滚动条隐藏），容器滚动时把 scrollTop 同步给 pre —— 滚动位置一致，
			// 且换行宽度不受任何内部滚动条影响，两层始终逐字符对齐。
			function syncHeight() {
				var ta = refs.current.ta;
				if (!ta) return;
				ta.style.height = "auto";
				ta.style.height = ta.scrollHeight + "px";
			}
			function onScrollContainer() {
				var cont = refs.current.cont;
				var pre = refs.current.pre;
				if (cont && pre) pre.scrollTop = cont.scrollTop;
			}
			function onKeyDown(e) {
				if (e.key === "Tab") {
					e.preventDefault();
					var ta = refs.current.ta;
					if (!ta) return;
					var start = ta.selectionStart;
					var end = ta.selectionEnd;
					var next = value.slice(0, start) + "  " + value.slice(end);
					onChange(next);
					setTimeout(function () {
						ta.selectionStart = ta.selectionEnd = start + 2;
					}, 0);
				}
			}

			// value 变化后同步高度（初渲染与每次输入）
			react.useEffect(function () { syncHeight(); }, [value]);

			return h("div", {
					className: "smp-code-editor",
					ref: function (el) { refs.current.cont = el; },
					onClick: function () { var ta = refs.current.ta; if (ta) ta.focus(); },
					onScroll: onScrollContainer
				},
				h("pre", {
					className: "smp-code-mirror",
					"aria-hidden": true,
					ref: function (el) { refs.current.pre = el; },
					dangerouslySetInnerHTML: { __html: html }
				}),
				h("textarea", {
					className: "smp-code-input",
					ref: function (el) { refs.current.ta = el; },
					value: value,
					placeholder: placeholder || "",
					spellCheck: false,
					wrap: "soft",
					onChange: function (e) { onChange(e.target.value); },
					onInput: function () { syncHeight(); },
					onKeyDown: onKeyDown
				})
			);
		}

		// ---- 编辑/新建表单（替换列表视图，原位置渲染） ----
		function ScriptForm(props) {
			var api = props.api;
			var initial = props.initial;
			var onDone = props.onDone;
			var onCancel = props.onCancel;
			var onDeleted = props.onDeleted;
			var editing = !!initial;
			var state = react.useState(initial ? scriptToForm(initial) : emptyForm());
			var form = state[0];
			var setForm = state[1];
			var errState = react.useState(null);
			var err = errState[0];
			var setErr = errState[1];
			var busyState = react.useState(false);
			var busy = busyState[0];
			var setBusy = busyState[1];
			var confirmDelState = react.useState(false);
			var confirmDel = confirmDelState[0];
			var setConfirmDel = confirmDelState[1];

			function set(key) {
				return function (v) {
					var next = {};
					for (var k in form) next[k] = form[k];
					next[key] = v;
					setForm(next);
				};
			}
			function save() {
				var body = formToBody(form);
				if (!body.id) { setErr("id 不能为空"); return; }
				if (!/^[a-z0-9][a-z0-9-]*$/.test(body.id)) { setErr("id 只能包含小写字母、数字与连字符，且以字母/数字开头"); return; }
				if (!body.name) { setErr("名称不能为空"); return; }
				if (!body.code) { setErr("代码不能为空"); return; }
				if (body.toolName && !/^[a-z_][a-z0-9_]*$/.test(body.toolName)) { setErr("工具名只能含小写字母、数字、下划线，且以字母或下划线开头（留空自动生成）"); return; }
				if (String(form.timeoutMs || "").trim() !== "" && !/^[1-9]\d*$/.test(String(form.timeoutMs).trim())) { setErr("超时需为正整数毫秒（留空 = 不限制）"); return; }
				setErr(null);
				setBusy(true);
				var request = editing ? api.update(initial.id, body) : api.create(body);
				request.then(function (saved) { setBusy(false); onDone(saved); })
					.catch(function (e) { setBusy(false); setErr(String((e && e.message) || e)); });
			}
			function requestDelete(pass) {
				if (!editing) return;
				if (!pass) { setConfirmDel(true); return; }
				setErr(null);
				setBusy(true);
				api.remove(initial.id).then(function () {
					setBusy(false);
					if (typeof onDeleted === "function") onDeleted(initial.id);
				}).catch(function (e) {
					setBusy(false);
					setConfirmDel(false);
					setErr("删除失败: " + String((e && e.message) || e));
				});
			}

			return h("div", { className: "smp-form" },
				h("div", { className: "smp-form-head" },
					h("span", { className: "smp-form-title" }, editing ? "编辑脚本：" + initial.id : "新建脚本"),
					h(P.Button, { variant: "outline", disabled: busy, onClick: onCancel }, "取消编辑")
				),
				h("div", { className: "smp-field-row" },
					field("ID（保存时如变更将重命名）", textInput(form.id, set("id"), "my-script")),
					field("名称", textInput(form.name, set("name"), "显示名称"))
				),
				field("描述", textInput(form.description, set("description"), "脚本用途说明")),
				h("div", { className: "smp-field-row" },
					field("版本", textInput(form.version, set("version"), "0.1.0")),
					field("作者", textInput(form.author, set("author"))),
					field("标签（逗号分隔）", textInput(form.tags, set("tags"), "ops, test"))
				),
				h("label", {
					className: "smp-check",
					style: { display: "inline-flex", alignItems: "center", gap: "8px", alignSelf: "flex-start", minHeight: "20px" }
				},
					h("input", {
						type: "checkbox",
						checked: form.registerAsTool,
						onChange: function (e) { set("registerAsTool")(e.target.checked); },
						style: { width: "14px", height: "14px", margin: "0", flex: "none" }
					}),
					"注册为 agent 可调用工具"
				),
				form.registerAsTool
					? field("工具名（留空自动生成 script_<id>）",
						textInput(form.toolName, set("toolName"), "script_" + (form.id || "my_script").replace(/-/g, "_")))
					: null,
				field("执行超时（毫秒，留空 = 不限制）",
					textInput(form.timeoutMs, set("timeoutMs"), "不限制")),
				h("div", { className: "smp-notice", style: { marginTop: -6 } }, "超时优先级：单次调用 timeoutMs > 本脚本设置 > 插件默认（默认不限制）。超过预算将中止整个脚本。"),
				field("脚本代码（async 上下文，可用 tools.* 绑定）",
					h(CodeEditor, {
						value: form.code,
						onChange: function (v) { set("code")(v); },
						placeholder: [
							"const result = await tools.read({ file_path: '/path/to/file' });",
							"console.log('读取结果', result);",
							"return { ok: true };"
						].join("\n")
					})),
				err ? h("div", { className: "smp-error" }, err) : null,
				h("div", { className: "smp-actions", style: { justifyContent: "space-between" } },
					editing
						? (confirmDel
							? h("span", { className: "smp-actions", style: { color: "var(--dsw-alias-label-secondary)", fontSize: 12 } },
								h("span", {}, "确认删除？"),
								h(P.Button, { variant: "outline", className: "smp-danger-btn", disabled: busy, onClick: function () { requestDelete(true); } }, "删除"),
								h(P.Button, { variant: "outline", disabled: busy, onClick: function () { setConfirmDel(false); } }, "取消"))
							: h(P.Button, { variant: "outline", className: "smp-danger-btn", disabled: busy, onClick: function () { requestDelete(false); } },
								h(P.IconTrashOutline16, { size: 14 }), " 删除"))
						: null,
					h("span", { className: "smp-actions" },
						h(P.Button, { variant: "primary", disabled: busy, onClick: save }, busy ? "保存中…" : "保存"),
						h(P.Button, { variant: "outline", disabled: busy, onClick: onCancel }, "取消"))
				)
			);
		}

		// ---- 单行脚本卡片：标题名称 + 副标题 id + 编辑/删除（行内确认） ----
		function ScriptCard(props) {
			var script = props.script;
			var onEdit = props.onEdit;
			var onDelete = props.onDelete;
			var editBusy = props.editBusy;
			var deleting = props.deleting;

			return h("div", { className: "smp-card" },
				h("div", { className: "smp-card-main" },
					h("div", { className: "smp-name", title: script.name }, script.name),
					h("div", { className: "smp-id", title: script.id }, script.id)
				),
				h("div", { className: "smp-actions" },
					h("span", { className: "smp-actions" },
						h(P.Button, { variant: "outline", disabled: editBusy, onClick: function () { onEdit(script); } },
							h(P.IconEditOutline16, { size: 14 }), editBusy ? " 加载中" : " 编辑")),
					h("span", { className: "smp-actions smp-del-narrow" },
						deleting
							? h("span", { className: "smp-actions", style: { color: "var(--dsw-alias-label-secondary)", fontSize: 12 } },
								h("span", {}, "确认删除？"),
								h(P.Button, { variant: "outline", className: "smp-danger-btn", disabled: editBusy, onClick: function () { onDelete(script, true); } }, "删除"),
								h(P.Button, { variant: "outline", disabled: editBusy, onClick: function () { onDelete(script, false); } }, "取消"))
							: h(P.Button, { variant: "outline", className: "smp-danger-btn", disabled: editBusy, onClick: function () { onDelete(script); } },
								h(P.IconTrashOutline16, { size: 14 }), " 删除"))
				)
			);
		}

		// ---- 管理 section：列表 ⇄ 编辑视图原位替换 ----
		function ScriptManagerSection(props) {
			var api = props.api;
			if (!api) return null;
			var listState = react.useState(null);
			var scripts = listState[0];
			var setScripts = listState[1];
			var errorState = react.useState(null);
			var error = errorState[0];
			var setError = errorState[1];
			var noticeState = react.useState(null);
			var notice = noticeState[0];
			var setNotice = noticeState[1];
			var viewState = react.useState("list");
			var view = viewState[0];
			var setView = viewState[1];
			var editingState = react.useState(null);
			var editing = editingState[0];
			var setEditing = editingState[1];
			var deleteIdState = react.useState(null);
			var deleteId = deleteIdState[0];
			var setDeleteId = deleteIdState[1];
			var editBusyState = react.useState(false);
			var editBusy = editBusyState[0];
			var setEditBusy = editBusyState[1];

			function load() {
				setError(null);
				api.list().then(function (data) {
					if (Array.isArray(data)) { setScripts(data); }
					else { setError("响应格式异常"); setScripts([]); }
				}).catch(function (e) {
					setError(String((e && e.message) || e));
					setScripts([]);
				});
			}
			react.useEffect(function () { load(); }, []);

			// 编辑前先拉取完整定义（列表项不含 code），期间按钮显示“加载中”
			function beginEdit(s) {
				if (editBusy) return;
				setEditBusy(true);
				setError(null);
				api.get(s.id).then(function (full) {
					setEditBusy(false);
					if (full && full.id) {
						setEditing(full);
						setView("edit");
					} else {
						setError("加载脚本失败：响应缺少数据");
					}
				}).catch(function (e) {
					setEditBusy(false);
					setError("加载脚本失败: " + String((e && e.message) || e));
				});
			}
			function beginNew() { setEditing(null); setView("new"); }
			function cancelForm() { setView("list"); setEditing(null); setDeleteId(null); }
			function formDone(saved) {
				setView("list");
				setEditing(null);
				setNotice("已保存" + (saved && saved.id ? ": " + saved.id : ""));
				load();
			}
			function formDeleted(id) {
				setView("list");
				setEditing(null);
				setNotice("已删除: " + id);
				load();
			}
			function confirmDelete(s, value) {
				if (value === true) {
					// 二次确认通过：执行删除
					setDeleteId(null);
					setError(null);
					api.remove(s.id).then(function () {
						setNotice("已删除: " + s.id);
						load();
					}).catch(function (e) {
						setError(String((e && e.message) || e));
					});
				} else if (value === undefined) {
					// 首次点击删除：打开行内确认态
					setDeleteId(s.id);
				} else {
					// 取消确认：关闭确认态
					setDeleteId(null);
				}
			}

			var listView = (
				scripts === null
					? h("div", { className: "smp-empty" }, "加载中…")
					: (scripts.length === 0
						? h("div", { className: "smp-empty" }, "暂无脚本。点击“新建脚本”创建，或在会话中使用 /script 命令执行。")
						: h("div", { className: "smp-list" },
							scripts.map(function (s) {
								return h(ScriptCard, {
									key: s.id,
									script: s,
									editBusy: editBusy,
									deleting: deleteId === s.id,
									onEdit: beginEdit,
									onDelete: confirmDelete
								});
							})
						)
					)
			);

			return h("div", { className: "smp-wrap" },
				h("div", { className: "smp-head" },
					h("span", { className: "smp-title" }, "脚本管理"),
					view === "list"
						? h("span", { className: "smp-actions" },
							h(P.Button, { variant: "outline", onClick: load }, "刷新"),
							h(P.Button, { variant: "primary", onClick: beginNew },
								h(P.IconPlusOutline16, { size: 14 }), " 新建脚本"))
						: null
				),
				error ? h("div", { className: "smp-error" }, error) : null,
				notice ? h("div", { className: "smp-notice" }, notice) : null,
				view === "new" ? h(ScriptForm, { api: api, onDone: formDone, onCancel: cancelForm }) : null,
				view === "edit" && editing ? h(ScriptForm, { api: api, initial: editing, onDone: formDone, onCancel: cancelForm, onDeleted: formDeleted }) : null,
				view === "list" ? listView : null
			);
		}


		// ---- script_run 自绘 toolview（B 层）----
		// 渲染约定（与 @deepseek-ai/dsh-client-ui-skill 的 SkillRow 同构）：
		// 组件只消费宿主的 owner props（callId/block/inspect...），纯展示、不读 store/远程。
		// block 的递归 subCalls 子树由宿主 ToolCallTree 渲染在本组件外部，这里不管。
		// 结果文本即 format-script-result.ts 的输出（首行 [Script] <name>、含 Time: Nms），
		// 改动 formatScriptResult 时须同步这里的解析。

		/** 把 settled 结果 content 块扁平为文本（对齐 ui-tool 的 resultText）。 */
		function smvResultText(block) {
			if (!("kind" in block)) return null;
			var parts = [];
			for (var i = 0; i < block.content.length; i++) {
				var item = block.content[i];
				parts.push(item.type === "text" ? item.text : JSON.stringify(item, null, 2));
			}
			if (parts.length === 0 && block.error !== undefined) parts.push(block.error.name + ": " + block.error.code);
			return parts.join("\n") || null;
		}

		/** 首行（用于折叠摘要/错误首行）。 */
		function smvFirstLine(text) {
			if (text === null || text === undefined) return "";
			var nl = text.indexOf("\n");
			return nl === -1 ? text : text.slice(0, nl);
		}

		/** 从 argsRaw(JSON) 取 scriptId；失败回退 callId。 */
		function smvScriptId(argsRaw, callId) {
			if (argsRaw) {
				try {
					var parsed = JSON.parse(argsRaw);
					if (parsed && typeof parsed.scriptId === "string" && parsed.scriptId !== "") return parsed.scriptId;
				} catch (e) { /* 非 JSON，走回退 */ }
			}
			return callId || "";
		}

		/** 从结果文本取脚本名：首行 \"[Script] <name>\" 中 name 之后的部分。 */
		function smvNameFromText(text, fallback) {
			var first = smvFirstLine(text);
			var prefix = "[Script] ";
			if (first.indexOf(prefix) === 0) {
				var rest = first.slice(prefix.length).trim();
				if (rest !== "") return rest;
			}
			return fallback || "";
		}

		/** 从结果文本取执行耗时：/Time: (\d+)ms/ → 数字（无则 null）。 */
		function smvExecMs(text) {
			if (text === null || text === undefined) return null;
			var m = /\bTime: (\d+)ms\b/.exec(text);
			return m ? parseInt(m[1], 10) : null;
		}

		/** 由 frozen block 派生单次展示模型（running 或 settled）。 */
		function smvRunModel(block) {
			var settled = "kind" in block;
			var argsRaw = settled ? (block.call && block.call.argsRaw) : block.argsRaw;
			argsRaw = argsRaw || "";
			var output = smvResultText(block);
			var state = !settled ? "running" : block.error && block.error.code === "interrupted" ? "stopped" : block.isError ? "error" : "ok";
			var scriptId = smvScriptId(argsRaw, block.callId);
			var scriptName = smvNameFromText(output, scriptId);
			var execMs = smvExecMs(output);
			return {
				scriptId: scriptId,
				scriptName: scriptName,
				output: output,
				execMs: execMs,
				state: state,
				errorSummary: state === "error" && output !== null ? smvFirstLine(output) : null,
				subCount: (block.subCalls || []).length
			};
		}

		/** 折叠行 leading：状态图标（可展开时悬停显示 chevron）。 */
		function smvLeadingFor(state, open, expandable) {
			var C = "smv";
			if (open) return h(P.IconChevronDownOutline14, { className: C + "-chevron" });
			var icon;
			if (state === "error") icon = h(P.StateDot, { state: "error" });
			else if (state === "stopped") icon = h(P.StateDot, { state: "warning" });
			else icon = h(P.IconCodeOutline16, { size: 14 }); // running / ok 用 idle 图标（StateDot 无 running 态，运行中由 CSS sweep 提示）
			if (!expandable) return icon;
			return react.createElement(react.Fragment, null,
				h("span", { className: C + "-iconIdle" }, icon),
				h(P.IconChevronDownOutline14, { className: C + "-chevron " + C + "-chevronHover" }));
		}

		/** 状态辅助文案（视觉隐藏，供读屏）。 */
		function smvStatus(state) {
			switch (state) {
				case "running": return "Running script";
				case "error": return "Script failed";
				case "stopped": return "Script stopped";
				default: return null;
			}
		}

		/** 渲染一次 script_run 调用：Script 行 + 可展开完整输出 + Inspect。 */
		function ScriptRunToolView(props) {
			var block = props.block;
			var inspect = props.inspect;
			var model = smvRunModel(block);
			var expState = react.useState(false);
			var expanded = expState[0];
			var setExpanded = expState[1];
			var C = "smv";
			var expandable = model.output !== null;
			var open = expanded && expandable;
			var status = smvStatus(model.state);
			var summary = model.errorSummary !== null ? model.errorSummary : model.scriptName || model.scriptId;

			function toggle() { setExpanded(function (v) { return !v; }); }
			function onKeyDown(e) {
				if (!expandable || (e.key !== "Enter" && e.key !== " ")) return;
				e.preventDefault();
				toggle();
			}

			var disclosureProps = expandable ? { role: "button", tabIndex: 0, "aria-expanded": open, onClick: toggle, onKeyDown: onKeyDown } : {};

			return h("div", { className: C + "-card", "data-tool": "script_run", "data-state": model.state },
				h("div", { className: C + "-row", "data-expandable": expandable || undefined, role: disclosureProps.role, tabIndex: disclosureProps.tabIndex, "aria-expanded": disclosureProps["aria-expanded"], onClick: disclosureProps.onClick, onKeyDown: disclosureProps.onKeyDown },
					h("span", { className: C + "-leading" },
						smvLeadingFor(model.state, open, expandable)),
					status !== null ? h("span", { className: C + "-visuallyHidden" }, status) : null,
					h("span", { className: C + "-title" }, "Script"),
					h("span", { className: C + "-sep", "aria-hidden": true }),
					h("span", { className: model.errorSummary !== null ? (C + "-summary " + C + "-errorSummary") : (C + "-summary") }, summary),
					model.execMs !== null ? h("span", { className: C + "-summarySuffix" }, "· " + model.execMs + "ms") : null,
					(model.subCount > 0 && open) ? h("span", { className: C + "-subCount" }, model.subCount + " inner calls") : null
				),
				open ? h("div", { className: C + "-bodyWrap" },
					h("section", { className: C + "-outputCard", "aria-label": "Output" },
						h("div", { className: C + "-outputHeader" }, "Output"),
						h("pre", { className: C + "-output", "data-error": model.state === "error" || undefined }, model.output)),
					inspect !== undefined ? h("button", { type: "button", className: C + "-inspectButton", onClick: inspect },
						h(P.IconInspectOutline12, {}), "Inspect") : null)
					: null
			);
		}
		// ---- apply ----
		function apply(ctx) {
			var commandUi = ctx.commandUi;
			if (commandUi) {
				commandUi.decorate({
					name: "script",
					available: function (_session) { return true; },
					ui: {
						kind: "popupSelect",
						options: async function (_session, signal) {
							var res = await fetch("/api/scripts", { signal: signal });
							if (!res.ok) throw new Error("Failed to load scripts: " + res.status);
							var scripts = await res.json();
							// 名称优先作为主显示；简介超出 60 字符则以省略号压缩
							return scripts.map(function (s) {
								var desc = (s.description || '').trim();
								var clipped = desc.length > 60 ? desc.slice(0, 59) + '…' : desc;
								return { id: s.id, label: s.name, detail: clipped || s.id };
							});
						},
						onSelect: function (option, session) {
							// 点选即执行：宿主 popupSelect 会等到 onSelect resolve 才收起弹层，
							// 期间一直显示“正在应用…”。脚本执行可能耗时较久（默认无上限），
							// 原地等待会让弹窗卡住。因此不在这里等待命令执行——
							// 先放行收起弹窗，再把 /script 命令放到后台执行
							// （链路与直接提交 /script <id> 一致，结果/错误照常进入会话）。
							var sid = session && session.sessionId;
							if (!sid) throw new Error("session unavailable");
							var id = option.id;
							Promise.resolve().then(function () {
								return ctx.remote.commands.execute(sid, "/script " + id, []);
							}).then(function (result) {
								if (result && !result.ok) {
									console.error("[dsh-script-manager] /script " + id + " failed:", (result.error && (result.error.message || result.error)) || result);
								}
							}).catch(function (e) {
								console.error("[dsh-script-manager] /script " + id + " error:", e);
							});
						}
					}
				});
			}

			var slots = ctx.slots;
			if (slots && typeof slots.inject === "function") {
				var api = makeApi();
				ctx.effect(function () {
					return slots.inject("settings.section", function () {
						return slots.register({
							name: "settings.section",
							id: "dsh-script-manager",
							order: 20,
							label: function () { return "脚本管理"; },
							inject: function () { return { api: api }; }
						}, ScriptManagerSection);
					});
				}, "script-manager: settings section");

				// script_run 根卡自绘（B 层）：命中 tool.call.toolview 的 script_run key，
				// 替换通用工具卡；未命中（slots 缺失/旧宿主）自然回退 Generic。
				ctx.effect(function () {
					return slots.inject("tool.call.toolview", function () {
						return slots.register({
							name: "tool.call.toolview",
							key: "script_run"
						}, ScriptRunToolView);
					});
				}, "script-manager: script_run toolview");
			}
		}

		module.exports = { apply: apply, inject: inject };
		return module.exports;
	}
});
