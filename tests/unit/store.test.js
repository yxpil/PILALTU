'use strict';
/**
 * store.js 单元测试 —— 配置持久化 / 用户管理 / 密码哈希
 * 运行：node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// 每次跑测前清空配置文件，保证用例幂等（data/ 已被 .gitignore 忽略，不提交）
const dataFile = path.join(__dirname, '..', '..', 'data', 'config.json');
fs.rmSync(dataFile, { force: true });

const store = require('../../server/store');
const cfg = store.load();

test('load() 生成默认配置并内置 admin 管理员', () => {
  assert.strictEqual(cfg.routerName, 'PILALTU');
  assert.ok(Array.isArray(cfg.users));
  const admin = cfg.users.find(u => u.username === 'admin');
  assert.ok(admin, '应存在内置 admin');
  assert.strictEqual(admin.role, 'admin');
  assert.ok(admin.salt && admin.hash, 'salt/hash 应已生成');
});

test('hashPassword 确定性：同密码同盐结果一致，不同输入结果不同', () => {
  const salt = 'deadbeef';
  const h1 = store.hashPassword('hunter2', salt);
  const h2 = store.hashPassword('hunter2', salt);
  assert.strictEqual(h1, h2, '同密码同盐必须同哈希');
  assert.notStrictEqual(store.hashPassword('hunter3', salt), h1, '不同密码应不同');
  assert.notStrictEqual(store.hashPassword('hunter2', 'cafe'), h1, '不同盐应不同');
});

test('makeSalt 每次生成不同随机盐', () => {
  assert.notStrictEqual(store.makeSalt(), store.makeSalt());
});

test('verify() 正确密码通过、错误密码拒绝', () => {
  assert.strictEqual(store.verify('admin', 'admin123'), true);
  assert.strictEqual(store.verify('admin', 'wrong-pass'), false);
  assert.strictEqual(store.verify('nobody', 'x'), false);
});

test('addUser：新增成功、重名拒绝、role 非法被收敛为 user', () => {
  const r1 = store.addUser('alice', 'pw1', 'user');
  assert.deepStrictEqual(r1, { ok: true });
  const r2 = store.addUser('alice', 'pw1', 'user');
  assert.strictEqual(r2.ok, false);
  assert.match(r2.reason, /已存在/);
  const r3 = store.addUser('bob', 'pw2', 'not-a-role'); // 非法角色
  assert.strictEqual(r3.ok, true);
  const bob = cfg.users.find(u => u.username === 'bob');
  assert.strictEqual(bob.role, 'user', '非法 role 必须收敛为 user');
});

test('setRole / resetPassword / removeUser', () => {
  assert.strictEqual(store.setRole('bob', 'admin').ok, true);
  assert.strictEqual(cfg.users.find(u => u.username === 'bob').role, 'admin');
  assert.strictEqual(store.setRole('ghost', 'admin').ok, false);

  assert.strictEqual(store.resetPassword('bob', 'newpass').ok, true);
  assert.strictEqual(store.verify('bob', 'newpass'), true);
  assert.strictEqual(store.resetPassword('ghost', 'x').ok, false);

  assert.strictEqual(store.removeUser('admin').ok, false, '内置 admin 不可删除');
  assert.strictEqual(store.removeUser('bob').ok, true);
  assert.strictEqual(store.removeUser('bob').ok, false, '重复删除已不存在用户应拒绝');
});

test('setServiceMeta：新建与更新，非字符串 name/note 被忽略', () => {
  const s = store.setServiceMeta(8080, 'Alpha', '备注');
  assert.strictEqual(s.port, 8080);
  assert.strictEqual(s.name, 'Alpha');
  const s2 = store.setServiceMeta(8080, undefined, '新备注');
  assert.strictEqual(s2.name, 'Alpha', '传 undefined 不应覆盖原 name');
  assert.strictEqual(s2.note, '新备注');
});
