'use strict';
/**
 * proxy.js — 反向代理 + HTML 注入
 *  - 根据目标端口转发请求（支持 WebSocket Upgrade）
 *  - 对 text/html 响应注入 Alt+U 切换器（脚本来自 public/inject.js）
 */
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');

const INJECT_FILE = path.join(__dirname, '..', 'public', 'inject.js');
const MAX_INJECT_BODY = 4 * 1024 * 1024; // 4MB 内的 HTML 才做注入

let injectScript = null;
function getInjectScript() {
  if (injectScript === null) {
    try {
      injectScript = fs.readFileSync(INJECT_FILE, 'utf8');
    } catch (e) {
      injectScript = '';
    }
  }
  return injectScript;
}

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'proxy-connection'
]);

function cleanHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    if (k.toLowerCase() === 'host') continue; // Host 统一重写
    out[k] = v;
  }
  return out;
}

function buildInjectHtml(port) {
  const script = getInjectScript();
  return (
    '<!--PILALTU-SWITCHER--><script>window.PILALTU_ROUTE_PORT=' +
    Number(port) + ';</script><script>' + script + '</script><!--/PILALTU-SWITCHER-->'
  );
}

/**
 * 注入响应处理：缓存 html body → 注入脚本 → 重写 content-length
 */
function handleResponse(upRes, res, injectHtml) {
  const headers = { ...upRes.headers };
  const ct = String(headers['content-type'] || '');
  const ce = headers['content-encoding'];
  const cl = Number(headers['content-length'] || 0);
  const injectable = /text\/html/i.test(ct) && !ce && cl <= MAX_INJECT_BODY;

  if (!injectable) {
    // 直接透传
    res.writeHead(upRes.statusCode || 502, headers);
    upRes.pipe(res);
    return;
  }

  // 缓存 body（也可能没有 content-length，chunked 同样缓存，超限则改透传）
  const chunks = [];
  let size = 0;
  let streamed = false;
  upRes.on('data', (c) => {
    if (streamed) return;
    size += c.length;
    if (size > MAX_INJECT_BODY) {
      streamed = true;
      // 放弃缓存，改为透传（此前缓存的数据已不可回放，直接 502 风险；改走透传）
      upRes.removeAllListeners('data');
      res.writeHead(upRes.statusCode || 502, headers);
      res.end();
      return;
    }
    chunks.push(c);
  });
  upRes.on('end', () => {
    if (streamed) return;
    let body = Buffer.concat(chunks).toString('utf8');
    const m = body.match(/<\/body\s*>/i);
    if (m) {
      body = body.slice(0, m.index) + injectHtml + body.slice(m.index);
    } else {
      body += injectHtml;
    }
    delete headers['content-length'];
    delete headers['transfer-encoding'];
    headers['content-length'] = Buffer.byteLength(body);
    res.writeHead(upRes.statusCode || 502, headers);
    res.end(body);
  });
  upRes.on('error', () => {
    if (!streamed) {
      res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' });
      res.end(errorPage());
    }
  });
}

function errorPage() {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>服务不可达</title><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;background:#fafafa;color:#111;min-height:100vh;display:flex;align-items:center;justify-content:center}
.card{background:#fff;border:1px solid #e6e6e6;border-radius:24px;padding:48px 56px;text-align:center;max-width:420px}
.badge{display:inline-block;background:#111;color:#fff;border-radius:999px;padding:6px 18px;font-size:13px;letter-spacing:.12em;margin-bottom:24px}
h1{font-size:20px;font-weight:600;margin-bottom:10px}
p{color:#777;font-size:14px;line-height:1.7;margin-bottom:28px}
a.btn{display:inline-block;background:#111;color:#fff;text-decoration:none;border-radius:999px;padding:10px 28px;font-size:14px}
a.btn:hover{background:#333}
</style></head><body><div class="card">
<div class="badge">PILALTU</div>
<h1>目标服务不可达</h1>
<p>所选端口的服务未响应，可能已停止。<br>按 Alt+U 或前往路由器选择其他服务。</p>
<a class="btn" href="/pilaltu/">打开服务选择</a>
</div></body></html>`;
}

/**
 * 创建代理处理器
 * @param {Function} getTarget (req) => { port } | null    null 表示未配置 → 跳选择页
 */
function createProxyHandler(getTarget) {
  return function proxyHandler(req, res) {
    const target = getTarget(req);
    if (!target) {
      res.writeHead(302, { Location: '/pilaltu/' });
      res.end();
      return;
    }
    const port = Number(target.port);
    const isUpgrade = /upgrade/i.test(req.headers.upgrade || '');
    const injectHtml = buildInjectHtml(port);

    // WebSocket / Upgrade 转发
    if (isUpgrade) {
      const upReq = http.request({
        host: '127.0.0.1',
        port,
        path: req.url,
        method: req.method,
        headers: cleanHeaders(req.headers),
        agent: false
      });
      upReq.on('error', () => {
        res.writeHead(503, { 'content-type': 'text/html; charset=utf-8' });
        res.end(errorPage());
      });
      upReq.on('upgrade', (upRes, socket, head) => {
        res.writeHead(101, {
          Upgrade: upRes.headers.upgrade,
          Connection: upRes.headers.connection,
          'Sec-WebSocket-Accept': upRes.headers['sec-websocket-accept']
        });
        socket.write(head);
        socket.pipe(res).pipe(socket);
      });
      req.pipe(upReq);
      return;
    }

    // 普通请求
    const upReq = http.request({
      host: '127.0.0.1',
      port,
      path: req.url,
      method: req.method,
      headers: cleanHeaders(req.headers),
      agent: false
    });

    upReq.on('error', () => {
      res.writeHead(503, { 'content-type': 'text/html; charset=utf-8' });
      res.end(errorPage());
    });

    upReq.on('response', (upRes) => {
      handleResponse(upRes, res, injectHtml);
    });

    req.pipe(upReq);
  };
}

module.exports = { createProxyHandler, errorPage };
