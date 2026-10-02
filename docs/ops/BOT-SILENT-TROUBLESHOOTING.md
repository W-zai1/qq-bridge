# 运维：机器人「只接收不回复」怎么查

> 实战记录。2026-10-01 本机真实发生过一次，下面是当时的症状、定位路径与已落地的自愈。

## 1. 症状

QQ 上给机器人发消息（含 @、含关键词、私聊）**全部没反应**，但机器人明显还在收消息——
控制台「运行概览」的活动记录里能看到 `消息已入未读：…`，只是没有任何 `工具统一发送：成功`。

关键特征：**不是掉线、不是模型炸了、不是白名单问题**——桥接进程活着、SnowLuma 连着、
DSH 就绪、模型连接正常。它只是"不愿意开口"。

## 2. 一句话定位

看桥接日志有没有这一行：

```
[reserved2] 会话繁忙，暂存唤醒原因 group:<群号>（atMention@seq134）
```

**有 → 就是本文说的问题**（会话被判定为"繁忙"，所有唤醒被改成"暂存"）。

### 为什么"暂存"等于永久静默

`暂存唤醒原因`（`st.pendingWakeReasons`）**只在某个 turn 正常结束时才被消费**
（`pumpMux` 的 `turn/end` 分支）。所以一旦"繁忙"状态本身是卡死的，就永远等不到那个
turn/end，暂存队列再也无人问津 —— 表现为永久只接收不回复。

这正是它的危险之处：**故障是自锁的**，不会自己好，只有重启桥接能解。

## 3. 当时的证据链

```sh
# ① 活动记录：只有入未读，没有发送
curl -H "x-console-token: <令牌>" http://127.0.0.1:3100/api/status     # 看 activity

# ② 会话状态：unread 堆积、lastAiReplyAt 停在很久以前
curl -H "x-console-token: <令牌>" http://127.0.0.1:3100/api/socialV2/states

# ③ DSH 侧：会话事件里根本没有新的 turn/start（排除"模型在慢慢想"）
#    会话日志在 ~/.dsh/sessions/<工作区目录>/<sessionId>/session.v4.jsonl.zstd
```

三条合起来才能定性：**桥接没投递**（活动无发送 + DSH 无新回合），而不是 DSH 在忙。

## 4. 已落地的自愈（本次修复）

`isConversationBusyV2` 原来是个**没有租约的全局闸门**——五条信号任意一条为真就拦下所有
唤醒，而每条信号都依赖"某个回合会来收尾"。收尾事件一丢（DSH 重启、事件流抖动、回合被
interrupt），信号就再也没人清。

现在改为带租约的 `isConversationBusyWithLeaseV2`：

| 信号 | 含义 | 租约 |
| --- | --- | --- |
| `turnRunning` / `collector` | 真有一轮在跑 | 5 分钟（一轮里可能等长轮询） |
| `pendingWakeTimer` / `pendingWakeKeys` / `promptQueue` | 待唤醒/排队 | 2 分钟（正常只有几秒的批处理窗口） |

- **持续**超过租约 → 判定卡死 → 强制放行（清掉超时信号），本次消息按正常路径唤醒；
- 信号组合一变就重新计时，所以一次正常的慢回合不会被误判；
- 强制放行时会打一条带**信号名与持续时长**的告警，下次再有类似问题一眼定位；
- `promptQueue` 被强清时，排队中的投递会**显式 reject**（而不是默默丢弃），
  让等待回执的调用方能拿到可处理的失败。

日志格式也补上了信号名，正常拦截时就能看出卡在哪：

```
[reserved2] 会话繁忙，暂存唤醒原因 private:<ownerQQ>（private@seq29）；繁忙信号: pendingWakeKeys+turnRunning+collector（已持续 0s）
```

## 5. 现场处置

```sh
# 卡死状态全在内存里 → 重启即可恢复（配置与账号不受影响）
restart.bat
```

新版桥接在租约到期后会自己放行，正常情况下不需要人工介入。

## 6. 还没查清的（留给后续）

用带租约的判定能**自愈**，但**没查清当初是哪条信号卡住的、为什么卡住**——因为出问题时
桥接还是旧代码，日志里只有一句无信息的"会话繁忙"，而刷新代码需要重启，重启就把现场清掉了。

下次若再出现，日志里会有 `繁忙信号: xxx（已持续 Ns）`：

- 若反复报 `promptQueue` → 查 `deliverPromptNow` 里有没有 await 不返回的路径；
- 若反复报 `turnRunning`/`collector` → 查 DSH 事件流丢 `turn/end` 的场景（DSH 重启、
  `session/end-seed`、回合被 interrupt）；
- 若报 `pendingWakeKeys` → 查 `sendWakePromptV2` 的失败分支有没有漏 delete。

> 相关：`RULES.md` 的权限边界、`docs/guides/TOKEN_OPTIMIZATION.md` 的 token 水位协议
> （`pendingWakeReasons` 与水位同属"回合收尾才推进"的机制）。
