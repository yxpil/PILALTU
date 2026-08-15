'use strict';
/**
 * store.js — 配置持久化
 * data/config.json 结构：
 * {
 *   routerPort: 3000,          // 路由器监听端口
 *   defaultPort: null,         // 默认伪装端口（无路由 Cookie 时转发到它）
 *   routerName: 'PILALTU',     // 路由器名称
 *   services: [ { port, name, note, pinned } ],   // 用户自定义的服务名/备注
 *   users: [ { username, salt, hash, role } ],    // role: admin | user
 *   excludePorts: [],          // 扫描排除端口
 *   scanOnBoot: true           // 启动时自动扫描
 * }
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

function makeSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 32).toString('hex');
}

const DEFAULTS = {
  routerPort: 20726,
  defaultPort: null,
  routerName: 'PILALTU',
  services: [],
  users: [],
  excludePorts: [],
  scanOnBoot: true
};

let config = null;

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_FILE)) {
    // 首次运行：创建默认管理员账号
    const adminSalt = makeSalt();
    const cfg = {
      ...DEFAULTS,
      users: [{
        username: 'admin',
        salt: adminSalt,
        hash: hashPassword('admin123', adminSalt),
        role: 'admin'
      }]
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
    console.log('[PILALTU] 首次运行：已创建默认管理员账号 admin / admin123（请尽快修改密码）');
  }
}

function load() {
  ensureFile();
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (e) {
    console.error('[PILALTU] config.json 解析失败，使用默认配置:', e.message);
    config = { ...DEFAULTS };
  }
  config = { ...DEFAULTS, ...config };
  config.users = config.users || [];
  config.services = config.services || [];
  config.excludePorts = config.excludePorts || [];
  return config;
}

let saveTimer = null;
function save() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    } catch (e) {
      console.error('[PILALTU] 配置保存失败:', e.message);
    }
  }, 200);
}

function get() {
  return config;
}

function update(patch) {
  Object.assign(config, patch);
  save();
  return config;
}

/** 用户管理 */
function addUser(username, password, role) {
  if (config.users.some(u => u.username === username)) {
    return { ok: false, reason: '用户名已存在' };
  }
  const salt = makeSalt();
  config.users.push({
    username,
    salt,
    hash: hashPassword(password, salt),
    role: role === 'admin' ? 'admin' : 'user'
  });
  save();
  return { ok: true };
}

function removeUser(username) {
  if (username === 'admin') return { ok: false, reason: '不能删除内置管理员' };
  const i = config.users.findIndex(u => u.username === username);
  if (i === -1) return { ok: false, reason: '用户不存在' };
  config.users.splice(i, 1);
  save();
  return { ok: true };
}

function resetPassword(username, password) {
  const u = config.users.find(x => x.username === username);
  if (!u) return { ok: false, reason: '用户不存在' };
  u.salt = makeSalt();
  u.hash = hashPassword(password, u.salt);
  save();
  return { ok: true };
}

function setRole(username, role) {
  const u = config.users.find(x => x.username === username);
  if (!u) return { ok: false, reason: '用户不存在' };
  u.role = role === 'admin' ? 'admin' : 'user';
  save();
  return { ok: true };
}

function verify(username, password) {
  const u = config.users.find(x => x.username === username);
  if (!u) return false;
  return hashPassword(password, u.salt) === u.hash;
}

/** 服务名覆盖（用户自定义名称/备注） */
function setServiceMeta(port, name, note) {
  let svc = config.services.find(s => s.port === Number(port));
  if (!svc) {
    svc = { port: Number(port), name: '', note: '' };
    config.services.push(svc);
  }
  if (typeof name === 'string') svc.name = name;
  if (typeof note === 'string') svc.note = note;
  save();
  return svc;
}

module.exports = {
  load, save, get, update,
  addUser, removeUser, resetPassword, setRole, verify,
  setServiceMeta, hashPassword, makeSalt
};
