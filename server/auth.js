'use strict';
/**
 * auth.js — 会话认证（管理员 / 普通用户）
 * session cookie: pilaltu_session=<token>; Path=/; HttpOnly; SameSite=Lax
 */
const crypto = require('crypto');

const SESSION_TTL = 7 * 24 * 3600 * 1000; // 7 天
const sessions = new Map(); // token -> { username, role, exp }

function login(store, username, password) {
  username = String(username || '').trim();
  const user = (store.get().users || []).find(u => u.username === username);
  if (!user) return { ok: false, reason: '用户名或密码错误' };
  if (!store.verify(username, password)) return { ok: false, reason: '用户名或密码错误' };
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, {
    username: user.username,
    role: user.role,
    exp: Date.now() + SESSION_TTL
  });
  return { ok: true, token, user: { username: user.username, role: user.role } };
}

function logout(token) {
  if (token) sessions.delete(token);
}

/** 解析 Cookie 头 */
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function getUser(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.pilaltu_session;
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (s.exp < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return { token, username: s.username, role: s.role };
}

function sessionCookie(token) {
  return `pilaltu_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}`;
}

function clearSessionCookie() {
  return 'pilaltu_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

function routeCookie(port) {
  return `pilaltu_route=${Number(port)}; Path=/; SameSite=Lax; Max-Age=31536000`;
}

function clearRouteCookie() {
  return 'pilaltu_route=; Path=/; SameSite=Lax; Max-Age=0';
}

module.exports = {
  login, logout, getUser, parseCookies,
  sessionCookie, clearSessionCookie, routeCookie, clearRouteCookie
};
