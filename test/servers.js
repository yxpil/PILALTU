'use strict';
/* 测试用：在 8080/8081/8082 起三个不同标题的服务 */
const http = require('http');

const SERVICES = [
  { port: 8080, name: 'Alpha 应用', color: '#1a73e8', body: '这是 Alpha 应用首页' },
  { port: 8081, name: 'Beta 控制台', color: '#b45309', body: '这是 Beta 控制台首页' },
  { port: 8082, name: 'Gamma 面板', color: '#0f766e', body: '这是 Gamma 面板首页' }
];

SERVICES.forEach(s => {
  http.createServer((req, res) => {
    if (req.url === '/api/info') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ service: s.name, port: s.port }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>${s.name} · :${s.port}</title>
<style>body{font-family:sans-serif;background:#f4f4f4;padding:60px}
.card{background:#fff;border-radius:16px;padding:40px;max-width:520px}
h1{color:${s.color}}</style></head><body>
<div class="card"><h1>${s.name}</h1>
<p>${s.body}</p>
<p>端口 :${s.port}</p>
</div></body></html>`);
  }).listen(s.port, '127.0.0.1', () => {
    console.log(`[TEST] :${s.port} -> ${s.name}`);
  });
});
