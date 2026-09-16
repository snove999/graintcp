// 测试夹具：模拟 workerd 环境，验证 worker.js / snippets.js 的路径解析与 WS 流程
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
// 用 fileURLToPath 而非 URL.pathname：后者是 percent-encoded 的，
// 路径含非 ASCII（如 `GitHub系列`）时会被双重编码，导致 import() 解析失败。
const DIR = fileURLToPath(new URL('.', import.meta.url));
import crypto from 'node:crypto';

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
  const patched = src + '\nexport { pCfg, parseAddressPort, addrParser, setUUID, CFG, ws as _ws, parseTurnProxyConfig, getSafeEnv, cfgCacheReset, incrementDailyStats, getCustomIPs, XH_HS, XH_GCHK, XH_GFR, XH_GDEC, XH_isGrpc, XH_pdFeat };\nexport const __setPD=(h,k)=>{XH_PDH=h;XH_PDK=k};\n';
  writeFileSync(DIR + '_worker_test.mjs', patched);
  return import(pathToFileURL(DIR + '_worker_test.mjs').href);}

// snippets 侧 XH_HS 边界用例：追加命名导出（顶层名在混淆产物中同样保留）
async function loadSnippetsXH() {
  const src = readFileSync(DIR + 'snippets.js', 'utf8');
  writeFileSync(DIR + '_snippets_xh.mjs', src + '\nexport { XH_HS };\n');
  return import(pathToFileURL(DIR + '_snippets_xh.mjs').href);
}

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
    // Snippets 出站预算实测仅 2 次（fetch 与 connect 合并计数）：直连腿失败后若再做 TXT 查询
    // 就是第 3 次 → 线上 502「Too many subrequests」。故 Snippets 侧改为：域名 proxyip（无 !txt）
    // 直接 connect 主机名（预算内）；只有显式 !txt 才查 TXT 池。Workers 侧不受此限，保留 TXT 预解析。
    const reqS = stubRequest('https://w.test/proxyip=pool.test', { 'Upgrade': 'websocket' });
    reqS.fetcher = mkFailFetcher(['snip-target.org']);
    await SN6.default.fetch(reqS, undefined, { waitUntil() {} });
    const pairS = __pairs[__pairs.length - 1];
    pairS.server._onmessage(vlessFrame(snipUuid6, 'snip-target.org', 443, new Uint8Array([7])));
    await sleep(300);
    check('snippets /proxyip=域名（无 !txt）：预算内直接 connect 主机名', connectLog.some(s => s.host === 'pool.test'), connectLog.map(s => s.host + ':' + s.port).join(','));
    pairS.client.close();

    connectLog = []; __pairs.length = 0;
    const reqS2 = stubRequest('https://w.test/proxyip=pool.test!txt', { 'Upgrade': 'websocket' });
    reqS2.fetcher = mkFailFetcher(['snip-target.org']);
    await SN6.default.fetch(reqS2, undefined, { waitUntil() {} });
    const pairS2 = __pairs[__pairs.length - 1];
    pairS2.server._onmessage(vlessFrame(snipUuid6, 'snip-target.org', 443, new Uint8Array([7])));
    await sleep(300);
    check('snippets /proxyip=域名!txt：TXT 池展开（显式 opt-in，仍保留）', connectLog.some(s => (s.host === '1.2.3.4' && s.port === 11485) || s.host === '5.6.7.8'), connectLog.map(s => s.host + ':' + s.port).join(','));
    pairS2.client.close();
  } catch (e) { check('反代链 EDT 对齐测试', false, e.message); }

  globalThis.fetch = realFetch;
}

// ================= 7. 补盲回归：xHTTP 下行回传 × xHTTP×/proxyip= × 非法编码 =================
// 背景：本次线上 P0（worker xHTTP 下行被 drop）能溜到线上，源于两个盲区：
//   a) worker xHTTP 用例只验上行 payload 与 [0,0] 前缀，从未验下行回传；
//   b) /proxyip= 用例全部只在 WS 下跑，xHTTP × /proxyip= 组合零覆盖。
// 本节永久堵上这两个盲区，并加固非法百分号编码健壮性。worker 手工构造 req/fetcher，snippets 走 SN.default.fetch。
console.log('\n===== 补盲回归：xHTTP 下行 × /proxyip= × 非法编码 =====');
{
  // 复刻既有空 DoH 桩（line 775 之后 globalThis.fetch 已还原，需显式装回，保证 hostname 反代展开确定性）
  globalThis.fetch = async (url, opts) => {
    const u = String(url instanceof URL ? url : url?.url || url);
    if (/dns-query|\/resolve/.test(u) && /[?&]name=/.test(u)) return new RealResponse(JSON.stringify({ Answer: [] }), { status: 200, headers: { 'content-type': 'application/dns-json' } });
    return realFetch(url, opts);
  };

  const W_UUID = '06b65903-406d-4a41-8463-6fd5c0ee7798';
  const SN_UUID = extractUuid(readFileSync(DIR + 'snippets.js', 'utf8').split('\n')[0]);

  // 直连腿失败桩（复用既有 mkFailFetcher 语义：opened reject 逼出 proxy 回落）
  const mkBlockFetcher = (failHosts) => ({ connect(a) {
    const host = typeof a === 'string' ? a : a.hostname;
    const port = typeof a === 'string' ? 443 : (a.port ?? 443);
    const s = makeTargetSocket(host, port);
    if (failHosts.includes(host)) s.opened = Promise.reject(new Error('blocked'));
    connectLog.push(s);
    return s;
  } });
  const okFetcher = { connect(a) { const s = makeTargetSocket(typeof a === 'string' ? a : a.hostname, (a && a.port) || 443); connectLog.push(s); return s; } };

  // 带超时读，避免旧代码「下行被 drop → 响应体永不产出」时挂死
  const readOr = (rdr, ms) => Promise.race([
    rdr.read().then(v => v).catch(() => ({ value: null, error: true })),
    new Promise(r => setTimeout(() => r({ value: null, timeout: true }), ms))
  ]);

  // 统一 xHTTP POST 请求构造：body 保持开启（供下行读取），octet-stream 走双端同一入口
  const mkXhReq = (url, frame, fetcher) => {
    let ctrl;
    const body = new ReadableStream({ start(c) { c.enqueue(frame); ctrl = c; } });
    const req = {
      url, method: 'POST',
      headers: { get: k => (k.toLowerCase() === 'content-type' ? 'application/octet-stream' : null) },
      body, cf: {}, fetcher
    };
    return { req, close: () => { try { ctrl.close(); } catch {} } };
  };

  // 路径变体矩阵（双端共用）：覆盖明文/百分号编码/整体编码/点号/尾随斜杠/简写/中段
  const PIP_VARIANTS = [
    ['/proxyip=1.1.1.11', '1.1.1.11', 443],
    ['/proxyip%3D1.1.1.12', '1.1.1.12', 443],
    ['/%2Fproxyip%3D1.1.1.13', '1.1.1.13', 443],
    ['/proxyip.1.1.1.14', '1.1.1.14', 443],
    ['/proxyip=1.1.1.15/', '1.1.1.15', 443],
    ['/ip=1.1.1.16', '1.1.1.16', 443],
    ['/pyip=1.1.1.17', '1.1.1.17', 443],
    ['/xh/proxyip=1.1.1.18', '1.1.1.18', 443],
  ];
  const DEFAULT_W = 'cmliussss'; // worker/snippets 默认反代主机名均含该片段

  // ---------- 7.1 worker pCfg 路径矩阵（单元，精确断言 pIP + order 语义） ----------
  {
    const t = (p) => { const u = new URL('https://w.test' + p); return WK.pCfg(u, u.pathname.slice(1), 'ProxyIP.CMLiussss.net'); };
    for (const [p, addr, port] of PIP_VARIANTS) {
      let c = null, err = '';
      try { c = t(p); } catch (e) { err = e.message; }
      const ok = !err && c && c.pIP?.address === addr && c.pIP?.port === port && c.order.join() === 'direct,proxy';
      check(`worker pCfg ${p} → pIP=${addr} + order=[direct,proxy]`, ok, err ? 'THROW ' + err : JSON.stringify({ pIP: c?.pIP, order: c?.order }));
    }
  }

  // ---------- 7.2 worker xHTTP 下行回传（本次 P0 直接覆盖；修复前必红） ----------
  {
    connectLog = []; __pairs.length = 0;
    const frame = vlessFrame(W_UUID, 'xh-down.org', 443, new Uint8Array([0x16, 3, 1, 0]));
    const { req, close } = mkXhReq('https://w.test/xh', frame, okFetcher);
    try {
      const res = await WK.default.fetch(req, {}, { waitUntil() {} });
      const rdr = res.body.getReader();
      const first = await readOr(rdr, 800);
      check('worker xHTTP(octet-stream) 下行：首块 VLESS 前缀 [0,0]', !!first.value && first.value[0] === 0 && first.value[1] === 0, JSON.stringify(first.value ? Array.from(first.value.slice(0, 2)) : first));
      const target = connectLog.find(s => s.host === 'xh-down.org');
      check('worker xHTTP 下行：远端 socket 已建连', !!target, connectLog.map(s => s.host).join(','));
      if (target) target._push(new Uint8Array([5, 5, 5, 5]));
      const second = await readOr(rdr, 800);
      check('worker xHTTP 下行：远端数据回传客户端', !!second.value && second.value.length === 4 && second.value[0] === 5, JSON.stringify(second.value ? Array.from(second.value) : second));
      check('worker xHTTP 下行：远端 socket 未被关闭', !!target && !target._isClosed(), target ? 'closed=' + target._isClosed() : 'no target');
      rdr.cancel().catch(() => {});
    } catch (e) { check('worker xHTTP 下行回传测试', false, e.message); }
    close();
  }

  // ---------- 7.3 worker xHTTP × /proxyip=（组合端到端：直连腿失败 → 必须连到 path 指定反代，而非默认反代） ----------
  for (const [p, addr, port] of PIP_VARIANTS) {
    connectLog = []; __pairs.length = 0;
    const targetHost = 'xh-real-' + addr.replace(/\./g, '-') + '.org';
    const frame = vlessFrame(W_UUID, targetHost, 443, new Uint8Array([7]));
    const { req, close } = mkXhReq('https://w.test' + p, frame, mkBlockFetcher([targetHost]));
    try {
      const res = await WK.default.fetch(req, {}, { waitUntil() {} });
      await sleep(120);
      const hit = connectLog.some(s => s.host === addr && s.port === port);
      const fellBack = connectLog.some(s => s.host.toLowerCase().includes(DEFAULT_W));
      check(`worker xHTTP ${p} → 反代 ${addr}:${port}（非默认反代）`, res.status === 200 && hit && !fellBack, `status=${res.status} log=${connectLog.map(s => s.host + ':' + s.port).join(',')}`);
    } catch (e) { check(`worker xHTTP ${p} → 反代 ${addr}:${port}（非默认反代）`, false, e.message); }
    close();
  }

  // ---------- 7.4 snippets xHTTP × /proxyip=（同一路径矩阵，双端一致性） ----------
  const SN = await import(pathToFileURL(DIR + 'snippets.js').href);
  for (const [p, addr, port] of PIP_VARIANTS) {
    connectLog = []; __pairs.length = 0;
    const targetHost = 'sn-real-' + addr.replace(/\./g, '-') + '.org';
    const frame = vlessFrame(SN_UUID, targetHost, 443, new Uint8Array([7]));
    const { req, close } = mkXhReq('https://w.test' + p, frame, mkBlockFetcher([targetHost]));
    try {
      const res = await SN.default.fetch(req, undefined, { waitUntil() {} });
      await sleep(120);
      const hit = connectLog.some(s => s.host === addr && s.port === port);
      const fellBack = connectLog.some(s => s.host.toLowerCase().includes(DEFAULT_W));
      check(`snippets xHTTP ${p} → 反代 ${addr}:${port}（非默认反代）`, res.status === 200 && hit && !fellBack, `status=${res.status} log=${connectLog.map(s => s.host + ':' + s.port).join(',')}`);
    } catch (e) { check(`snippets xHTTP ${p} → 反代 ${addr}:${port}（非默认反代）`, false, e.message); }
    close();
  }

  // ---------- 7.5 snippets xHTTP 下行回传（镜像，octet-stream 入口） ----------
  {
    connectLog = []; __pairs.length = 0;
    const frame = vlessFrame(SN_UUID, 'sn-xh-down.org', 443, new Uint8Array([0x16, 3, 1, 0]));
    const { req, close } = mkXhReq('https://w.test/xh', frame, okFetcher);
    try {
      const res = await SN.default.fetch(req, undefined, { waitUntil() {} });
      const rdr = res.body.getReader();
      const first = await readOr(rdr, 800);
      check('snippets xHTTP(octet-stream) 下行：首块 [0,0]', !!first.value && first.value[0] === 0 && first.value[1] === 0, JSON.stringify(first.value ? Array.from(first.value.slice(0, 2)) : first));
      const target = connectLog.find(s => s.host === 'sn-xh-down.org');
      if (target) target._push(new Uint8Array([6, 6, 6]));
      const second = await readOr(rdr, 800);
      check('snippets xHTTP 下行：远端数据回传客户端', !!second.value && second.value.length === 3 && second.value[0] === 6, JSON.stringify(second.value ? Array.from(second.value) : second));
      check('snippets xHTTP 下行：远端 socket 未被关闭', !!target && !target._isClosed(), target ? 'closed=' + target._isClosed() : 'no target');
      rdr.cancel().catch(() => {});
    } catch (e) { check('snippets xHTTP 下行回传测试', false, e.message); }
    close();
  }

  // ---------- 7.6 非法百分号编码健壮性（不抛异常 / 不 500 / 路由可预期） ----------
  {
    const BAD = ['%', '%zz', '%E0%A4%A'];
    // worker pCfg 单元：非法编码必须安全降级（保留原值），返回结构完整、order 非空
    let unitOk = true, unitInfo = [];
    for (const b of BAD) {
      try {
        const u = new URL('https://w.test/' + b);
        const c = WK.pCfg(u, u.pathname.slice(1), 'ProxyIP.CMLiussss.net');
        const good = c && Array.isArray(c.order) && c.order.length > 0;
        if (!good) unitOk = false;
        unitInfo.push(b + '=>' + JSON.stringify({ pIP: c?.pIP, order: c?.order }));
      } catch (e) { unitOk = false; unitInfo.push(b + '=>THROW ' + e.message); }
    }
    check('worker pCfg 非法百分号编码不抛异常（%/%zz/%E0%A4%A）', unitOk, unitInfo.join(' | '));

    // worker xHTTP e2e：非法编码路径不得 500 / 不得崩溃
    for (const b of BAD) {
      connectLog = []; __pairs.length = 0;
      const frame = vlessFrame(W_UUID, 'xh-enc.org', 443, new Uint8Array([7]));
      const { req, close } = mkXhReq('https://w.test/' + b, frame, okFetcher);
      let status = 0, err = '';
      try { const res = await WK.default.fetch(req, {}, { waitUntil() {} }); status = res.status; } catch (e) { err = e.message; }
      check(`worker xHTTP 非法编码 "${b}"：正常放行 200 不崩溃`, !err && status === 200, err ? 'THROW ' + err : 'status=' + status);
      close();
    }
    // snippets xHTTP e2e：同断言
    for (const b of BAD) {
      connectLog = []; __pairs.length = 0;
      const frame = vlessFrame(SN_UUID, 'sn-enc.org', 443, new Uint8Array([7]));
      const { req, close } = mkXhReq('https://w.test/' + b, frame, okFetcher);
      let status = 0, err = '';
      try { const res = await SN.default.fetch(req, undefined, { waitUntil() {} }); status = res.status; } catch (e) { err = e.message; }
      check(`snippets xHTTP 非法编码 "${b}"：正常放行 200 不崩溃`, !err && status === 200, err ? 'THROW ' + err : 'status=' + status);
      close();
    }
  }

  // ---------- 7.6b `%3F` 预解码 + 非法编码（本次缺陷的原始触发路径：URIError → 500）----------
  // 双端 4 条入口：worker/snippets × ws/xhF。修复前 decodeURIComponent 未包 try → 抛 URIError → 顶层 catch 返回 500。
  {
    const QBAD = ['x%3F%zz', 'x%3F%', 'x%3F%E0%A4%A'];
    // worker ws 入口（成功=101）
    for (const b of QBAD) {
      connectLog = []; __pairs.length = 0;
      const frame = vlessFrame(W_UUID, 'xh-q.org', 443);
      const req = stubRequest('https://w.test/' + b, { 'Upgrade': 'websocket', 'sec-websocket-protocol': Buffer.from(frame).toString('base64url') });
      let status = 0, err = '';
      try { const res = await WK.default.fetch(req, {}, { waitUntil() {} }); status = res.status; } catch (e) { err = e.message; }
      check(`worker ws 入口 "%3F+非法编码 ${b}"：正常建连 101 不崩溃`, !err && status === 101, err ? 'THROW ' + err : 'status=' + status);
    }
    // worker xhF 入口（成功=200）
    for (const b of QBAD) {
      connectLog = []; __pairs.length = 0;
      const frame = vlessFrame(W_UUID, 'xh-q2.org', 443, new Uint8Array([7]));
      const { req, close } = mkXhReq('https://w.test/' + b, frame, okFetcher);
      let status = 0, err = '';
      try { const res = await WK.default.fetch(req, {}, { waitUntil() {} }); status = res.status; } catch (e) { err = e.message; }
      check(`worker xhF 入口 "%3F+非法编码 ${b}"：正常放行 200 不崩溃`, !err && status === 200, err ? 'THROW ' + err : 'status=' + status);
      close();
    }
    // snippets ws 入口（成功=101）
    for (const b of QBAD) {
      connectLog = []; __pairs.length = 0;
      const frame = vlessFrame(SN_UUID, 'sn-q.org', 443);
      const req = stubRequest('https://w.test/' + b, { 'Upgrade': 'websocket', 'sec-websocket-protocol': Buffer.from(frame).toString('base64url') });
      let status = 0, err = '';
      try { const res = await SN.default.fetch(req, undefined, { waitUntil() {} }); status = res.status; } catch (e) { err = e.message; }
      check(`snippets ws 入口 "%3F+非法编码 ${b}"：正常建连 101 不崩溃`, !err && status === 101, err ? 'THROW ' + err : 'status=' + status);
    }
    // snippets xhF 入口（成功=200）
    for (const b of QBAD) {
      connectLog = []; __pairs.length = 0;
      const frame = vlessFrame(SN_UUID, 'sn-q2.org', 443, new Uint8Array([7]));
      const { req, close } = mkXhReq('https://w.test/' + b, frame, okFetcher);
      let status = 0, err = '';
      try { const res = await SN.default.fetch(req, undefined, { waitUntil() {} }); status = res.status; } catch (e) { err = e.message; }
      check(`snippets xhF 入口 "%3F+非法编码 ${b}"：正常放行 200 不崩溃`, !err && status === 200, err ? 'THROW ' + err : 'status=' + status);
      close();
    }
  }

  // ---------- 7.7 snippets 体积硬边界（Cloudflare Snippets 32KB 上限） ----------
  {
    const bytes = readFileSync(DIR + 'snippets.js').length;
    check('snippets.js 体积 ≤ 32768 字节（Snippets 硬限额）', bytes <= 32768, bytes + ' bytes');
  }

  globalThis.fetch = realFetch;
}

// ================= 8. XH_HS 首包就绪边界（域长越界回归） =================
console.log('\n===== XH_HS 首包就绪边界 =====');
{
  // 域名帧布局：o=19+optLen(0)=19；cmd@o-1、atype@o+2、domainLen@o+3、域名@o+4..o+3+l
  const host = 'example.com';
  const l = host.length, o = 19;
  const fr = vlessFrame(WK.CFG.id, host, 443, new Uint8Array(0));
  const hs = (cut) => WK.XH_HS(fr.subarray(0, cut));
  check('worker XH_HS 域帧切片=o+3 → 1（等待更多，不得 -1）', hs(o + 3) === 1, 'got ' + hs(o + 3));
  check('worker XH_HS 域帧切片=o+3+l → 1', hs(o + 3 + l) === 1, 'got ' + hs(o + 3 + l));
  check('worker XH_HS 域帧切片=o+4+l → 0', hs(o + 4 + l) === 0, 'got ' + hs(o + 4 + l));

  let SNX = null;
  try { SNX = await loadSnippetsXH(); } catch (e) { SNX = null; }
  if (SNX && typeof SNX.XH_HS === 'function') {
    const sn = (cut) => SNX.XH_HS(fr.subarray(0, cut));
    check('snippets XH_HS 域帧切片=o+3 → 1（等待更多，不得 -1）', sn(o + 3) === 1, 'got ' + sn(o + 3));
    check('snippets XH_HS 域帧切片=o+3+l → 1', sn(o + 3 + l) === 1, 'got ' + sn(o + 3 + l));
    check('snippets XH_HS 域帧切片=o+4+l → 0', sn(o + 4 + l) === 0, 'got ' + sn(o + 4 + l));
  } else {
    check('snippets XH_HS 边界用例（混淆产物无命名导出时跳过）', true, 'skipped');
  }
}

// ================= 9. gRPC 帧编解码（P1-9 固化：codec 边界 + 正路径 E2E + 模式判定） =================
// 说明：原 152 项中 content-type=application/grpc 的用例均使用「原始 VLESS 帧」，
//       只覆盖 grpF 的回退分支（XH_GCHK=false → xhF）；本组补齐 gRPC 正路径与帧编解码边界。
console.log('\n===== gRPC 编解码 =====');
{
  const { XH_GCHK, XH_GFR, XH_GDEC, XH_isGrpc } = WK;
  const eqU8 = (a, b) => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);
  const catU8 = parts => { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };
  // 手写帧（独立于被测 GFR）：0x00 + BE32(n) + [0x0a + varint(len) + payload]
  const mkGFrame = (payload, opt = {}) => {
    const tag = opt.tag ?? 0x0a, flag = opt.flag ?? 0;
    const L = []; let r = payload.length;
    while (r > 127) { L.push((r & 0x7f) | 0x80); r >>>= 7; } L.push(r);
    const body = Uint8Array.from([tag, ...L, ...payload]);
    const n = opt.n ?? body.length;
    const f = new Uint8Array(5 + body.length);
    f[0] = flag; f[1] = (n >>> 24) & 255; f[2] = (n >>> 16) & 255; f[3] = (n >>> 8) & 255; f[4] = n & 255; f.set(body, 5);
    return f;
  };
  const ghdr = (n, flag = 0) => Uint8Array.from([flag, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);

  // ---- codec：XH_GCHK 首帧嗅探边界 ----
  const P8 = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
  check('gRPC GCHK 合法完整帧 → true', XH_GCHK(mkGFrame(P8)) === true);
  check('gRPC GCHK b[0]≠0（压缩标志非 0）→ false', XH_GCHK(mkGFrame(P8, { flag: 1 })) === false);
  check('gRPC GCHK n=0 → false', XH_GCHK(ghdr(0)) === false);
  check('gRPC GCHK n>0x1000000（超上限）→ false', XH_GCHK(ghdr(0x1000001)) === false);
  check('gRPC GCHK n=0x1000000（上限）→ true', XH_GCHK(ghdr(0x1000000)) === true);
  check('gRPC GCHK 完整帧 b[5]≠0x0a → false', XH_GCHK(mkGFrame(P8, { tag: 0x12 })) === false);
  check('gRPC GCHK 不完整帧（仅 5B 头，长度合法）→ true', XH_GCHK(mkGFrame(P8).subarray(0, 5)) === true);
  check('gRPC GCHK 空/过短 → false', XH_GCHK(new Uint8Array(0)) === false && XH_GCHK(null) === false);

  // ---- codec：XH_GFR 封帧格式 ----
  const fr8 = XH_GFR(P8);
  check('gRPC GFR 封帧格式 [0x00][BE32][0x0a][varint][payload]',
    fr8[0] === 0 && fr8[5] === 0x0a && fr8[6] === P8.length && eqU8(fr8.subarray(7), P8),
    'hdr=' + JSON.stringify(Array.from(fr8.subarray(0, 7))));
  const big = new Uint8Array(300).map((_, i) => i & 255);
  check('gRPC GFR 大载荷(300B) 多字节 varint 往返', eqU8(XH_GDEC(XH_GFR(big)).out[0], big));

  // ---- codec：XH_GDEC 往返 / 半包 / 粘包 / 畸形 / 零长 ----
  check('gRPC GDEC 往返：GFR→GDEC 还原 payload', (() => { const d = XH_GDEC(XH_GFR(P8)); return d.out.length === 1 && eqU8(d.out[0], P8) && d.rest.length === 0; })());
  check('gRPC GDEC 半包：切分后 leftover 保留并可拼回', (() => {
    const f = mkGFrame(P8), a = f.subarray(0, 6), b = f.subarray(6);
    const r1 = XH_GDEC(a); if (r1.out.length !== 0 || r1.rest.length !== 6) return false;
    const r2 = XH_GDEC(catU8([r1.rest, b])); return r2.out.length === 1 && eqU8(r2.out[0], P8);
  })());
  check('gRPC GDEC 粘包：2 帧一次喂入全部剥出', (() => {
    const A = Uint8Array.from([1, 1, 1]), B = Uint8Array.from([2, 2, 2, 2]);
    const d = XH_GDEC(catU8([XH_GFR(A), XH_GFR(B)]));
    return d.out.length === 2 && eqU8(d.out[0], A) && eqU8(d.out[1], B) && d.rest.length === 0;
  })());
  check('gRPC GDEC 粘包+尾半帧：leftover 精确保留', (() => {
    const A = Uint8Array.from([9, 9]), B = Uint8Array.from([8, 8]);
    const d = XH_GDEC(catU8([XH_GFR(A), XH_GFR(B), XH_GFR(A).subarray(0, 4)]));
    return d.out.length === 2 && d.rest.length === 4;
  })());
  check('gRPC GDEC 畸形帧（声明长度>实际）→ 不解出、保留 leftover', (() => {
    const bad = mkGFrame(P8, { n: 999 });
    const d = XH_GDEC(bad); return d.out.length === 0 && d.rest.length === bad.length;
  })());
  check('gRPC GDEC 零长/空 payload → 无输出不崩', (() => {
    const d = XH_GDEC(XH_GFR(new Uint8Array(0)));
    return d.out.length === 0 && d.rest.length === 0;
  })());

  // ---- E2E 正路径（此前零覆盖）：上行剥帧 → 复用 xhF → 下行封帧 ----
  const G_UUID = '06b65903-406d-4a41-8463-6fd5c0ee7798';
  const G_REPLY = Uint8Array.from([0x16, 3, 1, 0xab]);
  const G_EXPECT = catU8([Uint8Array.from([0, 0]), G_REPLY]);
  const gFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url instanceof URL ? url : url?.url || url);
    if (/dns-query|\/resolve/.test(u) && /[?&]name=/.test(u)) return new RealResponse(JSON.stringify({ Answer: [] }), { status: 200, headers: { 'content-type': 'application/dns-json' } });
    return new RealResponse('', { status: 200 });
  };
  const readAllU8 = async (stream) => { const out = []; const r = stream.getReader(); for (;;) { const { done, value } = await r.read(); if (done) break; if (value) out.push(Uint8Array.from(value)); } return out; };
  // 本地普通 socket（非 workerd 的 type:'bytes'/HWM:0，避免半包场景下的时序抖动）
  const gReq = (host, chunks) => {
    let i = 0;
    const body = new ReadableStream({ pull(c) { if (i < chunks.length) c.enqueue(chunks[i++]); else c.close(); } });
    return {
      url: 'https://w.test/grpc', method: 'POST', cf: {},
      headers: { get: k => ({ 'content-type': 'application/grpc' })[k.toLowerCase()] ?? null },
      body,
      fetcher: {
        connect(a) {
          const h2 = typeof a === 'string' ? a : a.hostname, p2 = (a && a.port) || 443;
          let ctrl = null; const written = [];
          const readable = new ReadableStream({ start(c) { ctrl = c; } });
          const writable = new WritableStream({ write(ch) { written.push(Uint8Array.from(ch instanceof ArrayBuffer ? new Uint8Array(ch) : ch)); } });
          const s = { host: h2, port: p2, readable, writable, written, opened: Promise.resolve(), _enqueue: b => { try { ctrl.enqueue(b); } catch {} }, close() { try { ctrl.close(); } catch {} } };
          connectLog.push(s); return s;
        }
      }
    };
  };
  try {
    // 正路径单帧
    connectLog = []; __pairs.length = 0;
    const gPayload = Uint8Array.from([9, 8, 7]);
    const gres = await WK.default.fetch(gReq('grpc-e2e.org', [XH_GFR(vlessFrame(G_UUID, 'grpc-e2e.org', 443, gPayload))]), {}, { waitUntil() {} });
    await sleep(150);
    const gsock = connectLog.find(s => s.host === 'grpc-e2e.org');
    check('worker gRPC 正路径：建连目标正确', !!gsock && gsock.port === 443, connectLog.map(s => s.host + ':' + s.port).join(','));
    check('worker gRPC 正路径：上行剥帧后仅 payload 透传远端', !!gsock && eqU8(catU8(gsock.written), gPayload), gsock ? JSON.stringify(Array.from(catU8(gsock.written))) : 'no sock');
    check('worker gRPC 正路径：下行 CT=application/grpc + grpc-status:0', (gres.headers.get('content-type') || '') === 'application/grpc' && gres.headers.get('grpc-status') === '0', (gres.headers.get('content-type') || '') + '/' + gres.headers.get('grpc-status'));
    gsock._enqueue(G_REPLY); await sleep(60); gsock.close();
    const gfull = catU8(await readAllU8(gres.body));
    const gd = XH_GDEC(gfull);
    check('worker gRPC 正路径：下行封帧且解帧 = [0,0]++应答', gd.out.length >= 1 && eqU8(catU8(gd.out), G_EXPECT), JSON.stringify(Array.from(catU8(gd.out))));
    check('worker gRPC 正路径：下行无残留 leftover', gd.rest.length === 0, 'rest=' + gd.rest.length);

    // 正路径半包（跨块重组）
    connectLog = []; __pairs.length = 0;
    const hPayload = Uint8Array.from([5, 5, 5, 5, 5, 5]);
    const hFrame = XH_GFR(vlessFrame(G_UUID, 'grpc-half.org', 443, hPayload));
    const hres = await WK.default.fetch(gReq('grpc-half.org', [hFrame.subarray(0, 7), hFrame.subarray(7)]), {}, { waitUntil() {} });
    await sleep(150);
    const hsock = connectLog.find(s => s.host === 'grpc-half.org');
    check('worker gRPC 正路径：半包跨块重组后 payload 完整透传', !!hsock && eqU8(catU8(hsock.written), hPayload), hsock ? JSON.stringify(Array.from(catU8(hsock.written))) : 'no sock');
    hsock._enqueue(G_REPLY); await sleep(60); hsock.close();
    const hd = XH_GDEC(catU8(await readAllU8(hres.body)));
    check('worker gRPC 正路径：半包下行仍可解帧', hd.out.length >= 1 && eqU8(catU8(hd.out), G_EXPECT), 'got=' + JSON.stringify(Array.from(catU8(hd.out))) + ' rest=' + hd.rest.length);
  } finally {
    globalThis.fetch = gFetch;
  }

  // ---- 模式判定 XH_isGrpc（CT 前缀 + padding 特征排除）----
  const mkH = (ct, padHdr) => { const m = {}; if (ct !== null) m['content-type'] = ct; if (padHdr) m[padHdr[0]] = padHdr[1]; return { get: k => (m[k.toLowerCase()] ?? null) }; };
  const mkR = (ct, url = 'https://w.test/x', padHdr = null) => ({ url, headers: mkH(ct, padHdr) });
  const PDH = G_UUID.slice(1, 7), PDK = '_' + G_UUID.slice(25, 31);
  if (typeof WK.__setPD === 'function') WK.__setPD(PDH, PDK);
  check('gRPC 判定：CT=application/grpc 无 padding → true', XH_isGrpc(mkR('application/grpc')) === true);
  check('gRPC 判定：CT=application/grpc + padding 头 → false（走 xHTTP）', XH_isGrpc(mkR('application/grpc', 'https://w.test/x', [PDH, 'x'])) === false, 'PDH=' + PDH);
  check('gRPC 判定：CT=application/grpc + padding URL 参数 → false', XH_isGrpc(mkR('application/grpc', 'https://w.test/x?' + PDK + '=zzz')) === false);
  check('gRPC 判定：CT=application/octet-stream → false', XH_isGrpc(mkR('application/octet-stream')) === false);
  check('gRPC 判定：无 CT（packet-up）→ false', XH_isGrpc(mkR(null)) === false);
  if (typeof WK.__setPD === 'function') WK.__setPD('', '');
}

// ================= 汇总 =================
console.log('\n===== 汇总 =====');
const fail = results.filter(r => !r.ok);
console.log(`共 ${results.length} 项，失败 ${fail.length} 项`);
if (fail.length) { console.log('失败项:'); fail.forEach(f => console.log(' - ' + f.name)); }
// CI 门禁：有失败即非 0 退出码（失败 0 项保持 exit 0）
if (fail.length) process.exitCode = 1;
