/**
 * WorldFirst AI 资金助手 — 本地 Demo 服务器
 *
 * 一个进程同时承担：
 * 1. 静态文件托管（index.html / exchange.html / styles.css / app.js）
 * 2. /api/chat 转发到 DeepSeek（避免前端裸奔 API key）
 *
 * 启动：node server.js
 * 访问：http://localhost:5173/
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

const PORT = process.env.PORT || 5173;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
if (!DEEPSEEK_API_KEY) {
  console.warn('[warn] DEEPSEEK_API_KEY not set — /api/chat 将走 fallback');
}
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function safeJoin(root, urlPath) {
  let p = urlPath.split('?')[0].split('#')[0];
  if (p === '/' || p === '') p = '/index.html';
  const resolved = path.normalize(path.join(root, p));
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

function serveStatic(req, res) {
  const filePath = safeJoin(ROOT, req.url);
  if (!filePath) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not Found: ' + req.url);
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', c => { buf += c; });
    req.on('end', () => {
      try { resolve(JSON.parse(buf || '{}')); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function buildSystemPrompt(ctx) {
  return `你是「万里汇 WorldFirst」后台中的「AI 资金助手」，正在帮一位中国跨境电商商家做换汇决策。

【关于商家】
${ctx.用户画像 || '中国跨境电商卖家，多平台经营'}

【当前情境】
- 用户正在「货币兑换」页准备：${ctx.金额 || '一笔大额结汇'}
- 系统识别用途：${ctx.场景}
- 给出的建议方向：${ctx.建议}
- 给出建议时的依据：${ctx.依据摘要 || ''}

【你的回答必须遵守的红线（很重要）】
1. 不预测未来汇率走势，不说"将上涨/下跌""未来 X 天"。涉及行情时只能说"当前处于近 30 天 XX 区间，仅作背景参考"。
2. 不替用户决策，不替用户执行。涉及具体行动时回答"你可以考虑..."而不是"你应该..."。
3. 不计算精确收益数字。涉及成本只能说"按当前费率估算可减少路径成本"，不说"多赚 XX 元"。
4. 涉及税务、合规判断的边界问题，明确回答"建议联系客户经理"。
5. 用中文回答。语气专业、克制、像一位资深 CFO 顾问，不夸张、不卖货。
6. 回答要简洁，控制在 100-200 字左右。可以分点，但不要长篇大论。
7. 引用具体数字时只引用上文已经给出的数字，不编造新的数字。

【WorldFirst 内部产品备忘（必要时可以引导用户去用）】
- 货币兑换（即时兑换）
- 安心兑（远期锁汇，适合有明确未来换汇需求 + 想锁定成本）
- 万余盈（活期理财，适合短期闲置资金）
- 极速融（短期信贷，适合现金缺口）
- 万里付信用卡（多币种消费，适合避免再次换汇）
- 店铺管理-额度管理（结汇额度与凭证管理）

记住：你是顾问，不是销售。只有在用户的情境真的匹配时才提到上述产品。`;
}

function callDeepSeek(messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages,
      max_tokens: 400,
      temperature: 0.5,
    });
    const req = https.request({
      hostname: 'api.deepseek.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + DEEPSEEK_API_KEY,
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 25000,
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          const reply = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
          if (!reply) return reject(new Error('no reply: ' + data.slice(0,200)));
          resolve(reply.trim());
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function handleChat(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405); return res.end();
  }
  let payload;
  try { payload = await readJsonBody(req); }
  catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'invalid json' }));
  }
  const { context, message, history } = payload;
  if (!message) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'missing message' }));
  }

  const messages = [
    { role: 'system', content: buildSystemPrompt(context || {}) },
    ...((history || []).slice(-6)),
    { role: 'user', content: message },
  ];

  if (!DEEPSEEK_API_KEY) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'DEEPSEEK_API_KEY not configured' }));
  }

  try {
    const reply = await callDeepSeek(messages);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ reply }));
  } catch (e) {
    console.error('[chat] error:', e.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message || 'unknown' }));
  }
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/chat')) {
    return handleChat(req, res);
  }
  return serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`\n  万里汇 AI 资金助手 Demo`);
  console.log(`  ───────────────────────────────`);
  console.log(`  访问：  http://localhost:${PORT}/`);
  console.log(`  兑换页：http://localhost:${PORT}/exchange.html`);
  console.log(`  API：   /api/chat  (DeepSeek model: ${DEEPSEEK_MODEL})\n`);
});
