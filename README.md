# dsh-script-manager

DSH 自定义操作脚本管理插件

> DSH 的 run_code/PTC 机制让 agent 能执行 TypeScript 代码，但每次都是临时的，用户重复操作要重新描述。即使做成 skill，agent 跑新任务也要再写一遍代码，造成无意义的 token 消耗。本插件的出发点很简单——已经验证过的操作流程，直接固化成可复用脚本，不走模型上下文，不耗 token，带参数、带执行预期结果描述，用户和 agent 都能一键调用。与其把重复性操作做成 skill 让模型反复读，不如让它直接跑代码。

## 功能特性

- **脚本管理**：通过 Web UI 或 Agent 工具创建、编辑、删除脚本
- **用户调用**：通过 `/script <脚本名>` slash command 调用脚本
- **Agent 调用**：通过 `tools.script_run({ scriptId })` 工具调用脚本
- **执行引擎**：复用 DSH 的 `ctx.ptcRuntime`，并在 `cwd` 与文件策略上对齐 `run_code`，
  脚本执行环境与 PTC 模式完全一致（同一 seam、同一绑定形态、同一沙箱授权）
- **上下文注入**：脚本源代码和执行结果注入对话，供 agent 审查
- **行为一致**：两种调用方式产生的会话记录与输出格式 100% 一致
- **层级执行展示**：脚本内层 `tools.*` 调用以 log-only 的 `tool/ptc-dispatch-start` /
  `tool/ptc-dispatch` 事件写入会话（与 run_code/PTC 同一契约，不进入模型上下文），
  Web GUI 将脚本内部调用渲染为 PTC 同款嵌套工具卡片
- **变更历史**：脚本的每次创建/编辑/改名记一条变更日志（时间、入口面、修订号、变更字段，
  以及该版本完整定义快照含 code），可回溯"上一版长什么样 / 改坏了什么"
- **执行历史**：每次执行记一条（时间、修订号、调用面、生效参数、成败、错误、耗时、返回值摘要），
  能看出"哪个版本执行的"，且可与变更历史同修订号的快照联动取回当时代码
- **按脚本分储、存储分离**：历史按脚本存于独立数据目录（默认 `<scriptsDir>/.state/<scriptId>/`，
  可用 `stateDir` 配置指到任意绝对路径），绝不写入脚本文件与 `index.json`；
  删除脚本时同步整删该脚本的历史目录；目录结构为每个脚本预留后续扩展空间

## 安装

```bash
dsh plugin add /path/to/dsh-script-manager
```

要求 DSH `0.2.0-rc.2`（peerDependencies 按该版本声明），且部署中挂载了 PTC 运行时
（`@deepseek-ai/dsh-ptc-runtime-node`，由 `@deepseek-ai/dsh-base` 默认提供）。
脚本管理面在缺少 PTC 运行时的部署中照常可用，仅在执行脚本时报出可操作的错误。

## 使用方法

### 用户调用

键入`/script`后会弹出自动补全候选列表，展示所有可调用的脚本

```
/script <脚本名>
```

命令本身不直接执行脚本，而是把这次执行投递到框架原生的工具回合：登记一次待派发意图，
在该会话的下一次模型请求上短路（不产生任何 provider 请求与 token 消耗），直接产出一次
`script_run` 工具调用，随后由 DSH 的 agent loop 以真实执行身份运行。因此 `/script` 与
`script_run` 在会话里留下完全同构的记录（真实的 assistant/tool 消息、真实的父调用身份、
脚本内层调用挂在其下的嵌套卡片），脚本执行完 agent 会就结果继续回复。

### Agent 调用

```typescript
// 执行脚本
tools.script_run({ scriptId: "my-script" })

// 管理脚本（script_* 为拆分后的独立单操作工具）
tools.script_list()
tools.script_get({ scriptId: "my-script" })
tools.script_create({ script: { id: "my-script", name: "My Script", code: "..." } })
tools.script_update({ scriptId: "my-script", script: { name: "Renamed" } })
tools.script_delete({ scriptId: "my-script" })
tools.script_search({ query: "git" })
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

### 执行超时（timeout）

- 默认**不限制**单次执行时长（仍受 DSH 平台级 maxWallMs 护栏约 10 分钟约束）。
- 生效优先级（高 → 低）：
  1. 调用级：`script_run({ scriptId, timeoutMs })` 或动态工具单次覆盖
  2. 脚本级：脚本定义里的 `timeoutMs` 字段（正整数毫秒）
  3. 插件配置 `maxExecutionTime`（毫秒）
- 超时会中止整个脚本（含正在运行的内部 `tools.*` 调用），错误消息形如
  `script execution exceeded timeout of Nms`；结果中同时给出失败类别（`errorKind`）。
- 预算由插件自持（运行时侧 deadline 显式置空），因此"超时中止整个脚本含其内部调用"
  的语义与调用级/脚本级/插件级三级优先级都由同一处实现，不会被运行时的默认值覆盖。

### 执行环境与文件策略

脚本与 `run_code` 走同一个 PTC 运行时，并被授予同样的执行条件：

- 工作目录取会话的 `cwd`；
- 文件策略由 `ctx.sandboxPolicy` 按会话解析后传入，故脚本的文件权限与 `run_code`
  完全一致——脚本不会成为比 PTC 更宽松的旁路（会话处于受限模式时，脚本内的文件操作同样受限）。

执行结果会带上本次实际应用的文件策略事实（`Sandbox: mode=...; denied=...`），
若有操作被沙箱拒绝则一并记录到执行历史（`sandboxDenied`）。

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
tools.git_update({ repoPath: "~/work/my-repo" })
```

脚本更新（改名、改参数、关闭注册）后，动态工具会自动同步。

### 脚本历史（变更与执行）

脚本的**变更与执行**会被自动记录，用于排查和版本对照。每次编辑/改名递增修订号（revision），
并保存该版本完整定义快照（含 code）；每次执行记录修订号、参数、成败与耗时。

- Agent 工具：`script_change_history()` / `script_run_history()`（按脚本或跨脚本查询）
- Web UI：脚本卡片"历史"按钮，支持展开查看代码并前后对照
- 配置：`historyEnabled`（开关）、`historyChangesMax` / `historyRunsMax`（保留条数）
- 删除脚本会同步删除其历史；数据存于 `stateDir`，与脚本文件完全分离

## 配置

```yaml
- insert:
    - id: script-manager
      name: "dsh-script-manager"
      config:
        scriptsDir: ~/.dsh/scripts
        maxExecutionTime: 0      # 默认执行超时(ms)；0 = 不限制，脚本级/调用级可覆盖
        historyEnabled: true     # 是否记录脚本变更/执行历史；false = 完全禁用
        stateDir: ""             # 历史数据目录；留空 = <scriptsDir>/.state，可填任意绝对路径彻底分离
        historyChangesMax: 200   # 每脚本变更历史保留条数（超限压缩，保留最新 N 条）
        historyRunsMax: 500      # 每脚本执行历史保留条数（超限压缩，保留最新 N 条）
```

## 开发

```bash
pnpm install
pnpm build      # tsdown（服务端）+ build-client.mjs（客户端 bundle）
pnpm typecheck
```

### 客户端 bundle 的三条硬约束

`src/client.js` 是手写的浏览器 bundle，由 `build-client.mjs` 复制到 `lib/client.js`。
以下三条必须与宿主约定一致，否则插件在浏览器侧**完全不装配或不渲染**
（表现为页面白屏、或该设置页区块空白，且服务端没有任何报错指向它）：

1. **注册 id 必须是包的裸名**（与 `package.json` 的 `name` 一致，即 `dsh-script-manager`）。
   宿主按包名合成启动图行，浏览器加载器以该 id 查工厂；写成 `<name>/client` 之类的
   旧式拼写会让该行找不到工厂。
2. **`P.<Name>` 取的每个 primitives 原子必须存在于所构建的版本**。
   图标在新版本中会改名（例如 `IconTrashOutline16` → `IconTrashOutlineRegular`）；
   取到不存在的名字会得到 `undefined` 作为元素类型，渲染时抛错并拖垮挂载它的槽位条目。
3. **`inject` 只声明真正使用的服务**。`inject` 未满足时 cordis 不会调用 `apply`，
   一个拼错的条目会让整个客户端面静默失效。

第 1、2 条已由 `build-client.mjs` 在构建期强制校验，违反即构建失败并给出可操作报错；
第 3 条是本 bundle 自身的纪律。另外 `dsh.client.inject` 只应列**真正带客户端面**的包
（声明了 `dsh.client` 的包）——它表达"这些包的工厂要先到位"，指向无客户端面的包
虽被静默跳过，但属无效声明。