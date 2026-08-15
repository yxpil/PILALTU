'use strict';
/* 浏览器实测：登录 → 服务列表 → 点击切换 → Alt+U 快捷切换 → 截图
 * 跨平台 Chrome 探测：环境变量 PILALTU_CHROME > 常见系统路径 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const CHROME_CANDIDATES = [
  process.env.PILALTU_CHROME,
  // Linux
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/snap/bin/chromium', '/opt/google/chrome/chrome',
  // macOS
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  // Windows
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  (process.env.LOCALAPPDATA || '') + '\\Google\\Chrome\\Application\\chrome.exe'
].filter(Boolean);

function findChrome() {
  for (const c of CHROME_CANDIDATES) {
    try { if (fs.existsSync(c)) return c; } catch (e) { /* ignore */ }
  }
  return null;
}

const CHROME = findChrome();
if (!CHROME) {
  console.error('未找到 Chrome/Chromium。请安装 chromium，或用环境变量指定：PILALTU_CHROME=/path/to/chrome node test/browser.js');
  process.exit(1);
}
console.log('使用浏览器: ' + CHROME);
const BASE = 'http://127.0.0.1:20726';
const SHOT_DIR = path.join(__dirname, 'screenshots');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  // 1. 打开选择页 → 未登录应显示登录卡片
  console.log('[1] 登录页');
  await page.goto(BASE + '/pilaltu/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 600));
  const loginVisible = await page.evaluate(() => {
    const v = document.getElementById('view-login');
    return v && !v.classList.contains('hidden');
  });
  check('未登录显示登录视图', loginVisible);
  const hasInputs = await page.evaluate(() =>
    !!document.getElementById('loginUser') && !!document.getElementById('loginPass'));
  check('登录表单存在', hasInputs);
  await page.screenshot({ path: path.join(SHOT_DIR, '1-login.png') });

  // 2. 登录
  console.log('[2] 登录流程');
  await page.type('#loginUser', 'admin');
  await page.type('#loginPass', 'admin123');
  await page.click('#loginBtn');
  await page.waitForFunction(() => !document.getElementById('view-select').classList.contains('hidden'), { timeout: 8000 });
  await page.waitForFunction(() => document.querySelectorAll('.svc').length > 0, { timeout: 60000 });
  const svcCount = await page.evaluate(() => document.querySelectorAll('.svc').length);
  check('登录后进入选择视图', true);
  check('服务列表已渲染 (>=3 个)', svcCount >= 3, 'count=' + svcCount);
  const styleInk = await page.evaluate(() => {
    const chip = document.querySelector('.chip');
    return chip ? getComputedStyle(chip).borderRadius : null;
  });
  check('胶囊风格生效 (border-radius 999px)', styleInk === '999px', styleInk);
  await page.screenshot({ path: path.join(SHOT_DIR, '2-services.png') });

  // 3. 点击 Beta :8081 → 跳转并显示 Beta 页面
  console.log('[3] 点击切换路由');
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.svc')];
    const b = btns.find(x => x.textContent.includes('8081'));
    b && b.click();
  });
  await page.waitForFunction(() => document.title.includes('Beta'), { timeout: 8000 }).catch(() => {});
  check('跳转后显示 Beta 控制台', (await page.title()).includes('Beta'), await page.title());
  const injected = await page.evaluate(() => typeof window.__PILALTU_INJECTED__ !== 'undefined');
  check('代理页面已注入切换器', injected);
  await page.screenshot({ path: path.join(SHOT_DIR, '3-beta-routed.png') });

  // 4. Alt+U 弹出切换器
  console.log('[4] Alt+U 快捷切换');
  await page.keyboard.down('Alt');
  await page.keyboard.press('KeyU');
  await page.keyboard.up('Alt');
  await page.waitForFunction(() => !!document.getElementById('pilaltu-root'), { timeout: 5000 });
  const switcherVisible = await page.evaluate(() => {
    const mask = document.getElementById('pilaltu-mask');
    return mask && getComputedStyle(mask).display !== 'none';
  });
  check('Alt+U 弹出切换器', switcherVisible);
  await page.waitForFunction(() => document.querySelectorAll('.pilaltu-svc').length > 0, { timeout: 5000 });
  const items = await page.evaluate(() => document.querySelectorAll('.pilaltu-svc').length);
  check('切换器列出服务 (>=3)', items >= 3, 'count=' + items);
  await page.screenshot({ path: path.join(SHOT_DIR, '4-altu-switcher.png') });

  // 5. 在切换器里选 Gamma :8082
  console.log('[5] 切换器内选择');
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.pilaltu-svc')];
    const b = btns.find(x => x.textContent.includes('8082'));
    b && b.click();
  });
  await page.waitForFunction(() => document.title.includes('Gamma'), { timeout: 8000 }).catch(() => {});
  check('切换器选择后显示 Gamma 面板', (await page.title()).includes('Gamma'), await page.title());
  await page.screenshot({ path: path.join(SHOT_DIR, '5-gamma-routed.png') });

  // 6. 返回选择页检查当前路由高亮
  console.log('[6] 路由状态');
  await page.goto(BASE + '/pilaltu/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 800));
  const activePort = await page.evaluate(() => {
    const a = document.querySelector('.svc.active');
    return a ? a.querySelector('.port').textContent : null;
  });
  check('选择页高亮当前路由 :8082', activePort === '8082', activePort);
  const routeChip = await page.evaluate(() => document.getElementById('routeChip').textContent);
  check('状态条显示当前路由', routeChip.includes('8082'), routeChip);
  await page.screenshot({ path: path.join(SHOT_DIR, '6-active-route.png') });

  // 7. 管理员区可见
  console.log('[7] 管理员视图');
  const adminVisible = await page.evaluate(() => !document.getElementById('adminZone').classList.contains('hidden'));
  check('管理员看到管理区', adminVisible);
  await page.screenshot({ path: path.join(SHOT_DIR, '7-admin.png') });

  await browser.close();
  console.log('');
  console.log('浏览器实测: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('浏览器测试异常:', e.message); process.exit(1); });
