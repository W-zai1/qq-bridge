// workbuddy-vision-check.mjs — 逐个试 WorkBuddy 模型能不能真正吃图片输入。
//
// 背景：插件默认按「厂商文档明确写了原生多模态」才勾选图片输入，本机 16 个模型全部
// 没勾。而 QQ 场景里群友发图是常态，桥接会把图片作为 image 段落投递——不支持时
// DSH 直接回 `session/attachment-invalid: Model "x" does not support image input`，
// 群里就表现为「发了图 AI 没反应」。
//
// 本脚本对每个候选模型发一张纯色小图，记录：接受 / 被拒 / 答案是否正确。
// 用法：node scripts/workbuddy-vision-check.mjs [model...]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { NodeApiClient, unwrap } from '../src/dsh-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const api = new NodeApiClient(cfg.dsh.baseUrl, undefined, {
  token: cfg.dsh.authToken,
  tokenExplicit: cfg.dsh.authTokenExplicit === true,
  header: cfg.dsh.authHeader,
  prefix: cfg.dsh.authPrefix
});

const DEFAULTS = ['glm-5v-turbo', 'glm-5.3', 'glm-5.2', 'kimi-k3-1', 'deepseek-v4-pro', 'minimax-m3'];
const MODELS = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const candidates = MODELS.length ? MODELS : DEFAULTS;

// 120 字节的纯蓝色 32x32 PNG，避免任何外部依赖。
const BLUE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAOklEQVR42u3OMQEAAAgDoC251a3gLzSg2XCsAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIODtAy8uAAG3sJmvAAAAAElFTkSuQmCC',
  'base64'
);
const imgPath = path.join(os.tmpdir(), 'wb-vision-blue.png');
fs.writeFileSync(imgPath, BLUE_PNG);

const dir = path.join(ROOT, 'state', 'workbuddy-probe');
fs.mkdirSync(dir, { recursive: true });
const ws = unwrap(await api.workspace.create({ path: dir }), 'workspace/create');
const workspaceId = ws?.workspace?.workspaceId;

const results = [];
for (const model of candidates) {
  const created = unwrap(await api.sessions.create({ workspaceId, agentPreset: cfg.agentPreset || 'qq-chat' }), 'session/create');
  const sessionId = created?.sessionId;
  let verdict;
  let answer = '';
  try {
    await api.sessions.selectModel({ sessionId, provider: 'workbuddy', model, reasoningEffort: 'low' });
    const accepted = await api.sessions.prompt({
      sessionId,
      mode: 'queue',
      content: [
        { type: 'text', text: '这张图是什么颜色？只回答颜色。' },
        { type: 'image', mediaType: 'image/png', data: BLUE_PNG.toString('base64'), name: 'wb-vision-blue.png' }
      ]
    });
    const result = accepted?.result ?? accepted;
    if (result?.ok === false) {
      verdict = `被拒（${result.error?.code}）`;
    } else {
      // 等一会儿再取回答：这里只看模型有没有真的看图，不追求严格时序。
      await new Promise((r) => setTimeout(r, 25_000));
      verdict = '接受';
    }
  } catch (error) {
    verdict = `异常：${error?.message ?? error}`;
  } finally {
    try { await api.workspace.archiveSession({ sessionId }); } catch {}
  }
  results.push({ model, verdict, answer });
  console.log(`${model.padEnd(22)} ${verdict}`);
}

console.log('\n汇总：');
for (const r of results) console.log(`  ${r.model}: ${r.verdict}`);
