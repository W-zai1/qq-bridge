// workbuddy-probe.mjs — 读出本机 DSH 真实的 provider / 模型目录，并可对目标模型发一次真实调用。
//
// 为什么需要它：桥接的 config.json 只是「把 provider/model 下发给 DSH」，它自己**不校验**
// 这个名字到底存不存在（选择失败只打日志）。而 WorkBuddy 系插件按「该区域有没有登录账号」
// 决定要不要把模型列进目录——名字写错或账号没登录时，桥接侧只会看到模型静默退回默认值。
// 所以换 provider 前后各跑一次这个探针，是唯一能证明「真的切过去了」的办法。
//
// 用法：
//   node scripts/workbuddy-probe.mjs            # 只列目录 + 判定目标是否存在
//   node scripts/workbuddy-probe.mjs --call     # 额外新建会话，对目标模型发一次真实调用
//   WB_PROVIDER=workbuddy WB_MODEL='GLM-5.3 · x0.79' node scripts/workbuddy-probe.mjs --call
//
// 目标 provider/model 默认取 config.json 的 dsh.provider / dsh.model。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeApiClient, unwrap } from '../src/dsh-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
  } catch {
    return {};
  }
}

const cfg = readConfig();
const BASE_URL = process.env.DSH_BASE_URL || cfg.dsh?.baseUrl || 'http://127.0.0.1:3080';
const WANT_PROVIDER = process.env.WB_PROVIDER || String(cfg.dsh?.provider ?? '');
const WANT_MODEL = process.env.WB_MODEL || String(cfg.dsh?.model ?? '');
const WANT_EFFORT = process.env.WB_EFFORT || String(cfg.dsh?.reasoningEffort ?? '');
const DO_CALL = process.argv.includes('--call');
// WB_IMAGE=<本地图片路径> 时改用「看图」prompt：这是 QQ 场景的关键能力（群友发图），
// 必须实测——上游声明的 supportsImages 不等于模型真能看图。
const IMAGE_PATH = process.env.WB_IMAGE || '';

const api = new NodeApiClient(BASE_URL, undefined, {
  token: cfg.dsh?.authToken,
  tokenExplicit: cfg.dsh?.authTokenExplicit === true,
  header: cfg.dsh?.authHeader,
  prefix: cfg.dsh?.authPrefix,
  allowRemote: cfg.dsh?.allowRemote === true
});

function fail(message) {
  console.error(`\n❌ ${message}`);
  process.exit(1);
}

console.log(`DSH: ${BASE_URL}`);
console.log(`目标: ${WANT_PROVIDER || '(未指定)'} / ${WANT_MODEL || '(未指定)'}${WANT_EFFORT ? ` / ${WANT_EFFORT}` : ''}\n`);

// ── 1. 模型目录 ─────────────────────────────────────────────────────────────
let catalog;
try {
  catalog = unwrap(await api.callUnary('session.modelCatalog', {}), 'session.modelCatalog');
} catch (error) {
  fail(`读取模型目录失败：${error?.message ?? error}`);
}

const groups = catalog?.groups ?? [];
if (!groups.length) fail('模型目录里一个 provider 都没有（DSH 未就绪，或鉴权失败）');

console.log('可用 provider 与模型：');
for (const g of groups) {
  const models = g?.models ?? [];
  console.log(`  · ${g?.id ?? '(无 id)'}  (${models.length} 个模型)${g?.id === WANT_PROVIDER ? '   ← 目标 provider' : ''}`);
  for (const m of models) {
    const efforts = (m?.reasoning?.efforts ?? []).map((e) => e?.id).filter(Boolean);
    const hit = g?.id === WANT_PROVIDER && m?.id === WANT_MODEL ? '   ← 目标模型' : '';
    console.log(`      - ${m?.id}${m?.name && m.name !== m.id ? `  「${m.name}」` : ''}${efforts.length ? `  effort: ${efforts.join('/')}` : ''}${hit}`);
  }
}

// ── 2. 判定目标是否真的存在 ──────────────────────────────────────────────────
const wbGroups = groups.filter((g) => String(g?.id ?? '').startsWith('workbuddy'));
console.log(`\nWorkBuddy 相关 provider：${wbGroups.length ? wbGroups.map((g) => g.id).join(', ') : '（无）'}`);

const target = groups.find((g) => g?.id === WANT_PROVIDER);
const targetModel = target ? (target.models ?? []).find((m) => m?.id === WANT_MODEL) : null;
const verdict = target ? (targetModel ? 'found' : 'model-missing') : 'provider-missing';
if (verdict === 'found') console.log(`\n✅ 目标模型在目录里：${WANT_PROVIDER} / ${WANT_MODEL}`);
else if (verdict === 'model-missing') console.log(`\n❌ provider「${WANT_PROVIDER}」存在，但没有模型「${WANT_MODEL}」（照上面的清单改名）`);
else console.log(`\n❌ 目录里没有 provider「${WANT_PROVIDER}」`);

if (!DO_CALL) {
  console.log('\n（加 --call 可对目标模型发一次真实调用）');
  process.exit(verdict === 'found' ? 0 : 1);
}
if (verdict !== 'found') fail('目标模型不存在，跳过真实调用');

// ── 3. 真实调用一次（新建独立会话，用完归档）───────────────────────────────────
// 事件流用 async iterator 消费（与桥接同一条 remote.mux 通道）。
const dir = path.join(ROOT, 'state', 'workbuddy-probe');
fs.mkdirSync(dir, { recursive: true });
const ws = unwrap(await api.workspace.create({ path: dir }), 'workspace.create');
const workspaceId = ws?.workspace?.workspaceId;

const created = unwrap(await api.sessions.create({
  workspaceId,
  agentPreset: cfg.agentPreset || 'qq-chat'
}), 'session.create');
const sessionId = created?.sessionId ?? created?.value?.sessionId;
console.log(`\n探针会话 ${sessionId}`);

// 先把事件流挂上，再 selectModel —— 后者会产生一条非 turn 的 model/selection 事件，
// 正好用来确认「这条 mux 通道此刻真的在推事件」（而不是只顾着等 prompt 的回合）。
const abort = new AbortController();
let text = '';
let problem = '';
let sawTurnEnd = false;
let frames = 0;
const seen = new Map();
const timer = setTimeout(() => abort.abort(), 180_000);
api.events.follow(sessionId);
const pump = (async () => {
  const stream = api.openRemoteEventStream(abort.signal, () => {});
  try {
    for await (const envelope of stream) {
      const payload = envelope?.payload ?? envelope ?? null;
      if (!payload) continue;
      frames += 1;
      const kind = `${payload.type ?? '?'}${payload.event?.type ? `:${payload.event.type}` : ''}`;
      seen.set(kind, (seen.get(kind) ?? 0) + 1);
      if (payload.sessionId !== sessionId) continue;
      if (payload.type !== 'session/event') continue;
      const event = payload.event;
      if (!event) continue;
      if (event.type === 'assistant/message') {
        for (const block of event.data?.message?.content ?? []) if (block?.type === 'text') text += block.text;
      }
      if (event.type === 'turn/end') { sawTurnEnd = true; return 'turn/end'; }
      if (event.type === 'turn/error' || event.type === 'error') problem += JSON.stringify(event.data ?? {}).slice(0, 300);
    }
    return 'stream-closed';
  } catch (error) {
    if (abort.signal.aborted) return 'timeout';
    return `stream-error: ${error?.message ?? error}`;
  }
})();

// 给 mux 一点时间连上：连不上就白等（实测 500ms 不够，回合在 socket open 之前就跑完了，
// 事件全丢，表现为「无输出的 stream-closed」）。
await new Promise((r) => setTimeout(r, 3000));

const selected = unwrap(await api.sessions.selectModel({
  sessionId,
  provider: WANT_PROVIDER,
  model: WANT_MODEL,
  ...(WANT_EFFORT ? { reasoningEffort: WANT_EFFORT } : {})
}), 'session.selectModel');
console.log(`selectModel -> ${selected?.selected?.provider}/${selected?.selected?.model} (${selected?.selected?.reasoningEffort ?? '默认'})`);
await new Promise((r) => setTimeout(r, 4000));
console.log(`事件流预热: 已收到 ${frames} 帧 ${[...seen.entries()].map(([k, v]) => `${k}×${v}`).join(', ') || '（尚无帧）'}`);

// 用门面方法（它自己会做 wrapArgs 与 requestId 补全）；直接 callUnary('session/prompt', {request:…})
// 会被再包一层 → gateway/input-invalid（实测踩过）。
const content = [{ type: 'text', text: IMAGE_PATH ? '这张图里是什么颜色？只回答颜色两个字。' : '只回复四个字：连通正常' }];
if (IMAGE_PATH) {
  const buffer = fs.readFileSync(IMAGE_PATH);
  content.push({
    type: 'image',
    mediaType: /\.png$/i.test(IMAGE_PATH) ? 'image/png' : 'image/jpeg',
    data: buffer.toString('base64'),
    name: path.basename(IMAGE_PATH)
  });
  console.log(`附图: ${IMAGE_PATH}（${buffer.length} 字节）`);
}
const accepted = await api.sessions.prompt({ sessionId, mode: 'queue', content });
console.log(`prompt 已投递: ${JSON.stringify(accepted?.result ?? accepted).slice(0, 160)}`);

const why = await pump;
clearTimeout(timer);
console.log(`\n结果: ${why}（收到 ${frames} 帧）`);
console.log(`帧类型: ${[...seen.entries()].map(([k, v]) => `${k}×${v}`).join(', ') || '（无）'}`);
console.log(`模型输出: ${JSON.stringify(text.slice(0, 200))}`);
if (problem) console.log(`错误: ${problem}`);

try { api.events.forget(sessionId); } catch {}
try { await api.workspace.archiveSession({ sessionId }); } catch {}
console.log('[cleanup] 探针会话已归档');

const ok = sawTurnEnd && text.trim().length > 0;
console.log(ok ? '\n✅ WorkBuddy 模型真实调用成功' : '\n❌ WorkBuddy 模型调用未成功');
process.exit(ok ? 0 : 1);
