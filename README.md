# PILALTU · 多端口服务聚合路由器

自动识别本机全部端口上的服务，通过 Cookie 标记把请求路由到不同端口。
任意页面按 `Alt+U` 即可呼出切换器，未设置路由时按默认伪装端口转发，看起来就像直接访问该服务。

## 功能

- 全端口扫描（1-65535，并发探测），只识别 HTTP 服务：解析状态行 / Server 头 / 页面标题 / Content-Type（API 服务）
- Cookie 路由：登录后选择服务，`pilaltu_route` Cookie 决定转发目标端口
- `Alt+U` 全局快捷键：代理的所有 HTML 页面自动注入切换器，随时切换服务
- 默认伪装：未设置路由时转发到默认端口，平时看起来就是那个服务
- 登录体系：管理员 / 普通用户两级权限
  - 管理员：触发扫描、设置默认伪装、重命名服务、用户管理
  - 普通用户：查看服务、切换路由
- 简约黑白圆角胶囊设计，无第三方依赖（运行时零依赖）

## 启动

```bash
node server/index.js            # 默认端口 20726
node server/index.js 3100       # 指定端口
```

- 入口地址 `http://127.0.0.1:20726`
- 服务选择 `http://127.0.0.1:20726/pilaltu/`
- 首次运行创建默认管理员 `admin / admin123`，登录后请在用户管理中修改

## 跨平台（Linux / macOS / Windows）

- 运行时零依赖，仅使用 Node 内置模块（`net` / `http` / `crypto` / `fs` / `path`），三平台直接 `node server/index.js` 运行
- 只需 Node.js 16+，无需安装任何 npm 包
- 浏览器实测脚本 `test/browser.js` 自动探测系统 Chrome/Chromium（Linux 常见路径、macOS、Windows），也可用环境变量指定：
  ```bash
  PILALTU_CHROME=/usr/bin/chromium node test/browser.js
  ```

## 使用流程

1. 启动后自动扫描全端口，打开选择页登录
2. 点击服务卡片切换路由（或任意页面按 `Alt+U`）
3. 未设置路由时请求落到默认伪装端口；未设置默认端口则跳转选择页
4. 管理员可在管理区设置默认伪装、重命名服务、管理用户、重新扫描

## 目录结构

```
PILALTU/
├── server/
│   ├── index.js     # 主入口：路由聚合 + API
│   ├── scanner.js   # 全端口扫描 + 服务识别
│   ├── proxy.js     # 反向代理 + HTML 注入（Alt+U 切换器）
│   ├── auth.js      # 会话认证（管理员/普通用户）
│   └── store.js     # 配置持久化（data/config.json）
├── public/
│   ├── index.html   # 面板页面（登录/选择/管理）
│   ├── style.css    # 黑白圆角胶囊风格
│   ├── app.js       # 面板逻辑
│   └── inject.js    # 注入到被代理页面的 Alt+U 切换器
├── data/config.json # 运行时配置（自动生成）
└── test/
    ├── servers.js   # 测试服务（8080/8081/8082）
    ├── e2e.js       # API 端到端测试
    └── browser.js   # 浏览器实测（puppeteer-core + 系统 Chrome）
```

## 测试

```bash
node test/servers.js   # 起 3 个测试服务
node server/index.js   # 起路由器
node test/e2e.js       # API 端到端测试（22 项）
node test/browser.js   # 浏览器全流程实测（13 项，截图在 test/screenshots/）
```

## 安全说明

- 仅监听本机回环地址，适合个人本地多服务聚合
- 会话 Cookie HttpOnly + SameSite=Lax；密码 scrypt 加盐哈希
- 首次使用请修改默认管理员密码
