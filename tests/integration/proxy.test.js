'use strict';
/**
 * proxy.js 集成测试 —— 真实起上游 HTTP 服务 + 前端代理服务，走完整 HTTP 回路。
 * 覆盖：HTML 注入切换器、非 HTML 透传、无目标 302、后端不可达 503。
 * 注入测试：
 *  - 上游 HTML 中夹带 <script> XSS 载荷时，代理仅在 </body> 前插入切换器，
 *    切换器端口恒为数字（Number(port)），不回显外部输入。
 *  - getTarget 返回 null 时固定 302 到 /pilaltu/，Location 不反射请求输入（无开放重定向）。
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { createProxyHandler } = require('../../server/proxy');

function getFreePort() {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

function listenOn(handler) {
  return getFreePort().then((port) => new Promise((res) => {
    const s = http.createServer(handler);
    s.listen(port, '127.0.0.1', () => res({ server: s, port }));
  }));
}

function request(port, path, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET', headers: headers || {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('主路径：text/html 在 </body> 前注入切换器，端口写死为上游端口号', async () => {
  const up = await listenOn((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<html><body><p>hi</p></body></html>');
  });
  const front = await listenOn(createProxyHandler(() => ({ port: up.port })));
  try {
    const { status, headers, body } = await request(front.port, '/');
    assert.strictEqual(status, 200);
    assert.match(body, /<!--PILALTU-SWITCHER-->/);
    assert.match(body, new RegExp('window\\.PILALTU_ROUTE_PORT=' + up.port));
    assert.strictEqual(headers['content-type'].split(';')[0], 'text/html');
  } finally { up.server.close(); front.server.close(); }
});

test('注入：上游页面夹带 <script> XSS 载荷，切换器位置正确且端口恒为数字', async () => {
  const xss = "<script>alert('xss')</script>";
  const up = await listenOn((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<html><body>${xss}<p>after</p></body></html>`);
  });
  const front = await listenOn(createProxyHandler(() => ({ port: up.port })));
  try {
    const { body } = await request(front.port, '/');
    assert.ok(body.includes(xss), '上游 body 应被透传');
    const switcherIdx = body.indexOf('<!--PILALTU-SWITCHER-->');
    const bodyClose = body.toLowerCase().indexOf('</body>');
    assert.ok(switcherIdx > -1 && switcherIdx < bodyClose, '切换器应位于 </body> 之前');
    assert.match(body, new RegExp('PILALTU_ROUTE_PORT=' + up.port + ';'));
  } finally { up.server.close(); front.server.close(); }
});

test('非 HTML（JSON）响应透传，不注入切换器', async () => {
  const up = await listenOn((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  const front = await listenOn(createProxyHandler(() => ({ port: up.port })));
  try {
    const { body } = await request(front.port, '/');
    assert.strictEqual(body, '{"ok":true}');
    assert.ok(!body.includes('PILALTU-SWITCHER'));
  } finally { up.server.close(); front.server.close(); }
});

test('注入：无目标时固定 302 到 /pilaltu/，不反射请求（无开放重定向）', async () => {
  const front = await listenOn(createProxyHandler(() => null));
  try {
    const { status, headers } = await request(front.port, '//evil.example.com/path');
    assert.strictEqual(status, 302);
    assert.strictEqual(headers.location, '/pilaltu/', 'Location 必须固定，不反射请求输入');
  } finally { front.server.close(); }
});

test('后端不可达 → 503 错误页', async () => {
  const front = await listenOn(createProxyHandler(() => ({ port: 59991 })));
  try {
    const { status, body } = await request(front.port, '/');
    assert.strictEqual(status, 503);
    assert.match(body, /服务不可达/);
  } finally { front.server.close(); }
});
