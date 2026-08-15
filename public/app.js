/* PILALTU 面板逻辑 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = {
    me: null,
    data: null,
    pollTimer: null
  };

  const TYPE_LABEL = {
    web: 'Web',
    database: '数据库',
    remote: '远程',
    ftp: 'FTP',
    mail: '邮件',
    file: '文件',
    unknown: '未知'
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  async function api(url, opts) {
    const res = await fetch(url, Object.assign({
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin'
    }, opts || {}));
    let body = null;
    try { body = await res.json(); } catch (e) { /* ignore */ }
    if (res.status === 401 && !url.endsWith('/api/login')) {
      showLogin();
      throw new Error('未登录');
    }
    if (!res.ok) {
      const reason = body && body.reason ? body.reason : ('请求失败 ' + res.status);
      throw new Error(reason);
    }
    return body;
  }

  /* ---------- 视图切换 ---------- */
  function showLogin() {
    state.me = null;
    $('view-login').classList.remove('hidden');
    $('view-select').classList.add('hidden');
    $('meLabel').classList.add('hidden');
    $('logoutBtn').classList.add('hidden');
    stopPoll();
  }

  function showSelect() {
    $('view-login').classList.add('hidden');
    $('view-select').classList.remove('hidden');
    $('meLabel').textContent = state.me.username + (state.me.role === 'admin' ? ' · 管理员' : '');
    $('meLabel').classList.remove('hidden');
    $('logoutBtn').classList.remove('hidden');
    $('adminZone').classList.toggle('hidden', state.me.role !== 'admin');
    $('rescanBtn').classList.toggle('hidden', state.me.role !== 'admin');
    loadServices();
  }

  /* ---------- 登录 ---------- */
  function bindLogin() {
    $('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const user = $('loginUser').value.trim();
      const pass = $('loginPass').value;
      $('loginErr').classList.add('hidden');
      try {
        const r = await api('/pilaltu/api/login', {
          method: 'POST',
          body: JSON.stringify({ username: user, password: pass })
        });
        state.me = r.user;
        $('loginUser').value = '';
        $('loginPass').value = '';
        showSelect();
      } catch (err) {
        $('loginErr').textContent = err.message;
        $('loginErr').classList.remove('hidden');
      }
    });
    $('logoutBtn').addEventListener('click', async () => {
      try { await api('/pilaltu/api/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
      showLogin();
    });
  }

  /* ---------- 服务数据 ---------- */
  async function loadServices() {
    try {
      const d = await api('/pilaltu/api/services');
      state.data = d;
      renderStatus(d);
      renderServices(d.services);
      if (d.scanning) {
        startPoll();
      } else {
        stopPoll();
        renderScanBar(false);
      }
      if (state.me.role === 'admin') renderAdmin(d);
    } catch (e) {
      if (e.message !== '未登录') {
        renderError(e.message);
      }
    }
  }

  function renderStatus(d) {
    const routeChip = $('routeChip');
    if (d.currentRoute) {
      const svc = d.services.find(s => s.port === d.currentRoute);
      routeChip.textContent = svc
        ? '当前路由 :' + d.currentRoute + ' ' + svc.service
        : '当前路由 :' + d.currentRoute;
    } else {
      routeChip.textContent = '未设置路由';
    }
    const defChip = $('defaultChip');
    if (d.defaultPort) {
      const svc = d.services.find(s => s.port === d.defaultPort);
      defChip.textContent = svc
        ? '默认伪装 :' + d.defaultPort + ' ' + svc.service
        : '默认伪装 :' + d.defaultPort;
    } else {
      defChip.textContent = '未设置默认伪装';
    }
    const scanChip = $('scanChip');
    if (d.scanning) {
      scanChip.textContent = '扫描中 ' + Math.round(d.progress.done / Math.max(1, d.progress.total) * 100) + '%';
      scanChip.classList.add('chip-ghost');
    } else {
      scanChip.textContent = '发现 ' + d.services.length + ' 个服务';
      scanChip.classList.add('chip-ghost');
    }
  }

  function renderServices(list) {
    const grid = $('serviceGrid');
    grid.innerHTML = '';
    $('emptyState').classList.toggle('hidden', list.length > 0);
    if (state.me && state.me.role === 'admin' && list.length === 0) {
      $('scanBtn2').classList.remove('hidden');
    }
    for (const s of list) {
      const btn = document.createElement('button');
      btn.className = 'svc' + (state.data.currentRoute === s.port ? ' active' : '');
      btn.title = s.title || ('端口 :' + s.port);
      btn.innerHTML =
        '<span class="port">' + s.port + '</span>' +
        '<span class="info">' +
        '  <span class="name">' + esc(s.service) + '</span>' +
        '  <span class="meta">' + (TYPE_LABEL[s.type] || '未知') +
        (s.title ? ' · ' + esc(s.title) : '') + '</span>' +
        '</span>' +
        (s.online ? '' : '<span class="offline-mark">离线</span>');
      btn.addEventListener('click', () => switchRoute(s.port));
      grid.appendChild(btn);
    }
  }

  async function switchRoute(port) {
    try {
      await api('/pilaltu/api/setroute', {
        method: 'POST',
        body: JSON.stringify({ port })
      });
      // 跳到路由器根路径，按新 Cookie 转发到目标服务
      location.href = '/';
    } catch (e) {
      alert(e.message);
    }
  }

  /* ---------- 扫描 ---------- */
  function startPoll() {
    renderScanBar(true);
    if (state.pollTimer) return;
    state.pollTimer = setInterval(loadServices, 2000);
  }

  function stopPoll() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function renderScanBar(show) {
    $('scanBar').classList.toggle('hidden', !show);
  }

  /* ---------- 管理员 ---------- */
  function renderAdmin(d) {
    // 默认伪装选择器
    const sel = $('defaultPortSel');
    sel.innerHTML = '<option value="">选择端口</option>' +
      d.services.map(s => '<option value="' + s.port + '"' +
        (d.defaultPort === s.port ? ' selected' : '') + '>:' + s.port + ' ' + esc(s.service) + '</option>').join('');
    // 用户列表
    api('/pilaltu/api/users').then(r => renderUsers(r.users)).catch(() => {});
  }

  function renderUsers(users) {
    const box = $('userList');
    box.innerHTML = '';
    for (const u of users) {
      const row = document.createElement('div');
      row.className = 'userrow';
      row.innerHTML =
        '<span class="uname">' + esc(u.username) + '</span>' +
        '<span class="urole ' + u.role + '">' + (u.role === 'admin' ? '管理员' : '普通用户') + '</span>' +
        '<span class="flex-spacer"></span>' +
        '<span class="row-actions">' +
        (u.role === 'user'
          ? '<button class="btn btn-ghost btn-sm" data-act="promote">设为管理员</button>'
          : '<button class="btn btn-ghost btn-sm" data-act="demote">设为普通</button>') +
        '<button class="btn btn-ghost btn-sm" data-act="pwd">重置密码</button>' +
        (u.username !== 'admin' ? '<button class="btn btn-ghost btn-sm" data-act="del">删除</button>' : '') +
        '</span>';
      row.querySelector('[data-act="promote"]') && row.querySelector('[data-act="promote"]')
        .addEventListener('click', () => setRole(u.username, 'admin'));
      row.querySelector('[data-act="demote"]') && row.querySelector('[data-act="demote"]')
        .addEventListener('click', () => setRole(u.username, 'user'));
      row.querySelector('[data-act="pwd"]') && row.querySelector('[data-act="pwd"]')
        .addEventListener('click', () => resetPwd(u.username));
      row.querySelector('[data-act="del"]') && row.querySelector('[data-act="del"]')
        .addEventListener('click', () => delUser(u.username));
      box.appendChild(row);
    }
  }

  function bindAdmin() {
    $('rescanBtn').addEventListener('click', async () => {
      try {
        await api('/pilaltu/api/scan', { method: 'POST' });
        startPoll();
      } catch (e) { alert(e.message); }
    });
    $('scanBtn2').addEventListener('click', async () => {
      try {
        await api('/pilaltu/api/scan', { method: 'POST' });
        startPoll();
      } catch (e) { alert(e.message); }
    });
    $('defaultSetBtn').addEventListener('click', async () => {
      const port = $('defaultPortSel').value;
      if (!port) return;
      try {
        await api('/pilaltu/api/config', {
          method: 'POST',
          body: JSON.stringify({ defaultPort: Number(port) })
        });
        loadServices();
      } catch (e) { alert(e.message); }
    });
    $('defaultClearBtn').addEventListener('click', async () => {
      try {
        await api('/pilaltu/api/config', {
          method: 'POST',
          body: JSON.stringify({ defaultPort: null })
        });
        loadServices();
      } catch (e) { alert(e.message); }
    });
    $('addUserBtn').addEventListener('click', async () => {
      const username = $('newUserName').value.trim();
      const password = $('newUserPass').value;
      const role = $('newUserRole').value;
      if (!username || !password) return;
      try {
        await api('/pilaltu/api/users', {
          method: 'POST',
          body: JSON.stringify({ username, password, role })
        });
        $('newUserName').value = '';
        $('newUserPass').value = '';
        renderUsers();
        loadServices();
      } catch (e) { alert(e.message); }
    });
  }

  async function setRole(username, role) {
    try {
      await api('/pilaltu/api/users/role', {
        method: 'POST',
        body: JSON.stringify({ username, role })
      });
      renderUsers();
    } catch (e) { alert(e.message); }
  }

  async function resetPwd(username) {
    const pwd = prompt('为用户 ' + username + ' 设置新密码：');
    if (!pwd) return;
    try {
      await api('/pilaltu/api/users/password', {
        method: 'POST',
        body: JSON.stringify({ username, password: pwd })
      });
    } catch (e) { alert(e.message); }
  }

  async function delUser(username) {
    if (!confirm('确定删除用户 ' + username + ' ？')) return;
    try {
      await api('/pilaltu/api/users/delete', {
        method: 'POST',
        body: JSON.stringify({ username })
      });
      renderUsers();
    } catch (e) { alert(e.message); }
  }

  function renderError(msg) {
    const grid = $('serviceGrid');
    grid.innerHTML = '<div class="empty"><p>' + esc(msg) + '</p></div>';
  }

  /* ---------- 初始化 ---------- */
  async function init() {
    bindLogin();
    bindAdmin();
    try {
      const r = await api('/pilaltu/api/me');
      state.me = r.user;
      showSelect();
    } catch (e) {
      showLogin();
    }
  }

  init();
})();
