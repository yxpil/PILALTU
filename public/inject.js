/* PILALTU Alt+U 切换器 — 由代理注入到所有 HTML 页面 */
(function () {
  'use strict';
  if (window.__PILALTU_INJECTED__) return;
  window.__PILALTU_INJECTED__ = true;

  var ROUTE_PORT = window.PILALTU_ROUTE_PORT || null;

  var STYLE = '' +
    '#pilaltu-root{all:initial;font-family:-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;}' +
    '#pilaltu-root *,#pilaltu-root *::before,#pilaltu-root *::after{box-sizing:border-box;margin:0;padding:0;}' +
    '#pilaltu-mask{position:fixed;inset:0;background:rgba(0,0,0,.32);z-index:2147483000;display:flex;align-items:center;justify-content:center;animation:pilaltu-fade .15s ease;}' +
    '#pilaltu-panel{width:min(440px,calc(100vw - 40px));max-height:70vh;display:flex;flex-direction:column;background:#fff;border:1px solid #e6e6e6;border-radius:24px;box-shadow:0 20px 60px rgba(0,0,0,.18);overflow:hidden;animation:pilaltu-pop .18s ease;}' +
    '#pilaltu-head{display:flex;align-items:center;justify-content:space-between;padding:16px 22px;border-bottom:1px solid #f0f0f0;}' +
    '#pilaltu-title{font-size:14px;font-weight:700;letter-spacing:.1em;color:#111;}' +
    '#pilaltu-title .pill{background:#111;color:#fff;border-radius:999px;font-size:10px;letter-spacing:.14em;padding:3px 10px;margin-left:8px;}' +
    '#pilaltu-close{background:none;border:none;cursor:pointer;font-size:16px;color:#999;padding:4px 8px;border-radius:999px;}' +
    '#pilaltu-close:hover{background:#f2f2f2;color:#111;}' +
    '#pilaltu-body{padding:14px;overflow-y:auto;}' +
    '#pilaltu-body::-webkit-scrollbar{width:8px;}#pilaltu-body::-webkit-scrollbar-thumb{background:#ddd;border-radius:999px;}' +
    '#pilaltu-empty{text-align:center;color:#999;font-size:13px;padding:28px 0;}' +
    '.pilaltu-svc{display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:#fff;border:1px solid #e6e6e6;border-radius:999px;padding:9px 14px;margin-bottom:8px;cursor:pointer;font-family:inherit;transition:border-color .12s,background .12s,color .12s;}' +
    '.pilaltu-svc:hover{border-color:#111;}' +
    '.pilaltu-svc.cur{background:#111;border-color:#111;color:#fff;}' +
    '.pilaltu-svc .p{flex:none;width:44px;height:44px;border-radius:50%;background:#f1f1f1;color:#111;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;}' +
    '.pilaltu-svc.cur .p{background:#fff;color:#111;}' +
    '.pilaltu-svc .n{min-width:0;flex:1;}' +
    '.pilaltu-svc .n .t{font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    '.pilaltu-svc .n .m{font-size:11px;color:#999;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    '.pilaltu-svc.cur .n .m{color:rgba(255,255,255,.6);}' +
    '.pilaltu-svc .off{flex:none;font-size:10px;color:#aaa;border:1px solid #ddd;border-radius:999px;padding:2px 8px;}' +
    '.pilaltu-svc.cur .off{border-color:rgba(255,255,255,.4);color:rgba(255,255,255,.6);}' +
    '#pilaltu-foot{padding:10px 22px;border-top:1px solid #f0f0f0;display:flex;align-items:center;justify-content:space-between;}' +
    '#pilaltu-foot span{font-size:11px;color:#999;}' +
    '#pilaltu-clear{border:none;background:none;cursor:pointer;font-size:11.5px;color:#111;text-decoration:underline;}' +
    '@keyframes pilaltu-fade{from{opacity:0}to{opacity:1}}' +
    '@keyframes pilaltu-pop{from{transform:translateY(12px);opacity:0}to{transform:none;opacity:1}}';

  var TYPE_LABEL = { web: 'Web', database: '数据库', remote: '远程', ftp: 'FTP', mail: '邮件', file: '文件', unknown: '未知' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var root, mask, panel, bodyEl, listEl;

  function open() {
    if (root) { close(); return; }
    root = document.createElement('div');
    root.id = 'pilaltu-root';
    root.innerHTML = '<style>' + STYLE + '</style>' +
      '<div id="pilaltu-mask"><div id="pilaltu-panel">' +
      '<div id="pilaltu-head"><span id="pilaltu-title">PILALTU<span class="pill">服务切换</span></span>' +
      '<button id="pilaltu-close" type="button">✕</button></div>' +
      '<div id="pilaltu-body"><div id="pilaltu-empty">加载中…</div></div>' +
      '<div id="pilaltu-foot"><span>Alt+U 打开 · Esc 关闭</span><button id="pilaltu-clear" type="button">清除路由</button></div>' +
      '</div></div>';
    document.body.appendChild(root);
    mask = root.querySelector('#pilaltu-mask');
    panel = root.querySelector('#pilaltu-panel');
    bodyEl = root.querySelector('#pilaltu-body');
    listEl = root.querySelector('#pilaltu-empty');
    root.querySelector('#pilaltu-close').addEventListener('click', close);
    root.querySelector('#pilaltu-clear').addEventListener('click', clearRoute);
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
    document.addEventListener('keydown', onKeyEsc);
    fetch('/pilaltu/api/services', { credentials: 'same-origin' })
      .then(function (r) {
        if (r.status === 401) { location.href = '/pilaltu/'; return null; }
        return r.json();
      })
      .then(function (d) {
        if (!d) return;
        render(d);
      })
      .catch(function () {
        listEl.textContent = '加载失败';
      });
  }

  function onKeyEsc(e) {
    if (e.key === 'Escape' || e.key === 'Esc') close();
  }

  function close() {
    if (root) {
      document.removeEventListener('keydown', onKeyEsc);
      root.parentNode && root.parentNode.removeChild(root);
    }
    root = mask = panel = bodyEl = listEl = null;
  }

  function render(d) {
    var svcs = d.services || [];
    if (!svcs.length) { listEl.textContent = '未发现任何服务'; return; }
    bodyEl.innerHTML = '';
    svcs.forEach(function (s) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pilaltu-svc' + (s.port === d.currentRoute ? ' cur' : '');
      btn.title = s.title || ('端口 :' + s.port);
      btn.innerHTML = '<span class="p">' + s.port + '</span>' +
        '<span class="n"><span class="t">' + esc(s.service) + '</span>' +
        '<span class="m">' + (TYPE_LABEL[s.type] || '未知') +
        (s.title ? ' · ' + esc(s.title) : '') + '</span></span>' +
        (s.online ? '' : '<span class="off">离线</span>');
      btn.addEventListener('click', function () { switchRoute(s.port); });
      bodyEl.appendChild(btn);
    });
    listEl = null;
  }

  function switchRoute(port) {
    fetch('/pilaltu/api/setroute', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ port: port })
    }).then(function (r) {
      if (r.ok) { location.href = '/'; } else { listEl && (listEl.textContent = '切换失败'); }
    }).catch(function () {
      listEl && (listEl.textContent = '切换失败');
    });
  }

  function clearRoute() {
    fetch('/pilaltu/api/clearroute', {
      method: 'POST',
      credentials: 'same-origin'
    }).then(function () {
      location.href = '/pilaltu/';
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.altKey && (e.key === 'u' || e.key === 'U')) {
      e.preventDefault();
      e.stopPropagation();
      open();
    }
  }, true);
})();
