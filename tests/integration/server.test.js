'use strict';
/**
 * 端到端集成测试 —— 真实启动 node server/index.js，走完整 HTTP 服务。
 * 覆盖：面板静态页、登录/会话鉴权、未登录 401、错误密码 401。
 * 注入测试：
 *  - 路径穿越 /pilaltu/../../server/store.js 不得泄露服务端源码；
 *  - 含 <img onerror> 的恶意用户名存入后以 application/json 原样返回（JSON 转义安全，不被当 HTML 执行）。
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');
const SERVER = path.join(REPO, 'server', 'index.js');

function getFreePort() {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

function req(port, { method = 'GET', path = '/', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const r = http.request({ host: '127.0.0.1', port, path, method, headers: { ...headers, ...(data ? { 'content-length': Buffer.byteLength(data) } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function startServer() {
  const port = await getFreePort();
  const child = spawn(process.execPath, [SERVER, String(port)], { cwd: REPO, env: { ...process.env } });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server boot timeout')), 15000);
    child.stdout.on('data', (d) => {
      if (d.toString().includes('入口地址')) { clearTimeout(timer); resolve(); }
    });
    child.stderr.on('data', () => {});
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error('server exited code=' + code)); });
  });
  return { child, port };
}

test('端到端：面板可达、登录鉴权、路径穿越不泄露源码、XSS 用户名安全返回', async (t) => {
  let srv;
  try {
    srv = await startServer();
  } catch (e) {
    t.diagnostic('启动失败: ' + e.message);
    throw e;
  }
  const { port, child } = srv;

  try {
    // 面板静态页
    const panel = await req(port, { path: '/pilaltu/' });
    assert.strictEqual(panel.status, 200);
    assert.match(panel.body, /<html/i);

    // 未登录访问受保护 API → 401
    const meGuest = await req(port, { path: '/pilaltu/api/me' });
    assert.strictEqual(meGuest.status, 401);

    // 错误密码 → 401
    const bad = await req(port, { method: 'POST', path: '/pilaltu/api/login', headers: { 'content-type': 'application/json' }, body: { username: 'admin', password: 'WRONG' } });
    assert.strictEqual(bad.status, 401);

    // 正确登录 → 200 + set-cookie
    const ok = await req(port, { method: 'POST', path: '/pilaltu/api/login', headers: { 'content-type': 'application/json' }, body: { username: 'admin', password: 'admin123' } });
    assert.strictEqual(ok.status, 200);
    const setCookie = ok.headers['set-cookie'][0];
    const session = setCookie.split(';')[0];
    assert.match(session, /^pilaltu_session=/);

    // 带 cookie 访问 /api/me → 200
    const me = await req(port, { path: '/pilaltu/api/me', headers: { cookie: session } });
    assert.strictEqual(me.status, 200);
    assert.strictEqual(JSON.parse(me.body).user.username, 'admin');

    // 注入：路径穿越读取服务端源码 → 不得泄露
    const trav = await req(port, { path: '/pilaltu/%2e%2e/%2e%2e/server/store.js' });
    assert.ok(!trav.body.includes('module.exports'), '路径穿越不得泄露 server/store.js 源码');
    assert.ok(!trav.body.includes('scryptSync'), '不得泄露内部实现');

    // 注入：恶意用户名以 application/json 返回，JSON 安全转义而非 HTML 执行
    const xssName = '<img src=x onerror=alert(1)>';
    await req(port, { method: 'POST', path: '/pilaltu/api/users', headers: { 'content-type': 'application/json', cookie: session }, body: { username: xssName, password: 'pw12345', role: 'user' } });
    const list = await req(port, { path: '/pilaltu/api/users', headers: { cookie: session } });
    assert.strictEqual(list.status, 200);
    assert.match(list.headers['content-type'], /application\/json/);
    const users = JSON.parse(list.body).users;
    const found = users.find(u => u.username === xssName);
    assert.ok(found, '恶意用户名应作为普通 JSON 字符串回显，且 JSON 可正常解析');
  } finally {
    child.kill();
  }
});
