# PILALTU 测试说明

## 运行方式

```bash
npm test
```

基于 Node.js 内置测试运行器（`node --test`，无需额外安装依赖），串行执行 `tests/` 下全部用例。

> 备注：仓库原有的 `test/e2e.js`、`test/browser.js` 是基于 puppeteer-core 的浏览器 e2e 脚手架（需要本机 Chrome），已保留为 `npm run test:e2e` / `npm run test:browser`，不属于本次可跑绿的自动化套件。

## 测了什么

测试目录：`tests/`
- `tests/unit/store.test.js` —— 配置持久化与用户管理：默认配置生成、scrypt 密码哈希确定性、`addUser`/`removeUser`/`resetPassword`/`setRole`/`setServiceMeta` 主路径与边界（重名、非法角色收敛、内置 admin 保护、未知用户拒绝）。
- `tests/unit/auth.test.js` —— Cookie 解析、会话/路由 Cookie 格式、登录与 `getUser` 会话校验、登出失效。
- `tests/integration/proxy.test.js` —— 真实起上游 HTTP 服务 + 前端代理，走完整 HTTP 回路：HTML 注入 Alt+U 切换器位置正确、非 HTML 透传不注入、后端不可达返回 503。
- `tests/integration/server.test.js` —— 真实 `node server/index.js` 启动端到端：面板可达、未登录 401、错误密码 401、正确登录拿会话、带会话访问受保护接口。

### 注入 / 安全测试
- **XSS 载荷 Cookie**：`<script>alert(...)</script>` 形式的 `pilaltu_session` 只是普通字符串，`getUser` 一律返回 `null`，不会通过鉴权。
- **伪协议路由 Cookie**：`pilaltu_route=javascript:alert(1)` 经 `Number()` 为 `NaN`，路由层拒绝。
- **开放重定向**：无路由目标时固定 `302 Location: /pilaltu/`，不反射请求路径（`//evil.example.com` 无法诱导跳转）。
- **路径穿越**：`/pilaltu/%2e%2e/%2e%2e/server/store.js` 不泄露任何服务端源码（断言不含 `module.exports`/`scryptSync`）。
- **恶意用户名存储/回显**：`<img src=x onerror=alert(1)>` 存入后以 `application/json` 原样转义返回，JSON 可正常解析，不被当作 HTML 执行。

## 预期结果

```
# tests 18
# pass 18
# fail 0
```

18 个用例全部通过（单测 12 + 集成 6，其中注入/安全相关断言覆盖 5 处）。

## 说明
- 运行会在仓库 `data/` 下生成 `config.json`（含本地管理员口令哈希），该目录已被 `.gitignore` 忽略，不会提交。
