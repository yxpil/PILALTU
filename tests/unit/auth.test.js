'use strict';
/**
 * auth.js 单元测试 —— Cookie 解析 / 登录会话 / 会话 Cookie 格式
 * 含注入测试：恶意 Cookie（<script>、伪协议）不得被当作合法会话。
 */
const test = require('node:test');
const assert = require('node:assert');
const auth = require('../../server/auth');

test('parseCookies：正常 / 空 / 畸形 / URL编码', () => {
  assert.deepStrictEqual(auth.parseCookies(undefined), {});
  assert.deepStrictEqual(auth.parseCookies(''), {});
  assert.deepStrictEqual(auth.parseCookies('a=1; b=2'), { a: '1', b: '2' });
  // 无等号的片段被跳过
  assert.deepStrictEqual(auth.parseCookies('justgarbage; c=3'), { c: '3' });
  // URL 编码的值被解码
  assert.strictEqual(auth.parseCookies('x=%3Cscript%3E').x, '<script>');
});

test('会话 / 路由 Cookie 格式正确', () => {
  const c = auth.sessionCookie('tok123');
  assert.match(c, /pilaltu_session=tok123/);
  assert.match(c, /HttpOnly/);
  assert.match(c, /Path=\//);
  assert.match(auth.clearSessionCookie(), /Max-Age=0/);
  assert.match(auth.routeCookie(8080), /pilaltu_route=8080/);
  assert.match(auth.clearRouteCookie(), /Max-Age=0/);
});

// 伪造一个最小 store 供 login 使用（避免触碰真实配置文件）
function fakeStore(users) {
  return {
    get: () => ({ users }),
    verify: (u, p) => {
      const x = users.find(y => y.username === u);
      return !!x && x.__pw === p;
    }
  };
}

test('login：成功返回 token+用户，失败区分用户/密码错误', () => {
  const users = [{ username: 'admin', role: 'admin', __pw: 'right' }];
  const ok = auth.login(fakeStore(users), 'admin', 'right');
  assert.strictEqual(ok.ok, true);
  assert.match(ok.token, /^[0-9a-f]{48}$/);
  assert.deepStrictEqual(ok.user, { username: 'admin', role: 'admin' });

  assert.strictEqual(auth.login(fakeStore(users), 'admin', 'bad').ok, false);
  assert.strictEqual(auth.login(fakeStore(users), 'root', 'x').ok, false);
  // 用户名前后空白被 trim
  assert.strictEqual(auth.login(fakeStore(users), '  admin  ', 'right').ok, true);
});

test('getUser：无 Cookie / 非法 token / 登出后均返回 null', () => {
  const users = [{ username: 'admin', role: 'admin', __pw: 'right' }];
  const s = auth.login(fakeStore(users), 'admin', 'right');
  const req = { headers: { cookie: `pilaltu_session=${s.token}` } };
  assert.strictEqual(auth.getUser(req).username, 'admin');

  assert.strictEqual(auth.getUser({ headers: {} }), null);
  assert.strictEqual(auth.getUser({ headers: { cookie: 'pilaltu_session=garbage' } }), null);

  auth.logout(s.token);
  assert.strictEqual(auth.getUser(req), null, '登出后 token 应失效');
});

test('注入测试：脚本载荷 Cookie 不被当作会话', () => {
  // 攻击者在 Cookie 里塞 <script> 事件载荷，解析后只是普通字符串，绝不能通过鉴权
  const evil = '<script>alert(document.cookie)</script>';
  const cookies = auth.parseCookies(`pilaltu_session=${encodeURIComponent(evil)}`);
  assert.strictEqual(cookies.pilaltu_session, evil);
  assert.strictEqual(auth.getUser({ headers: { cookie: `pilaltu_session=${encodeURIComponent(evil)}` } }), null);

  // 伪协议路由 Cookie：Number() 后为 NaN，路由层必须拒绝（此处断言其非有效端口）
  const routeCookies = auth.parseCookies('pilaltu_route=javascript:alert(1)');
  assert.ok(Number(routeCookies.pilaltu_route) !== Number(routeCookies.pilaltu_route), '伪协议端口必须为 NaN');
});
