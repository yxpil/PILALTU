'use strict';
/**
 * public/inject.js 前端钩子测试 —— 用 jsdom 模拟浏览器环境。
 * 覆盖：
 *  - Alt+U 触发打开切换面板（事件钩子）；
 *  - Esc 关闭面板；
 *  - 重复注入守卫（__PILALTU_INJECTED__）；
 *  - 钩子/注入：服务名/标题含 <img onerror=...> XSS 载荷时，esc() 转义，
 *    DOM 中不得生成真实 <img>（事件载荷不执行）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const injectSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'inject.js'), 'utf8');

function setupDom(services) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost/pilaltu/',
    runScripts: 'outside-only'
  });
  const { window } = dom;
  window.PILALTU_ROUTE_PORT = 3000;
  // 打桩 fetch：返回带 XSS 载荷的服务列表
  window.fetch = (url) => {
    if (url === '/pilaltu/api/services') {
      return Promise.resolve({ status: 200, json: async () => ({ services, currentRoute: 3000 }) });
    }
    if (url === '/pilaltu/api/setroute') {
      return Promise.resolve({ ok: true });
    }
    return Promise.resolve({ ok: true });
  };
  window.eval(injectSrc);
  return { dom, window };
}

function key(window, key, opts) {
  const ev = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...(opts || {}) });
  window.document.dispatchEvent(ev);
  return ev;
}

test('重复注入守卫：脚本只挂载一次', () => {
  const { window } = setupDom([]);
  assert.strictEqual(window.__PILALTU_INJECTED__, true);
  window.eval(injectSrc); // 第二次执行应直接 return
  assert.strictEqual(window.document.querySelectorAll('#pilaltu-root').length, 0);
});

test('Alt+U 打开面板；渲染服务列表', async () => {
  const services = [
    { port: 3000, service: 'Alpha', type: 'web', title: '首页', online: true }
  ];
  const { window } = setupDom(services);
  key(window, 'u', { altKey: true });
  // fetch 是异步的，等待渲染
  await new Promise((r) => setTimeout(r, 20));
  const root = window.document.querySelector('#pilaltu-root');
  assert.ok(root, 'Alt+U 后应创建切换面板');
  const btn = root.querySelector('.pilaltu-svc');
  assert.ok(btn, '应渲染服务按钮');
  assert.match(btn.textContent, /Alpha/);
  assert.ok(btn.classList.contains('cur'), '当前路由端口应高亮');
});

test('Esc 关闭面板', async () => {
  const { window } = setupDom([{ port: 8080, service: 'Alpha', type: 'web', online: true }]);
  key(window, 'u', { altKey: true });
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(window.document.querySelector('#pilaltu-root'));
  key(window, 'Escape');
  assert.strictEqual(window.document.querySelector('#pilaltu-root'), null, 'Esc 后面板应移除');
});

test('注入：服务名/标题中的 XSS 载荷被转义，不生成真实 DOM 节点', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const services = [
    { port: 9000, service: evil, type: 'web', title: '<script>alert(2)</script>', online: true }
  ];
  const { window } = setupDom(services);
  key(window, 'u', { altKey: true });
  await new Promise((r) => setTimeout(r, 30));
  const root = window.document.querySelector('#pilaltu-root');
  assert.ok(root);
  // 关键断言：不得因 esc() 缺失而插入真实 <img>/<script>
  assert.strictEqual(root.querySelectorAll('img').length, 0, 'XSS 不得生成 <img> 节点');
  assert.strictEqual(root.querySelectorAll('script').length, 0, 'XSS 不得生成 <script> 节点');
  // 载荷作为纯文本出现在 title 属性 / 文本中
  const t = root.querySelector('.pilaltu-svc .t');
  assert.ok(t.textContent.includes(evil), '恶意服务名应作为纯文本存在');
});
