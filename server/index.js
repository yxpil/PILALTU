'use strict';
/**
 * PILALTU — 多端口服务聚合路由器
 * 启动：node server/index.js  （默认端口 3000，可传参：node server/index.js 3100）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const store = require('./store');
const auth = require('./auth');
const { scanAll } = require('./scanner');
const { createProxyHandler } = require('./proxy');

const PORT_ARG = Number(process.argv[2]) || 0;

// ---------------- 全局状态 ----------------
let scanState = {
  running: false,
  progress: { done: 0, total: 0, found: 0 },
  results: [],          // 最近一次扫描结果 [{port, service, type, title, server}]
  startedAt: null
};

// ---------------- 配置 ----------------
const config = store.load();
const ROUTER_PORT = PORT_ARG || Number(config.routerPort) || 3000;
if (config.excludePorts.indexOf(ROUTER_PORT) === -1) {
  config.excludePorts.push(ROUTER_PORT);
}

// ---------------- 服务列表合并 ----------------
function mergedServices() {
  const meta = new Map((config.services || []).map(s => [s.port, s]));
  const known = new Set();
  const out = scanState.results.map(r => {
    known.add(r.port);
    const m = meta.get(r.port);
    return {
      port: r.port,
      service: (m && m.name) || r.service || '未知服务',
      type: r.type || 'unknown',
      title: r.title || null,
      note: (m && m.note) || '',
      online: true
    };
  });
  // 配置里手写但扫描未发现的服务（可能离线）
  for (const m of meta.values()) {
    if (!known.has(m.port)) {
      out.push({
        port: m.port,
        service: m.name || `端口 ${m.port}`,
        type: 'unknown',
        title: null,
        note: m.note || '',
        online: false
      });
    }
  }
  out.sort((a, b) => a.port - b.port);
  return out;
}

// ---------------- 扫描 ----------------
async function runScan() {
  if (scanState.running) return;
  scanState.running = true;
  scanState.startedAt = new Date().toISOString();
  scanState.results = [];
  console.log('[PILALTU] 开始全端口扫描...');
  try {
    const results = await scanAll({
      excludePorts: config.excludePorts,
      onProgress: (p) => { scanState.progress = p; }
    });
    scanState.results = results;
    console.log(`[PILALTU] 扫描完成：发现 ${results.length} 个 HTTP 服务`);
    for (const r of results.slice(0, 30)) {
      console.log(`  :${r.port}  ${r.service || '(未识别)'}${r.title ? ' — ' + r.title : ''}`);
    }
    if (results.length > 30) console.log(`  ... 其余 ${results.length - 30} 个端口`);
  } catch (e) {
    console.error('[PILALTU] 扫描出错:', e.message);
  } finally {
    scanState.running = false;
  }
}

// ---------------- 工具 ----------------
function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e6) { resolve(null); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function publicUser(u) {
  return { username: u.username, role: u.role };
}

// ---------------- 静态资源 ----------------
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const staticCache = new Map();
function serveStatic(req, res, filePath) {
  const p = path.join(PUBLIC_DIR, filePath);
  if (!p.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end(); return;
  }
  let data = staticCache.get(p);
  if (!data) {
    try {
      data = fs.readFileSync(p);
      staticCache.set(p, data);
    } catch {
      res.writeHead(404); res.end('Not Found'); return;
    }
  }
  const ext = path.extname(p).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml'
  };
  res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream' });
  res.end(data);
}

// ---------------- 面板 + API 路由 ----------------
function route(req, res, url) {
  const u = new URL(url, 'http://localhost');
  const pathname = u.pathname;
  const user = auth.getUser(req);
  const cookies = auth.parseCookies(req.headers.cookie);

  // ---- 面板页面 ----
  if (pathname === '/pilaltu/' || pathname === '/pilaltu') {
    serveStatic(req, res, 'index.html');
    return;
  }
  if (pathname === '/pilaltu/style.css') { serveStatic(req, res, 'style.css'); return; }
  if (pathname === '/pilaltu/app.js') { serveStatic(req, res, 'app.js'); return; }

  // ---- API ----
  if (pathname === '/pilaltu/api/login' && req.method === 'POST') {
    readBody(req).then((b) => {
      const r = auth.login(store, b.username, b.password);
      if (!r.ok) { json(res, 401, { ok: false, reason: r.reason }); return; }
      res.setHeader('set-cookie', auth.sessionCookie(r.token));
      json(res, 200, { ok: true, user: r.user });
    });
    return;
  }

  if (pathname === '/pilaltu/api/logout' && req.method === 'POST') {
    auth.logout(cookies.pilaltu_session);
    res.setHeader('set-cookie', auth.clearSessionCookie());
    json(res, 200, { ok: true });
    return;
  }

  if (pathname === '/pilaltu/api/me') {
    if (!user) { json(res, 401, { ok: false, reason: '未登录' }); return; }
    json(res, 200, { ok: true, user: publicUser(user) });
    return;
  }

  // ---- 以下 API 需要登录 ----
  if (pathname.startsWith('/pilaltu/api/') && !user) {
    json(res, 401, { ok: false, reason: '未登录' });
    return;
  }

  if (pathname === '/pilaltu/api/services') {
    const currentRoute = cookies.pilaltu_route ? Number(cookies.pilaltu_route) : null;
    json(res, 200, {
      ok: true,
      routerName: config.routerName,
      services: mergedServices(),
      defaultPort: config.defaultPort,
      currentRoute,
      scanning: scanState.running,
      progress: scanState.progress,
      me: publicUser(user)
    });
    return;
  }

  if (pathname === '/pilaltu/api/setroute' && req.method === 'POST') {
    readBody(req).then((b) => {
      const port = Number(b.port);
      if (!port || port < 1 || port > 65535) { json(res, 400, { ok: false, reason: '端口无效' }); return; }
      res.setHeader('set-cookie', auth.routeCookie(port));
      json(res, 200, { ok: true, port });
    });
    return;
  }

  if (pathname === '/pilaltu/api/clearroute' && req.method === 'POST') {
    res.setHeader('set-cookie', auth.clearRouteCookie());
    json(res, 200, { ok: true });
    return;
  }

  // ---- 以下 API 仅管理员 ----
  if (pathname.startsWith('/pilaltu/api/') && (!user || user.role !== 'admin')) {
    json(res, 403, { ok: false, reason: '需要管理员权限' });
    return;
  }

  if (pathname === '/pilaltu/api/scan' && req.method === 'POST') {
    runScan();
    json(res, 200, { ok: true, running: true });
    return;
  }

  if (pathname === '/pilaltu/api/config' && req.method === 'POST') {
    readBody(req).then((b) => {
      if (b.defaultPort !== undefined) {
        const p = Number(b.defaultPort);
        config.defaultPort = (p >= 1 && p <= 65535) ? p : null;
      }
      if (typeof b.routerName === 'string' && b.routerName.trim()) {
        config.routerName = b.routerName.trim().slice(0, 30);
      }
      store.save();
      json(res, 200, { ok: true, defaultPort: config.defaultPort, routerName: config.routerName });
    });
    return;
  }

  if (pathname === '/pilaltu/api/service' && req.method === 'POST') {
    readBody(req).then((b) => {
      const port = Number(b.port);
      if (!port) { json(res, 400, { ok: false, reason: '端口无效' }); return; }
      const svc = store.setServiceMeta(port, b.name, b.note);
      json(res, 200, { ok: true, service: svc });
    });
    return;
  }

  if (pathname === '/pilaltu/api/users' && req.method === 'GET') {
    json(res, 200, {
      ok: true,
      users: (config.users || []).map(publicUser)
    });
    return;
  }

  if (pathname === '/pilaltu/api/users' && req.method === 'POST') {
    readBody(req).then((b) => {
      if (!b.username || !b.password) { json(res, 400, { ok: false, reason: '缺少用户名或密码' }); return; }
      const r = store.addUser(b.username, b.password, b.role);
      if (!r.ok) { json(res, 400, { ok: false, reason: r.reason }); return; }
      json(res, 200, { ok: true });
    });
    return;
  }

  if (pathname === '/pilaltu/api/users/delete' && req.method === 'POST') {
    readBody(req).then((b) => {
      const r = store.removeUser(b.username);
      if (!r.ok) { json(res, 400, { ok: false, reason: r.reason }); return; }
      json(res, 200, { ok: true });
    });
    return;
  }

  if (pathname === '/pilaltu/api/users/password' && req.method === 'POST') {
    readBody(req).then((b) => {
      const r = store.resetPassword(b.username, b.password);
      if (!r.ok) { json(res, 400, { ok: false, reason: r.reason }); return; }
      json(res, 200, { ok: true });
    });
    return;
  }

  if (pathname === '/pilaltu/api/users/role' && req.method === 'POST') {
    readBody(req).then((b) => {
      const r = store.setRole(b.username, b.role);
      if (!r.ok) { json(res, 400, { ok: false, reason: r.reason }); return; }
      json(res, 200, { ok: true });
    });
    return;
  }

  // ---- 未匹配 API ----
  if (pathname.startsWith('/pilaltu/')) {
    json(res, 404, { ok: false, reason: '接口不存在' });
    return;
  }

  // ---- 代理（其余所有路径）----
  createProxyHandler((req) => {
    const c = auth.parseCookies(req.headers.cookie);
    const routePort = c.pilaltu_route ? Number(c.pilaltu_route) : null;
    // 1. 有路由 Cookie → 转发到该端口
    if (routePort && routePort >= 1 && routePort <= 65535) return { port: routePort };
    // 2. 无 Cookie → 默认伪装端口
    if (config.defaultPort) return { port: Number(config.defaultPort) };
    // 3. 无默认 → 跳选择页
    return null;
  })(req, res);
}

// ---------------- 启动 ----------------
const server = http.createServer((req, res) => {
  try {
    route(req, res, req.url);
  } catch (e) {
    console.error('[PILALTU] 请求处理异常:', e);
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Internal Error');
  }
});

server.listen(ROUTER_PORT, () => {
  console.log('');
  console.log('  ┌──────────────────────────────────────────┐');
  console.log('  │   PILALTU  多端口服务聚合路由器           │');
  console.log('  └──────────────────────────────────────────┘');
  console.log(`  入口地址    http://127.0.0.1:${ROUTER_PORT}`);
  console.log(`  服务选择    http://127.0.0.1:${ROUTER_PORT}/pilaltu/`);
  console.log(`  默认管理员  admin / admin123`);
  console.log('  在任意被代理页面按  Alt+U  快速切换服务');
  console.log('');
  if (config.scanOnBoot !== false) runScan();
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`[PILALTU] 端口 ${ROUTER_PORT} 已被占用，请换端口启动：node server/index.js <端口>`);
  } else {
    console.error('[PILALTU] 启动失败:', e.message);
  }
  process.exit(1);
});
