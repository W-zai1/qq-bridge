// 控制台静态校验：在无法跑 Playwright 的环境里，替代性地检查 HTML/JS 结构契约。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 独立发语音工具已拆到仓库上一级的 voice-tool/（qq-bridge 只保留共享内核 src/voice-core.js）
const VOICE_TOOL = path.resolve(ROOT, '..', 'voice-tool');
const html = fs.readFileSync(path.join(ROOT, 'public', 'console.html'), 'utf8');

let bad = 0;
const ok = (cond, name, extra = '') => {
  if (cond) console.log(`  OK   ${name}${extra ? ' — ' + extra : ''}`);
  else { bad++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

console.log('## 元素 ID');
const ids = [...html.matchAll(/\sid="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]);
const dups = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
ok(dups.length === 0, 'ID 唯一', dups.length ? `重复：${dups.join(', ')}` : `共 ${ids.length} 个`);
for (const id of ['voiceList', 'voiceRefreshBtn', 'voiceSendBtn', 'voiceSendTarget', 'voiceSendDryRun', 'voiceMsg']) {
  const n = (html.match(new RegExp(`id="${id}"`, 'g')) ?? []).length;
  ok(n === 1, `语音面板元素 ${id}`, `${n} 处`);
}

console.log('## 视图 / 页面契约');
const views = [...new Set([...html.matchAll(/data-view="([a-z0-9-]+)"/g)].map((m) => m[1]))].sort();
const pages = [...new Set([...html.matchAll(/data-page="([a-z0-9-]+)"/g)].map((m) => m[1]))].sort();
ok(JSON.stringify(views) === JSON.stringify(pages), 'data-view 与 data-page 一一对应', `${views.length} 个：${views.join(', ')}`);

console.log('## 工具开关');
const tools = [...html.matchAll(/data-v2-tool="([A-Za-z]+)"/g)].map((m) => m[1]);
ok(tools.includes('sendVoice'), 'sendVoice 开关存在', `共 ${tools.length} 个开关`);
ok(new Set(tools).size === tools.length, '工具开关无重复');

// 群白名单改为「一行一个群号 + 每行一个开关」：旧的单行逗号输入框被替换，
// 但 wlGroups 这个 ID 必须保留（225 个旧 ID 的契约，见 console-ui-legacy-ids.json）。
console.log('## 群白名单按行编辑');
for (const id of ['wlGroupRows', 'wlGroupAdd', 'wlGroupSummary']) {
  ok((html.match(new RegExp(`id="${id}"`, 'g')) ?? []).length === 1, `元素 ${id}`);
}
ok(/getElementById\('wlGroupAdd'\)\.addEventListener/.test(html), '「+ 添加一行」已绑定事件');
ok(/function addGroupRow\(/.test(html) && /function readGroupRows\(/.test(html) && /function renderGroupRows\(/.test(html), 'add/read/renderGroupRows 均已定义');
ok(/addGroupRow\('', true\)/.test(html), '★ 新增行默认「允许聊天」');
ok(/groups: rows\b/.test(html) || /groups: rows,/.test(html) || /groups: rows\s*\}/.test(html), '★ 保存时提交的是行数据（不是逗号串）');
ok((html.match(/id="wlGroups"/g) ?? []).length === 1, '★ 旧 ID wlGroups 仍保留（兼容契约）');
const legacyIds = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'console-ui-legacy-ids.json'), 'utf8').replace(/^\uFEFF/, ''));
const idsAll = [...html.matchAll(/\sid="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]);
const missingLegacy = legacyIds.filter((id) => !idsAll.includes(id));
ok(missingLegacy.length === 0, '全部旧 ID 仍在', missingLegacy.length ? `缺失：${missingLegacy.join(', ')}` : `${legacyIds.length} 个`);

console.log('## 语音面板接线');
ok(/id="voiceRefreshBtn"/.test(html) && /getElementById\('voiceRefreshBtn'\)\.addEventListener/.test(html), '刷新按钮已绑定事件');
ok(/getElementById\('voiceSendBtn'\)\.addEventListener/.test(html), '试发按钮已绑定事件');
ok(/api\('\/api\/voice\/list/.test(html), '面板调用 /api/voice/list（操作者通道，无需 key）');
ok(/api\('\/api\/voice\/send'/.test(html), '面板调用 /api/voice/send');
ok(/typeof loadVoiceLibrary === 'function'|async function loadVoiceLibrary/.test(html), 'loadVoiceLibrary 已定义');

console.log('## JS 语法');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const big = scripts.sort((a, b) => b.length - a.length)[0];
try { new Function(big); ok(true, '主 script 语法可解析', `${big.length} 字符`); }
catch (e) { ok(false, '主 script 语法', e.message); }

// 模型切换面板：桥接把 provider/model 写错时**不会报错**（只打日志），
// 所以这个面板是用户唯一能看出「其实跑在别的模型上」的地方，接线必须钉住。
console.log('## 模型切换面板接线');
for (const id of ['dshProviderSelect', 'dshCatalogModelSelect', 'dshModelSave', 'dshModelMsg', 'dshModelNote', 'dshConnectState']) {
  const n = (html.match(new RegExp(`id="${id}"`, 'g')) ?? []).length;
  ok(n === 1, `模型面板元素 ${id}`, `${n} 处`);
}
ok(/getElementById\('dshProviderSelect'\)\.addEventListener/.test(html), '提供方下拉已绑定事件');
ok(/getElementById\('dshCatalogModelSelect'\)\.addEventListener/.test(html), '模型下拉已绑定事件');
ok(/getElementById\('dshModelSave'\)\.addEventListener/.test(html), '切换按钮已绑定事件');
ok(/api\('\/api\/dsh\/model', 'POST'/.test(html), '切换调用 /api/dsh/model（POST）');
ok(/function renderDshCatalogModels/.test(html), 'renderDshCatalogModels 已定义');
ok(/r\.resolved/.test(html), '页面读取 resolved 判定当前模型是否在目录里');

// 好友私聊放行：这是「谁能私聊机器人」唯一的可视化出口——开关在 config.json，
// 但名单是运行时从 OneBot 拉的，页面必须如实呈现，否则用户只能靠翻启动日志猜。
console.log('## 好友私聊放行（页面呈现）');
ok((html.match(/id="friendsState"/g) ?? []).length === 1, 'friendsState 元素');
ok(/s\.friendsEnabled/.test(html), '页面读取 friendsEnabled');
ok(/s\.friendsCount/.test(html), '页面显示 friendsCount');
ok(/s\.botSelfId/.test(html), '页面说明放行的是机器人号的好友（botSelfId）');
ok(/s\.friendsSourceUin/.test(html), '页面显示 sourceUin（放行的另一个号是谁）');
ok(/s\.friendsSource/.test(html), '页面读取名单来源计数');
ok(/未就绪/.test(html), '「那个号还没登录」时页面给出可执行提示');

// 「允许所有人私聊」开关：这是**放宽准入**的按钮，页面必须写明它只影响私聊、
// 且勾选后立刻给出警告——否则用户会在不知情的情况下把私聊对所有人打开。
console.log('## 「允许所有人私聊」开关');
ok((html.match(/id="wlAllowAllPrivate"/g) ?? []).length === 1, '开关元素');
ok(/wlAllowAllPrivate'\)\.addEventListener\('change'/.test(html), 'change 事件已绑定（勾选即显示警告）');
ok(/w\.allowAllPrivate === true/.test(html), 'refreshWhitelist 回读开关状态');
ok(/allowAllPrivate: document\.getElementById\('wlAllowAllPrivate'\)\.checked/.test(html), '保存时提交开关值');
ok((html.match(/id="allowAllPrivateWarn"/g) ?? []).length === 1, '警告条元素');
ok(/status\.allowAllPrivate === true/.test(html), '总览摘要反映「私聊对所有人开放」');
ok(/只影响私聊/.test(html), '页面注明只影响私聊');

// 顶栏「模型来源」快捷切换 + 悬停 API 接入口：把最常用的动作搬到顶栏，
// 并让「怎么再接入一个模型」在界面上可读，不用去翻文档。
console.log('## 顶栏模型来源切换');
for (const id of ['providerSwitch', 'providerCurrent', 'providerToggle', 'phDshUrl', 'phProvider', 'phModel', 'phProviders', 'phSideEffect']) {
  const n = (html.match(new RegExp(`id="${id}"`, 'g')) ?? []).length;
  ok(n === 1, `顶栏元素 ${id}`, `${n} 处`);
}
ok(/getElementById\('providerToggle'\)\.addEventListener\('click', toggleProvider\)/.test(html), '切换按钮已绑定事件');
ok(/async function toggleProvider/.test(html), 'toggleProvider 已定义');
ok(/function refreshProviderSwitch\(r\)/.test(html) && /refreshProviderSwitch\(r\);/.test(html), '顶栏与卡片共用同一份响应（不重复取数）');
ok(/function pickProviderByFamily/.test(html) && /startsWith\('workbuddy'\)/.test(html), '按前缀挑 provider（名字换了也能用）');
ok(/api\('\/api\/dsh\/model', 'POST', \{ provider: target/.test(html), '复用同一个切换接口');
ok(/\.provider-switch:hover \.provider-hover/.test(html) && /:focus-within/.test(html), '悬停与键盘聚焦都能展开面板');

// 配置快照：这是「改错了能退回来」的唯一出口。桥接会在每次保存设置前自动留档，
// 页面必须能把它们列出来、预览、还原——否则快照存在但没人用得上。
console.log('## 配置快照（页面）');
for (const id of ['cfgBakList', 'cfgBakMsg', 'cfgBakRefresh', 'cfgBakPreviewWrap', 'cfgBakPreview', 'cfgBakPreviewName', 'cfgBakRestore', 'cfgBakClose']) {
  const n = (html.match(new RegExp(`id="${id}"`, 'g')) ?? []).length;
  ok(n === 1, `快照元素 ${id}`, `${n} 处`);
}
ok(/getElementById\('cfgBakRestore'\)\.addEventListener/.test(html), '还原按钮已绑定事件');
ok(/getElementById\('cfgBakRefresh'\)\.addEventListener/.test(html), '刷新按钮已绑定事件');
ok(/async function refreshConfigBackups/.test(html) && /async function previewConfigBackup/.test(html), '列表与预览函数已定义');
ok(/data-cfgbak=/.test(html) && /querySelectorAll\('button\[data-cfgbak\]'\)/.test(html), '预览按钮用事件委托（列表重建不泄漏监听器）');
ok(/api\('\/api\/config\/restore', 'POST'/.test(html), '还原调用 /api/config/restore');
ok(/refreshConfigBackups\(\);/.test(html), '已接入页面初始化');

console.log('## 语音图形界面的音量控件');
{
  const voice = fs.readFileSync(path.join(VOICE_TOOL, 'public', 'voice.html'), 'utf8');
  const ids = [...voice.matchAll(/\sid="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]);
  const dups = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
  ok(dups.length === 0, 'voice.html ID 唯一', dups.length ? `重复：${dups.join(', ')}` : `共 ${ids.length} 个`);
  for (const id of ['volRange', 'volLabel', 'volReset', 'normBox', 'loudnessSel', 'previewBtn']) {
    ok(ids.includes(id), `音量控件 ${id}`);
  }
  ok(/id="volRange"[^>]*min="10"[^>]*max="400"/.test(voice), '滑块范围 10%~400%');
  ok(/volRange'\)\.addEventListener\('input'/.test(voice), '滑块 input 事件已绑定');
  ok(/previewBtn'\)\.addEventListener/.test(voice), '试听按钮已绑定');
  ok(/api\/preview/.test(voice), '试听调 /api/preview（听处理后的效果）');
  ok(/body\.normalize = true/.test(voice) && /body\.volume = volValue\(\)/.test(voice), '发送时带上音量设置');
  const scripts = [...voice.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  try { new Function(scripts[0]); ok(true, 'voice.html 前端 JS 可解析'); }
  catch (e) { ok(false, 'voice.html 前端 JS 可解析', e.message); }
}

console.log('## fixture mock 覆盖');
const fixture = fs.readFileSync(path.join(ROOT, 'scripts', 'console-ui-fixture.mjs'), 'utf8');
ok(fixture.includes("case '/api/socialV2/voices'"), 'fixture mock 了 /api/socialV2/voices');
ok(fixture.includes("case '/api/voice/send'"), 'fixture mock 了 /api/voice/send');
ok(/case '\/api\/dsh\/model'/.test(fixture) && /dshCatalog/.test(fixture), 'fixture mock 了 /api/dsh/model 与 dshCatalog');

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`);
if (bad > 0) process.exit(1);
