# 用 WorkBuddy 积分跑 QQ 桥接

> 本文记录**本机**把 QQ 机器人的模型从 DeepSeek 官方账号（`deepseek-account`）切到
> WorkBuddy 积分（`workbuddy`）的完整做法、验证方式与回滚步骤。2026-09-30 实测通过。

## 1. 为什么要动 DSH，而不只是改 `config.json`

桥接**自己不连模型**：它只把 `config.json` 里的 `dsh.provider` / `dsh.model` 通过
`session.selectModel` 下发给本机 DSH（`http://127.0.0.1:19387`），真正的模型调用由 DSH 发出。
所以「用上 WorkBuddy 积分」= DSH 端要先有一个能提供 WorkBuddy 模型的 provider，桥接才选得到它。

DSH 端用的是社区插件 [`dsh-connect-workbuddy`](https://github.com/dingminhua/dsh-connect-workbuddy)
（MIT）：它复用 WorkBuddy 桌面 App 的登录态，注册 `workbuddy`（国内版）/ `workbuddy-global`（国际版）
两个 provider，并提供**只读**的积分概览。本机账号是国内版，因此只出现 `workbuddy`。

## 2. 安装（DSH 端）

```sh
# 用 DSH 自带的 CLI 装进 desktop profile；它会同时把 bundle 写进 dsh.profile.bundles
"%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" ^
  plugin --profile desktop add dsh-connect-workbuddy
```

- 版本要求：插件 `>=2.1.0` 只支持 **DSH `0.1.7-rc.1` ~ `0.2.x`**；`0.1.5` 线请停在 `2.0.15`。
  本机是 DSH `0.1.7-rc.2`，实测装到 `2.3.1`。
- 前置：**WorkBuddy 桌面 App 已安装并登录**（本机 `C:\Program Files\WorkBuddy`，凭据在
  `%LOCALAPPDATA%\CodeBuddyExtension\Data\Public\auth\workbuddy-desktop.info`）。
- 插件声明的 `dsh-*` peer 只要有一条不满足，**整条 bundle 会被静默跳过**（provider 不注册、
  设置卡片不出现、模型列表为空且页面无报错）。所以装完必须用下面的探针确认，而不是靠肉眼。

## 3. 改桥接配置

```json
"dsh": { "baseUrl": "http://127.0.0.1:19387", "provider": "workbuddy", "model": "deepseek-v4.1-flash", "reasoningEffort": "max" }
```

可选的 WorkBuddy 模型（`workbuddy` provider，括号内是积分倍率，越小越省）：

| 模型 id | 名称 | 倍率 | 图片输入 |
| --- | --- | --- | --- |
| `deepseek-v4.1-flash` | Deepseek-V4.1-Flash | x0.11 | ❌ |
| `glm-5.3-flash` | GLM-5.3-Flash | x0.06 | ❌ |
| `minimax-m3` | MiniMax-M3 | x0.25 | ❌ |
| `hy4-preview` | Hy4 preview | x0.29 | ❌ |
| `deepseek-v4-pro` | Deepseek-V4-Pro | x0.51 | ❌ |
| `glm-5.3` / `glm-5.2` / `glm-5.1` | GLM-5.x | x0.79 | ❌ |
| `kimi-k3-1` | Kimi-K3 | x1.62 | ❌ |
| `auto` | Auto（上游自己路由） | — | ❌ |

### ⚠️ 图片输入（QQ 场景的关键限制）

**本机 16 个 WorkBuddy 模型全部不接受图片输入**（`glm-5v-turbo`、`glm-5.3`、`kimi-k3-1`、
`deepseek-v4-pro`、`minimax-m3` 等逐个实测，均被 DSH 拒绝）：

```
session/attachment-invalid: Model "xxx" does not support image input.
```

后果：**群友发图片/表情时 AI 收不到图**（桥接仍会把文本正常投递，纯文字聊天不受影响）。
想恢复看图能力有两条路：

1. 在 DSH「设置 → 插件 → DSH Connect WorkBuddy」的模型管理里，**手动勾选**目标模型的
   「图片输入」并保存（插件默认只对厂商文档写明「原生多模态」的模型自动勾选，本机全部未勾）。
   注意：勾选后若上游其实不支持，图片会在上游被丢弃或报错——属自担风险的手动声明。
2. 回滚到 DeepSeek 官方账号（见 §6），它是多模态的。

## 4. 验证（三层，缺一层都不算通）

```sh
# ① 目录层：DSH 是否真的注册了 workbuddy provider、目标模型在不在
node scripts/workbuddy-probe.mjs

# ② 调用层：对目标模型发一次真实调用（会新建探针会话，用完自动归档）
node scripts/workbuddy-probe.mjs --call

# ③ 图片层：哪些模型真能吃图片输入
node scripts/workbuddy-vision-check.mjs
```

另有两个等价于「桥接自己那一刀」的动作，可用来确认真实 QQ 会话已被切过去：

```sh
# 桥接启动日志里会打印：已设置会话模型 <sessionId> -> workbuddy/deepseek-v4.1-flash (max)
# 控制台 →「令牌与花费」页也能看到每个会话实际用的模型
```

> 桥接把 `provider`/`model` 写错时**不会报错**（选择失败只打日志），所以换完 provider
> 一定要跑 ① ，否则会以为切过去了、实际还在用旧模型。
>
> **不过现在这件事已经自动做了**：桥接启动时会自己核对一遍（见 §4.1），
> 不用再靠人记得跑探针。探针的价值变成了「排查时看全量目录」。
>
> **档位也要核**：不同 provider 支持的 `reasoningEffort` 不一样（例如本机
> `deepseek-account` 支持 `off/low/high/max`，而 WorkBuddy 的 `glm-5.3` 只有 `low/high/max`）。
> 换 provider 后原来的 `max` 可能不存在，DSH 会拒绝非法档位——启动确认会把这点一起报出来。

### 4.1 启动时的模型连接确认

每次启动、以及 DSH 每次重新就绪，桥接会读一次 DSH 模型目录并逐项核对配置，
把**实际生效**的模型打进启动日志（`state/bridge.log`）：

```
✅ 模型连接: workbuddy/deepseek-v4.1-flash（Deepseek-V4.1-Flash · x0.11）｜ 思考强度 max
```

配错时不静默，直接列出可用候选（可直接抄进 `config.json`）：

```
❌ 模型连接: provider「workbuddy」下没有模型「gpt-9」——该 provider 可用: auto, hy4-preview, hy3, ...
   QQ 消息到达时会再次尝试选择；若仍失败，实际跑的是 DSH 默认模型。
```

DSH 刚起步、`sessionController` 还没挂上时会读到「读不到 DSH 模型目录」——这是**软失败**：
只提示、不阻塞启动、不误报成「模型不存在」（实测 2026-10-01 10:49 那次就是这种情况）。

### 4.2 在控制台里切换

**两个入口，共用同一组接口**（`GET`/`POST /api/dsh/model`），所以两处永远不会各说各话：

**① 顶栏右上角「模型来源」（最常用）**

```
模型来源  ● WorkBuddy 积分 · deepseek-v4.1-flash   [⇄ 切到 DeepSeek]
```

- 一键在两家之间来回切。目标 provider 按**前缀**从 DSH 实时目录里挑（`workbuddy*` / `deepseek*`），
  所以 provider 改名、或以后装了别的插件，这个按钮都不用改代码；目标不存在时按钮会置灰而不是点了报错。
- 切换会先弹确认框（列出「从哪 → 到哪」，因为它会真的改变机器人行为并花掉对应的钱/积分）。
- **鼠标移到这块区域**（或键盘 Tab 聚焦）会展开一个面板，显示 API 接入口与接入更多模型的办法——见 §7。

**② 运行总览 →「DSH 模型与思考强度」卡片**

内容就是 DSH 当前公布的完整目录（本机 3 个 provider）：

- **提供方 / 模型**两个联动下拉；
- 顶部一行是**连接状态**：`✅ 当前模型在 DSH 目录中`，或红字列出「不在目录里」的具体是哪一项；
- 点「切换模型」会：按目录校验 → 写入 `config.json` → **立即推给所有在线 QQ 会话**
  （回执里的 `appliedSessions` 就是成功推送的会话数），不必等下一条消息；
- 目录里没有的组合会被拒（HTTP 409 并附可用清单），不会把配置写坏。

等价的手工调用（令牌在 `state/console-token`）：

```sh
curl -X POST http://127.0.0.1:3100/api/dsh/model \
  -H "x-console-token: <令牌>" -H "content-type: application/json" \
  -d '{"provider":"workbuddy","model":"minimax-m3","reasoningEffort":"low"}'
```

> ⚠️ 切换会**同时**改写 DSH 的全局默认模型（`~/.dsh/profiles/desktop/cordis.patch.yml` 的
> `agent-default-model`），也就是 Web GUI 里新建会话的默认模型也会跟着变。这是 DSH 的
> `session.selectModel` 语义，不是桥接多加的行为，控制台卡片上有同样的提示。


## 5. 花费看板的口径

WorkBuddy 计的是**积分**，DSH 只回 token 数，所以控制台「令牌与花费」页**无法显示积分余额**
（余额看 DSH 插件卡片里的只读积分概览）。`config.json` 的 `pricing` 覆盖段把
`deepseek-v4.1-flash` 登记为 DeepSeek 官方同源模型的单价、并把 `peakMultiplier` 设为 `1`
（WorkBuddy 不分峰谷）：

- 看板显示的金额口径是「**这些 token 按 DeepSeek 官方价值多少钱**」，不是你扣掉的积分。
- 想按别的口径折算（例如按积分倍率近似），改 `config.json` 的 `pricing.models` 即可，改完重启桥接。

## 6. 回滚到 DeepSeek 官方账号

配置层的回滚是**一行**：

```json
"dsh": { "baseUrl": "http://127.0.0.1:19387", "provider": "deepseek-account", "model": "deepseek-flash", "reasoningEffort": "max" }
```

1. 改回上面这行（或从备份目录 `backup/<时间戳>/config.json` 拷回）。
2. 重启桥接：`restart.bat`（或 `node src/bridge.js`）。
3. 若还想把 DSH 全局默认也改回去：编辑 `~/.dsh/profiles/desktop/cordis.patch.yml` 的
   `agent-default-model` 行（`provider` / `model`），然后重启 DSH。
4. 可选：卸载插件 `dsh plugin --profile desktop remove dsh-connect-workbuddy`，并重启 DSH。

> **注意**：`session.selectModel` 会**同时**写会话级选择和 DSH 全局默认
> （`cordis.patch.yml` 的 `agent-default-model`）。所以桥接按 `config.json` 切模型时，
> GUI 新会话的默认模型也会跟着变——这是 DSH 的设计，不是桥接的 bug（控制台也标注了该副作用）。

## 7. 接入更多大模型

桥接**只负责选择**，不负责接入——能不能多一个模型，取决于 **DSH 里有没有对应的 provider**。
DSH 注册 provider 有两条路（控制台顶栏的悬停面板也写了同样的两条捷径）：

### ① 内置 DeepSeek 通道换网关（不用装插件）

`dsh-llm-deepseek` 适配器支持 `baseURL`，可以指向**任何兼容 Messages 协议**的网关。
在 DSH **设置 → 模型** 的「自定义设置」折叠区里改：

| 字段 | 含义 |
| --- | --- |
| `baseURL` | 网关根地址。官方默认 `https://api.deepseek.com/anthropic`；必须是无凭据/查询串/片段的 HTTP(S) 根 |
| `apiKeyEnv` | 存放 API Key 的**环境变量名**（不是 Key 本身——Key 不落在配置里） |
| `models` | 该网关下有哪些模型 |

> ⚠️ 该适配器**只接受 Messages 协议**，没有 `protocol` 字段；写了会以
> `protocol is not configurable` 报错并让后续请求持续失败，直到配置文件改正。
> Provider id 叫 `deepseek-official` 时**不能**换成别的适配器（`DUPLICATE_ADAPTER`）。

### ② 装 provider 插件（像 WorkBuddy 那样）

```sh
"%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" ^
  plugin --profile desktop add <包名>
```

装完它会把自己的 provider 注册进 DSH 目录。**注意版本门禁**：插件声明的 `dsh-*` peer 只要有一条
不满足，**整条 bundle 会被静默跳过**（provider 不注册、页面无报错），所以装完必须跑
`node scripts/workbuddy-probe.mjs` 确认，而不是靠肉眼。

### 接入之后

- 控制台顶栏的「⇄ 切换」与「DSH 模型与思考强度」卡片会**自动列出新 provider**（都读实时目录），
  **本仓库的代码不需要改动**；
- 想让 QQ 机器人用上新模型，把 `config.json` 的 `dsh.provider` / `dsh.model` 指过去（或在控制台点一下）。

> 目录来自 `session.modelCatalog`（HTTP 接口，任何能发请求的本机程序都能读）：

```sh
curl http://127.0.0.1:3100/api/dsh/model -H "x-console-token: <令牌>"
```

## 8. 本次改动的备份位置

`backup/20260930-221341/`（时间戳目录，改动前快照）：

| 文件 | 内容 |
| --- | --- |
| `config.json` | 改动前的桥接配置（`deepseek-account` / `deepseek-flash`） |
| `cordis.patch.yml` | 改动前的 DSH profile patch（原始 `agent-default-model` + MCP 段） |
| `desktop-profile-package.json` | 改动前的 profile `package.json`（bundles 里没有 workbuddy） |
| `desktop-profile-pnpm-lock.yaml` / `desktop-profile-pnpm-workspace.yaml` | 改动前的 pnpm 状态 |
| `dsh-.credentials.yaml.bak` | 改动前的 DSH 凭据文件 |
