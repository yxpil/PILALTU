'use strict';
/**
 * scanner.js — 全端口 TCP 扫描 + HTTP 服务识别
 * 只识别 HTTP 服务：
 *  1. 对每个开放端口发 HTTP GET 探测
 *  2. 解析响应状态行 / Server 头 / 页面标题 / Content-Type
 * 非 HTTP 服务不进入服务列表（路由器只聚合 HTTP 服务）。
 * 连接被拒的端口立即跳过，开放端口才等待探测，全量扫描很快。
 */
const net = require('net');

/** 常用端口优先扫描（快速出结果），剩余端口随后补齐 */
const COMMON_PORTS = [
  80, 443, 3000, 3001, 3002, 3300, 4000, 4200, 4300, 5000, 5001,
  5173, 5174, 5175, 5500, 6000, 6001, 7000, 7001, 8000, 8001, 8080,
  8081, 8082, 8083, 8088, 8090, 8091, 8100, 8200, 8443, 8448, 8880,
  8888, 9000, 9001, 9090, 9200, 9500, 9999, 10000, 15672, 1883,
  27017, 28017, 3306, 5432, 6379, 6370, 6380, 11211, 22, 21, 25,
  110, 143, 445, 139, 135, 3389, 5900, 5901, 2375, 2376, 5601, 30000
];

/**
 * 探测单个端口：只做 HTTP 识别
 * @returns {Promise<object|null>} null = 非 HTTP 或端口关闭
 */
function probe(port, opts = {}) {
  const httpTimeout = opts.httpTimeout || 1600;   // 等 HTTP 响应头的窗口
  const totalTimeout = opts.totalTimeout || 3000; // 总超时
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    let buf = Buffer.alloc(0);
    let done = false;
    let headEnd = -1;
    const timer = setTimeout(onTimeout, totalTimeout);

    function onTimeout() {
      if (done) return;
      // 收到过 HTTP 响应头 → 按已解析信息收工；否则视为非 HTTP，忽略
      if (headEnd !== -1) finish(parseHttp());
      else finish(null);
    }

    function finish(info) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      resolve(info);
    }

    function parseHttp() {
      const head = buf.toString('latin1', 0, Math.max(0, headEnd));
      const info = parseHttpHead(head, port);
      const m = buf.toString('utf8').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (m) info.title = cleanTitle(m[1]);
      if (info.title && !info.service) info.service = 'Web 服务';
      return info;
    }

    sock.on('connect', () => {
      sock.write('GET / HTTP/1.1\r\nHost: localhost\r\nUser-Agent: PILALTU-Scanner/0.1\r\nAccept: */*\r\nConnection: close\r\n\r\n');
      // HTTP 响应头迟迟不来 → 非 HTTP 服务，忽略
      setTimeout(() => {
        if (!done && headEnd === -1) finish(null);
      }, httpTimeout);
    });

    sock.on('data', (d) => {
      if (done) return;
      buf = Buffer.concat([buf, d]);

      if (headEnd === -1) {
        const idx = buf.indexOf('\r\n\r\n');
        if (idx !== -1) {
          headEnd = idx;
          const info = parseHttp();
          if (info.service || info.title) { finish(info); return; }
          if (buf.length > 300 * 1024) { finish(info); return; }
          return; // 继续等 body / close
        }
        if (buf.length > 300 * 1024) { finish(null); return; } // 有数据但非 HTTP
        return;
      }

      // head 已定位：在 body 里找 title
      const m = buf.toString('utf8', headEnd).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (m) {
        finish({ open: true, service: 'Web 服务', type: 'web', title: cleanTitle(m[1]) });
        return;
      }
      if (buf.length > 300 * 1024) {
        finish({ open: true, service: 'Web 服务', type: 'web', title: null });
      }
    });

    sock.on('error', () => finish(null)); // 拒绝/超时 → 关闭

    sock.on('close', () => {
      if (done) return;
      if (headEnd !== -1) finish(parseHttp());
      else finish(null);
    });
  });
}

function parseHttpHead(head, port) {
  const lines = head.split('\r\n');
  const statusLine = lines[0] || '';
  const server = (head.match(/^server:\s*(.+)$/im) || [])[1];
  const ct = (head.match(/^content-type:\s*(.+)$/im) || [])[1] || '';
  const titleMatch = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  let title = titleMatch ? cleanTitle(titleMatch[1]) : null;
  let service = null;
  let type = 'web';
  if (server) service = server.trim();
  else if (title) service = 'Web 服务';
  else if (/json/i.test(ct)) { service = 'API 服务'; }
  if (!statusLine) { service = null; type = 'unknown'; }
  return { open: true, service, type, title, server: server ? server.trim() : null, status: statusLine };
}

function cleanTitle(t) {
  return t.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/**
 * 全端口扫描（只识别 HTTP 服务）
 * @param {object} opts { excludePorts, concurrency, onProgress }
 * @returns {Promise<Array>} [{port, service, type, title, server}]
 */
async function scanAll(opts = {}) {
  const exclude = new Set((opts.excludePorts || []).map(Number));
  const concurrency = opts.concurrency || 300;
  const all = [];
  for (let p = 1; p <= 65535; p++) {
    if (!exclude.has(p)) all.push(p);
  }
  // 常用端口在前
  const commons = all.filter(p => COMMON_PORTS.includes(p));
  const rest = all.filter(p => !COMMON_PORTS.includes(p));
  const queue = commons.concat(rest);

  const found = [];
  let done = 0;
  const total = queue.length;
  const report = () => opts.onProgress && opts.onProgress({ done, total, found: found.length });

  async function worker() {
    while (queue.length) {
      const port = queue.shift();
      const info = await probe(port);
      if (info) {
        found.push({ port, ...info });
      }
      done++;
      if (done % 100 === 0 || done === total) report();
    }
  }

  const workers = [];
  for (let i = 0; i < concurrency; i++) workers.push(worker());
  await Promise.all(workers);
  found.sort((a, b) => a.port - b.port);
  report();
  return found;
}

module.exports = { scanAll, COMMON_PORTS };
