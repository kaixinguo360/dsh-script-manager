# dsh-script-manager

DSH 自定义操作脚本管理插件

> DSH 的 run_code/PTC 机制让 agent 能执行 TypeScript 代码，但每次都是临时的，用户重复操作要重新描述。即使做成 skill，agent 跑新任务也要再写一遍代码，造成无意义的 token 消耗。本插件的出发点很简单——已经验证过的操作流程，直接固化成可复用脚本，不走模型上下文，不耗 token，带参数、带执行预期结果描述，用户和 agent 都能一键调用。与其把重复性操作做成 skill 让模型反复读，不如让它直接跑代码。

## 功能特性

- **脚本管理**：通过 Web UI 或 Agent 工具创建、编辑、删除脚本
- **用户调用**：通过 `/script <脚本名>` slash command 调用脚本
- **Agent 调用**：通过 `tools.script_run({ scriptId })` 工具调用脚本
- **执行引擎**：复用 DSH 的 `ctx.codeRuntime`，保持脚本执行环境与原本的PTC模式完全一致
- **上下文注入**：脚本源代码和执行结果注入对话，供 agent 审查
- **行为一致**：两种调用方式的行为与输出格式 100% 一致
- **层级执行展示**：脚本内层 `tools.*` 调用以 log-only 的 `tool/code-dispatch-start` /
  `tool/code-dispatch` 事件写入会话（与 run_code/PTC 同一契约，不进入模型上下文），
  Web GUI 将脚本内部调用渲染为 PTC 同款嵌套工具卡片

## 安装

```bash
dsh plugin add /path/to/dsh-script-manager
```

## 使用方法

### 用户调用

键入`/script`后会弹出自动补全候选列表，展示所有可调用的脚本

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

### 脚本创建

**方式一：/create_script 命令（推荐）**

用自然语言描述想要固化为脚本的操作，agent 会自动生成脚本、验证执行、告诉用户调用方式。推荐在首次踩坑完成后，让 agent 将踩坑得到的正确流程整理成脚本：

```
/create_script 将刚才执行过的，从远程仓库拉取最新代码并构建的流程，整理成一个可复用脚本
```

**方式二：Web UI**

设置页 → 脚本管理 → 新建脚本，填写表单后保存。

**方式三：script_create 工具**

agent 主动调用 `tools.script_create` 工具创建脚本：

```typescript
tools.script_create({
  script: {
    id: "my-script",
    name: "My Script",
    code: 'console.log("hello"); return { ok: true };'
  }
})
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
      name: "dsh-script-manager"
      config:
        scriptsDir: ~/.dsh/scripts
        maxExecutionTime: 0      # 默认执行超时(ms)；0 = 不限制，脚本级/调用级可覆盖
        enableWebUI: true
```

### 执行超时（timeout）

- 默认**不限制**单次执行时长（仍受 DSH 平台级 maxWallMs 护栏约 10 分钟约束）。
- 生效优先级（高 → 低）：
  1. 调用级：`script_run({ scriptId, timeoutMs })` 或动态工具单次覆盖
  2. 脚本级：脚本定义里的 `timeoutMs` 字段（正整数毫秒）
  3. 插件配置 `maxExecutionTime`（毫秒）
- 超时会中止整个脚本（含正在运行的内部 `tools.*` 调用），错误消息形如
  `script execution exceeded timeout of Nms`。

### 执行预期结果（expectedOutcome / successCriteria / failureGuidance）

脚本可声明三个可选的执行预期结果字段（多行文本），随执行结果一并提供给 agent，
便于它在执行完成后对照判断脚本是否达到预期行为：

- `expectedOutcome`：脚本完成后应达成的结果；
- `successCriteria`：如何验证达到预期——可检查的迹象/检查点
  （产物文件、退出码、输出特征、返回值字段等）；
- `failureGuidance`：未达预期或执行失败时 agent 如何介入
  （调整输入重试、补做手动步骤、`script_update` 修正脚本后重跑等）。

执行结果文本中预期结果段位于 Logs 之前，末尾带一行 Review 提示；未声明预期结果的脚本
照常工作，仅追加一行 Note 提示。适合在创建脚本时顺手补上：

```json
{
  "expectedOutcome": "仓库已更新到 origin/main 的最新提交",
  "successCriteria": "git log 顶部为远端最新 commit；git status 干净",
  "failureGuidance": "网络错误可原样重试；若远端有新冲突需先手动解决再重跑"
}
```

### 参数化脚本（parameters）

脚本可声明 `parameters` 数组以便接收输入。执行时输入会先校验、合并默认值，再以
`params.<name>` 注入脚本（值即参数声明类型：字符串/数字/布尔）。

每个参数：

- `name`（必填）：合法标识符，脚本内以 `params.<name>` 读取；
- `type`：`string`（默认）/ `number` / `boolean`；
- `label` / `description`（可选，展示用）；
- `required`：`true` 为必输；`false`（默认）为选输；
- `default`：**必输参数不得声明默认值；选输参数必须声明与 type 匹配的默认值**。

```json
{
  "parameters": [
    { "name": "targetUser", "type": "string", "required": false, "default": "private", "label": "目标用户" },
    { "name": "repoPath", "type": "string", "required": true, "description": "仓库绝对路径" },
    { "name": "depth", "type": "number", "required": false, "default": 3 }
  ]
}
```

参数化脚本执行方式：

- `script_run({ scriptId, params: { ... } })`（必输缺失会报错并列出参数名）；
- `/script <id> {"k":"v"}`；
- `/script` 候选列表：带参脚本右侧有参数图标，点图标可填参执行；点选候选项时——
  无必输参数则直接以默认值执行，存在必输参数则弹出参数输入窗；
- 注册为动态工具（`registerAsTool`）的带参脚本，其工具 schema 会反映每个参数
  （类型/必输/默认说明）。

执行结果文本会带一段 `Params:`（本次实际生效参数，含默认值合并），便于执行完成后
对照执行契约验收；传入但未声明的参数会被忽略并在结果中提示。

### 动态工具注册（registerAsTool）

脚本可注册为 agent 直接调用的工具——创建时设置 `registerAsTool: true`，
可选指定 `toolName`（留空则自动生成 `script_<id>`）。注册后 agent 无需
先 `script_list` 再 `script_run`，直接按工具名调用即可。

带参脚本注册为动态工具时，声明的参数会映射为工具的平铺参数，
agent 调用时按参数名传值：

```typescript
// 脚本声明了 { name: "repoPath", required: true }
// 注册为工具 git-update 后，agent 直接调用：
tools.git_update({ repoPath: "/home/kaixinguo/work/my-repo" })
```

脚本更新（改名、改参数、关闭注册）后，动态工具会自动同步。

## 开发

```bash
pnpm install
pnpm build
```