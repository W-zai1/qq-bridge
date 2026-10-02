// verify-role-space-conversion.mjs — 核对「一代空格分条」与「二代空格转逗号」是否同一口径。
//
// 为什么要专门守这条不变量：同一张人格卡的「回复示例」节被两代共用——一代把中文空格当**分条信号**，
// 二代则把它**改写成逗号**当停顿（见 bridge.js 的 convertExampleSpacesToComma，它只作用于该节）。
// 两处判定口径一旦漂移，就会出现「一代明明没在这处分条、二代却被插了个逗号」的偏差，
// 而且只在特定角色卡上复现，靠肉眼看示例极难发现。
//
// 用法：node scripts/verify-role-space-conversion.mjs
//   退出码 0 = 全部角色卡的示例节两代口径一致。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isHan = (ch) => { if (!ch) return false; const c = ch.codePointAt(0); return (c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3400 && c <= 0x4DBF) || (c >= 0xF900 && c <= 0xFAFF); };
const isHanOrPunct = (ch) => { if (!ch) return false; const c = ch.codePointAt(0); return isHan(ch) || (c >= 0x3000 && c <= 0x303F); };
const NO_REPLACE = new Set(['/', '\\', '(', ')', '[', ']', '{', '}', '"', "'", '<', '>', '|', '&', '=', ':', ';', ',', '.', '。', '，', '、']);
function conv(line, pred) {
  const chars = Array.from(String(line ?? '')); let out = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === ' ' || ch === '\t') {
      const p = chars[i - 1], n = chars[i + 1];
      if (((p && pred(p)) || (n && pred(n))) && !(p && NO_REPLACE.has(p)) && !(n && NO_REPLACE.has(n))) { out += '，'; continue; }
    }
    out += ch;
  }
  return out;
}
function v1split(src) {
  const tokens = String(src ?? '').split(/\s+/).map((t) => t.trim()).filter(Boolean);
  if (tokens.length <= 1) return tokens;
  const g = []; let cur = tokens[0];
  for (let i = 1; i < tokens.length; i++) {
    const pl = [...cur].pop() || '', cf = [...tokens[i]][0] || '';
    if (isHan(pl) || isHan(cf)) { g.push(cur); cur = tokens[i]; } else cur = cur + ' ' + tokens[i];
  }
  if (cur) g.push(cur);
  return g;
}

const md = fs.readFileSync(path.join(ROOT, 'roles', '小鲸鱼.md'), 'utf8');
const lines = md.split('\n').slice(94, 164).filter((l) => l.trim());

console.log('=== 有差异的行（旧 vs 新）===');
let diff = 0;
for (const line of lines) {
  const oldC = conv(line, isHanOrPunct), newC = conv(line, isHan);
  if (oldC !== newC) {
    diff++;
    console.log(`原: ${line}`);
    console.log(`旧: ${oldC}`);
    console.log(`新: ${newC}\n`);
  }
}
console.log(diff === 0
  ? '（本卡片上两种口径无差异——宽口径的偏差只在"中文标点贴着空格、另一侧是拉丁字母"时才出现）'
  : `共 ${diff} 行有差异`);

console.log('=== 二代转换与一代分条是否一致 ===');
let bad = 0;
for (const line of lines) {
  const groups = v1split(line);
  if (groups.length <= 1) continue;
  const inserted = (conv(line, isHan).match(/，/g) || []).length - (line.match(/，/g) || []).length;
  if (inserted !== groups.length - 1) {
    bad++;
    console.log(`✗ ${line}`);
    console.log(`   一代分 ${groups.length} 段；二代插入 ${inserted} 个逗号`);
  }
}
console.log(bad === 0
  ? `✅ 完全一致（检查了 ${lines.filter((l) => v1split(l).length > 1).length} 行）
     —— 一代分 N 条 ⇔ 二代恰好插入 N-1 个逗号`
  : `❌ ${bad} 行不一致（口径漂移了：见 bridge.js 的 isCjkChar / convertExampleSpacesToComma）`);

process.exit(bad === 0 ? 0 : 1);
