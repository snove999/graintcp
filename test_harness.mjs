// 测试夹具：模拟 workerd 环境，验证 worker.js / snippets.js 的路径解析与 WS 流程
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';

const DIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// ---------- workerd 环境桩 ----------
// Node 的 Response 拒绝 101 + webSocket，改用轻量桩
const RealResponse = globalThis.Response;
globalThis.Response = class {
  constructor(body, init = {}) {
    if (init.status === 101) {
      this.status = 101;
      this.webSocket = init.webSocket;
      this.headers = new Headers(init.headers || {});
      this.ok = false;
      return;
    }
    return new RealResponse(body, init);
  }
};

// WebSocketPair 桩：记录每个实例，client/server 半双工互通
const __pairs = [];
globalThis.__pairs = __pairs;
function mkSock() {
  const sock = {
    _listeners: {}, _sent: [], _closed: false, _other: null,
    accept() {},
    send(d) { const u = d instanceof Uint8Array ? d : new Uint8Array(d); sock._sent.push(u); sock._other?._onmessage(u.slice()); },
    close() { if (sock._closed) return; sock._closed = true; (sock._listeners.close || []).forEach(f => f()); },
    addEventListener(t, f) { (sock._listeners[t] ||= []).push(f); },
    _onmessage(d) { (sock._listeners.message || []).forEach(f => f({ data: d })); },
    set binaryType(_) {}
  };
  return sock;
}
globalThis.WebSocketPair = class {
  constructor() {
    this.client = mkSock();
    this.server = mkSock();
    this.client._other = this.server;
    this.server._other = this.client;
    __pairs.push(this);
  }
  // workerd 用 Object.values 解构
  get 0() { return this.client; }
  get 1() { return this.server; }
};

// DoH 拦截桩：默认空应答（直连预解析回退 hostname、反代回退原地址，保持旧行为确定性）；专项测试块内覆盖
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url instanceof URL ? url : url?.url || url);
  if (/dns-query|\/resolve/.test(u) && /[?&]name=/.test(u)) return new RealResponse(JSON.stringify({ Answer: [] }), { status: 200, headers: { 'content-type': 'application/dns-json' } });
  return realFetch(url, opts);
};

// fake TCP socket（字节流，支持 BYOB）
let connectLog = [];
function makeTargetSocket(host, port) {
  let pending = [];
  let controllerRef = null;
  let closed = false;
  const readable = new ReadableStream({
    type: 'bytes',
    start(c) {
      controllerRef = c;
      while (pending.length) c.enqueue(pending.shift());
    },
    cancel() {}
  }, { highWaterMark: 0 });
  const written = [];
  let wController = null;
  const writable = new WritableStream({
    start(c) { wController = c; },
    write(chunk) { written.push(Uint8Array.from(chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : chunk)); }
  });
  return {
    host, port, readable, writable, written,
    opened: Promise.resolve(),
    _push(buf) {
      const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
      if (controllerRef) { try { controllerRef.enqueue(u); return; } catch { /* closed */ } }
      pending.push(u);
    },
    close() {
      closed = true;
      try { wController?.close(); } catch {}
      try { controllerRef?.close(); } catch {}
    },
    _isClosed: () => closed
  };
}

function stubRequest(url, headers = {}) {
  const h = new Map(Object.entries(headers));
  const fetcher = {
    connect(address, options) {
      const host = typeof address === 'string' ? address : address.hostname;
      const port = typeof address === 'string' ? 443 : (address.port ?? 443);
      // 模拟 workerd：非法主机名同步抛错（真实环境为 connect 拒绝）
      if (/[^A-Za-z0-9.\-:\[\]]/.test(host)) throw new Error('invalid hostname');
      const sock = makeTargetSocket(host, port);
      connectLog.push(sock);
      return sock;
    }
  };
  const req = {
    url,
    headers: { get: k => h.get(k.toLowerCase()) ?? h.get(k) ?? null },
    cf: { country: 'CN', city: 'Test' },
    fetcher
  };
  return req;
}

// VLESS 构帧：version + uuid + addonsLen(0) + cmd(1) + port + addrType(2=domain) + len + addr + payload
function vlessFrame(uuid, host, port = 443, payload = new Uint8Array([0x16, 3, 1, 0])) {
  const idBytes = [];
  const hex = c => (c > 64 ? c + 9 : c) & 0xF;
  for (let i = 0, p = 0; i < 16; i++) {
    let c = uuid.charCodeAt(p++); if (c === 45) c = uuid.charCodeAt(p++);
    const h = hex(c);
    c = uuid.charCodeAt(p++); if (c === 45) c = uuid.charCodeAt(p++);
    idBytes.push(h << 4 | hex(c));
  }
  const enc = new TextEncoder().encode(host);
  const len = enc.length;
  const head = new Uint8Array([0, ...idBytes, 0, 1, port >> 8 & 0xFF, port & 0xFF, 2, len]);
  return new Uint8Array([...head, ...enc, ...payload]);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log((cond ? '✅' : '❌') + ' ' + name + (detail ? `  [${detail}]` : ''));
}

// snippets UUID 提取：明文版走首行正则；混淆版字符串进数组后回退到当前配置常量
const SNIP_UUID_FALLBACK = 'd675a8ea-61bc-4db9-a8a6-109ca1ec8385';
const extractUuid = (line) => (line.match(/UUID="([^"]+)"/) || [0, SNIP_UUID_FALLBACK])[1];

async function loadWorker() {
  const src = readFileSync(DIR + 'worker.js', 'utf8');
  const patched = src + '\nexport { pCfg, parseAddressPort, addrParser, setUUID, CFG, ws as _ws, parseTurnProxyConfig, getSafeEnv, cfgCacheReset, incrementDailyStats, getCustomIPs };\n';
  writeFileSync(DIR + '_worker_test.mjs', patched);
  return import(pathToFileURL(DIR + '_worker_test.mjs').href);}

const WK = await loadWorker();
const { pCfg, addrParser, parseAddressPort } = WK;

// ================= 1. pCfg 语法矩阵（对照 edgetunnel 反代参数获取） =================
console.log('\n===== pCfg 语法矩阵 =====');
const mkUrl = (pathAndQuery) => new URL('https://w.test' + pathAndQuery);

{
  const c = pCfg(mkUrl('/proxyip=1.2.3.4:443'), 'proxyip=1.2.3.4:443', null);
  check('pCfg /proxyip=host:port', c.pIP?.address === '1.2.3.4' && c.pIP?.port === 443 && c.order.join() === 'direct,proxy', JSON.stringify(c.pIP));
}
{
  const c = pCfg(mkUrl('/?proxyip=example.com'), 'x', null);
  check('pCfg ?proxyip= (query)', c.pIP?.address === 'example.com' && c.pIP?.port === 443, JSON.stringify(c.pIP));
}
{
  const c = pCfg(mkUrl('/proxyip/example.com%3A8443'), 'proxyip/example.com:8443', null);
  check('pCfg /proxyip/host:port', c.pIP?.address === 'example.com' && c.pIP?.port === 8443, JSON.stringify(c.pIP));
}
{
  const c = pCfg(mkUrl('/s5=user:pass@10.0.0.1:1080'), 's5=user:pass@10.0.0.1:1080', null);
  check('pCfg /s5=user:pass@host:port', c.s5?.username === 'user' && c.s5?.password === 'pass' && c.s5?.hostname === '10.0.0.1' && c.s5?.port === 1080 && c.order.join() === 'direct,s5', JSON.stringify(c.s5));
}
{
  const c = pCfg(mkUrl('/socks5=socks5://user:pass@10.0.0.2:1080'), 'socks5=socks5://user:pass@10.0.0.2:1080', null);
  check('pCfg /socks5=socks5://…（EDT：:// 全局优先）', c.gP?.type === 'socks5' && c.gP?.cfg?.username === 'user' && c.gP?.cfg?.hostname === '10.0.0.2', JSON.stringify({ gP: c.gP, s5: c.s5 }));
}
{
  const c = pCfg(mkUrl('/socks://dXNlcjpwYXNz@10.0.0.3:1080'), 'sock://dXNlcjpwYXNz@10.0.0.3:1080', null);
  check('pCfg /socks=<b64-auth>@host（EDT 2.1 全局形式）', c.gP?.type === 'socks5' && c.gP?.cfg?.username === 'user' && c.gP?.cfg?.password === 'pass' && c.gP?.cfg?.hostname === '10.0.0.3' && c.gP?.cfg?.port === 1080, JSON.stringify(c.gP));
}
{
  const c = pCfg(mkUrl('/s5=dXNlcjpwYXNzQDEwLjAuMC4zOjEwODA='), 's5=dXNlcjpwYXNzQDEwLjAuMC4zOjEwODA=', null);
  check('pCfg /s5=<整段b64>（旧 EDT 形式）', c.s5?.username === 'user' && c.s5?.password === 'pass' && c.s5?.hostname === '10.0.0.3' && c.s5?.port === 1080, JSON.stringify(c.s5));
}
{
  const c = pCfg(mkUrl('/socks5://user:pass@10.0.0.4:1080'), 'socks5://user:pass@10.0.0.4:1080', null);
  check('pCfg /socks5://… 全局', c.gP?.type === 'socks5' && c.gP?.cfg?.hostname === '10.0.0.4' && c.order.join() === 'gP', JSON.stringify(c.gP));
}
{
  const c = pCfg(mkUrl('/http=user:pass@10.0.0.5:8080'), 'http=user:pass@10.0.0.5:8080', null);
  check('pCfg /http=… 回落', c.order.join() === 'direct,s5' && c.enS === 'http', JSON.stringify({ order: c.order, enS: c.enS }));
}
{
  const c = pCfg(mkUrl('/https=10.0.0.6:443'), 'https=10.0.0.6:443', null);
  check('pCfg /https=…（EDT 支持，TLS CONNECT）', c.s5 && c.enS === 'https' && c.s5.tls, JSON.stringify({ s5: c.s5, enS: c.enS }));
}
{
  const c = pCfg(mkUrl('/?s5=10.0.0.7:1080'), 'x', null);
  check('pCfg ?s5= (query 回落)', c.s5?.hostname === '10.0.0.7' && c.enS === 'socks5' && !c.gP, JSON.stringify(c.s5));
}
{
  const c = pCfg(mkUrl('/?https=10.0.0.8:443'), 'x', null);
  check('pCfg ?https= (query, EDT 支持)', c.s5 && c.enS === 'https', JSON.stringify(c.s5));
}
{
  const c = pCfg(mkUrl('/x?s5=10.0.0.9:1080&globalproxy'), 'x', null);
  check('pCfg ?s5=…&globalproxy → 全局', c.gP?.type === 'socks5' && !c.s5 && c.order.join() === 'gP', JSON.stringify({ gP: c.gP, s5: c.s5 }));
}
{
  const c = pCfg(mkUrl('/?mode=proxy&proxyip=1.1.1.1'), 'x', null);
  check('pCfg mode=proxy', c.order.join() === 'direct,proxy' && c.pIP?.address === '1.1.1.1', JSON.stringify(c.order));
}
{
  const c = pCfg(mkUrl('/'), '', 'ProxyIP.CMLiussss.net');
  check('pCfg 纯 / 兜底 PIP', c.pIP?.address === 'ProxyIP.CMLiussss.net' && c.order.includes('proxy'), JSON.stringify(c.pIP));
}
{
  const c = pCfg(mkUrl('/'), 'proxyip=[2606:4700::1]:443', null);
  check('pCfg IPv6 反代', c.pIP?.address === '2606:4700::1' && c.pIP?.port === 443, JSON.stringify(c.pIP));
}
{
  const c = pCfg(mkUrl('/ip=1.2.3.6'), 'ip=1.2.3.6', null);
  check('pCfg /ip= 形式', c.pIP?.address === '1.2.3.6', JSON.stringify(c.pIP));
}

// ================= 2. addrParser / parseAddressPort =================
console.log('\n===== 地址解析 =====');
{
  const [h, p] = parseAddressPort('[2606:4700::6810:84e5]:8443');
  check('parseAddressPort [v6]:port', h === '2606:4700::6810:84e5' && p === 8443, `${h}:${p}`);
}
{
  const [h, p] = parseAddressPort('2606:4700::6810:84e5');
  check('parseAddressPort 裸 v6', h === '2606:4700::6810:84e5' && p === 443, `${h}:${p}`);
}
{
  const a = addrParser('dXNlcjpwYXNzQDE5Mi4xNjguMS4xOjkwNTA=');
  check('addrParser 整段 b64（旧 EDT）', a.username === 'user' && a.password === 'pass' && a.hostname === '192.168.1.1' && a.port === 9050, JSON.stringify(a));
}
{
  const a = addrParser('socks5://user:pass@10.0.0.2:1080');
  check('addrParser 带协议前缀', a.username === 'user' && a.hostname === '10.0.0.2' && a.port === 1080, JSON.stringify(a));
}

// ================= 3. WS 流程模拟（worker 内核 + 建连 + 中继） =================
async function wsFlow(mod, label, url, env, uuid) {
  connectLog = [];
  __pairs.length = 0;
  const frame = vlessFrame(uuid, 'example-target.com', 443);
  const edB64 = Buffer.from(frame).toString('base64url');
  const req = stubRequest(url, { 'Upgrade': 'websocket', 'sec-websocket-protocol': edB64 });
  const res = await (mod._ws ? mod._ws(req, env) : mod.default.fetch(req, env, { waitUntil() {} }));
  check(`${label} WS 返回 101`, res.status === 101, String(res.status));
  const pair = __pairs[__pairs.length - 1];
  const server = pair.server;

  await sleep(150);
  check(`${label} WS 建连目标正确`, connectLog.some(s => s.host === 'example-target.com' && s.port === 443), connectLog.map(s => s.host + ':' + s.port).join(','));
  check(`${label} WS 发送 vless 应答 [0,0]`, server._sent.some(d => d[0] === 0 && d[1] === 0), JSON.stringify(server._sent.slice(0, 3).map(d => Array.from(d.slice(0, 2)))));
  const target = connectLog.find(s => s.host === 'example-target.com');
  check(`${label} WS 首包 payload 写入远端`, target && target.written.length > 0 && target.written[0][0] === 0x16, target ? target.written.map(w => w.length).join(',') : 'no target');

  // 远端回包：小包 + 大包
  target._push(new Uint8Array(Array.from({ length: 40 }, (_, i) => i & 0xFF)));
  target._push(new Uint8Array(Array.from({ length: 70000 }, (_, i) => i & 0xFF)));
  await sleep(250);
  const downBytes = server._sent.reduce((a, b) => a + b.length, 0);
  check(`${label} WS 下行中继（小包聚合 + 大包直发）`, downBytes >= 70040, `frames=${server._sent.length} bytes=${downBytes}`);

  // 客户端继续上行
  const up2 = new Uint8Array(500).fill(7);
  server._other._sent.length = 0; // 客户端发数据 → 服务端收到 message
  server._onmessage(up2.buffer);
  await sleep(150);
  check(`${label} WS 后续上行写入远端`, target.written.some(w => w.length === 500 && w[0] === 7), String(target.written.length));

  // 客户端关闭 → 全部关闭
  (server._listeners.close || []).forEach(f => f());
  await sleep(60);
  check(`${label} WS 关闭后远端关闭`, target._isClosed());
}

console.log('\n===== WS 流程模拟 (worker) =====');
await wsFlow(WK, 'worker', 'https://w.test/proxyip=9.9.9.9', { PROXYIP: 'ProxyIP.CMLiussss.net' }, WK.CFG.id);

// 无 ed 头：消息触发
{
  connectLog = [];
  __pairs.length = 0;
  const req = stubRequest('https://w.test/', { 'Upgrade': 'websocket' });
  await WK._ws(req, {});
  await sleep(20);
  const pair = __pairs[__pairs.length - 1];
  const server = pair.server;
  const frame = vlessFrame(WK.CFG.id, 'delayed-target.net', 8080, new Uint8Array([1, 2, 3]));
  server._onmessage(frame.buffer);
  await sleep(180);
  check('WS 无 ed 头：消息触发建连', connectLog.some(s => s.host === 'delayed-target.net' && s.port === 8080), connectLog.map(s => s.host).join(','));
  const target = connectLog.find(s => s.host === 'delayed-target.net');
  check('WS 无 ed 头：payload 透传', target?.written[0]?.[0] === 1 && target?.written[0]?.[2] === 3);
}

// 错误 UUID
{
  connectLog = [];
  __pairs.length = 0;
  const req = stubRequest('https://w.test/', { 'Upgrade': 'websocket' });
  await WK._ws(req, {});
  await sleep(20);
  const pair = __pairs[__pairs.length - 1];
  const server = pair.server;
  const bad = vlessFrame('00000000-0000-4000-8000-000000000001', 'evil.net', 443);
  server._onmessage(bad.buffer);
  await sleep(150);
  check('WS 错误 UUID 拒绝建连并关闭', connectLog.length === 0 && server._closed, JSON.stringify(connectLog.map(s => s.host)));
}

// 分段上行：vless 头 + payload 分两帧到达（bundle 合并）
{
  connectLog = [];
  __pairs.length = 0;
  const req = stubRequest('https://w.test/', { 'Upgrade': 'websocket' });
  await WK._ws(req, {});
  await sleep(20);
  const pair = __pairs[__pairs.length - 1];
  const server = pair.server;
  const frame = vlessFrame(WK.CFG.id, 'split-target.net', 443, new Uint8Array(100).fill(9));
  const head = frame.subarray(0, 30), tail = frame.subarray(30);
  server._onmessage(head.buffer);
  await sleep(5);
  server._onmessage(tail.buffer);
  await sleep(180);
  const target = connectLog.find(s => s.host === 'split-target.net');
  check('WS 分段首包 bundle 合并', !!target && target.written.length >= 1 && target.written[0].length >= 100, target ? target.written.map(w => w.length).join(',') : 'no target');
}

// ================= 4. snippets.js 行为测试 =================
console.log('\n===== WS 流程模拟 (snippets) =====');
{
  const SN = await import(pathToFileURL(DIR + 'snippets.js').href);
  const srcLine = readFileSync(DIR + 'snippets.js', 'utf8').split('\n')[0];
  const uuid = extractUuid(srcLine);
  await wsFlow(SN, 'snippets', 'https://w.test/proxyip=8.8.4.4', undefined, uuid);
}
{
  const SN = await import(pathToFileURL(DIR + 'snippets.js').href);
  const snipUuid = extractUuid(readFileSync(DIR + 'snippets.js', 'utf8').split('\n')[0]);
  // 目标与 s5 回落都非法 → 全部建连失败 → 应优雅关闭 WS 而非崩溃
  connectLog = [];
  __pairs.length = 0;
  const frame = vlessFrame(snipUuid, '%00%01', 443);
  const req = stubRequest('https://w.test/s5=%00%02', { 'Upgrade': 'websocket', 'sec-websocket-protocol': Buffer.from(frame).toString('base64url') });
  const res = await SN.default.fetch(req, undefined, undefined);
  await sleep(150);
  const pair = __pairs[__pairs.length - 1];
  check('snippets 非法反代地址：建连失败优雅关闭', res.status === 101 && pair.server._closed, `status=${res.status} closed=${pair.server._closed}`);
  // 后续正常请求不受影响
  connectLog = [];
  __pairs.length = 0;
  const frame2 = vlessFrame(snipUuid, 'snip-after.net', 443);
  const req2 = stubRequest('https://w.test/', { 'Upgrade': 'websocket', 'sec-websocket-protocol': Buffer.from(frame2).toString('base64url') });
  await SN.default.fetch(req2, undefined, undefined);
  await sleep(150);
  check('snippets 后续连接正常', connectLog.some(s => s.host === 'snip-after.net'), connectLog.map(s => s.host).join(','));
}

// ================= 5. 路由冒烟 (worker) =================
console.log('\n===== 路由冒烟 (worker) =====');
{
  const env = {};
  const req = stubRequest('https://w.test/sub?uuid=06b65903-406d-4a41-8463-6fd5c0ee7798', {});
  try {
    const res = await WK.default.fetch(req, env, { waitUntil() {} });
    const body = await res.text();
    let decoded = '';
    try { decoded = Buffer.from(body, 'base64').toString('utf8'); } catch {}
    check('worker /sub?uuid= 返回订阅', res.status === 200 && /vless:\/\//.test(decoded), `status=${res.status} head=${decoded.slice(0, 60)}`);
  } catch (e) { check('worker /sub?uuid= 返回订阅', false, e.message); }
}
{
  const req = stubRequest('https://w.test/', {});
  const res = await WK.default.fetch(req, {}, { waitUntil() {} });
  const txt = await res.text();
  check('worker / 未登录返回登录页', res.status === 200 && txt.length > 100, String(res.status));
}
{
  const uuid = '06b65903-406d-4a41-8463-6fd5c0ee7798';
  const req = stubRequest('https://w.test/version?uuid=' + uuid, {});
  const res = await WK.default.fetch(req, {}, { waitUntil() {} });
  const body = await res.json().catch(() => null);
  check('worker /version?uuid= EDT 探测端点', res.status === 200 && body?.Version === 2142, JSON.stringify(body));
  const req2 = stubRequest('https://w.test/version?uuid=00000000-0000-4000-8000-000000000001', {});
  const res2 = await WK.default.fetch(req2, {}, { waitUntil() {} });
  check('worker /version 错误 uuid 拒绝', res2.status === 404, String(res2.status));
}

// ================= 6. EDT 2.1 生成器契约（哨兵重建） =================
console.log('\n===== EDT 2.1 生成器契约测试 =====');
{
  // 模拟新版生成器（sub.cmliussss.net 形态）：trojan 哨兵行 + 推广行 + 外部透传行
  const mockGen = [
    'trojan://00000000-0000-4000-8000-000000000000@Join.my.Telegram.promo.example:443??security=tls&sni=example.com&fp=chrome&type=ws&host=example.com&path=%2F#%E5%8A%A0%E5%85%A5%E6%88%91%E7%9A%84%E9%A2%91%E9%81%93t.me%2FCMLiussss%E8%A7%A3%E9%94%81%E6%9B%B4%E5%A4%9A%E4%BC%98%E9%80%89%E8%8A%82%E7%82%B9',
    'trojan://00000000-0000-4000-8000-000000000000@212.147.249.131:443??security=tls&sni=example.com&fp=chrome&type=ws&host=example.com&path=%2F#FI',
    'trojan://00000000-0000-4000-8000-000000000000@167.253.159.197:443??security=tls&sni=example.com&fp=chrome&type=ws&host=example.com&path=%2F#SG',
    'vless://11111111-2222-4333-8444-555555555555@1.2.3.4:443?encryption=none&security=tls&sni=real.example.com&type=ws&host=real.example.com&path=%2Flink#%E5%A4%96%E9%83%A8%E8%8A%82%E7%82%B9'
  ].join('\n');
  const genCalls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url instanceof URL ? url : url?.url || url);
    if (u.includes('host=example.com&uuid=00000000-0000-4000-8000-000000000000')) {
      genCalls.push(u);
      return new Response(Buffer.from(mockGen).toString('base64'), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };

  // snippets：/sub?uuid= 哨兵订阅（订阅器 sub.xdu.qzz.io 被 mock 拦截）
  try {
    const SN = await import(pathToFileURL(DIR + 'snippets.js').href);
    const srcLine = readFileSync(DIR + 'snippets.js', 'utf8').split('\n')[0];
    const snipUuid = extractUuid(srcLine);
    const req = stubRequest('https://w.test/sub?uuid=' + snipUuid, {});
    const res = await SN.default.fetch(req, undefined, { waitUntil() {} });
    const text = Buffer.from(await res.text(), 'base64').toString('utf8');
    check('snippets 哨兵契约请求生成器', genCalls.length === 1, genCalls.join(' | ').slice(0, 90));
    check('snippets 哨兵行重建为本端 vless', text.includes('vless://' + snipUuid + '@212.147.249.131:443') && text.includes('sni=w.test') && text.includes('host=w.test'), text.split('\n')[1]?.slice(0, 110));
    check('snippets 备注保留(#FI/#SG)', text.includes('#FI') && text.includes('#SG'), text.split('\n').map(l => l.split('#')[1]).filter(Boolean).join(','));
    check('snippets 透传节点原样保留', text.includes('vless://11111111-2222-4333-8444-555555555555@1.2.3.4:443'), 'yes');
    check('snippets 占位 trojan 不残留', !text.includes('trojan://'), 'yes');
    check('snippets 推广地址已过滤', !text.includes('Join.my.Telegram') && !text.includes('t.me'), 'yes');
    check('snippets 订阅返回 200', res.status === 200, String(res.status));
  } catch (e) { check('snippets 生成器契约测试', false, e.message); }

  // worker：/123456（默认订阅密码）走路径B
  try {
    genCalls.length = 0;
    const req = stubRequest('https://w.test/123456', {});
    const res = await WK.default.fetch(req, {}, { waitUntil() {} });
    const text = Buffer.from(await res.text(), 'base64').toString('utf8');
    const wUuid = '06b65903-406d-4a41-8463-6fd5c0ee7798';
    check('worker 哨兵契约请求生成器', genCalls.length === 1, genCalls.join(' | ').slice(0, 90));
    check('worker 哨兵行重建为本端 vless', text.includes('vless://' + wUuid + '@212.147.249.131:443') && text.includes('sni=w.test'), text.split('\n').find(l => l.includes('212.147'))?.slice(0, 110));
    check('worker 透传节点原样保留', text.includes('11111111-2222-4333-8444-555555555555@1.2.3.4:443'), 'yes');
    check('worker 推广地址已过滤', !text.includes('Join.my.Telegram') && !text.includes('t.me'), 'yes');
    check('worker 订阅返回 200', res.status === 200, String(res.status));
  } catch (e) { check('worker 生成器契约测试', false, e.message); }

  // worker：路径A（Clash UA → 转换订阅），断言转换后端回源抓自身端点（不再内联截断链接）
  try {
    genCalls.length = 0;
    const convCalls = [];
    let innerServed = null;
    globalThis.fetch = async (url, opts) => {
      const u = String(url instanceof URL ? url : url?.url || url);
      if (u.includes('host=example.com&uuid=00000000-0000-4000-8000-000000000000')) { genCalls.push(u); return new Response(Buffer.from(mockGen).toString('base64'), { status: 200 }); }
      if (u.includes('/sub?target=clash')) {
        convCalls.push(u);
        const src = decodeURIComponent(u.match(/url=([^&]+)/)[1]);
        const inner = await WK.default.fetch(stubRequest(src, {}), {}, { waitUntil() {} });
        innerServed = Buffer.from(await inner.text(), 'base64').toString('utf8');
        return new Response('proxies: []', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    };
    const req = stubRequest('https://w.test/123456', { 'User-Agent': 'clash-verge/1.0' });
    const res = await WK.default.fetch(req, {}, { waitUntil() {} });
    await res.text();
    const urlParam = decodeURIComponent(convCalls[0]?.match(/url=([^&]+)/)?.[1] || '');
    check('worker 转换订阅回源自身端点（不截断）', urlParam.startsWith('https://w.test/123456?flag=true'), urlParam.slice(0, 100));
    check('worker 转换订阅回源内容为全部重建节点', (innerServed || '').includes('@212.147.249.131:443') && (innerServed || '').includes('@167.253.159.197:443') && !(innerServed || '').includes('trojan://'), `回源节点 ${(innerServed || '').split('\n').length} 行`);
    check('worker 转换订阅响应 200', res.status === 200, String(res.status));
  } catch (e) { check('worker 转换订阅测试', false, e.message); }

  // snippets：ProxyIP TXT 动态池（!txt → DoH TXT 随机取一条作为反代）
  try {
    const SN2 = await import(pathToFileURL(DIR + 'snippets.js').href);
    const srcLine2 = readFileSync(DIR + 'snippets.js', 'utf8').split('\n')[0];
    const snipUuid2 = extractUuid(srcLine2);
    globalThis.fetch = async (url, opts) => {
      const u = String(url instanceof URL ? url : url?.url || url);
      if (u.includes('dns-query') && u.includes('name=pool.example')) {
        return new Response(JSON.stringify({ Answer: [
          { type: 16, data: '"101.1.1.1"' },
          { type: 16, data: '"101.1.1.2:8443"' }
        ] }), { status: 200 });
      }
      return new Response('nf', { status: 404 });
    };
    connectLog = [];
    __pairs.length = 0;
    const frame = vlessFrame(snipUuid2, 'txt-target.org', 443);
    // 直连目标必失败（模拟被墙），逼出 proxy 池回落
    const req = {
      url: 'https://w.test/proxyip=pool.example!txt',
      headers: { get: k => k.toLowerCase() === 'sec-websocket-protocol' ? Buffer.from(frame).toString('base64url') : (k.toLowerCase() === 'upgrade' ? 'websocket' : null) },
      cf: {}, fetcher: {
        connect(a) {
          const host = typeof a === 'string' ? a : a.hostname, port = (a && a.port) || 443;
          if (host === 'txt-target.org') throw new Error('direct blocked');
          const sock = makeTargetSocket(host, port);
          connectLog.push(sock);
          return sock;
        }
      }
    };
    const res = await SN2.default.fetch(req, undefined, { waitUntil() {} });
    await sleep(250);
    const ok = connectLog.some(s => s.host === 'txt-target.org' && s.port === 443);
    const viaPool = connectLog.some(s => (s.host === '101.1.1.1' && s.port === 443) || (s.host === '101.1.1.2' && s.port === 8443));
    check('snippets TXT 池：DoH 解析并经池内反代建连', !ok && viaPool, connectLog.map(s => s.host + ':' + s.port).join(','));
    globalThis.fetch = realFetch;
  } catch (e) { check('snippets TXT 池测试', false, e.message); }

  // snippets：xHTTP/gRPC 传输（POST 流式，VLESS 握手 + 数据同帧）
  try {
    const SN3 = await import(pathToFileURL(DIR + 'snippets.js').href);
    const srcLine3 = readFileSync(DIR + 'snippets.js', 'utf8').split('\n')[0];
    const snipUuid3 = extractUuid(srcLine3);
    connectLog = [];
    __pairs.length = 0;
    let ctrl;
    const frame = vlessFrame(snipUuid3, 'xh-target.org', 443, new Uint8Array([9, 8, 7]));
    const body = new ReadableStream({ start(c) { c.enqueue(frame); ctrl = c; } });
    const req = {
      url: 'https://w.test/xh', method: 'POST',
      headers: { get: k => ({ 'content-type': 'application/grpc' })[k.toLowerCase()] ?? null },
      body, cf: {}, fetcher: { connect(a) { const sock = makeTargetSocket(typeof a === 'string' ? a : a.hostname, (a && a.port) || 443); connectLog.push(sock); return sock; } }
    };
    const res = await SN3.default.fetch(req, undefined, { waitUntil() {} });
    check('snippets xHTTP：响应 200 + octet-stream 头', res.status === 200 && (res.headers.get('content-type') || '').includes('octet-stream') && res.headers.get('grpc-status') === '0', String(res.status));
    await sleep(150);
    check('snippets xHTTP：建连目标正确', connectLog.some(s => s.host === 'xh-target.org' && s.port === 443), connectLog.map(s => s.host + ':' + s.port).join(','));
    const target = connectLog.find(s => s.host === 'xh-target.org');
    check('snippets xHTTP：payload 透传远端', target && target.written.some(w => w[0] === 9 && w[1] === 8 && w[2] === 7), target ? target.written.map(w => w.length).join(',') : 'no target');
    const rdr = res.body.getReader();
    const first = await rdr.read();
    check('snippets xHTTP：VLESS 应答前缀 [0,0]', first.value && first.value[0] === 0 && first.value[1] === 0, JSON.stringify(first.value && Array.from(first.value.slice(0, 2))));
    target._push(new Uint8Array([5, 5, 5, 5]));
    const second = await rdr.read();
    check('snippets xHTTP：下行数据回传', second.value && second.value[0] === 5 && second.value.length === 4, JSON.stringify(second.value && Array.from(second.value)));
    ctrl.close();
  } catch (e) { check('snippets xHTTP 传输测试', false, e.message); }

  // snippets：xHTTP 强化（padding 校验/响应 padding/no-store/测速站拦截）
  try {
    const SN4 = await import(pathToFileURL(DIR + 'snippets.js').href);
    const srcLine4 = readFileSync(DIR + 'snippets.js', 'utf8').split('\n')[0];
    const snipUuid4 = extractUuid(srcLine4);
    const pdh = snipUuid4.slice(1, 7);
    connectLog = [];
    __pairs.length = 0;
    let ctrl4;
    const mkReq = (pad, host) => {
      const fr = vlessFrame(snipUuid4, host || 'xh2-target.org', 443, new Uint8Array([1]));
      const bd = new ReadableStream({ start(c) { c.enqueue(fr); ctrl4 = c; } });
      return { url: 'https://w.test/xh', method: 'POST', headers: { get: k => ({ 'content-type': 'application/grpc' }[k.toLowerCase()] ?? (k.toLowerCase() === pdh ? pad : null)) }, body: bd, cf: {}, fetcher: { connect(a) { const sock = makeTargetSocket(typeof a === 'string' ? a : a.hostname, (a && a.port) || 443); connectLog.push(sock); return sock; } } };
    };
    const r1 = await SN4.default.fetch(mkReq('abc'), undefined, { waitUntil() {} });
    check('snippets xHTTP：短 padding 拒绝 400', r1.status === 400, String(r1.status));
    const r2 = await SN4.default.fetch(mkReq('A'.repeat(160)), undefined, { waitUntil() {} });
    check('snippets xHTTP：合法 padding 放行 200', r2.status === 200, String(r2.status));
    const padH = r2.headers.get(pdh) || '';
    check('snippets xHTTP：响应携带随机 padding 头', padH.length >= 100 && padH.length <= 1100, `len=${padH.length}`);
    check('snippets xHTTP：响应含 no-store', r2.headers.get('cache-control') === 'no-store', String(r2.headers.get('cache-control')));
    const r3 = await SN4.default.fetch(mkReq('', 'speed.cloudflare.com'), undefined, { waitUntil() {} });
    const b3 = new Uint8Array(await r3.arrayBuffer());
    const txt3 = Buffer.from(b3.slice(2)).toString('utf8');
    check('snippets 测速站本地拦截（无建连）', r3.status === 200 && txt3.includes('HTTP/1.1 204') && !connectLog.some(s => s.host.includes('speed')), `body=${txt3.slice(0, 36)}`);
    try { ctrl4 && ctrl4.close(); } catch {}

    // snippets：xHTTP 显式拒绝 UDP（cmd=2）
    try {
      connectLog = [];
      __pairs.length = 0;
      const frU = vlessFrame(snipUuid4, 'udp-target.org', 53);
      frU[18] = 2;
      const bdU = new ReadableStream({ start(c) { c.enqueue(frU); c.close(); } });
      const rU = await SN4.default.fetch({ url: 'https://w.test/xh', method: 'POST', headers: { get: k => ({ 'content-type': 'application/grpc' })[k.toLowerCase()] ?? null }, body: bdU, cf: {}, fetcher: { connect(a) { const sock = makeTargetSocket(typeof a === 'string' ? a : a.hostname, (a && a.port) || 443); connectLog.push(sock); return sock; } } }, undefined, { waitUntil() {} });
      const bU = (await rU.text()).slice(0, 40);
      check('snippets xHTTP：UDP(cmd=2) 显式拒绝 400', rU.status === 400 && bU.includes('UDP'), rU.status + ': ' + bU);
    } catch (e) { check('snippets UDP 拒绝测试', false, e.message); }
    } catch (e) { check('snippets xHTTP 强化测试', false, e.message); }

  // worker：xHTTP/gRPC 传输全链路 + padding + 测速 + UDP 拒绝 + sstp
  try {
    const wUuid = '06b65903-406d-4a41-8463-6fd5c0ee7798';
    const wpdh = wUuid.slice(1, 7);
    connectLog = [];
    __pairs.length = 0;
    let wctrl;
    const wframe = vlessFrame(wUuid, 'wxh-target.org', 443, new Uint8Array([9, 8, 7]));
    const wbody = new ReadableStream({ start(c) { c.enqueue(wframe); wctrl = c; } });
    const wreq = {
      url: 'https://w.test/xh', method: 'POST',
      headers: { get: k => ({ 'content-type': 'application/grpc' })[k.toLowerCase()] ?? null },
      body: wbody, cf: {},
      fetcher: { connect(a) { const sock = makeTargetSocket(typeof a === 'string' ? a : a.hostname, (a && a.port) || 443); connectLog.push(sock); return sock; } }
    };
    const wres = await WK.default.fetch(wreq, {}, { waitUntil() {} });
    check('worker xHTTP：200 + octet-stream + grpc-status + no-store', wres.status === 200 && (wres.headers.get('content-type') || '').includes('octet-stream') && wres.headers.get('grpc-status') === '0' && wres.headers.get('cache-control') === 'no-store', String(wres.status));
    await sleep(150);
    const wtarget = connectLog.find(s => s.host === 'wxh-target.org');
    check('worker xHTTP：建连目标正确', !!wtarget, connectLog.map(s => s.host + ':' + s.port).join(','));
    check('worker xHTTP：payload 透传远端', wtarget && wtarget.written.some(w => w[0] === 9 && w[1] === 8 && w[2] === 7), wtarget ? wtarget.written.map(w => w.length).join(',') : 'no target');
    const wrdr = wres.body.getReader();
    const wfirst = await wrdr.read();
    check('worker xHTTP：VLESS 应答前缀 [0,0]', wfirst.value && wfirst.value[0] === 0 && wfirst.value[1] === 0, JSON.stringify(wfirst.value && Array.from(wfirst.value.slice(0, 2))));
    const wpadH = wres.headers.get(wpdh) || '';
    check('worker xHTTP：响应随机 padding 头', wpadH.length >= 100 && wpadH.length <= 1100, `len=${wpadH.length}`);
    // padding 短值拒绝
    const wbad = new ReadableStream({ start(c) { c.enqueue(wframe); c.close(); } });
    const wres2 = await WK.default.fetch({ url: 'https://w.test/xh2', method: 'POST', headers: { get: k => ({ 'content-type': 'application/grpc', [wpdh]: 'abc' })[k.toLowerCase()] ?? null }, body: wbad, cf: {}, fetcher: wreq.fetcher }, {}, { waitUntil() {} });
    check('worker xHTTP：短 padding 拒绝 400', wres2.status === 400, String(wres2.status));
    // UDP cmd=2 拒绝
    connectLog = [];
    const frU2 = vlessFrame(wUuid, 'udp2.org', 53);
    frU2[18] = 2;
    const wres3 = await WK.default.fetch({ url: 'https://w.test/xh3', method: 'POST', headers: { get: k => ({ 'content-type': 'application/grpc' })[k.toLowerCase()] ?? null }, body: new ReadableStream({ start(c) { c.enqueue(frU2); c.close(); } }), cf: {}, fetcher: wreq.fetcher }, {}, { waitUntil() {} });
    check('worker xHTTP：UDP(cmd=2) 拒绝 400', wres3.status === 400, String(wres3.status));
    // 测速站本地拦截
    connectLog = [];
    const frSp = vlessFrame(wUuid, 'speed.cloudflare.com', 443);
    const wres4 = await WK.default.fetch({ url: 'https://w.test/xh4', method: 'POST', headers: { get: k => ({ 'content-type': 'application/grpc' })[k.toLowerCase()] ?? null }, body: new ReadableStream({ start(c) { c.enqueue(frSp); c.close(); } }), cf: {}, fetcher: wreq.fetcher }, {}, { waitUntil() {} });
    const bSp = new Uint8Array(await wres4.arrayBuffer());
    check('worker xHTTP：测速站本地 204 拦截', wres4.status === 200 && !connectLog.some(s => s.host.includes('speed')) && Buffer.from(bSp.slice(2)).toString().includes('HTTP/1.1 204'), `body=${Buffer.from(bSp.slice(2)).toString().slice(0, 24)}`);
    // sstp 全局代理（xHTTP 路径）
    connectLog = [];
    const frSS = vlessFrame(wUuid, 'ss-target.org', 443, new Uint8Array([4]));
    const wres5 = await WK.default.fetch({ url: 'https://w.test/sstp://1.2.3.4:443', method: 'POST', headers: { get: k => ({ 'content-type': 'application/grpc' })[k.toLowerCase()] ?? null }, body: new ReadableStream({ start(c) { c.enqueue(frSS); c.close(); } }), cf: {}, fetcher: wreq.fetcher }, {}, { waitUntil() {} });
    check('worker xHTTP：sstp:// 全局代理建连', wres5.status === 200 && connectLog.some(s => s.host === '1.2.3.4' && s.port === 443 && s.written.some(w => w[0] === 4)), connectLog.map(s => s.host + ':' + s.port).join(','));
    try { wctrl && wctrl.close(); } catch {}
  } catch (e) { console.error('[wxh ERR]', e.stack || e.message); check('worker xHTTP 测试', false, String(e.stack || e.message).split('\n')[0]); }

  // snippets：sstp:// 全局代理透传（TCP 连 443 后回 VLESS 前缀）+ 12s 超时参数存在性
  try {
    const snipUuid5 = extractUuid(readFileSync(DIR + 'snippets.js', 'utf8').split('\n')[0]);
    const SN5 = await import(pathToFileURL(DIR + 'snippets.js').href);
    connectLog = [];
    __pairs.length = 0;
    const frS = vlessFrame(snipUuid5, 'sstp-target.org', 443);
    let cS; const bdS = new ReadableStream({ start(c) { c.enqueue(frS); cS = c; } });
    const rS = await SN5.default.fetch({ url: 'https://w.test/xh', method: 'POST', headers: { get: k => ({ 'content-type': 'application/grpc' })[k.toLowerCase()] ?? null }, body: bdS, cf: {}, fetcher: { connect(a) { const sock = makeTargetSocket(typeof a === 'string' ? a : a.hostname, (a && a.port) || 443); connectLog.push(sock); return sock; } } }, undefined, { waitUntil() {} });
    const rdrS = rS.body.getReader();
    const fS = await Promise.race([rdrS.read(), new Promise((_, re) => setTimeout(() => re(new Error('TIMEOUT')), 800))]);
    check('snippets sstp:// 全局代理透传', fS.value && fS.value[0] === 0 && fS.value[1] === 0 && connectLog.some(s => s.host === 'sstp-target.org' && s.port === 443), connectLog.map(s => s.host + ':' + s.port).join(',') + ' prefix=' + JSON.stringify(fS.value && Array.from(fS.value.slice(0, 2))));
    rdrS.cancel().catch(() => {}); cS && cS.close();
    check('snippets 12s 建连超时已配置', readFileSync(DIR + 'snippets.js', 'utf8').includes('12e3'), 'yes');
  } catch (e) { check('snippets sstp 测试', false, e.message); }

  // worker：AD_FILTER 环境变量自定义过滤正则（把 FI 那条也过滤掉，验证变量生效）
  try {
    globalThis.fetch = async (url, opts) => {
      const u = String(url instanceof URL ? url : url?.url || url);
      if (u.includes('host=example.com&uuid=00000000-0000-4000-8000-000000000000')) return new Response(Buffer.from(mockGen).toString('base64'), { status: 200 });
      return new Response('nf', { status: 404 });
    };
    const req = stubRequest('https://w.test/123456', {});
    const res = await WK.default.fetch(req, { AD_FILTER: '212\\.147|telegram' }, { waitUntil() {} });
    const text = Buffer.from(await res.text(), 'base64').toString('utf8');
    check('worker AD_FILTER 自定义正则生效', !text.includes('212.147.249.131') && text.includes('167.253.159.197'), 'FI 已剔除，SG 保留');
  } catch (e) { check('worker AD_FILTER 自定义正则生效', false, e.message); }

  // worker：getSafeEnv D1 全量缓存（单飞读表 / env 优先 / reset 失效）
  try {
    const { getSafeEnv, cfgCacheReset } = WK;
    let q = 0;
    const db = { prepare() { q++; return { bind() { return this; }, all: async () => ({ results: [{ key: 'PROXYIP', value: '9.9.9.9' }] }) }; } };
    cfgCacheReset();
    const gv1 = await getSafeEnv({ DB: db }, 'PROXYIP', 'def');
    const gv2 = await getSafeEnv({ DB: db }, 'PROXYIP', 'def');
    check('worker getSafeEnv：D1 全表缓存（两次调用一次读表）', gv1 === '9.9.9.9' && gv2 === '9.9.9.9' && q === 1, `q=${q} v=${gv1}/${gv2}`);
    const gv3 = await getSafeEnv({ PROXYIP: '1.1.1.1', DB: db }, 'PROXYIP', 'def');
    check('worker getSafeEnv：环境变量优先于 D1', gv3 === '1.1.1.1' && q === 1, `q=${q} v=${gv3}`);
    cfgCacheReset();
    const gv4 = await getSafeEnv({ DB: db }, 'NOTSET', 'fb');
    check('worker getSafeEnv：reset 后重新读表并回退默认', q === 2 && gv4 === 'fb', `q=${q} v=${gv4}`);
    cfgCacheReset();
  } catch (e) { check('worker getSafeEnv 缓存测试', false, e.message); }

  // worker：incrementDailyStats 降频（INSERT 每连接发，DELETE 清理每天只一次，无逐连接 SELECT）
  try {
    let sq = [];
    const sdb = { prepare(sql) { return { bind() { return this; }, run: async () => { sq.push(sql.trim().split(' ')[0].toUpperCase()); return {}; }, all: async () => ({ results: [] }) }; } };
    await WK.incrementDailyStats({ DB: sdb });
    await WK.incrementDailyStats({ DB: sdb });
    const ins = sq.filter(x => x === 'INSERT').length, del = sq.filter(x => x === 'DELETE').length, sel = sq.filter(x => x === 'SELECT').length;
    check('worker incrementDailyStats：DELETE 降频为每天一次且无 SELECT', ins === 2 && del === 1 && sel === 0, `INSERT=${ins} DELETE=${del} SELECT=${sel}`);
  } catch (e) { check('worker incrementDailyStats 降频测试', false, e.message); }

  // worker：getCustomIPs 远程源并行抓取（顺序保持 / 单源失败不影响 / 不再串行累加）
  try {
    const t0 = Date.now();
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('slow1')) { await sleep(80); return new Response('ip-slow-a#慢源\nip-slow-b', { status: 200 }); }
      if (u.includes('boom')) throw new Error('net down');
      return new Response('ip-fast-a\n#注释行\nip-fast-b', { status: 200 });
    };
    const gIPs = await WK.getCustomIPs({ ADDAPI: 'https://slow1.test/a, https://boom.test/b, https://fast.test/c' }, 7);
    check('worker getCustomIPs：并行抓取顺序保持且单源失败不影响', gIPs.length === 4 && gIPs[0] === 'ip-slow-a#慢源' && gIPs.includes('ip-slow-b') && gIPs.includes('ip-fast-a') && gIPs.includes('ip-fast-b'), gIPs.join(','));
    check('worker getCustomIPs：并行耗时低于串行累加', Date.now() - t0 < 200, (Date.now() - t0) + 'ms');
  } catch (e) { check('worker getCustomIPs 测试', false, e.message); }

  // 反代链 EDT 对齐：TXT 池展开竞速 / tp1 寻找服务兜底 / 直连 DoH 预解析（worker + snippets）
  try {
    const wUuid = '06b65903-406d-4a41-8463-6fd5c0ee7798';
    const dohMock = (name, type) => {
      const n = String(name).toLowerCase().replace(/\.$/, '');
      if (n === 'pool.test' && type === 'TXT') return { Answer: [{ type: 16, data: '"1.2.3.4:11485,5.6.7.8"' }] };
      if (n === 'multi.test' && type === 'A') return { Answer: [{ type: 1, data: '9.9.9.9' }, { type: 1, data: '8.8.8.8' }] };
      return {};
    };
    globalThis.fetch = async (url) => {
      const u = String(url instanceof URL ? url : url?.url || url);
      const m = u.match(/[?&]name=([^&]+)&type=([A-Za-z]+)/);
      if (m && /dns-query|\/resolve/.test(u)) return new Response(JSON.stringify(dohMock(decodeURIComponent(m[1]), m[2])), { status: 200 });
      return new Response('nf', { status: 404 });
    };
    const mkFailFetcher = (failHosts) => ({ connect(a) {
      const host = typeof a === 'string' ? a : a.hostname;
      const port = typeof a === 'string' ? 443 : (a.port ?? 443);
      const s = makeTargetSocket(host, port);
      if (failHosts.includes(host)) s.opened = Promise.reject(new Error('blocked'));
      connectLog.push(s);
      return s;
    } });
    // worker：/proxyip=域名 → TXT 池展开竞速（直连先败）
    connectLog = []; __pairs.length = 0;
    const reqP = stubRequest('https://w.test/proxyip=pool.test', { 'Upgrade': 'websocket' });
    reqP.fetcher = mkFailFetcher(['real-target.org']);
    await WK._ws(reqP, {});
    const pairP = __pairs[__pairs.length - 1];
    pairP.server._onmessage(vlessFrame(wUuid, 'real-target.org', 443, new Uint8Array([7])));
    await sleep(300);
    check('worker /proxyip=域名：TXT 池展开竞速建连', connectLog.some(s => s.host === '1.2.3.4' && s.port === 11485) && !connectLog.some(s => s.host === 'proxyip.tp1.090227.xyz'), connectLog.map(s => s.host + ':' + s.port).join(','));
    pairP.client.close();
    // worker：池全败 → tp1 寻找服务兜底
    connectLog = []; __pairs.length = 0;
    const reqT = stubRequest('https://w.test/proxyip=pool.test', { 'Upgrade': 'websocket' });
    reqT.fetcher = mkFailFetcher(['real-target.org', '1.2.3.4', '5.6.7.8']);
    await WK._ws(reqT, {});
    const pairT = __pairs[__pairs.length - 1];
    pairT.server._onmessage(vlessFrame(wUuid, 'real-target.org', 443, new Uint8Array([7])));
    await sleep(300);
    check('worker /proxyip=：池全败回退 tp1 寻找服务', connectLog.some(s => s.host === 'proxyip.tp1.090227.xyz' && s.port === 1), connectLog.map(s => s.host + ':' + s.port).join(','));
    pairT.client.close();
    // worker：直连 DoH 预解析（目标域名 → 字面 IP 竞速）
    connectLog = []; __pairs.length = 0;
    const reqM = stubRequest('https://w.test/', { 'Upgrade': 'websocket' });
    reqM.fetcher = mkFailFetcher([]);
    await WK._ws(reqM, {});
    const pairM = __pairs[__pairs.length - 1];
    pairM.server._onmessage(vlessFrame(wUuid, 'multi.test', 443, new Uint8Array([7])));
    await sleep(300);
    check('worker 直连：DoH 预解析按字面 IP 竞速', connectLog.some(s => s.host === '9.9.9.9') && !connectLog.some(s => s.host === 'multi.test'), connectLog.map(s => s.host + ':' + s.port).join(','));
    pairM.client.close();
    // snippets：/proxyip=域名 TXT 优先（无需 !txt 后缀，EDT 对齐）
    const SN6 = await import(pathToFileURL(DIR + 'snippets.js').href);
    const snipUuid6 = extractUuid(readFileSync(DIR + 'snippets.js', 'utf8').split('\n')[0]);
    connectLog = []; __pairs.length = 0;
    const reqS = stubRequest('https://w.test/proxyip=pool.test', { 'Upgrade': 'websocket' });
    reqS.fetcher = mkFailFetcher(['snip-target.org']);
    await SN6.default.fetch(reqS, undefined, { waitUntil() {} });
    const pairS = __pairs[__pairs.length - 1];
    pairS.server._onmessage(vlessFrame(snipUuid6, 'snip-target.org', 443, new Uint8Array([7])));
    await sleep(300);
    check('snippets /proxyip=域名：TXT 优先池展开（EDT 对齐）', connectLog.some(s => (s.host === '1.2.3.4' && s.port === 11485) || s.host === '5.6.7.8'), connectLog.map(s => s.host + ':' + s.port).join(','));
    pairS.client.close();
  } catch (e) { check('反代链 EDT 对齐测试', false, e.message); }

  globalThis.fetch = realFetch;
}

// ================= 汇总 =================
console.log('\n===== 汇总 =====');
const fail = results.filter(r => !r.ok);
console.log(`共 ${results.length} 项，失败 ${fail.length} 项`);
if (fail.length) { console.log('失败项:'); fail.forEach(f => console.log(' - ' + f.name)); }
