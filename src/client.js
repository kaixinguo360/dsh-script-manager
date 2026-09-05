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
			".smp-textarea{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:8px 10px;font-size:13px;font-family:inherit;line-height:1.5;box-sizing:border-box;width:100%;resize:vertical;min-height:64px}",
			".smp-textarea:focus-visible{border-color:var(--dsw-alias-state-business-primary);outline:none}",
			".smp-params{display:flex;flex-direction:column;gap:6px;border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px}",
			".smp-params-head{display:flex;align-items:center;gap:8px;min-height:28px}",
			".smp-params-title{flex:1;font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary)}",
			".smp-params-list{display:flex;flex-direction:column;gap:8px}",
			".smp-param-row{display:flex;flex-direction:column;gap:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;background:transparent}",
			".smp-param-line,.smp-param-line2{display:flex;gap:8px;align-items:center;flex-wrap:wrap}",
			".smp-param-line .smp-input{flex:1;min-width:120px}",
			".smp-param-line2 .smp-input{flex:1;min-width:120px}",
			".smp-param-type{width:110px;flex:none!important}",
			".smp-param-req{flex:none;margin:0 4px 0 2px}",
			".smp-params .smp-btn-sm,.smp-params .smp-danger-btn{height:28px;padding:0 10px;font-size:12px}",
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
			"@media (max-width:640px){.smp-del-narrow{display:none}.smp-edit-icon-narrow{display:none}}",
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
			".smv-inspectButton:hover{background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary)}",
			".smp-param-icon{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;margin-left:6px;color:var(--dsw-alias-label-tertiary);border-radius:6px;cursor:pointer;flex:none;vertical-align:middle}",
			".smp-param-icon:hover{color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-hover)}",
			".smp-ovl{position:fixed;inset:0;z-index:2147483000;background:color-mix(in srgb, var(--dsw-alias-bg-mask,#000) 40%, transparent);display:flex;align-items:center;justify-content:center;padding:24px}",
			".smp-ovl-card{background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;box-shadow:0 12px 40px rgb(0 0 0 / .35);width:min(420px,100%);max-height:80vh;display:flex;flex-direction:column;overflow:hidden}",
			".smp-ovl-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l2)}",
			".smp-ovl-title{flex:1;font-size:14px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
			".smp-ovl-x{border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:16px;line-height:20px;padding:0 4px;border-radius:6px}",
			".smp-ovl-x:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}",
			".smp-ovl-body{flex:1;overflow-y:auto;padding:10px 14px;display:flex;flex-direction:column;gap:10px}",
			".smp-ovl-row{display:flex;flex-direction:column;gap:4px}",
			".smp-ovl-lbl{font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary)}",
			".smp-ovl-tip{color:var(--dsw-alias-label-tertiary);font-weight:400}",
			".smp-ovl-input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;height:30px;padding:0 10px;font-size:13px;font-family:inherit;box-sizing:border-box;width:100%;outline:none}",
			".smp-ovl-input:focus{border-color:var(--dsw-alias-state-business-primary)}",
			".smp-ovl-err{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.4}",
			".smp-ovl-foot{display:flex;justify-content:flex-end;gap:8px;padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l2)}",
			".smp-ovl-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:8px;height:30px;padding:0 14px;font-size:13px;cursor:pointer}",
			".smp-ovl-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".smp-ovl-primary{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-primary);color:#fff}",
			".smp-ovl-primary:hover{background:var(--dsw-alias-state-business-primary-hover,#2a6cf0);color:#fff}",
			"/* 历史面板 */",
			".smp-tabs{display:flex;gap:6px;align-items:center}",
			".smp-tab{display:inline-flex;align-items:center;height:28px;padding:0 12px;font-size:12px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;cursor:pointer;white-space:nowrap}",
			".smp-tab[data-active=\"1\"]{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}",
			".smp-hlist{display:flex;flex-direction:column;gap:6px;margin-top:2px}",
			".smp-hrow{display:flex;flex-wrap:wrap;align-items:flex-start;gap:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:8px 10px;background:transparent}",
			".smp-hrow[data-open=\"1\"]{border-color:var(--dsw-alias-state-business-primary)}",
			".smp-hrow-open{background:var(--dsw-alias-interactive-bg-hover)}",
			".smp-hact{flex:none;font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}",
			".smp-hmain{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;cursor:pointer}",
			".smp-hline1{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px;line-height:16px;color:var(--dsw-alias-label-primary)}",
			".smp-hmeta{display:flex;align-items:center;gap:4px;flex-wrap:wrap;font-size:11px;line-height:14px;color:var(--dsw-alias-label-tertiary)}",
			".smp-hbadge{font-size:10px;line-height:14px;padding:0 5px;border-radius:4px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);white-space:nowrap}",
			".smp-hok{border-color:var(--dsw-alias-state-success-primary,#2faf5f);color:var(--dsw-alias-state-success-primary,#2faf5f)}",
			".smp-hbad{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}",
			".smp-hdetail{width:100%;box-sizing:border-box;padding:8px;border:1px dashed var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-markdown-code-block);overflow:auto}",
			".smp-hpre{margin:0;font-family:var(--dsh-font-mono,ui-monospace,Menlo,Consolas,monospace);font-size:11px;line-height:16px;white-space:pre-wrap;word-break:break-all;color:var(--dsw-alias-label-primary)}",
			".smp-hnote{font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:16px}",
			".smp-hcode{display:flex;flex-direction:column;gap:6px;min-width:0}",
			".smp-hcode-title{font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:14px}",
			"/* 参数输入浮层 — 历史列表视图 */",
			".smp-ovl-history-head{display:flex;align-items:center;gap:8px;padding-bottom:8px;border-bottom:1px solid var(--dsw-alias-border-l2)}",
			".smp-ovl-history-title{flex:1;font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}",
			".smp-ovl-history-list{display:flex;flex-direction:column;gap:6px;flex:1;overflow-y:auto}",
			".smp-ovl-history-empty{font-size:12px;color:var(--dsw-alias-label-tertiary);padding:12px 0;text-align:center}",
			".smp-ovl-history-item{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden}",
			".smp-ovl-history-item-main{display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer}",
			".smp-ovl-history-item-main:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".smp-ovl-history-item-meta{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;overflow:hidden}",
			".smp-ovl-history-item-time{color:var(--dsw-alias-label-tertiary);font-size:11px}",
			".smp-ovl-history-item-caller{color:var(--dsw-alias-label-tertiary);font-size:11px;flex:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:40%}",
			".smp-ovl-history-item-timerow{display:flex;align-items:center;gap:6px;min-width:0}",
			".smp-ovl-history-item-chev{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px;align-self:center;margin-left:auto;padding-left:8px}",
			".smp-ovl-history-item-summary{color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
			".smp-ovl-history-item-badge{flex:none;font-size:10px;line-height:14px;padding:0 5px;border-radius:4px;border:1px solid;white-space:nowrap}",
			".smp-ovl-history-item-ok{border-color:var(--dsw-alias-state-success-primary,#2faf5f);color:var(--dsw-alias-state-success-primary,#2faf5f)}",
			".smp-ovl-history-item-bad{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}",
			".smp-ovl-history-item-detail{padding:6px 10px 10px;border-top:1px dashed var(--dsw-alias-border-l2);background:var(--dsw-alias-markdown-code-block)}",
			".smp-ovl-history-item-pre{margin:0;font-family:var(--dsh-font-mono,monospace);font-size:11px;line-height:16px;white-space:pre-wrap;word-break:break-all;color:var(--dsw-alias-label-primary)}",
			".smp-ovl-history-item-dmeta{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);padding-bottom:6px;border-bottom:1px solid var(--dsw-alias-border-l2);margin-bottom:6px}",
			".smp-ovl-history-item-sec{font-size:11px;font-weight:500;color:var(--dsw-alias-label-secondary);line-height:16px;margin:6px 0 3px}",
			".smp-ovl-history-item-kv{display:flex;gap:8px;font-size:11px;line-height:18px;min-width:0}",
			".smp-ovl-history-item-k{flex:none;min-width:90px;max-width:40%;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
			".smp-ovl-history-item-v{flex:1;min-width:0;color:var(--dsw-alias-label-primary);word-break:break-all;white-space:pre-wrap}",
			".smp-ovl-history-item-select{margin-top:6px;display:flex;justify-content:flex-end}",
			".smp-ovl-history-btn{border:1px solid var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-primary);color:#fff;border-radius:6px;height:26px;padding:0 12px;font-size:12px;cursor:pointer}",
			".smp-ovl-history-btn:hover{opacity:0.9}",
			".smp-ovl-hist{font-size:12px;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:2px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;white-space:nowrap}",
			".smp-ovl-hist:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-secondary)}"
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
				},
				history: function (kind, opts) {
					var q = [];
					opts = opts || {};
					if (opts.scriptId) q.push("scriptId=" + encodeURIComponent(opts.scriptId));
					if (opts.limit) q.push("limit=" + encodeURIComponent(String(opts.limit)));
					if (opts.offset) q.push("offset=" + encodeURIComponent(String(opts.offset)));
					if (opts.includeSnapshot) q.push("includeSnapshot=1");
					var qs = q.length > 0 ? "?" + q.join("&") : "";
					return fetch("/api/script-history/" + encodeURIComponent(kind) + qs).then(parse);
				}
			};
		}

		// ---- 表单映射 ----
		function emptyForm() {
			return { id: "", name: "", description: "", version: "0.1.0", author: "", tags: "", registerAsTool: false, toolName: "", timeoutMs: "", parameters: [], expectedOutcome: "", successCriteria: "", failureGuidance: "", code: "" };
		}
		function scriptToForm(s) {
			return {
				id: s.id, name: s.name, description: s.description || "",
				version: s.version || "", author: s.author || "",
				tags: (s.tags || []).join(", "), registerAsTool: !!s.registerAsTool,
				toolName: s.toolName || "", timeoutMs: (s.timeoutMs === undefined || s.timeoutMs === null) ? "" : String(s.timeoutMs),
				parameters: (s.parameters || []).map(function (p) { return { _k: "p" + Math.random().toString(36).slice(2, 8), name: p.name || "", label: p.label || "", type: p.type || "string", required: !!p.required, default: (p.default === undefined || p.default === null) ? "" : String(p.default), description: p.description || "" }; }),
				expectedOutcome: s.expectedOutcome || "", successCriteria: s.successCriteria || "", failureGuidance: s.failureGuidance || "",
				code: s.code || ""
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
				expectedOutcome: (f.expectedOutcome || "").trim() || undefined,
				successCriteria: (f.successCriteria || "").trim() || undefined,
				failureGuidance: (f.failureGuidance || "").trim() || undefined,
				parameters: (function () {
					var out = [];
					(f.parameters || []).forEach(function (r) {
						var name = String(r.name || "").trim();
						if (!name) return; // 跳过空行
						var type = (r.type === "number" || r.type === "boolean") ? r.type : "string";
						var required = !!r.required;
						var item = { name: name, type: type, required: required };
						var label = String(r.label || "").trim();
						if (label) item.label = label;
						var desc = String(r.description || "").trim();
						if (desc) item.description = desc;
						if (!required) {
							// 选输必须带默认。string 的空串是合法默认值,不能吞成未声明;
							// number/boolean 留空(未填)则留给服务端校验提示填写
							var dv = r.default == null ? "" : String(r.default);
							if (type === "string") { item.default = dv; }
							else if (dv.trim() !== "") {
								if (type === "number") { var n = Number(dv); if (Number.isFinite(n)) item.default = n; }
								else item.default = dv === "true" || dv === "1" || dv === "是";
							}
						}
						out.push(item);
					});
					return out.length > 0 ? out : undefined;
				})(),
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
		function textAreaInput(value, onChange, placeholder) {
			return h("textarea", {
				className: "smp-textarea",
				rows: 3,
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

			// ---- 参数行编辑（不可变更新 form.parameters 数组） ----
			function setParams(nextParams) { set("parameters")(nextParams); }
			function addParam() {
				var rows = (form.parameters || []).slice();
				rows.push({ _k: "p" + Math.random().toString(36).slice(2, 8), name: "", label: "", type: "string", required: false, default: "", description: "" });
				setParams(rows);
			}
			function setParam(k, key) {
				return function (v) {
					var rows = (form.parameters || []).map(function (r) {
						if (r._k !== k) return r;
						var nr = {};
						for (var x in r) nr[x] = r[x];
						nr[key] = v;
						// 必输不可带默认(UI 同步清空,避免误留)
						if (key === "required" && v) nr.default = "";
						return nr;
					});
					setParams(rows);
				};
			}
			function removeParam(k) {
				setParams((form.parameters || []).filter(function (r) { return r._k !== k; }));
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
			// 参数化：行编辑器（必输无默认 / 选输必有默认，服务端保存时强校验）
			h("div", { className: "smp-params" },
				h("div", { className: "smp-params-head" },
					h("span", { className: "smp-params-title" }, "参数（可选；脚本内以 params.<name> 读取）"),
					h(P.Button, { variant: "outline", disabled: busy, onClick: addParam }, "+ 添加参数")),
				(Array.isArray(form.parameters) && form.parameters.length > 0)
					? h("div", { className: "smp-params-list" }, form.parameters.map(function (r) {
						return h("div", { className: "smp-param-row", key: r._k },
							h("div", { className: "smp-param-line" },
								textInput(r.name, setParam(r._k, "name"), "name"),
								h("select", { className: "smp-input smp-param-type", value: r.type, onChange: function (e) { setParam(r._k, "type")(e.target.value); } },
									h("option", { value: "string" }, "string"),
									h("option", { value: "number" }, "number"),
									h("option", { value: "boolean" }, "boolean")),
								h("label", { className: "smp-check smp-param-req", style: { alignSelf: "center" } },
									h("input", { type: "checkbox", checked: !!r.required, onChange: function (e) { setParam(r._k, "required")(e.target.checked); } }),
									"必输"),
								h(P.Button, { variant: "outline", className: "smp-danger-btn", onClick: function () { removeParam(r._k); } }, "删除")),
							h("div", { className: "smp-param-line2" },
								textInput(r.label, setParam(r._k, "label"), "显示名(可选)"),
								r.required ? null : textInput(r.default, setParam(r._k, "default"), r.type === "number" ? "默认数字" : r.type === "boolean" ? "true/false" : "默认值"),
								textInput(r.description, setParam(r._k, "description"), "说明(可选)")));
						}, this))
					: h("div", { className: "smp-notice", style: { marginTop: 0 } }, "无参数：执行时不需要输入，/script 候选直接运行（可选参数会带默认值）。")),
				// 执行契约：声明式验收元数据，执行结果会带上供 agent 对照检查
				field("预期结果（expectedOutcome，可选）——脚本完成后应达成的结果",
					textAreaInput(form.expectedOutcome, set("expectedOutcome"), "例：仓库已更新到最新 main 并完成构建" + "\n" + "该字段随执行结果展示给 agent 对照判断是否达到预期")),
				field("成功判据（successCriteria，可选）——如何验证达到预期",
					textAreaInput(form.successCriteria, set("successCriteria"), "例：git log 显示最新提交；构建产物存在" + "\n" + "写可检查的具体迹象/检查点，供 agent 验收")),
				field("未达标介入指引（failureGuidance，可选）——未达预期/失败时如何调整",
					textAreaInput(form.failureGuidance, set("failureGuidance"), "例：网络问题可重试；如需改参/补手动步骤/修正脚本后重跑，请说明" + "\n" + "指引 agent 决定是否介入、如何介入")),
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

		// ---- 单行脚本卡片：标题名称 + 副标题 id + 历史/编辑/删除（行内确认） ----
		function ScriptCard(props) {
			var script = props.script;
			var onEdit = props.onEdit;
			var onDelete = props.onDelete;
			var onHistory = props.onHistory;
			var editBusy = props.editBusy;
			var deleting = props.deleting;

			return h("div", { className: "smp-card" },
				h("div", { className: "smp-card-main" },
					h("div", { className: "smp-name", title: script.name }, script.name),
					h("div", { className: "smp-id", title: script.id }, script.id)
				),
				h("div", { className: "smp-actions" },
					h("span", { className: "smp-actions" },
						h(P.Button, { variant: "outline", disabled: editBusy, onClick: function () { onHistory(script); } }, "历史"),
						h(P.Button, { variant: "outline", disabled: editBusy, onClick: function () { onEdit(script); } },
							h(P.IconEditOutline16, { size: 14, className: "smp-edit-icon-narrow" }), editBusy ? " 加载中" : " 编辑")),
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

		// ---- 历史面板：执行/变更两页签（变更展开时二次拉取带快照，可与上一版代码对照） ----
		function ScriptHistoryPanel(props) {
			var api = props.api;
			var script = props.script;
			var kindState = react.useState("runs");
			var kind = kindState[0];
			var setKind = kindState[1];
			var entriesState = react.useState(null);
			var entries = entriesState[0];
			var setEntries = entriesState[1];
			var errState = react.useState(null);
			var err = errState[0];
			var setErr = errState[1];
			var openState = react.useState({});
			var open = openState[0];
			var setOpen = openState[1];
			var snapsState = react.useState(null);
			var snaps = snapsState[0];
			var setSnaps = snapsState[1];

			function load(k) {
				setEntries(null);
				setErr(null);
				api.history(k, { scriptId: script.id, limit: 50 }).then(function (data) {
					if (data && Array.isArray(data.entries)) {
						setEntries(data.entries);
						if (data.disabled) setErr("历史未启用（配置 historyEnabled=false）");
					} else {
						setErr("响应格式异常");
						setEntries([]);
					}
				}).catch(function (e) {
					setErr(String((e && e.message) || e));
					setEntries([]);
				});
			}
			react.useEffect(function () { load(kind); }, [kind]);
			react.useEffect(function () { setOpen({}); }, [kind]);

			function ensureSnaps() {
				if (snaps) return Promise.resolve(snaps);
				return api.history("changes", { scriptId: script.id, limit: 50, includeSnapshot: true })
					.then(function (data) {
						var list = data && Array.isArray(data.entries) ? data.entries : [];
						setSnaps(list);
						return list;
					})
					.catch(function () { return []; });
			}
			function toggle(i) {
				var next = {};
				for (var k in open) { if (open[k]) next[k] = true; }
				next[i] = !open[i];
				setOpen(next);
			}
			function toggleChange(i) {
				if (open[i]) { toggle(i); return; }
				ensureSnaps().then(function () { toggle(i); });
			}
			function fmtTs(ts) {
				if (!ts) return "";
				try {
					var d = new Date(ts);
					if (isNaN(d.getTime())) return ts;
					var pad = function (n) { return (n < 10 ? "0" : "") + n; };
					return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " +
						pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
				} catch (e) { return ts; }
			}
			function briefParams(p) {
				try { return JSON.stringify(p); } catch (e) { return String(p); }
			}
			function preBlock(title, text) {
				if (text === undefined || text === null || text === "") return null;
				return h("div", { className: "smp-hdetail" },
					title ? h("div", { className: "smp-hcode-title" }, title) : null,
					h("pre", { className: "smp-hpre" }, String(text)));
			}

			var body;
			if (err && entries === null) {
				body = h("div", { className: "smp-empty" }, err);
			} else if (entries === null) {
				body = h("div", { className: "smp-empty" }, "加载中…");
			} else if (entries.length === 0) {
				body = h("div", { className: "smp-empty" }, err || (kind === "runs" ? "暂无执行记录（执行一次 /script 或 script_run 后出现）。" : "暂无变更记录（创建/编辑/改名脚本后出现）。"));
			} else {
				body = h("div", { className: "smp-hlist" }, entries.map(function (e, i) {
					var key = String(i);
					var isOpen = !!open[key];
					if (kind === "runs") {
						var revBadge = h("span", { className: "smp-hbadge" },
							e.revision !== undefined && e.revision !== null ? "修订 #" + e.revision : "修订 ?");
						var okBadge = e.success
							? h("span", { className: "smp-hbadge smp-hok" }, "成功")
							: h("span", { className: "smp-hbadge smp-hbad" }, "失败");
						var meta = [];
						if (e.caller) meta.push(e.caller);
						if (e.executionTime !== undefined && e.executionTime !== null) meta.push(e.executionTime + "ms");
						if (e.params && typeof e.params === "object") meta.push("参数 " + briefParams(e.params));
						meta.push(fmtTs(e.ts));
						var detail = isOpen ? h("div", { className: "smp-hdetail" },
							preBlock(null, e.error),
							preBlock("参数", e.params ? JSON.stringify(e.params, null, 2) : ""),
							preBlock("返回值", e.value)
						) : null;
						return h("div", { className: "smp-hrow" + (isOpen ? " smp-hrow-open" : ""), "data-open": isOpen ? "1" : "0", key: key },
							h("div", { className: "smp-hmain", onClick: function () { toggle(i); } },
								h("div", { className: "smp-hline1" }, okBadge, revBadge, h("span", { style: { flex: 1 } }),
									h("span", { className: "smp-hact" }, isOpen ? "收起" : "展开")),
								h("div", { className: "smp-hmeta" }, meta.join(" · "))),
							detail);
					}
					// changes
					var actionBadge = e.action === "create"
						? h("span", { className: "smp-hbadge smp-hok" }, "创建")
						: (e.action === "rename"
							? h("span", { className: "smp-hbadge" }, "改名")
							: h("span", { className: "smp-hbadge" }, "更新"));
					var cmeta = [];
					if (e.source === "web") cmeta.push("Web UI");
					else if (e.source === "tool") cmeta.push("Agent 工具");
					if (e.fields && e.fields.length > 0) cmeta.push("字段: " + e.fields.join(", "));
					cmeta.push(fmtTs(e.ts));
					var cdetail = null;
					if (isOpen) {
						var curSnap = null;
						if (snaps) {
							for (var si = 0; si < snaps.length; si++) {
								if (snaps[si].revision === e.revision && snaps[si].snapshot) { curSnap = snaps[si].snapshot; break; }
							}
						}
						var prevSnap = null;
						if (snaps && e.revision > 1) {
							for (var pi = 0; pi < snaps.length; pi++) {
								if (snaps[pi].revision === e.revision - 1 && snaps[pi].snapshot) { prevSnap = snaps[pi].snapshot; break; }
							}
						}
						var blocks = [];
						if (curSnap) {
							blocks.push(h("div", { className: "smp-hcode" },
								h("div", { className: "smp-hcode-title" }, "修订 #" + e.revision + "（" + e.action + "）code"),
								h("pre", { className: "smp-hpre" }, curSnap.code || "")));
							if (prevSnap) {
								blocks.push(h("div", { className: "smp-hcode" },
									h("div", { className: "smp-hcode-title" }, "修订 #" + (e.revision - 1) + "（上一版）code"),
									h("pre", { className: "smp-hpre" }, prevSnap.code || "")));
							} else {
								blocks.push(h("div", { className: "smp-hnote" }, "上一版快照不可用（可能已被保留策略清理；可调大 historyChangesMax）。"));
							}
						} else {
							blocks.push(h("div", { className: "smp-hnote" }, "快照加载失败或不可用。"));
						}
						cdetail = h("div", { className: "smp-hdetail" }, blocks);
					}
					return h("div", { className: "smp-hrow" + (isOpen ? " smp-hrow-open" : ""), "data-open": isOpen ? "1" : "0", key: key },
						h("div", { className: "smp-hmain", onClick: function () { toggleChange(i); } },
							h("div", { className: "smp-hline1" }, actionBadge,
								h("span", { className: "smp-hbadge" }, "修订 #" + e.revision),
								h("span", { style: { flex: 1 } }),
								h("span", { className: "smp-hact" }, isOpen ? "收起" : "展开")),
							h("div", { className: "smp-hmeta" }, cmeta.join(" · "))),
						cdetail);
				}));
			}

			return h("div", { className: "smp-wrap" },
				h("div", { className: "smp-head" },
					h("span", { className: "smp-title" }, script.id + " 的历史"),
					h("span", { className: "smp-actions smp-tabs" },
						h("button", { type: "button", className: "smp-tab" + (kind === "runs" ? "" : ""), "data-active": kind === "runs" ? "1" : "0", onClick: function () { setKind("runs"); } }, "执行历史"),
						h("button", { type: "button", className: "smp-tab", "data-active": kind === "changes" ? "1" : "0", onClick: function () { setKind("changes"); } }, "变更历史"))),
				err && entries !== null ? h("div", { className: "smp-notice" }, err) : null,
				body);
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
			var historyForState = react.useState(null);
			var historyFor = historyForState[0];
			var setHistoryFor = historyForState[1];

			function beginHistory(s) { setHistoryFor(s); setView("history"); }
			function backFromHistory() { setView("list"); setHistoryFor(null); }

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
									onDelete: confirmDelete,
									onHistory: beginHistory
								});
							})
						)
					)
			);

			return h("div", { className: "smp-wrap" },
				h("div", { className: "smp-head" },
					h("span", { className: "smp-title" },
						view === "history" && historyFor ? ("历史：" + historyFor.name) : "脚本管理"),
					view === "list"
						? h("span", { className: "smp-actions" },
							h(P.Button, { variant: "outline", onClick: load }, "刷新"),
							h(P.Button, { variant: "primary", onClick: beginNew },
								h(P.IconPlusOutline16, { size: 14 }), " 新建脚本"))
						: (view === "history"
							? h("span", { className: "smp-actions" }, h(P.Button, { variant: "outline", onClick: backFromHistory }, "返回"))
							: null)
				),
				error ? h("div", { className: "smp-error" }, error) : null,
				notice ? h("div", { className: "smp-notice" }, notice) : null,
				view === "new" ? h(ScriptForm, { api: api, onDone: formDone, onCancel: cancelForm }) : null,
				view === "edit" && editing ? h(ScriptForm, { api: api, initial: editing, onDone: formDone, onCancel: cancelForm, onDeleted: formDeleted }) : null,
				view === "history" && historyFor ? h(ScriptHistoryPanel, { api: api, script: historyFor }) : null,
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

		// ==================== 参数化 /script(候选图标 + 参数弹窗) ====================
		// 宿主 popupSelect 行只渲染 label/detail,无法内嵌图标或表单:
		// - 参数概要写进 detail(带参项标识);
		// - 行尾图标用 DOM 增强注入(宿主结构变化时自动降级:仅少了快捷入口,点行仍按规则弹窗/执行);
		// - 参数填写用自绘遮罩浮层(原生 DOM,不依赖 react-dom)。

		function smpPType(p) { return p && p.type ? p.type : "string"; }
		/** 执行来源友好化：script_run → script_run；dynamic-tool:xxx → 工具 xxx；其余原样。 */
		function smpCallerLabel(c) {
			if (!c) return "";
			var s = String(c);
			if (s.indexOf("dynamic-tool:") === 0) return "工具 " + s.slice("dynamic-tool:".length);
			return s;
		}
		/** 文本截断（供展示用，保留原始值不变）。 */
		function smpTrimText(s, n) {
			s = s === null || s === undefined ? "" : String(s);
			return s.length > n ? s.substring(0, n) + "…" : s;
		}
		function smpHasParams(s) { return Array.isArray(s && s.parameters) && s.parameters.length > 0; }
		function smpHasRequired(s) { return smpHasParams(s) && s.parameters.some(function (p) { return p.required; }); }

		/** 参数概要文本(候选行 detail 尾部),如 targetUser(必) mode(=private)。 */
		function smpParamsBrief(params) {
			if (!Array.isArray(params) || params.length === 0) return "";
			return params.map(function (p) {
				var t = p.label || p.name;
				return p.required ? t + "(必)" : t + "(" + smpBriefDefault(p) + ")";
			}).join(", ");
		}
		function smpBriefDefault(p) {
			if (p.default === undefined || p.default === null || p.default === "") return "默认空";
			return "=" + String(p.default);
		}

		/** 后台执行 /script(与现有点选行为一致:先放行收层,命令照常进会话)。 */
		function smpRunScript(ctx, sid, id, paramsJson) {
			var cmd = "/script " + id + (paramsJson ? " " + paramsJson : "");
			return Promise.resolve().then(function () {
				return ctx.remote.commands.execute(sid, cmd, []);
			}).then(function (result) {
				if (result && !result.ok) {
					console.error("[dsh-script-manager] " + cmd + " failed:", (result.error && (result.error.message || result.error)) || result);
				}
			}).catch(function (e) {
				console.error("[dsh-script-manager] " + cmd + " error:", e);
			});
		}

		// ---- 参数输入浮层(自绘,原生 DOM) ----
		var smpOverlay = null;
		function smpCloseOverlay() {
			if (!smpOverlay) return;
			try { document.removeEventListener("keydown", smpOverlay._kd, true); } catch (e) {}
			if (smpOverlay.parentNode) smpOverlay.parentNode.removeChild(smpOverlay);
			smpOverlay = null;
		}
		/**
		 * 打开参数填写浮层。
		 * @param spec { id, name, parameters, onSubmit } onSubmit(id, paramsObj) 返回 Promise
		 */
		function smpOpenOverlay(spec) {
			smpCloseOverlay();
			var params = spec.parameters || [];
			var api = spec.api || smpApi;
			var view = "form";
			var currentValues = {};
			var inputs = {};
			var errBox;
			params.forEach(function (p) {
				if (!p.required && p.default !== undefined) currentValues[p.name] = p.default;
			});

			var overlay = document.createElement("div");
			overlay.className = "smp-ovl";
			overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) smpCloseOverlay(); });

			var card = document.createElement("div");
			card.className = "smp-ovl-card";
			card.addEventListener("mousedown", function (e) { e.stopPropagation(); });

			var head = document.createElement("div");
			head.className = "smp-ovl-head";
			var title = document.createElement("span");
			title.className = "smp-ovl-title";
			title.textContent = spec.name;
			head.appendChild(title);
			var histBtn = null;
			if (api) {
				histBtn = document.createElement("button");
				histBtn.type = "button";
				histBtn.className = "smp-ovl-hist";
				histBtn.textContent = "历史参数";
				histBtn.title = "从历史执行中选取参数填入";
				histBtn.addEventListener("click", function () { switchView(view === "form" ? "history" : "form"); });
				head.appendChild(histBtn);
			}
			var close = document.createElement("button");
			close.type = "button";
			close.className = "smp-ovl-x";
			close.textContent = "×";
			close.setAttribute("aria-label", "Close");
			close.addEventListener("click", smpCloseOverlay);
			head.appendChild(close);
			card.appendChild(head);

			var body = document.createElement("div");
			body.className = "smp-ovl-body";
			var foot = document.createElement("div");
			foot.className = "smp-ovl-foot";
			var cancel = document.createElement("button");
			cancel.type = "button";
			cancel.className = "smp-ovl-btn";
			cancel.textContent = "取消";
			cancel.addEventListener("click", smpCloseOverlay);
			foot.appendChild(cancel);
			var ok = document.createElement("button");
			ok.type = "button";
			ok.className = "smp-ovl-btn smp-ovl-primary";
			ok.textContent = "执行";
			ok.addEventListener("click", function () {
				var missing = [];
				var parsed = {};
				params.forEach(function (p) {
					var el = inputs[p.name];
					var raw = el && el.value !== undefined ? el.value : "";
					var type = smpPType(p);
					if (type === "boolean") {
						parsed[p.name] = raw === "true" || raw === true;
					} else if (type === "number") {
						if (String(raw).trim() === "") {
							if (p.required) { missing.push(p.name); return; }
							parsed[p.name] = p.default;
						} else if (Number.isFinite(Number(String(raw).trim()))) {
							parsed[p.name] = Number(String(raw).trim());
						} else {
							errBox.textContent = "参数 " + (p.label || p.name) + " 需为数字";
							errBox.style.display = "";
							return;
						}
					} else {
						if (String(raw).trim() === "" && p.required) { missing.push(p.name); return; }
						parsed[p.name] = p.required ? String(raw).trim() : (String(raw).trim() !== "" ? String(raw).trim() : p.default);
					}
				});
				if (missing.length > 0) {
					errBox.textContent = "请填写必输参数: " + missing.join(", ");
					errBox.style.display = "";
					return;
				}
				smpCloseOverlay();
				spec.onSubmit(spec.id, parsed);
			});
			foot.appendChild(ok);

			// ---- form 视图：参数输入 ----
			function renderForm() {
				body.innerHTML = "";
				params.forEach(function (p) {
					var req = !!p.required;
					var type = smpPType(p);
					var row = document.createElement("label");
					row.className = "smp-ovl-row";
					var lbl = document.createElement("span");
					lbl.className = "smp-ovl-lbl";
					lbl.textContent = (p.label || p.name) + (req ? " *" : "");
					if (p.description) {
						var tip = document.createElement("span");
						tip.className = "smp-ovl-tip";
						tip.textContent = p.description;
						lbl.appendChild(document.createTextNode(" "));
						lbl.appendChild(tip);
					}
					row.appendChild(lbl);
					if (type === "boolean") {
						var sel = document.createElement("select");
						sel.className = "smp-ovl-input";
						var cvB = currentValues[p.name];
						var cvHas = cvB !== undefined && cvB !== null;
						var selTrue = cvHas ? (cvB === true || cvB === "true") : (!req && p.default === true);
						["true", "false"].forEach(function (v) {
							var o = document.createElement("option");
							o.value = v;
							o.textContent = v === "true" ? "是 / true" : "否 / false";
							if ((v === "true") === selTrue) o.selected = true;
							sel.appendChild(o);
						});
						inputs[p.name] = sel;
						row.appendChild(sel);
					} else {
						var inp = document.createElement("input");
						inp.className = "smp-ovl-input";
						inp.type = "text";
						inp.placeholder = req ? "必填" : ("默认: " + smpBriefDefault(p));
						var cv = currentValues[p.name];
						inp.value = cv !== undefined && cv !== null ? String(cv) : "";
						inputs[p.name] = inp;
						row.appendChild(inp);
					}
					body.appendChild(row);
				});
				errBox = document.createElement("div");
				errBox.className = "smp-ovl-err";
				errBox.style.display = "none";
				body.appendChild(errBox);
			}

			// ---- history 视图：历史执行参数列表 ----
			function renderHistory() {
				body.innerHTML = "";
				var wrap = document.createElement("div");
				wrap.className = "smp-ovl-history-head";
				var hTitle = document.createElement("span");
				hTitle.className = "smp-ovl-history-title";
				hTitle.textContent = "选择历史参数";
				wrap.appendChild(hTitle);
				body.appendChild(wrap);
				var list = document.createElement("div");
				list.className = "smp-ovl-history-list";
				body.appendChild(list);
				var loading = document.createElement("div");
				loading.className = "smp-ovl-history-empty";
				loading.textContent = "加载中…";
				list.appendChild(loading);
				foot.style.display = "none";
				api.history("runs", { scriptId: spec.id, limit: 10 }).then(function (data) {
					var entries = (data && Array.isArray(data.entries)) ? data.entries : [];
					var filtered = entries.filter(function (e) { return e.params && typeof e.params === "object" && Object.keys(e.params).length > 0; });
					list.innerHTML = "";
					if (filtered.length === 0) {
						var empty = document.createElement("div");
						empty.className = "smp-ovl-history-empty";
						empty.textContent = entries.length === 0 ? "该脚本暂无执行记录" : "历史记录中暂无带参数的可选项";
						list.appendChild(empty);
						return;
					}
					filtered.forEach(function (e) {
						var item = document.createElement("div");
						item.className = "smp-ovl-history-item";
						var main = document.createElement("div");
						main.className = "smp-ovl-history-item-main";
						var badge = document.createElement("span");
						badge.className = "smp-ovl-history-item-badge " + (e.success ? "smp-ovl-history-item-ok" : "smp-ovl-history-item-bad");
						badge.textContent = e.success ? "成功" : "失败";
						main.appendChild(badge);
						var meta = document.createElement("div");
						meta.className = "smp-ovl-history-item-meta";
						var timeRow = document.createElement("div");
						timeRow.className = "smp-ovl-history-item-timerow";
						var time = document.createElement("span");
						time.className = "smp-ovl-history-item-time";
						try { var d = new Date(e.ts); var pad = function (n) { return (n < 10 ? "0" : "") + n; }; time.textContent = (d.getMonth() + 1) + "/" + d.getDate() + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()); } catch (x) { time.textContent = e.ts || ""; }
						timeRow.appendChild(time);
						if (e.caller) {
							var callerSpan = document.createElement("span");
							callerSpan.className = "smp-ovl-history-item-caller";
							callerSpan.textContent = smpCallerLabel(e.caller);
							callerSpan.title = "调用方: " + e.caller;
							timeRow.appendChild(callerSpan);
						}
						meta.appendChild(timeRow);
						var summary = document.createElement("span");
						summary.className = "smp-ovl-history-item-summary";
						var paramStr = Object.keys(e.params).map(function (k) { return k + "=" + String(e.params[k]).substring(0, 20); }).join(", ");
						summary.textContent = paramStr.length > 60 ? paramStr.substring(0, 60) + "…" : paramStr;
						meta.appendChild(summary);
						main.appendChild(meta);
						var chev = document.createElement("span");
						chev.className = "smp-ovl-history-item-chev";
						chev.textContent = "▸";
						main.appendChild(chev);
						item.appendChild(main);
						var detail = null;
						var expanded = false;
						main.addEventListener("click", function () {
							expanded = !expanded;
							chev.textContent = expanded ? "▾" : "▸";
							if (expanded) {
								if (!detail) {
									detail = document.createElement("div");
									detail.className = "smp-ovl-history-item-detail";
									var dmetaBits = [];
									if (e.caller) dmetaBits.push("调用方 " + smpCallerLabel(e.caller));
									if (e.revision !== undefined && e.revision !== null) dmetaBits.push("修订 #" + e.revision);
									if (e.executionTime !== undefined && e.executionTime !== null) dmetaBits.push("耗时 " + e.executionTime + "ms");
									if (dmetaBits.length > 0) {
										var dmeta = document.createElement("div");
										dmeta.className = "smp-ovl-history-item-dmeta";
										dmeta.textContent = dmetaBits.join(" · ");
										detail.appendChild(dmeta);
									}
									var sec1 = document.createElement("div");
									sec1.className = "smp-ovl-history-item-sec";
									sec1.textContent = "参数";
									detail.appendChild(sec1);
									Object.keys(e.params).forEach(function (k) {
										var kv = document.createElement("div");
										kv.className = "smp-ovl-history-item-kv";
										var kEl = document.createElement("span");
										kEl.className = "smp-ovl-history-item-k";
										kEl.textContent = k;
										kv.appendChild(kEl);
										var vEl = document.createElement("span");
										vEl.className = "smp-ovl-history-item-v";
										vEl.textContent = String(e.params[k]);
										kv.appendChild(vEl);
										detail.appendChild(kv);
									});
									var extra = !e.success ? (e.error || "") : (typeof e.value === "string" ? e.value : "");
									if (extra) {
										var sec2 = document.createElement("div");
										sec2.className = "smp-ovl-history-item-sec";
										sec2.textContent = e.success ? "返回" : "错误";
										detail.appendChild(sec2);
										var pre2 = document.createElement("pre");
										pre2.className = "smp-ovl-history-item-pre";
										pre2.textContent = smpTrimText(extra, 400);
										detail.appendChild(pre2);
									}
									var selBtn = document.createElement("div");
									selBtn.className = "smp-ovl-history-item-select";
									var selBtnInner = document.createElement("button");
									selBtnInner.type = "button";
									selBtnInner.className = "smp-ovl-history-btn";
									selBtnInner.textContent = "填入参数";
									selBtnInner.addEventListener("click", function (ev) {
										ev.stopPropagation();
										for (var k in e.params) { if (e.params.hasOwnProperty(k)) currentValues[k] = e.params[k]; }
										switchView("form");
									});
									selBtn.appendChild(selBtnInner);
									detail.appendChild(selBtn);
								}
								item.appendChild(detail);
							} else if (detail && detail.parentNode) {
								detail.parentNode.removeChild(detail);
							}
						});
						list.appendChild(item);
					});
				}).catch(function () {
					list.innerHTML = "";
					var fail = document.createElement("div");
					fail.className = "smp-ovl-history-empty";
					fail.textContent = "历史参数加载失败";
					list.appendChild(fail);
				});
			}

			// ---- 视图切换 ----
			function switchView(v) {
				var leavingForm = view === "form" && v === "history"; // 仅离开 form 时才保存输入(避免 inputs 指向已脱离 DOM 的旧元素覆盖新值)
				view = v;
				if (leavingForm) {
					params.forEach(function (p) {
						var el = inputs[p.name];
						if (el) currentValues[p.name] = el.value;
					});
				}
				if (v === "form") {
					renderForm();
					foot.style.display = "";
					if (histBtn) histBtn.textContent = "历史参数";
				} else {
					renderHistory();
					if (histBtn) histBtn.textContent = "返回";
				}
			}

			renderForm();
			card.appendChild(body);
			card.appendChild(foot);

			overlay.appendChild(card);
			overlay._kd = function (e) { if (e.key === "Escape") smpCloseOverlay(); };
			document.addEventListener("keydown", overlay._kd, true);
			document.body.appendChild(overlay);
			smpOverlay = overlay;
			// 聚焦第一个输入
			var first = params.length > 0 ? inputs[params[0].name] : null;
			if (first && first.focus) first.focus();
		}

		/** 打开某脚本的参数填写弹窗(供图标点击与必输候选点选调用)。 */
		function smpOpenDialogFor(id, meta, ctx) {
			if (!meta || !meta.parameters || meta.parameters.length === 0) {
				// 无参数可填:直接默认执行
				var sid0 = smpActiveSession && smpActiveSession.sessionId;
				if (sid0 && ctx) smpRunScript(ctx, sid0, id, null);
				return;
			}
			smpOpenOverlay({
				id: id,
				name: meta.name || id,
				parameters: meta.parameters,
				api: smpApi,
				onSubmit: function (pid, paramsObj) {
					var sid = smpActiveSession && smpActiveSession.sessionId;
					if (!sid || !ctx) { console.error("[dsh-script-manager] no session for script params"); return; }
					smpRunScript(ctx, sid, pid, JSON.stringify(paramsObj));
				}
			});
		}
		// ---- 候选行参数图标(DOM 增强;结构变化自动降级) ----
		var smpOptMeta = {}; // id -> { parameters, name }(最近一次 options 结果)
		var smpActiveSession = null; // 最近一次候选打开的 session
		var smpIconObserver = null;
		var smpApi = null;
		/** 监听宿主 listbox,为带参项行尾注入图标;仅当图标未注入过且行文本含脚本 id。 */
		function smpWatchIcons(onOpen) {
			if (typeof MutationObserver === "undefined") return;
			if (smpIconObserver) { smpIconObserver.disconnect(); smpIconObserver = null; }
			var pending = 0;
			smpIconObserver = new MutationObserver(function () {
				// 找到当前可见 listbox
				var rows = document.querySelectorAll('[role="listbox"] [role="option"]');
				if (rows.length === 0) return;
				for (var i = 0; i < rows.length; i++) {
					var row = rows[i];
					if (row.querySelector('[data-smp-param-icon]')) continue;
					var id = smpFindOptionId(row);
					var meta = id && smpOptMeta[id];
					if (!meta || !meta.parameters || meta.parameters.length === 0) continue;
					if (row.querySelector('[data-smp-param-icon]')) continue;
					var icon = document.createElement("span");
					icon.className = "smp-param-icon";
					icon.setAttribute("data-smp-param-icon", "1");
					icon.title = "填写参数执行";
					icon.setAttribute("role", "button");
					icon.setAttribute("tabindex", "0");
					icon.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 4.5h12M2 8h12M2 11.5h12"/><circle cx="5" cy="4.5" r="1.6" fill="var(--dsw-alias-bg-base)"/><circle cx="11" cy="8" r="1.6" fill="var(--dsw-alias-bg-base)"/><circle cx="7" cy="11.5" r="1.6" fill="var(--dsw-alias-bg-base)"/></svg>';
					(function (id2, meta2) {
						icon.addEventListener("click", function (e) {
							e.preventDefault();
							e.stopPropagation();
							onOpen(id2, meta2);
						});
						icon.addEventListener("keydown", function (e) {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								e.stopPropagation();
								onOpen(id2, meta2);
							}
						});
					})(id, meta);
					row.appendChild(icon);
				}
			});
			smpIconObserver.observe(document.body, { childList: true, subtree: true });
		}
		/** 行文本匹配脚本 id(候选 detail 形如 "<id> | ..." 或 description;优先精确 id)。 */
		function smpFindOptionId(row) {
			var text = (row.textContent || "").trim();
			if (!text) return null;
			for (var id in smpOptMeta) {
				if (text.indexOf(id) !== -1) return id;
			}
			return null;
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
						options: async function (session, signal) {
							var res = await fetch("/api/scripts", { signal: signal });
							if (!res.ok) throw new Error("Failed to load scripts: " + res.status);
							var scripts = await res.json();
							// 名称优先作为主显示；带参脚本在 detail 尾部标注参数概要；
							// 并缓存本次候选的参数元供行图标/onSelect 使用
							var meta = {};
							var opts = scripts.map(function (s) {
								var hasP = smpHasParams(s);
								if (hasP) meta[s.id] = { id: s.id, name: s.name, parameters: s.parameters || [] };
								var desc = (s.description || '').trim();
								var brief = hasP ? smpParamsBrief(s.parameters) : '';
								// detail 容纳 id + 参数概要;description 过长则省略
								var parts = [];
								if (brief) parts.push(brief);
								var clipped = desc.length > 48 ? desc.slice(0, 47) + '…' : desc;
								if (clipped) parts.push(clipped);
								var detail = parts.length > 0 ? parts.join(' | ') : desc;
								if (hasP) detail = s.id + ' · ' + detail;
								var o = { id: s.id, label: s.name, detail: detail || s.id };
								if (hasP) o._smpParams = s.parameters || [];
								return o;
							});
							smpOptMeta = meta;
							if (session && session.sessionId) smpActiveSession = session;
							// 每次候选打开重置一次图标观察(宿主收层后行移除,重开重注)
							if (typeof smpWatchIcons === "function") {
								smpWatchIcons(function (id2, meta2) { smpOpenDialogFor(id2, meta2); });
							}
							return opts;
						},
						onSelect: function (option, session) {
							// 点选候选行。规则:
							// - 无必输参数(含无参/全可选带默认) → 直接后台执行(默认参数;服务端自动补默认);
							// - 存在必输参数 → 不在 onSelect 里等输入,先放行收层,随后打开参数弹窗。
							// 后台执行:先放行收起弹窗再 execute(链路与直接提交 /script 一致,结果/错误进会话)。
							var sid = session && session.sessionId;
							if (!sid) throw new Error("session unavailable");
							smpActiveSession = session;
							var id = option.id;
							var ps = option._smpParams;
							var hasRequired = Array.isArray(ps) && ps.some(function (p) { return p.required; });
							if (hasRequired) {
								// 收层后弹参数窗(把当前选中 id 记入;宿主 dismiss 后再开避免遮挡)
								Promise.resolve().then(function () {
									var meta = smpOptMeta[id] || { id: id, name: option.label || id, parameters: ps };
									smpOpenDialogFor(id, meta, ctx);
								});
								return;
							}
							smpRunScript(ctx, sid, id, null);
						}
					}
				});
			}

			var slots = ctx.slots;
			if (slots && typeof slots.inject === "function") {
				var api = makeApi();
				smpApi = api;
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
