'use strict';
/* 端到端测试：登录 → 服务列表 → 路由 → 默认伪装 → 注入 → 用户权限 */
const http = require('http');

const BASE = 'http://127.0.0.1:20726';
let pass = 0, fail = 0;

function req(method, path, { body, headers = {}, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const payload = body ? JSON.stringify(body) : null;
    const h = { ...headers };
    if (payload) h['content-type'] = 'application/json';
    if (cookie) h.cookie = cookie;
    const r = http.request({
      host: u.hostname, port: u.port, path: u.pathname + u.search,
      method, headers: h
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d }));
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + JSON.stringify(extra).slice(0, 200) : '')); }
}

function cookieOf(res) {
  const sc = res.headers['set-cookie'];
  if (!sc) return '';
  return sc.map(s => s.split(';')[0]).join('; ');
}

async function main() {
  // 1. 错误密码
  console.log('[1] 登录');
  let r = await req('POST', '/pilaltu/api/login', { body: { username: 'admin', password: 'wrong' } });
  check('错误密码被拒 (401)', r.status === 401);

  // 2. 正确登录
  r = await req('POST', '/pilaltu/api/login', { body: { username: 'admin', password: 'admin123' } });
  const adminCookie = cookieOf(r);
  check('管理员登录成功', r.status === 200 && JSON.parse(r.body).ok === true);
  check('Set-Cookie 已下发', adminCookie.includes('pilaltu_session'));

  // 3. 服务列表（含 8080/8081/8082）— 轮询等待扫描完成
  console.log('[2] 服务扫描结果');
  let svc = null;
  for (let i = 0; i < 60; i++) {
    r = await req('GET', '/pilaltu/api/services', { cookie: adminCookie });
    svc = JSON.parse(r.body);
    if (svc.services.some(s => s.port === 8080)) break;
    await new Promise(res => setTimeout(res, 1000));
  }
  const ports = svc.services.map(s => s.port);
  check('API 返回 200', r.status === 200);
  check('扫描到 8080/8081/8082', [8080, 8081, 8082].every(p => ports.includes(p)), ports);
  const b80 = svc.services.find(s => s.port === 8080);
  check('8080 识别为 Web 服务', b80 && b80.type === 'web', b80);
  check('8080 标题识别正确', b80 && b80.title && b80.title.includes('Alpha'), b80 && b80.title);

  // 4. 未登录访问面板 API 被拒
  r = await req('GET', '/pilaltu/api/services');
  check('未登录访问被拒 (401)', r.status === 401);

  // 5. 设置路由 Cookie 并验证代理转发
  console.log('[3] 路由转发');
  r = await req('POST', '/pilaltu/api/setroute', { body: { port: 8081 }, cookie: adminCookie });
  check('setroute 成功', r.status === 200 && JSON.parse(r.body).ok === true);
  const routeCookie = adminCookie + '; ' + cookieOf(r);

  r = await req('GET', '/', { cookie: routeCookie });
  check('根路径转发到 :8081', r.status === 200 && r.body.includes('Beta 控制台'), r.status);
  check('HTML 注入 Alt+U 脚本', r.body.includes('PILALTU') && r.body.includes('Alt+U'), r.body.slice(0, 80));

  // 6. 默认伪装（无 route cookie → defaultPort）
  console.log('[4] 默认伪装');
  r = await req('POST', '/pilaltu/api/config', { body: { defaultPort: 8080 }, cookie: adminCookie });
  check('设置默认端口成功', r.status === 200);
  r = await req('GET', '/', { cookie: adminCookie });
  check('无路由 Cookie 时转发到默认端口 :8080', r.body.includes('Alpha 应用'), r.status);
  check('伪装页面同样注入切换器', r.body.includes('pilaltu-mask'));

  // 7. 未登录且无默认端口的行为 → 跳选择页（先清默认）
  r = await req('POST', '/pilaltu/api/config', { body: { defaultPort: null }, cookie: adminCookie });
  r = await req('GET', '/', {});
  check('无 Cookie 无默认 → 302 选择页', r.status === 302 && r.headers.location === '/pilaltu/', r.status);

  // 8. 普通用户权限
  console.log('[5] 用户与权限');
  r = await req('POST', '/pilaltu/api/users', { body: { username: 'tom', password: 'tom123', role: 'user' }, cookie: adminCookie });
  check('管理员创建普通用户', r.status === 200 && JSON.parse(r.body).ok === true);
  r = await req('POST', '/pilaltu/api/login', { body: { username: 'tom', password: 'tom123' } });
  const userCookie = cookieOf(r);
  check('普通用户登录成功', r.status === 200);
  r = await req('GET', '/pilaltu/api/services', { cookie: userCookie });
  check('普通用户可看服务列表', r.status === 200);
  r = await req('POST', '/pilaltu/api/scan', { cookie: userCookie });
  check('普通用户不能触发扫描 (403)', r.status === 403);
  r = await req('GET', '/pilaltu/api/users', { cookie: userCookie });
  check('普通用户不能看用户列表 (403)', r.status === 403);

  // 9. 删除测试用户 + 恢复默认端口
  r = await req('POST', '/pilaltu/api/users/delete', { body: { username: 'tom' }, cookie: adminCookie });
  check('删除测试用户', r.status === 200);
  r = await req('POST', '/pilaltu/api/config', { body: { defaultPort: 8080 }, cookie: adminCookie });
  check('恢复默认伪装 :8080', r.status === 200);

  console.log('');
  console.log('结果: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('测试异常:', e); process.exit(1); });
