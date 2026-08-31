# @deepseek-ai/dsh-plugin-script-manager

DSH 自定义操作脚本管理插件

## 功能特性

- **脚本管理**：通过 Web UI 或工具创建、编辑、删除脚本
- **用户调用**：通过 `/script <脚本名>` slash command 调用脚本
- **Agent 调用**：通过 `tools.script_run({ scriptId })` 工具调用脚本
- **执行引擎**：复用 DSH 的 `ctx.codeRuntime`，保持执行环境完全一致
- **上下文注入**：脚本源代码和执行结果注入对话，供 agent 审查
- **行为一致**：两种调用方式输出格式 100% 一致

## 安装

```bash
cd ~/.dsh/profiles/web
dsh plugin add /path/to/dsh-plugin-script-manager
```

## 使用方法

### 用户调用

```
/script <脚本名>
```

### Agent 调用

```typescript
// 执行脚本
tools.script_run({ scriptId: "my-script" })

// 管理脚本
tools.script_manage({ action: "list" })
tools.script_manage({ action: "create", script: { id: "...", ... } })
```

### 脚本编写

脚本代码是 TypeScript async function body：

```typescript
// 可通过 tools.* 调用所有 DSH 工具
const result = await tools.read({ file_path: "package.json" });
const pkg = JSON.parse(result.lines.map(l => l.text).join(""));
console.log("项目:", pkg.name);
return { name: pkg.name };
```

## 配置

```yaml
- insert:
    - id: script-manager
      name: "@deepseek-ai/dsh-plugin-script-manager"
      config:
        scriptsDir: ~/.dsh/scripts
        maxExecutionTime: 30000
        enableWebUI: true
```

## 开发

```bash
pnpm install
pnpm build
```