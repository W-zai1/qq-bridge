# 设置与状态是怎么「永久记住」的

> 2026-10-02 实测核对。本文回答两件事：**哪些东西重启后会保留**，以及**改错了怎么退回来**。

## 1. 结论先说

桥接的设置与运行状态**本来就是持久化的**——控制台每次点保存都会立刻写盘，重启不丢。
真正缺的不是"保存"，而是**版本**：改错了没有退路。所以补的是自动快照 + 一键还原。

## 2. 持久化清单（重启后仍然存在）

| 文件 | 内容 | 什么时候写 |
| --- | --- | --- |
| `config.json` | 白名单/黑名单（含每群开关）、`allowAllPrivate`、好友放行、ownerQQ、DSH 模型与思考强度、人格注入上限、一代/二代仿真参数、黑话参数、语音与表情设置、控制台令牌、安全拦截开关 | 任意「保存」按钮 |
| `state/sessions.json` | QQ 会话 ↔ DSH 会话映射与策略 | 建会话/退役/切模式 |
| `state/social-v2.json` | 每个会话的唤醒配置、未读水位（`lastUnreadSeq` / `lastReadThroughSeq`）、**记忆**（进行中话题 / 想说未说的话 / 对群友的印象）、最近消息、限流窗口 | 任何与之相关的动作 |
| `state/mode.json` | 当前运行模式与 closed-agent preset | 切模式 |
| `state/current-role.json` | 当前人格卡与静默开关 | 设人格 |
| `state/slang.json` | 黑话词库（候选/已确认/已拒绝） | 学习与人工确认 |
| `state/stickers.json` | 收藏表情的本地理解与标签 | 记备注 |
| `state/token-usage.jsonl` | token 账本（基线 + 逐轮采样） | 每个回合 |
| `state/qq-activity.log` | 活动记录（轮转保留） | 每条消息 |
| `state/console-token` | 控制台访问令牌 | 首次生成或手动改 |
| `state/config-backups/` | **本文新增**：配置快照 | 每次保存设置前 |

### 刻意不落盘的（重启即重置，属设计而非缺陷）

- 正在跑的回合、`pendingWakeReasons`（"会话繁忙时暂存的唤醒原因"）、各类内存定时器；
- 这些是"进行中的动作"而不是"设置"。重启等于放弃当前动作重新开始——**重启后不会卡在繁忙状态**，只会丢掉那一轮没来得及投递的唤醒。

## 3. 配置快照：改错了怎么退回来

### 自动留档

每次保存设置前，桥接先把**当前盘上的那份** `config.json` 存成时间戳快照：

```
state/config-backups/2026-10-02T14-42-24-016Z.whitelist.json
                      └── 时间 ──┘        └─ 来自哪次改动 ─┘
```

- 最多保留 **20 份**，超出自动删最旧的；
- 内容与上一份完全相同则**不留**（"点保存但没改任何东西"不该刷掉有用的历史版本）；
- 写入失败只记一行日志，**绝不阻断本次保存**——"备份不了"不该变成"设置也存不了"；
- 标签直接写出改动来源：`whitelist` / `dsh-model` / `dsh-effort` / `social-v2-config` / `security` / `console-token` / `slang-config` / `role-limit` / `social-v1-config`。

### 界面还原

控制台「调试与运维」页 → **配置快照**卡片：

1. 列表列出时间、来自哪次改动、大小；
2. 点「预览」看那一份的完整内容（确认无误再动手）；
3. 点「还原到这一份」→ 二次确认 → 写回 `config.json` 并**同步重载内存配置**。

还原前会先把**当前这份**也存成 `before-restore` 快照——选错了还能退回来。

### 命令行

```sh
ls state/config-backups/                      # 看有哪些版本
diff <(cat state/config-backups/<快照>.json) config.json   # 比对差异
cp state/config-backups/<快照>.json config.json && restart.bat   # 手工还原（需重启）
```

### 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/config/backups` | 列出快照（含上限值） |
| GET | `/api/config/backup?name=<文件名>` | 预览某一份正文 |
| POST | `/api/config/restore` | 还原（body: `{ "name": "<文件名>" }`） |

三者都是**管理端接口**（需控制台令牌）；文件名经白名单校验，`../` 之类的路径穿越会被拒绝。

## 4. 一个被证伪的担心

设计这套机制时我怀疑：*"控制台保存是整份读-改-写，会不会把手工编辑的内容覆盖掉？"*

**实测：不会。** 手工往 `config.json` 里加的字段在控制台保存后依然存在——处理器是
`readConfigObject()` 读整份 → 只改自己那几个键 → 整份写回，未知字段被原样带过去。
并发保存（两个卡片同时点）也不会丢更新：Node 单线程 + `readFileSync`/`writeFileSync`
是同步的，每个请求的读-改-写天然原子，3 轮实测都两次改动同时生效。

> ⚠️ 但这**不构成"随便手改"的许可**：`JSON` 不支持注释，而控制台写回时会把格式重排成
> `JSON.stringify(obj, null, 2)`——你精心对齐的缩进和空行会没，注释根本存不下来。
> 想留说明就写进 `docs/`，别写在 `config.json` 里。

## 5. 备份里含密钥

快照是 `config.json` 的完整副本，因此**包含控制台令牌与 SnowLuma 的 accessToken**。
`state/` 目录在启动时会被收紧 ACL（Windows 上由 `scripts/harden-state-acl.mjs` 处理），
所以正常权限下本机其他用户读不到；但如果你把 `state/config-backups/` 拷给别人排查问题，
**先把这两个令牌删掉**。

## 6. 相关

- [ops/BOT-SILENT-TROUBLESHOOTING.md](../ops/BOT-SILENT-TROUBLESHOOTING.md)：机器人只接收不回复时的定位路径（重启后繁忙状态自动清空，与本文第 2 节末尾呼应）
- [guides/WORKBUDDY.md](WORKBUDDY.md)：模型来源切换（这些设置同样会被快照记录与还原）
