// verify-private-access.mjs — 核对「谁能私聊机器人」的私聊准入判定。
//
// 为什么需要它：`allowAllPrivate` / `friends.enabled` / 静态白名单 / 黑名单四者叠在一起，
// 优先级在页面上看不出来；而"未加好友的人到底能不能私聊"这件事**没法靠读配置自我验证**
// （配置只说你开了什么，不说谁最终进得来）。这里逐行复刻 `allowed()` 的私聊分支，
// 用桥接的实时目录与好友名单跑一遍，把每个人的最终判定连同**理由**打出来。
//
// 用法：node scripts/verify-private-access.mjs
//   退出码 0 = 全部符合预期；1 = 有项不符（输出里带 FAIL 的那几行）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let bad = 0;
const ok = (cond, name, extra = '') => {
  if (cond) console.log(`  OK   ${name}${extra ? ' — ' + extra : ''}`);
  else { bad++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

const token = fs.readFileSync(path.join(ROOT, 'state', 'console-token'), 'utf8').trim();
const H = { 'x-console-token': token, 'content-type': 'application/json' };
const get = async (p) => (await fetch('http://127.0.0.1:3100' + p, { headers: H })).json();

// 逐行复刻 src/bridge.js 的 allowed()（私聊分支）
function decidePrivate(id, cfg, friendIds) {
  const s = String(id);
  if ((cfg.deny?.private ?? []).map(String).includes(s)) return { ok: false, why: '黑名单' };
  if (cfg.allowAllPrivate === true) return { ok: true, why: '允许所有人私聊' };
  if (cfg.friends?.enabled === true && friendIds.has(s)) return { ok: true, why: '好友放行' };
  const list = (cfg.allow?.private ?? []).map(String);
  if (list.length > 0) return { ok: list.includes(s), why: '静态白名单' };
  return { ok: cfg.allowAllWhenEmpty === true, why: '空名单全放' };
}

const w = await get('/api/whitelist');
const s = await get('/api/status');
const cfgFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const friendIds = new Set((s.friendsIds ?? []).map(String));

console.log(`  allowAllPrivate=${w.allowAllPrivate}  好友数=${friendIds.size}  私聊白名单=${JSON.stringify(w.allow.private)}`);
ok(cfgFile.allowAllPrivate === true, '★ 已落盘到 config.json');
ok(w.allowAllPrivate === true, '接口回读为开启');

console.log('\n## 未加好友的人能否私聊');
// 这些号码都不在好友名单里，也不在静态白名单里
for (const stranger of ['123456789', '987654321', '55555555']) {
  const d = decidePrivate(stranger, cfgFile, friendIds);
  ok(!friendIds.has(stranger) && d.ok === true, `陌生人 ${stranger} → 放行`, `不在好友名单，判定=${d.why}`);
}

console.log('\n## 其它路径未被破坏');
const adminId = String(w.allow.private[0]);
ok(decidePrivate(adminId, cfgFile, friendIds).ok === true, '白名单上的你自己 → 放行');
ok(decidePrivate('123456789', { ...cfgFile, deny: { ...cfgFile.deny, private: ['123456789'] } }, friendIds).ok === false, '★ 黑名单仍然优先（拉黑一个号不受此开关影响）');

console.log('\n## 群聊不受影响');
function decideGroup(id, cfg, table) {
  const s2 = String(id);
  if ((cfg.deny?.groups ?? []).map(String).includes(s2)) return false;
  if (table.get(s2) === false) return false;
  const list = (cfg.allow?.groups ?? []).map((g) => String(g.id ?? g));
  if (list.length > 0) return list.includes(s2);
  return cfg.allowAllWhenEmpty === true;
}
const table = new Map((w.allowGroupsDetail ?? []).map((e) => [String(e.id), e.enabled]));
const anyGroup = String(w.allowGroupsDetail[0].id);
ok(decideGroup(anyGroup, cfgFile, table) === true, '白名单群照旧放行');
ok(decideGroup('444444444', cfgFile, table) === false, '★ 非白名单群仍被拒绝（开关只管私聊）');

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`);
process.exit(bad > 0 ? 1 : 0);
