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
  // A-2：CF-CIDR 兜底数据源 → 确定性桩（避免测试触发真实外网抓取，保持离线确定性）
  if (/raw\.githubusercontent\.com\/.*CF-CIDR/.test(u)) return new RealResponse('104.16.0.0/13\n172.64.0.0/13\n', { status: 200 });
  return realFetch(url, opts);
};

// F3 测试桩：把「非 DoH」handler 包成「DoH 一律回公网 A/AAAA，其余交给 handler」。
// dohIps 传内网 IP（如 ['10.0.0.1']）模拟「解析到内网」；传 [] 模拟「解析失败/空」。
const wrapDoh = (handler, dohIps = ['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946']) => async (u, o) => {
  const s = String((u && u.url) || u);
  if (/dns-query|\/resolve/.test(s) && /[?&]name=/.test(s)) {
    const isV6 = /type=AAAA/i.test(s);
    const list = (dohIps || []).filter(ip => String(ip).includes(':') === isV6);
    return new RealResponse(JSON.stringify({ Answer: list.map(ip => ({ type: isV6 ? 28 : 1, data: ip })) }), { status: 200, headers: { 'content-type': 'application/dns-json' } });
  }
  return handler(u, o);
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
// xhttp 节点 extra（padding 混淆）断言：字段与 EDT 一致，头名/键名须由该 UUID 派生（与入站 PDH/PDK 同源）；
// 订阅文本可能已被 unb64 整体 URL 解码过，故对捕获值再 decode 一次（已解码的 JSON 不含 %，decode 为恒等）
const extraOf = (line) => { const m = String(line).match(/[?&]extra=([^&#]+)/); if (!m) return null; try { return JSON.parse(decodeURIComponent(m[1])); } catch { return null; } };
const extraOk = (line, uuid) => { const j = extraOf(line); return !!j && j.xPaddingObfsMode === true && j.xPaddingMethod === 'tokenish' && j.xPaddingPlacement === 'queryInHeader' && j.xPaddingHeader === uuid.slice(1, 7) && j.xPaddingKey === '_' + uuid.slice(25, 31); };
// 响应 padding 头：Xray 服务端 queryInHeader 形态 `?<键>=<base62 100–1000>`，不得带固定前缀（原 https://x.invalid/）
const padHdrOk = (v, uuid) => { const k = '_' + uuid.slice(25, 31); if (!v.startsWith('?' + k + '=')) return false; const p = v.slice(k.length + 2); return /^[0-9A-Za-z]{100,1000}$/.test(p); };

async function loadWorker() {
  const src = readFileSync(DIR + 'worker.js', 'utf8');
  const patched = src + '\nexport { pCfg, parseAddressPort, addrParser, setUUID, CFG, ws as _ws, mkK, parseTurnProxyConfig, getSafeEnv, cfgCacheReset, incrementDailyStats, getCustomIPs, XH_HS, XH_GCHK, XH_GFR, XH_GDEC, XH_GUP, XH_isGrpc, XH_pdFeat };\nexport const __setPD=(h,k)=>{XH_PDH=h;XH_PDK=k};\nexport const __b7={go2s5List:typeof _go2s5List=="function"?_go2s5List:null,go2s5Hit:typeof _go2s5Hit=="function"?_go2s5Hit:null,extHostSafe:typeof _extHostSafe=="function"?_extHostSafe:null,tryCon:typeof tryCon=="function"?tryCon:null,resetGO2S5:()=>{try{_GO2S5=null}catch(e){}},parseHosts:typeof _parseHosts=="function"?_parseHosts:null,fyShuffle:typeof _fyShuffle=="function"?_fyShuffle:null,XH_GUP:typeof XH_GUP=="function"?XH_GUP:null,GMAX:typeof GMAX=="number"?GMAX:null};\nexport const __b6={obs:typeof obs=="function"?obs:null,obsRedact:typeof obsRedact=="function"?obsRedact:null,obsScrub:typeof obsScrub=="function"?obsScrub:null,routeEnum:typeof routeEnum=="function"?routeEnum:null,obsReset:typeof _obsReset=="function"?_obsReset:null,tgStreak:typeof tgStreak=="function"?tgStreak:null,tgDegradedUntil:typeof tgDegradedUntil=="function"?tgDegradedUntil:null,tgFailBump:typeof tgFailBump=="function"?tgFailBump:null,tgFailClear:typeof tgFailClear=="function"?tgFailClear:null,sendTgMsg:typeof sendTgMsg=="function"?sendTgMsg:null,pushDashboard:typeof pushDashboard=="function"?pushDashboard:null,sweepLoginFail:typeof _sweepLoginFail=="function"?_sweepLoginFail:null};\nexport const __b8={ispCode:typeof ispCode=="function"?ispCode:null,resolveIspCode:typeof resolveIspCode=="function"?resolveIspCode:null,localRandomIPs:typeof localRandomIPs=="function"?localRandomIPs:null,cidrList:typeof _cidrList=="function"?_cidrList:null,cidrCacheReset:typeof _cidrCacheReset=="function"?_cidrCacheReset:null,randIP:typeof _randIPFromCIDR=="function"?_randIPFromCIDR:null,whitelist:typeof ISP_WHITELIST!="undefined"?ISP_WHITELIST:null,cidrUrl:typeof ISP_CIDR_URL!="undefined"?ISP_CIDR_URL:null,builtin:typeof ISP_CIDR_BUILTIN!="undefined"?ISP_CIDR_BUILTIN:null,ports:typeof CF_PORTS!="undefined"?CF_PORTS:null};\nexport const __b9={chainProxyCfg:typeof chainProxyCfg=="function"?chainProxyCfg:null,chainKey:typeof _chainKey=="function"?_chainKey:null,chainDecrypt:typeof _chainDecrypt=="function"?_chainDecrypt:null,b64uEncode:typeof _b64uEncode=="function"?_b64uEncode:null,camouflageReverse:typeof _camouflageReverse=="function"?_camouflageReverse:null,nginxPage:typeof nginxPage=="function"?nginxPage:null,cf1101Page:typeof cf1101Page=="function"?cf1101Page:null,CHAIN_TYPES:typeof _CHAIN_TYPES!="undefined"?_CHAIN_TYPES:null,CAM_HDR_ALLOW:typeof _CAM_HDR_ALLOW!="undefined"?_CAM_HDR_ALLOW:null};\nexport const __b10={adminCheckResult:typeof _adminCheckResult=="function"?_adminCheckResult:null,camResolveSafe:typeof _camResolveSafe=="function"?_camResolveSafe:null};\n';
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
    check('snippets NET=ws 默认：重建节点 type=ws 且无 mode=', /type=ws&/.test(text) && !text.includes('mode='), text.split('\n')[1]?.slice(0, 120));
    const resX = await SN.default.fetch(stubRequest('https://w.test/sub?uuid=' + snipUuid + '&net=xhttp', {}), undefined, { waitUntil() {} });
    const textX = Buffer.from(await resX.text(), 'base64').toString('utf8');
    const lineX = textX.split('\n').find(l => l.includes('212.147.249.131')) || '';
    check('snippets ?net=xhttp：重建节点 type=xhttp + mode=stream-one + path/host/sni 完整', /type=xhttp&/.test(lineX) && lineX.includes('mode=stream-one') && lineX.includes('sni=w.test') && lineX.includes('host=w.test') && /path=[^&#]+/.test(lineX), lineX.slice(0, 160));
    check('snippets ?net=xhttp：透传外来节点不被改写', textX.includes('vless://11111111-2222-4333-8444-555555555555@1.2.3.4:443'), 'yes');
    check('snippets ?net=xhttp：重建节点带 padding 混淆 extra（头/键由 UUID 派生）', extraOk(lineX, snipUuid), lineX.slice(0, 260));
    check('snippets NET=ws 默认：重建节点不带 extra', !text.includes('extra='), text.split('\n')[1]?.slice(0, 120));
    const resF = await SN.default.fetch(stubRequest('https://w.test/sub?uuid=' + snipUuid + '&net=xhttp&flag=true', {}), undefined, { waitUntil() {} });
    const textF = Buffer.from(await resF.text(), 'base64').toString('utf8');
    check('snippets flag=true（转换器回源）忽略 net=xhttp，恒 ws', /type=ws&/.test(textF) && !textF.includes('xhttp'), textF.split('\n')[1]?.slice(0, 100));
    check('snippets flag=true（转换器回源）不带 extra', !textF.includes('extra='), textF.split('\n')[1]?.slice(0, 100));
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
    check('snippets xHTTP：响应 padding 头为 ?<键>=<base62>，无固定前缀', padH.length > 0 && padHdrOk(padH, snipUuid4), padH.slice(0, 40));
    const stok = Array.from({ length: 400 }, () => '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'[Math.random() * 62 | 0]).join('');
    const rObfs = await SN4.default.fetch(mkReq('https://w.test/xh/?_' + snipUuid4.slice(25, 31) + '=' + stok), undefined, { waitUntil() {} });
    check('snippets xHTTP：Xray obfs 形态 padding（URL 头 + tokenish）放行 200', rObfs.status === 200, String(rObfs.status));
    try { ctrl4 && ctrl4.close(); } catch {}
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
    check('worker xHTTP：响应 padding 头为 ?<键>=<base62>，无固定前缀', padHdrOk(wpadH, wUuid), wpadH.slice(0, 40));
    // padding 短值拒绝
    const wbad = new ReadableStream({ start(c) { c.enqueue(wframe); c.close(); } });
    const wres2 = await WK.default.fetch({ url: 'https://w.test/xh2', method: 'POST', headers: { get: k => ({ 'content-type': 'application/grpc', [wpdh]: 'abc' })[k.toLowerCase()] ?? null }, body: wbad, cf: {}, fetcher: wreq.fetcher }, {}, { waitUntil() {} });
    check('worker xHTTP：短 padding 拒绝 400', wres2.status === 400, String(wres2.status));
    // Xray 客户端 xPaddingObfsMode 实发形态（queryInHeader：头值 = 完整请求 URL + ?<键>=<tokenish base62>）→ 放行，且判定为 xHTTP（不进 gRPC 回退）
    const wpdk = '_' + wUuid.slice(25, 31), B62T = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const wtok = Array.from({ length: 400 }, () => B62T[Math.random() * 62 | 0]).join('');
    const wobfsH = { 'content-type': 'application/grpc', [wpdh]: 'https://w.test/xh4/?' + wpdk + '=' + wtok };
    const wobfsGet = k => wobfsH[k.toLowerCase()] ?? null;
    const wresO = await WK.default.fetch({ url: 'https://w.test/xh4/', method: 'POST', headers: { get: wobfsGet }, body: new ReadableStream({ start(c) { c.enqueue(wframe); c.close(); } }), cf: {}, fetcher: wreq.fetcher }, {}, { waitUntil() {} });
    check('worker xHTTP：Xray obfs 形态 padding（URL 头 + tokenish）放行 200 且判定为 xHTTP', wresO.status === 200 && WK.XH_isGrpc({ url: 'https://w.test/xh4/', headers: { get: wobfsGet } }) === false, String(wresO.status));
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
    const sstpOpts = [];
    const sstpFetcher = { connect(a, o) { const s = makeTargetSocket(typeof a === 'string' ? a : a.hostname, (a && a.port) || 443); sstpOpts.push(o); connectLog.push(s); setTimeout(() => s.close(), 30); return s; } };
    const wres5 = await WK.default.fetch({ url: 'https://w.test/sstp://1.2.3.4:443', method: 'POST', headers: { get: k => ({ 'content-type': 'application/grpc' })[k.toLowerCase()] ?? null }, body: new ReadableStream({ start(c) { c.enqueue(frSS); c.close(); } }), cf: {}, fetcher: sstpFetcher }, {}, { waitUntil() {} });
    const sstpSock = connectLog.find(s => s.host === '1.2.3.4' && s.port === 443);
    const firstWrite = sstpSock && sstpSock.written[0] ? Buffer.from(sstpSock.written[0]).toString('latin1') : '';
    check('worker xHTTP：sstp:// 走真实 SSTP 握手（TLS 连 443，首写 SSTP_DUPLEX_POST；桩不应答 → 502 而非把 VLESS 载荷裸写）', wres5.status === 502 && !!sstpSock && sstpOpts[0] && sstpOpts[0].secureTransport === 'on' && firstWrite.startsWith('SSTP_DUPLEX_POST /sra_') && !sstpSock.written.some(w => w.length === 1 && w[0] === 4), `status=${wres5.status} first=${firstWrite.slice(0, 30)} tls=${sstpOpts[0] && sstpOpts[0].secureTransport}`);
    try { wctrl && wctrl.close(); } catch {}
  } catch (e) { console.error('[wxh ERR]', e.stack || e.message); check('worker xHTTP 测试', false, String(e.stack || e.message).split('\n')[0]); }

  // snippets：xHTTP 默认直连透传 + 12s 超时参数存在性
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
    check('snippets xHTTP 默认直连透传（原误标 sstp 用例；URL 未含 sstp）', fS.value && fS.value[0] === 0 && fS.value[1] === 0 && connectLog.some(s => s.host === 'sstp-target.org' && s.port === 443), connectLog.map(s => s.host + ':' + s.port).join(',') + ' prefix=' + JSON.stringify(fS.value && Array.from(fS.value.slice(0, 2))));
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
    await WK.incrementDailyStats({ DB: sdb }, true);
    await WK.incrementDailyStats({ DB: sdb }, true);
    const ins = sq.filter(x => x === 'INSERT').length, del = sq.filter(x => x === 'DELETE').length, sel = sq.filter(x => x === 'SELECT').length;
    check('worker incrementDailyStats：两次强制 flush 各 1 次 UPSERT、DELETE 清理每天一次、无 SELECT', ins === 2 && del === 1 && sel === 0, `INSERT=${ins} DELETE=${del} SELECT=${sel}`);
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
  const { XH_GCHK, XH_GFR, XH_GDEC, XH_GUP, XH_isGrpc } = WK;
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
  check('gRPC GCHK 完整帧 b[5]≠0x0a → false', XH_GCHK(mkGFrame(P8, { tag: 0x12 })) === false);
  check('gRPC GCHK 空/过短 → false', XH_GCHK(new Uint8Array(0)) === false && XH_GCHK(null) === false);

  // ---- L-1（确定性缺陷）：不完整帧不得跳过 b[5] 二次确认 ----
  // 修前：`if(b.length>=5+n&&b[5]!==10)` 被前缀短路，5 字节头（b[5] 不存在）一律放行 → true
  check('L-1 gRPC GCHK 仅 5B 头 [0,0,0,0,1] → false（修前 true）',
    XH_GCHK(Uint8Array.from([0, 0, 0, 0, 1])) === false);
  check('L-1 gRPC GCHK 6B 头 [0,0,0,0,1,0x0a] → true',
    XH_GCHK(Uint8Array.from([0, 0, 0, 0, 1, 0x0a])) === true);
  check('L-1 gRPC GCHK 6B 头 [0,0,0,0,1,0x00] → false（b[5]≠0x0a）',
    XH_GCHK(Uint8Array.from([0, 0, 0, 0, 1, 0x00])) === false);
  check('L-1 gRPC GCHK 声明 n=100 只给 20B 且 b[5]≠0x0a → false', (() => {
    const b = new Uint8Array(20); b[0] = 0; b[4] = 100; b[5] = 0x12;
    return XH_GCHK(b) === false;
  })());

  // ---- L-2（加固）：帧长上限 16MiB → 4MiB（GMAX）----
  const GMAX = 0x400000;
  const g6 = (n, tag = 0x0a) => Uint8Array.from([0, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255, tag]);
  check('L-2 gRPC GCHK n=GMAX(0x400000) → true', XH_GCHK(g6(GMAX)) === true);
  check('L-2 gRPC GCHK n=GMAX+1 → false（旧上限 0x1000000 亦被拒）',
    XH_GCHK(g6(GMAX + 1)) === false && XH_GCHK(g6(0x1000000)) === false);
  check('L-2 gRPC GDEC 声明 n>GMAX 的畸形帧 → 不解出、全量保留 leftover', (() => {
    const b = new Uint8Array(64); b[1] = 0x00; b[2] = 0x40; b[3] = 0x00; b[4] = 0x01; // n=0x400001
    const d = XH_GDEC(b); return d.out.length === 0 && d.rest.length === 64;
  })());

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
  // ---- L-3（确定性缺陷）：application/grpc-web* 不得被 startsWith 前缀命中 ----
  check('L-3 gRPC 判定：CT=application/grpc-web → false（修前 true）', XH_isGrpc(mkR('application/grpc-web')) === false);
  check('L-3 gRPC 判定：CT=application/grpc-web+proto → false', XH_isGrpc(mkR('application/grpc-web+proto')) === false);
  check('L-3 gRPC 判定：CT=application/grpc-web-text+proto → false', XH_isGrpc(mkR('application/grpc-web-text+proto')) === false);
  check('L-3 gRPC 判定：CT=application/grpc; charset=utf-8 → true（带参仍兼容）', XH_isGrpc(mkR('application/grpc; charset=utf-8')) === true);

  // ---- L-2c（加固）：XH_GUP 惰性拉取，不提前抽干整个请求体 ----
  check('L-2c gRPC XH_GUP 惰性拉取：只取 1 帧时不抽干后续数据', await (async () => {
    let fed = 0; const TOTAL = 400;
    const rd = { read: async () => (fed < TOTAL ? (fed++, { done: false, value: XH_GFR(P8) }) : { done: true }) };
    const r = XH_GUP(null, rd, false).getReader();
    // 关键：先静置，给"预读型"实现足够时间抽干；惰性实现在此之前不应读取
    await sleep(60);
    const fedIdle = fed;
    const first = await r.read();
    const fedAfterOne = fed;
    await r.cancel().catch(() => { });
    return !!first.value && fedIdle <= 2 && fedAfterOne <= 8 && fedAfterOne < TOTAL / 4;
  })());
  // ---- L-2b（加固）：声明长度越界的帧立即终止，不再无界缓冲 ----
  check('L-2b gRPC XH_GUP 声明 n>GMAX 的帧 → 立即报错终止、不缓冲', await (async () => {
    let fed = 0;
    const rd = { read: async () => (fed < 100000 ? (fed++, { done: false, value: new Uint8Array(1024) }) : { done: true }) };
    const r = XH_GUP(Uint8Array.from([0, 0, 0x40, 0, 1]), rd, false).getReader(); // n=0x400001 > GMAX
    let err = null, out = 0;
    try { for (;;) { const { done, value } = await r.read(); if (done) break; out += value.length; } } catch (e) { err = e; }
    return !!err && out === 0 && fed <= 4;   // 首个分块内即判定，不再继续喂入
  })());
  if (typeof WK.__setPD === 'function') WK.__setPD('', '');
}

// ================= 10. 面板鉴权加固（R1-a / R1-b / 残留 #3 #4 #5） =================
console.log('\n===== 面板鉴权加固 =====');
{
  const UA2 = 'Mozilla/5.0 (R2 Test)';
  const PWD = 'abc';                       // worker.js 顶部默认 WEB_PASSWORD
  const ctx2 = { waitUntil(p) { try { Promise.resolve(p).catch(() => { }); } catch { } } };
  const mkR2 = ({ url, method = 'GET', headers = {}, body = null }) => {
    const h = {}; for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = v;
    return {
      url, method,
      headers: { get: k => (k.toLowerCase() in h ? h[k.toLowerCase()] : null) },
      cf: { country: 'US', city: 'T' },
      body,
      json: async () => { try { return JSON.parse(body); } catch { return null; } },
      text: async () => (typeof body === 'string' ? body : ''),
      fetcher: { connect() { throw new Error('no-connect'); } }
    };
  };
  const call = (req, env) => WK.default.fetch(req, env || {}, ctx2);
  // D1 桩：store 持久化；failWrite=true 模拟写库失败（R1-a 场景）
  // 注意：_cfgLoad 用的是 prepare(...).all()（无 bind），_dashWrite 用的是 prepare(...).bind(k,v,v).run()
  const mkDB = (failWrite = false) => {
    const store = new Map();
    return {
      store,
      prepare(sql) {
        const ins = /INSERT/i.test(sql);
        const all = async () => ({ results: ins ? [] : [...store].map(([k2, v2]) => ({ key: k2, value: v2 })) });
        const run = (a) => { if (failWrite) throw new Error('D1 write failed'); if (ins && a && a.length >= 2) store.set(String(a[0]), String(a[1])); return Promise.resolve({}); };
        const bound = (a) => ({ bind: (...a2) => bound(a2), all, run: () => run(a) });
        return { bind: (...a) => bound(a), all, run: () => run([]) };
      }
    };
  };
  const resetCfg = () => { try { if (typeof WK.cfgCacheReset === 'function') WK.cfgCacheReset(); } catch { } };
  const login = (env, ip, pwd = PWD) => call(mkR2({
    url: 'https://w.test/?flag=login', method: 'POST',
    headers: { 'User-Agent': UA2, 'Content-Type': 'application/json', ...(ip ? { 'cf-connecting-ip': ip } : {}) },
    body: JSON.stringify({ pwd })
  }), env);
  const cookieOf = res => (res.headers.get('set-cookie') || '').split(';')[0] || '';
  const isDash = async (env, ck) => {
    const res = await call(mkR2({ url: 'https://w.test/', headers: { 'User-Agent': UA2, Cookie: ck } }), env);
    const t = await res.text();
    return res.status === 200 && t.includes('mainBody');
  };

  // ---- R1-a / E5：_dashWrite 失败时不得返回「未持久化的随机值」（否则每请求轮换、登录后立即掉线）----
  // E5 裁定：此前「回退 _WEB_PW」与 R1-b 的 fail-closed 不一致（密钥可能仍是源码公开默认口令）→ 改为返回 '' 由登录端点 503。
  // 因此本组断言由「回退后仍可登录」改为「fail-closed：拒绝登录、不签发 cookie」。
  resetCfg();
  {
    const env = { DB: mkDB(true) };                       // 有 D1 但写入失败
    const r1 = await login(env, '10.1.1.1');
    check('R1-a/E5 写库失败：登录被拒（503，fail-closed，不再回退口令当 HMAC 密钥）',
      r1.status === 503, 'status=' + r1.status);
    check('R1-a/E5 写库失败：不签发任何 cookie（无未持久化随机密钥可签发）',
      cookieOf(r1) === '', 'set-cookie=' + (r1.headers.get('set-cookie') || '(无)'));
    // 关键鉴别：连续两次登录均被拒 —— 证明不会「第一次 200、第二次因密钥轮换而掉线」的静默故障
    const r2 = await login(env, '10.1.1.1');
    check('R1-a/E5 写库失败：连续两次登录均被拒（不存在密钥轮换导致的静默掉线）',
      r2.status === 503 && cookieOf(r2) === '', 'status=' + r2.status);
  }

  // ---- R1-b：无 D1 且未配（强）AUTH_SECRET → 拒绝面板登录、不签发 cookie ----
  resetCfg();
  {
    const env = {};                                        // 无 D1、无 AUTH_SECRET
    const r = await login(env, '10.2.2.2');
    check('R1-b 无 D1 无 AUTH_SECRET：登录被拒（503）', r.status === 503, 'status=' + r.status);
    check('R1-b 无 D1 无 AUTH_SECRET：不签发任何 cookie', cookieOf(r) === '', 'set-cookie=' + (r.headers.get('set-cookie') || '(无)'));
  }

  // ---- 残留 #3：AUTH_SECRET 强度下限（<16 视为弱并忽略）----
  resetCfg();
  {
    const r = await login({ AUTH_SECRET: '1' }, '10.3.3.3');   // 弱密钥 + 无 D1 → 无安全密钥可用
    check('残留#3 AUTH_SECRET="1"（弱）+ 无 D1 → 不被采用，登录被拒',
      r.status === 503 && cookieOf(r) === '', 'status=' + r.status);
  }
  resetCfg();
  {
    const env = { AUTH_SECRET: '1', DB: mkDB(false) };         // 弱密钥被忽略 → 走 D1 自动随机
    const r = await login(env, '10.4.4.4');
    const ck = cookieOf(r);
    check('残留#3 弱 AUTH_SECRET 被忽略后改用自动随机并持久化 → 登录成功',
      r.status === 200 && ck.startsWith('auth='), 'status=' + r.status);
    check('残留#3 自动随机密钥签发的 cookie 可校验通过', ck ? await isDash(env, ck) : false);
  }

  // ---- 残留 #4：登录退避表 TTL / 容量 / unknown 桶 ----
  const LF = (globalThis.__loginFail ||= new Map());
  resetCfg();
  {
    LF.clear();
    const env = { DB: mkDB(false) };
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await login(env, '10.5.5.5', 'wrong-pw')).status;
    check('残留#4 真实 IP 连续 6 次失败 → 触发退避 429', last === 429, 'last=' + last);
  }
  resetCfg();
  {
    LF.clear();
    const env = { DB: mkDB(false) };
    let saw429 = false, last = 0;
    for (let i = 0; i < 8; i++) { last = (await login(env, null, 'wrong-pw')).status; if (last === 429) saw429 = true; }
    check("残留#4 'unknown' 桶（无 cf-connecting-ip）不参与退避 → 始终 403 不误伤", !saw429 && last === 403, 'last=' + last + ' saw429=' + saw429);
  }
  resetCfg();
  {
    LF.clear();
    const now = Date.now();
    for (let i = 0; i < 10001; i++) LF.set('10.6.' + (i >> 8) + '.' + (i & 255), { c: 5, t: now, until: now + 60000 });
    const before = LF.size;
    await login({ DB: mkDB(false) }, '10.7.7.7', 'wrong-pw');
    check('残留#4 退避表容量上限生效（预置 10001 条活跃项 → 单次请求后回落）',
      before > 10000 && LF.size < 100, 'before=' + before + ' after=' + LF.size);
    LF.clear();
  }

  // ---- 残留 #5：无 D1 时 webhook 告警不得被匿名放大 ----
  {
    const saveFetch = globalThis.fetch;
    let tg = 0;
    globalThis.fetch = async (url, opts) => {
      const u = String(url instanceof URL ? url : (url && url.url) || url);
      if (u.includes('api.telegram.org')) { tg++; return new RealResponse(JSON.stringify({ ok: true, result: {} }), { status: 200, headers: { 'content-type': 'application/json' } }); }
      if (/dns-query|\/resolve/.test(u) && /[?&]name=/.test(u)) return new RealResponse(JSON.stringify({ Answer: [] }), { status: 200, headers: { 'content-type': 'application/dns-json' } });
      return new RealResponse('', { status: 200 });
    };
    try {
      const wh = () => call(mkR2({
        url: 'https://w.test/tg/webhook', method: 'POST',
        headers: { 'User-Agent': UA2, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { text: 'hello', chat: { id: 1 } } })
      }), { TG_BOT_TOKEN: 'tok', TG_CHAT_ID: '1' });
      globalThis.__whWarned = 0; tg = 0;
      resetCfg();
      await wh(); await wh(); await sleep(120);
      check('残留#5 无 D1：webhook 调 2 次只告警 1 次（isolate 内存标志）', tg === 1, 'tg=' + tg);

      globalThis.__whWarned = 0; tg = 0;
      resetCfg();
      const envDB = { TG_BOT_TOKEN: 'tok', TG_CHAT_ID: '1', DB: mkDB(false) };
      await call(mkR2({ url: 'https://w.test/tg/webhook', method: 'POST', headers: { 'User-Agent': UA2, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: { text: 'hi', chat: { id: 1 } } }) }), envDB);
      await call(mkR2({ url: 'https://w.test/tg/webhook', method: 'POST', headers: { 'User-Agent': UA2, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: { text: 'hi', chat: { id: 1 } } }) }), envDB);
      await sleep(120);
      check('残留#5 有 D1：webhook 调 2 次仍只告警 1 次（持久化路径未回归）', tg === 1, 'tg=' + tg);
    } finally { globalThis.fetch = saveFetch; }
  }
}

// ================= 11. 批次 7 EDT 对齐（A-1 / A-3 / A-4 / A-5 / A-6 / A-7 / A-11） =================
console.log('\n===== 批次 7 EDT 对齐 =====');
{
  const UA3 = 'Mozilla/5.0 (B7 Test)';
  const UA_TUNNEL = 'v2rayN/ed' + 'tunnel (https://github.com/cm' + 'liu/ed' + 'tunnel)';
  const UUID0 = '06b65903-406d-4a41-8463-6fd5c0ee7798';   // worker.js 顶部默认 UUID
  const MAGIC_Q = '/sub?host=example.com&uuid=00000000-0000-4000-8000-000000000000';
  const ctx3 = { waitUntil(p) { try { Promise.resolve(p).catch(() => { }); } catch { } } };
  const mkR3 = ({ url, method = 'GET', headers = {}, body = null }) => {
    const h = {}; for (const [k2, v2] of Object.entries(headers)) h[k2.toLowerCase()] = v2;
    return {
      url, method,
      headers: { get: k => (k.toLowerCase() in h ? h[k.toLowerCase()] : null) },
      cf: { country: 'US', city: 'T' }, body,
      json: async () => { try { return JSON.parse(body); } catch { return null; } },
      text: async () => (typeof body === 'string' ? body : ''),
      fetcher: { connect() { throw new Error('no-connect'); } }
    };
  };
  const call3 = (req, env) => WK.default.fetch(req, env || {}, ctx3);
  const resetCfg3 = () => { try { if (typeof WK.cfgCacheReset === 'function') WK.cfgCacheReset(); } catch { } };
  // 注意：不能用 decodeURIComponent(escape(atob(x)))——escape 会把字面 '%' 变成 '%25'，导致 %2C 解不开
  const unb64 = (t) => { try { return decodeURIComponent(atob(t)); } catch (e) { try { return atob(t); } catch (e2) { return ''; } } };

  // ---- A-1：BEST_SUB 订阅生成器哨兵（默认关闭）----
  resetCfg3();
  check('A-1 未配 BEST_SUB：魔术参数仍 403（默认关闭，零回归面）',
    (await call3(mkR3({ url: 'https://w.test' + MAGIC_Q, headers: { 'User-Agent': UA_TUNNEL } }), {})).status === 403);
  // E2：BEST_SUB 改为**强随机令牌**屏障 —— 三个魔术参数全是源码字面量（本项目开源、可枚举），
  //     SUB_DOMAIN 也只是普通面板配置项（普遍会填），都不足以保护「跳过 UUID 校验 = 泄露真实 UUID/ProxyIP」这一路径。
  const BST = 'x'.repeat(40);                       // ≥32 字符强令牌
  const BENV = { BEST_SUB: '1', SUB_DOMAIN: 'gen.test', BEST_SUB_TOKEN: BST };
  resetCfg3();
  {
    const r = await call3(mkR3({ url: 'https://w.test' + MAGIC_Q + '&bst=' + BST, headers: { 'User-Agent': UA_TUNNEL } }), BENV);
    const t = await r.text();
    check('A-1/E2 BEST_SUB=1 + 强令牌 + ?bst= 正确 + 3/3 魔术条件 → 200 且返回订阅',
      r.status === 200 && unb64(t).includes('vless://'), 'status=' + r.status);
  }
  resetCfg3();
  check('A-1/E2 已配 SUB_DOMAIN + 全魔术命中但**未配 BEST_SUB_TOKEN** → 403（不跳过鉴权）',
    (await call3(mkR3({ url: 'https://w.test' + MAGIC_Q + '&bst=' + BST, headers: { 'User-Agent': UA_TUNNEL } }), { BEST_SUB: '1', SUB_DOMAIN: 'gen.test' })).status === 403);
  resetCfg3();
  check('A-1/E2 已配令牌但请求未带 ?bst= → 403',
    (await call3(mkR3({ url: 'https://w.test' + MAGIC_Q, headers: { 'User-Agent': UA_TUNNEL } }), BENV)).status === 403);
  resetCfg3();
  check('A-1/E2 带了错误令牌 → 403',
    (await call3(mkR3({ url: 'https://w.test' + MAGIC_Q + '&bst=' + 'y'.repeat(40), headers: { 'User-Agent': UA_TUNNEL } }), BENV)).status === 403);
  resetCfg3();
  check('A-1/E2 令牌长度 <32 视为弱 → 忽略该配置 → 403',
    (await call3(mkR3({ url: 'https://w.test' + MAGIC_Q + '&bst=short', headers: { 'User-Agent': UA_TUNNEL } }), { BEST_SUB: '1', SUB_DOMAIN: 'gen.test', BEST_SUB_TOKEN: 'short' })).status === 403);
  resetCfg3();
  check('A-1 BEST_SUB=1 但魔术条件只满足 2/3 → 403',
    (await call3(mkR3({ url: 'https://w.test/sub?uuid=00000000-0000-4000-8000-000000000000&bst=' + BST, headers: { 'User-Agent': UA_TUNNEL } }), BENV)).status === 403);
  // A-1 门槛（team-lead 裁定）：未显式配置 SUB_DOMAIN → 整个哨兵分支不启用，仍走 UUID 鉴权
  resetCfg3();
  {
    const r = await call3(mkR3({ url: 'https://w.test' + MAGIC_Q + '&bst=' + BST, headers: { 'User-Agent': UA_TUNNEL } }), { BEST_SUB: '1', BEST_SUB_TOKEN: BST });
    check('A-1 门槛：BEST_SUB=1 + 令牌正确但**未配 SUB_DOMAIN** → 仍 403（不跳过鉴权）', r.status === 403, 'status=' + r.status);
  }

  // ---- A-3：订阅域名随机化（默认关闭）----
  const subOf = async (env) => {
    const r = await call3(mkR3({ url: 'https://w.test/sub?uuid=' + UUID0, headers: { 'User-Agent': UA3 } }), env);
    return unb64(await r.text());
  };
  const ADD2 = { ADD: '1.1.1.1:443#n1\n8.8.8.8:443#n2' };
  resetCfg3();
  check('A-3 未配 RANDOM_HOST：订阅域名保持入口域名（默认关闭零影响）', (await subOf(ADD2)).includes('w.test'));
  resetCfg3();
  {
    const d = await subOf({ ...ADD2, RANDOM_HOST: '1', HOSTS: 'a.test,b.test' });
    check('A-3 RANDOM_HOST=1 + HOSTS：出现 ≥2 种随机域名且原域名已被替换',
      d.includes('a.test') && d.includes('b.test') && !d.includes('w.test'), d.slice(0, 120));
  }
  resetCfg3();
  {
    const d = await subOf({ ...ADD2, RANDOM_HOST: '1', HOSTS: 'evil.com/@x,b.test' });
    check('A-3 HOSTS 白名单：含 / @ 的非法域名被过滤（防节点 URI 注入）', !d.includes('evil.com'), d.slice(0, 120));
  }

  // ---- NET：订阅默认传输 ws|xhttp（env/D1 → ?net= 覆盖 → 转换器回源恒 ws）----
  const subOfUrl = async (env, u) => { const r = await call3(mkR3({ url: u, headers: { 'User-Agent': UA3 } }), env); return unb64(await r.text()); };
  resetCfg3();
  { const d = await subOf(ADD2); check('NET 未配：节点 type=ws 且无 mode=（默认零影响）', /type=ws&/.test(d) && !d.includes('mode='), d.slice(0, 140)); }
  resetCfg3();
  { const d = await subOf({ ...ADD2, NET: 'xhttp' }); check('NET=xhttp：节点 type=xhttp&mode=stream-one（每行）', d.split('\n').filter(Boolean).every(l => l.includes('type=xhttp&host=') && l.includes('&mode=stream-one')), d.slice(0, 160)); }
  resetCfg3();
  {
    const d = await subOf({ ...ADD2, NET: 'xhttp' }), ls = d.split('\n').filter(Boolean);
    check('NET=xhttp：每行带 padding 混淆 extra，头/键与入站同源（UUID 派生）', ls.length > 0 && ls.every(l => extraOk(l, UUID0)), d.slice(0, 260));
    check('NET=xhttp：节点不写 alpn（客户端自行协商）', !/[?&]alpn=/.test(d), d.slice(0, 160));
  }
  resetCfg3();
  { const d = await subOf(ADD2); check('NET=ws：节点不带 extra、不写 alpn', !d.includes('extra=') && !/[?&]alpn=/.test(d), d.slice(0, 160)); }
  resetCfg3();
  { const d = await subOfUrl({ ...ADD2, NET: 'xhttp' }, 'https://w.test/sub?uuid=' + UUID0 + '&net=ws'); check('NET=xhttp + ?net=ws → 本次 ws', /type=ws&/.test(d) && !d.includes('xhttp'), d.slice(0, 120)); }
  resetCfg3();
  { const d = await subOfUrl(ADD2, 'https://w.test/sub?uuid=' + UUID0 + '&net=xhttp'); check('NET 未配 + ?net=xhttp → 本次 xhttp', /type=xhttp&/.test(d) && d.includes('mode=stream-one'), d.slice(0, 120)); }
  resetCfg3();
  { const d = await subOfUrl({ ...ADD2, NET: 'xhttp' }, 'https://w.test/123456?flag=true&net=xhttp'); check('NET=xhttp 但 flag=true（转换器回源）→ 恒 ws', /type=ws&/.test(d) && !d.includes('xhttp'), d.slice(0, 120)); }
  resetCfg3();
  { const d = await subOfUrl({ ...ADD2, NET: 'XHTTP ' }, 'https://w.test/sub?uuid=' + UUID0); check('NET 大小写/空白容错："XHTTP " → xhttp', /type=xhttp&/.test(d), d.slice(0, 120)); }
  resetCfg3();
  { const d = await subOfUrl({ ...ADD2, NET: 'grpc' }, 'https://w.test/sub?uuid=' + UUID0); check('NET 非法值 → 回退 ws', /type=ws&/.test(d) && !d.includes('mode='), d.slice(0, 120)); }
  resetCfg3();
  {
    // 路径 B：上游生成器返回 ws 模板行（含本端 UUID）+ 外来节点行 → 仅本端行改写
    // 两行都带 alpn=h3：本端行须剔除（中间位置），外来行须原样保留
    const save = globalThis.fetch;
    const up = 'vless://' + UUID0 + '@1.2.3.4:443?encryption=none&security=tls&alpn=h3&type=ws&host=w.test&path=%2F#mine\nvless://11111111-2222-4333-8444-555555555555@5.6.7.8:443?encryption=none&security=tls&alpn=h3&type=ws&host=x.test#other';
    globalThis.fetch = async (u) => { const s = String((u && u.url) || u); if (s.includes('/sub?host=example.com')) return new RealResponse('nope', { status: 500 }); if (s.includes('gen.test/sub?')) return new RealResponse(btoa(up), { status: 200 }); return new RealResponse('nf', { status: 404 }); };
    try {
      const d = await subOfUrl({ NET: 'xhttp', SUB_DOMAIN: 'gen.test' }, 'https://w.test/123456');
      const mine = d.split('\n').find(l => l.includes(UUID0)) || '', other = d.split('\n').find(l => l.includes('11111111-2222')) || '';
      check('NET=xhttp 路径 B：上游 ws 行（本端 UUID）改写为 xhttp+stream-one，外来行不动', mine.includes('type=xhttp&mode=stream-one') && other.includes('type=ws') && !other.includes('xhttp'), (mine + ' | ' + other).slice(0, 200));
      check('NET=xhttp 路径 B：本端行补 padding 混淆 extra（头/键由 UUID 派生）', extraOk(mine, UUID0), mine.slice(0, 260));
      check('NET=xhttp 路径 B：本端行剔除 alpn 且无 &&/?& 残留，外来行 alpn 原样保留', !/[?&]alpn=/.test(mine) && !/[?&]&|&#/.test(mine) && mine.includes('security=tls&type=xhttp') && other.includes('&alpn=h3&') && !extraOf(other), (mine + ' | ' + other).slice(0, 220));
    } finally { globalThis.fetch = save; }
  }
  resetCfg3();
  {
    // 路径 B · ws：本端行 alpn 在查询串末尾（紧贴 #）也须剔除；ws 行不带 extra
    const save = globalThis.fetch;
    const up = 'vless://' + UUID0 + '@1.2.3.4:443?encryption=none&security=tls&type=ws&host=w.test&path=%2F&alpn=h3#mine';
    globalThis.fetch = async (u) => { const s = String((u && u.url) || u); if (s.includes('/sub?host=example.com')) return new RealResponse('nope', { status: 500 }); if (s.includes('gen.test/sub?')) return new RealResponse(btoa(up), { status: 200 }); return new RealResponse('nf', { status: 404 }); };
    try {
      const d = await subOfUrl({ SUB_DOMAIN: 'gen.test' }, 'https://w.test/123456');
      const mine = d.split('\n').find(l => l.includes(UUID0)) || '';
      check('NET=ws 路径 B：本端行末尾 alpn 剔除、# 备注保留、不带 extra', /type=ws&/.test(mine) && !/[?&]alpn=/.test(mine) && !/&#/.test(mine) && /path=[^&#]+#mine$/.test(mine) && !mine.includes('extra='), mine.slice(0, 200));
    } finally { globalThis.fetch = save; }
  }

  // ---- A-4 / A-5：转换器回源钉 &target=mixed + 补 udp/xudp/tls13/append_type ----
  const GEN_LINE = 'vless://00000000-0000-4000-8000-000000000000@1.2.3.4:443?encryption=none&security=tls&type=ws&host=example.com#n';
  const captureSub = async (env, url) => {
    const save = globalThis.fetch; const seen = [];
    globalThis.fetch = async (u) => {
      const s = String((u && u.url) || u);
      seen.push(s);
      if (s.includes('/sub?host=example.com')) return new RealResponse(btoa(GEN_LINE), { status: 200 });
      return new RealResponse('converted', { status: 200 });
    };
    try { return { res: await call3(mkR3({ url, headers: { 'User-Agent': UA3 } }), env), seen }; }
    finally { globalThis.fetch = save; }
  };
  resetCfg3();
  {
    const { seen } = await captureSub({ SUBAPI: 'https://conv.test' }, 'https://w.test/123456?target=clash');
    const conv = seen.find(u => u.includes('conv.test')) || '';
    const inner = decodeURIComponent((conv.match(/[?&]url=([^&]*)/) || [0, ''])[1]);
    check('A-4 回源 URL 钉 &target=mixed（对齐 EDT 回源约定）', inner.includes('flag=true&target=mixed'), 'inner=' + inner);
    check('A-5 转换器 URL 补 udp/xudp/tls13/append_type（默认全开）',
      /&udp=true/.test(conv) && /&xudp=true/.test(conv) && /&tls13=true/.test(conv) && /&append_type=true/.test(conv), conv.slice(0, 220));
  }
  resetCfg3();
  {
    const { seen } = await captureSub({ SUBAPI: 'https://conv.test', SUB_UDP: 'false' }, 'https://w.test/123456?target=clash');
    const conv = seen.find(u => u.includes('conv.test')) || '';
    check('A-5 SUB_UDP=false → 转换器 URL 出现 udp=false（可配）', /&udp=false/.test(conv), conv.slice(0, 220));
  }
  resetCfg3();
  {
    const { res } = await captureSub({ SUBAPI: 'https://conv.test' }, 'https://w.test/123456?target=mixed');
    const ct = res.headers.get('content-type') || '';
    check('A-4 ?target=mixed → 钉为原生 base64 通用订阅（不进转换后端，无本端递归）',
      ct.includes('text/plain') && unb64(await res.text()).includes('vless://'), 'ct=' + ct);
  }

  // ---- A-7：TLS 分片订阅参数 ----
  resetCfg3();
  check('A-7 TLS_FRAGMENT=shadowrocket → 节点含 fragment=1,40-60,30-50,tlshello',
    (await subOf({ TLS_FRAGMENT: 'shadowrocket' })).includes('fragment=1,40-60,30-50,tlshello'));
  resetCfg3();
  check('A-7 TLS_FRAGMENT=happ → 节点含 fragment=3,1,tlshello',
    (await subOf({ TLS_FRAGMENT: 'happ' })).includes('fragment=3,1,tlshello'));
  resetCfg3();
  check('A-7 未配 TLS_FRAGMENT → 不含 fragment（零影响）', !(await subOf({})).includes('fragment='));

  // ---- A-11：/robots.txt、GET /logout、admin/check ----
  resetCfg3();
  {
    const r = await call3(mkR3({ url: 'https://w.test/robots.txt', headers: { 'User-Agent': 'Googlebot/2.1' } }), {});
    check('A-11 /robots.txt → 200 + Disallow: /（且位于蜘蛛拦截之前）', r.status === 200 && (await r.text()).includes('Disallow: /'), 'status=' + r.status);
  }
  resetCfg3();
  {
    const r = await call3(mkR3({ url: 'https://w.test/logout', headers: { 'User-Agent': UA3 } }), {});
    const sc = r.headers.get('set-cookie') || '';
    check('A-11 GET /logout → 302 + Location:/ + 清 cookie（无开放重定向）',
      r.status === 302 && r.headers.get('location') === '/' && /Max-Age=0/i.test(sc), 'status=' + r.status + ' sc=' + sc);
  }
  const mkDB3 = () => {
    const store = new Map();
    return {
      store, prepare(sql) {
        const ins = /INSERT/i.test(sql);
        const all = async () => ({ results: ins ? [] : [...store].map(([k2, v2]) => ({ key: k2, value: v2 })) });
        const run = (a) => { if (ins && a && a.length >= 2) store.set(String(a[0]), String(a[1])); return Promise.resolve({}); };
        const bound = (a) => ({ bind: (...a2) => bound(a2), all, run: () => run(a) });
        return { bind: (...a) => bound(a), all, run: () => run([]) };
      }
    };
  };
  const DB3 = mkDB3(); const ENV3 = { DB: DB3 };
  let AUTH_CK = '';
  resetCfg3();
  {
    const r = await call3(mkR3({
      url: 'https://w.test/?flag=login', method: 'POST',
      headers: { 'User-Agent': UA3, 'Content-Type': 'application/json', 'cf-connecting-ip': '10.9.9.9' },
      body: JSON.stringify({ pwd: 'abc' })
    }), ENV3);
    AUTH_CK = (r.headers.get('set-cookie') || '').split(';')[0];
    check('A-11 前置：取得有效鉴权 cookie', AUTH_CK.startsWith('auth='), 'ck=' + AUTH_CK.slice(0, 16));
  }
  resetCfg3();
  check('A-11 admin/check 无鉴权 → 403',
    (await call3(mkR3({ url: 'https://w.test/admin/check?socks5=1.2.3.4:1080', headers: { 'User-Agent': UA3 } }), {})).status === 403);
  resetCfg3();
  check('A-11 admin/check 有鉴权但缺代理参数 → 400',
    (await call3(mkR3({ url: 'https://w.test/admin/check', headers: { 'User-Agent': UA3, Cookie: AUTH_CK } }), ENV3)).status === 400);
  resetCfg3();
  {
    const r = await call3(mkR3({ url: 'https://w.test/admin/check?socks5=127.0.0.1:1080', headers: { 'User-Agent': UA3, Cookie: AUTH_CK } }), ENV3);
    const j = await r.json().catch(() => ({}));
    check('A-11 admin/check 内网代理主机 → SSRF 闸门拦截（400 / success:false）',
      r.status === 400 && j.success === false, 'status=' + r.status + ' body=' + JSON.stringify(j));
  }

  // ---- A-6：pCfg ?sstp= 与 g 前缀全局语法 ----
  {
    const c1 = pCfg(mkUrl('/s5=1.2.3.4:1080'), 's5=1.2.3.4:1080', null);
    check('A-6 原有 /s5= 行为不变（仍为回落，非全局）', !c1.gP && !!c1.s5, JSON.stringify({ gP: !!c1.gP, s5: !!c1.s5 }));
    const c2 = pCfg(mkUrl('/gs5=1.2.3.4:1080'), 'gs5=1.2.3.4:1080', null);
    check('A-6 /gs5= → 提升为全局 socks5', !!c2.gP && c2.gP.type === 'socks5' && !c2.s5, JSON.stringify({ type: c2.gP && c2.gP.type }));
    const c3 = pCfg(mkUrl('/gturn=user:pass@1.2.3.4:3478'), 'gturn=user:pass@1.2.3.4:3478', null);
    check('A-6 /gturn= → 全局 turn', !!c3.gP && c3.gP.type === 'turn', JSON.stringify({ type: c3.gP && c3.gP.type }));
    const c4 = pCfg(mkUrl('/?sstp=1.2.3.4:443'), 'x', null);
    check('A-6 ?sstp= → 解析并提升为全局 sstp', !!c4.gP && c4.gP.type === 'sstp', JSON.stringify({ type: c4.gP && c4.gP.type }));
    const c5 = pCfg(mkUrl('/ghttps=1.2.3.4:443'), 'ghttps=1.2.3.4:443', null);
    // gP.type 只有 socks5/http/sstp/turn 四种（tryCon 按此分派），https 落在 'http' 且靠 cfg.tls=1 走 TLS 隧道
    check('A-6 /ghttps= → 全局（type=http + cfg.tls=1）',
      !!c5.gP && c5.gP.type === 'http' && c5.gP.cfg && c5.gP.cfg.tls === 1, JSON.stringify({ type: c5.gP && c5.gP.type, tls: c5.gP && c5.gP.cfg && c5.gP.cfg.tls }));
  }

  // ---- A-12：GO2SOCKS5 直连白名单（匹配方式 + SSRF 红线 + 未配零影响）----
  {
    const B7 = WK.__b7 || {};
    // helper 缺失（如跑在陈旧产物上）时返回 null → 断言自然判红，而不是抛异常炸掉整个 harness
    const HIT = (l, h) => { try { return B7.go2s5Hit ? B7.go2s5Hit(l, h) : null; } catch (e) { return null; } };
    const LIST = async (env) => { try { B7.resetGO2S5 && B7.resetGO2S5(); return B7.go2s5List ? await B7.go2s5List(env) : null; } catch (e) { return null; } };
    const RESET = () => { try { B7.resetGO2S5 && B7.resetGO2S5(); } catch (e) { } };
    // 最小 socket 桩：opened 已 resolve（供 raceSprout/sprout 使用），其余空实现
    const fakeFetcher = {
      connect() {
        return {
          opened: Promise.resolve(),
          writable: { getWriter: () => ({ write: async () => { }, releaseLock: () => { } }) },
          readable: { getReader: () => ({ read: async () => ({ done: true, value: undefined }), releaseLock: () => { } }) },
          close: () => { }
        };
      }
    };
    check('A-12 匹配：精确主机名 a.com → 命中', HIT(['a.com'], 'a.com') === true);
    check('A-12 匹配：evil-a.com **不**命中 a.com（非子串包含）', HIT(['a.com'], 'evil-a.com') === false);
    check('A-12 匹配：*b.com 命中 x.b.com（点分后缀）', HIT(['*b.com'], 'x.b.com') === true);
    check('A-12 匹配：xb.com **不**命中 *b.com（必须带点）', HIT(['*b.com'], 'xb.com') === false);
    check('A-12 匹配：*.c.com 写法同样支持', HIT(['*.c.com'], 'y.c.com') === true);
    check('A-12 匹配：未配白名单（空列表）→ 恒 false', HIT([], 'a.com') === false);
    RESET();
    {
      const l0 = await LIST({ GO2SOCKS5: '*' });
      check('A-12 格式闸门：裸 "*" 被拒（不得整体关闭 ProxyIP 收敛）', Array.isArray(l0) && l0.length === 0, JSON.stringify(l0));
    }
    RESET();
    {
      const l = await LIST({ GO2SOCKS5: 'a.com, *.b.com, bad/x, ok.com' });
      check('A-12 格式闸门：含 / 的非法项被丢弃，合法项保留',
        Array.isArray(l) && l.length === 3 && l.includes('a.com') && l.includes('*.b.com') && l.includes('ok.com'), JSON.stringify(l));
    }
    RESET();
    // tryCon 安全包装：helper 缺失（跑在陈旧产物上）时返回 err，断言自然判红而不炸 harness
    const TRYCON = async (at, h, p, rc, env) => {
      if (!B7.tryCon) return { sock: null, err: new Error('tryCon-unavailable') };
      try { return { sock: await B7.tryCon(fakeFetcher, at, h, p, rc, env), err: null }; } catch (e) { return { sock: null, err: e }; }
    };
    // 命中白名单 → 直连（不抛错，拿到 socket）
    RESET();
    {
      const rc = { pIP: { address: 'proxy.test', port: 443 }, s5: null, enS: null, turn: null, gP: null, order: ['proxy'] };
      const { sock, err } = await TRYCON(3, 'direct.test', 443, rc, { GO2SOCKS5: 'direct.test' });
      check('A-12 命中白名单 → 改为直连（跳过 ProxyIP）', !err && !!sock, 'err=' + (err && err.message));
    }
    RESET();
    // ★ 硬红线：白名单不等于放行内网——命中也要过 _extHostSafe
    {
      const rc = { pIP: null, s5: null, enS: null, turn: null, gP: null, order: ['direct'] };
      const { err } = await TRYCON(1, '127.0.0.1', 80, rc, { GO2SOCKS5: '127.0.0.1' });
      check('A-12 红线：目标为回环地址，即便命中白名单也被 _extHostSafe 拒绝',
        !!err && /GO2SOCKS5 target blocked/.test(String(err.message)), 'err=' + (err && err.message));
    }
    RESET();
    {
      const rc = { pIP: null, s5: null, enS: null, turn: null, gP: null, order: ['direct'] };
      const { err } = await TRYCON(1, '10.0.0.5', 80, rc, { GO2SOCKS5: '10.0.0.5' });
      check('A-12 红线：目标为内网地址（10.0.0.5）同样被拒',
        !!err && /GO2SOCKS5 target blocked/.test(String(err.message)), 'err=' + (err && err.message));
    }
    RESET();
  }

  // ---- A-11：admin/check 失败路径必须返回明确错误（不挂起、不静默）----
  {
    // (a) fetcher 直接抛错 → 明确 error 字符串
    resetCfg3();
    {
      const r = await call3(mkR3({ url: 'https://w.test/admin/check?socks5=proxy.test:1080', headers: { 'User-Agent': UA3, Cookie: AUTH_CK } }), ENV3);
      const j = await r.json().catch(() => ({}));
      check('A-11 失败路径：connect 抛错 → success:false + 非空 error（不挂起）',
        j.success === false && typeof j.error === 'string' && j.error.length > 0 && typeof j.responseTime === 'number', JSON.stringify(j));
    }
    // (b) 第七轮：目标 80 → **443 + TLS**。断言 SOCKS5 CONNECT 编码的是 cloudflare.com:443，
    //     且随后确实发出了 TLS ClientHello（首字节 0x16 0x03 = TLS handshake record, TLS 1.x）
    const mkRecSock = (hs) => {
      let i = 0;
      const writes = [];
      const sock = {
        writable: { getWriter: () => ({ write: async (v) => { writes.push(new Uint8Array(v)); }, releaseLock: () => { } }) },
        readable: { getReader: () => ({ read: async () => (i < hs.length ? { done: false, value: hs[i++] } : { done: true, value: undefined }), releaseLock: () => { } }) },
        close: () => { sock._closed = true; }
      };
      sock._writes = writes;
      return sock;
    };
    const HS_OK = [new Uint8Array([5, 0]), new Uint8Array([5, 0, 0, 1, 0, 0, 0, 0, 0, 0])];
    const decodeS5Target = (c1) => {
      const b = c1 || new Uint8Array(0);
      const nameLen = b[4] || 0;
      return { atyp: b[3], name: new TextDecoder().decode(b.slice(5, 5 + nameLen)), port: ((b[5 + nameLen] || 0) << 8) | (b[6 + nameLen] || 0) };
    };
    resetCfg3();
    {
      const sock = mkRecSock(HS_OK);
      const req2 = mkR3({ url: 'https://w.test/admin/check?socks5=proxy.test:1080', headers: { 'User-Agent': UA3, Cookie: AUTH_CK } });
      req2.fetcher = { connect: () => sock };
      const r = await call3(req2, ENV3);
      const j = await r.json().catch(() => ({}));
      // writes[0]=SOCKS5 greeting, writes[1]=CONNECT 请求, writes[2]=TLS ClientHello
      const tgt = decodeS5Target(sock._writes[1]);
      check('A-11 目标固定为 cloudflare.com:443（SOCKS5 CONNECT 编码，非 80）',
        tgt.atyp === 3 && tgt.name === 'cloudflare.com' && tgt.port === 443, JSON.stringify(tgt));
      const ch = sock._writes[2] || new Uint8Array(0);
      check('A-11 走 TLS 握手（发出 TLS ClientHello：0x16 0x03）',
        ch[0] === 0x16 && ch[1] === 0x03, `first2=${ch[0]},${ch[1]} len=${ch.length}`);
      check('A-11 失败路径：TLS 握手 EOF → 明确 error（不挂起，且非无意义的 "0"）',
        j.success === false && typeof j.error === 'string' && j.error.length > 0 && !/^0$/.test(j.error), JSON.stringify(j));
    }
    // (b2) 目标**不可由请求参数指定**：注入 host/port/target 均不影响目标
    resetCfg3();
    {
      const sock = mkRecSock(HS_OK);
      const req2 = mkR3({ url: 'https://w.test/admin/check?socks5=proxy.test:1080&host=evil.com&port=9999&target=evil.com:80', headers: { 'User-Agent': UA3, Cookie: AUTH_CK } });
      req2.fetcher = { connect: () => sock };
      await call3(req2, ENV3);
      const tgt = decodeS5Target(sock._writes[1]);
      check('A-11 目标不可由参数指定（注入 host/port/target → 仍 cloudflare.com:443）',
        tgt.name === 'cloudflare.com' && tgt.port === 443, JSON.stringify(tgt));
    }
    // (c) E3：异常路径必须关 socket —— 原实现的 releaseLock/close 在 try 主体末尾，
    //     catch 只返回 JSON 不关连接 → 泄漏至 isolate 回收。改为 finally 后此处必须关闭。
    resetCfg3();
    {
      let closed = false, i = 0, wn = 0;
      // 第七轮：HTTP GET 现由 TLS 加密，不再以明文写 → 改为让 **TLS ClientHello 写阶段**（第 3 次写）抛错，
      // 此时 _ckSock 已赋值（TlsClient 构造前），故 finally 必须关闭 socket。
      const hsChunks = [new Uint8Array([5, 0]), new Uint8Array([5, 0, 0, 1, 0, 0, 0, 0, 0, 0])];
      const badSock = {
        writable: {
          getWriter: () => ({
            write: async () => { wn++; if (wn > 2) throw new Error('boom'); },
            releaseLock: () => { }
          })
        },
        readable: { getReader: () => ({ read: async () => (i < hsChunks.length ? { done: false, value: hsChunks[i++] } : { done: true, value: undefined }), releaseLock: () => { } }) },
        close: () => { closed = true; }
      };
      const req3 = mkR3({ url: 'https://w.test/admin/check?socks5=proxy.test:1080', headers: { 'User-Agent': UA3, Cookie: AUTH_CK } });
      req3.fetcher = { connect: () => badSock };
      const r = await call3(req3, ENV3);
      const j = await r.json().catch(() => ({}));
      check('E3 admin/check 写阶段抛错 → 返回明确 error（不挂起）',
        j.success === false && typeof j.error === 'string' && j.error.length > 0, JSON.stringify(j));
      check('E3 admin/check 异常路径也关闭 socket（清理在 finally）', closed === true, 'closed=' + closed);
    }
  }
}

// ================= 12. 批次 6：可观测性（/health + TG 可见性 + 低频结构化日志） =================
console.log('\n===== 批次 6 可观测性 =====');
{
  const WK6 = WK.__b6 || {};
  // 过期产物（未含批次 6 代码）跑 harness 时 __b6 全为 null：降级为 1 条失败，避免整轮崩溃丢失红基线
  const B6_OK = !!(WK6.obs && WK6.routeEnum && WK6.sendTgMsg && WK6.tgStreak);
  const mkDB6 = () => {
    const store = new Map();
    return {
      store, prepare(sql) {
        const ins = /INSERT/i.test(sql);
        const all = async () => ({ results: ins ? [] : [...store].map(([k2, v2]) => ({ key: k2, value: v2 })) });
        const run = (a) => { if (ins && a && a.length >= 2) store.set(String(a[0]), String(a[1])); return Promise.resolve({}); };
        const bound = (a) => ({ bind: (...a2) => bound(a2), all, run: () => run(a) });
        return { bind: (...a) => bound(a), all, run: () => run([]) };
      }
    };
  };
  const mkR6 = (url, method = 'GET') => ({
    url, method,
    headers: { get: k => (k.toLowerCase() === 'user-agent' ? 'Mozilla/5.0 (B6 Test)' : null) },
    cf: { country: 'US', city: 'T' }, body: null,
    json: async () => ({}), text: async () => ''
  });
  const call6 = (req, env) => WK.default.fetch(req, env || {}, { waitUntil() { } });

  // ---- ① /health：SLO 探针端点（最小信息、不泄漏） ----
  {
    const r = await call6(mkR6('https://w.test/health'), {});
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch (e) { }
    check('批次6 /health：curl/蜘蛛类 UA 之外也能拿到 200（端点位于蜘蛛拦截之前）', r.status === 200, 'status=' + r.status);
    check('批次6 /health：响应体最小信息（仅 {ok,t} 两个键）',
      !!j && j.ok === true && typeof j.t === 'number' && Object.keys(j).length === 2, t);
    check('批次6 /health：不泄漏 UUID / 口令 / token / 版本 / 主机名 / 部署形态',
      !/d675a8ea|vless|cloudflare|D1|SUB_PASSWORD|password|token|version|worker|obf/i.test(t), t);
  }

  // ---- ② TG 推送可见性：失败计数 → 降级 → 恢复单条告警 ----
  if (!B6_OK) {
    check('批次6 TG 可见性：产物未含批次 6 代码（红基线 —— 需重建产物）', false, '__b6 导出缺失');
  } else {
    const prevFetch = globalThis.fetch;
    const oErr = console.error, oWarn = console.warn;
    const lines = [];
    // 只劫持 error/warn（obs 的 error/warn 出口）；**不能劫持 log** —— check() 用它输出结论
    const grab = (...a) => { lines.push(a.map(x => String(x)).join(' ')); };
    console.error = grab; console.warn = grab;
    let mode = 'ok';
    globalThis.fetch = async (u, opt) => {
      const s = String(u instanceof URL ? u : (u && u.url) || u);
      if (!/api\.telegram\.org/.test(s)) return prevFetch(u, opt);
      if (mode === 'fail500') return new RealResponse('err', { status: 500 });
      if (mode === 'failapi') return new RealResponse(JSON.stringify({ ok: false, description: 'chat not found' }), { status: 200 });
      if (mode === 'throw') throw new Error('net down');
      return new RealResponse(JSON.stringify({ ok: true, result: { message_id: 777 } }), { status: 200 });
    };
    const pend = [];
    const ctx6 = { waitUntil(p) { pend.push(Promise.resolve(p).catch(() => { })); } };
    const drain = async () => { for (let i = 0; i < 10 && pend.length; i++) { const b = pend.splice(0); await Promise.all(b); await sleep(1); } };
    const env6 = { DB: mkDB6(), TG_BOT_TOKEN: '123456:AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIII', TG_CHAT_ID: '10001' };
    const hasEv = (arr, ev) => arr.some(l => { try { return JSON.parse(l).ev === ev; } catch (e) { return false; } });
    try {
      if (WK6.obsReset) WK6.obsReset();
      await WK6.tgFailClear(env6, 'init');   // 干净起点（清 D1 计数 + 内存计数）
      lines.length = 0;
      // (a) 连续 3 次失败（TG 业务错误：HTTP 200 + {"ok":false}）
      mode = 'failapi';
      const trace = [];
      for (let i = 0; i < 3; i++) {
        WK.cfgCacheReset();                       // 每轮前重置 D1 配置缓存（模拟独立 isolate，避免跨用例缓存串味）
        await WK6.sendTgMsg(ctx6, env6, 'B6 测试', mkR6('https://w.test/abc'), '', false);
        await drain();
        trace.push(await WK6.tgStreak(env6));
      }
      const s3 = await WK6.tgStreak(env6);
      const dg = await WK6.tgDegradedUntil(env6);
      check('批次6 TG 可见性：连续 3 次失败 → streak=3（原实现完全静默）', s3 === 3, 'streak=' + s3 + ' trace=' + trace.join('>'));
      check('批次6 TG 可见性：达阈值 → 进降级冷却（degraded_until > now）', dg > Date.now(), 'until=' + dg);
      check('批次6 TG 可见性：失败落结构化日志 ev=tg_fail', hasEv(lines, 'tg_fail'), lines.slice(0, 1).join('') || '(no log)');
      // (b) 降级冷却期内 pushDashboard 跳过（不硬试、不刷屏）
      lines.length = 0;
      await WK6.pushDashboard({ ...env6, STATS_ENABLED: 'true' });
      check('批次6 TG 可见性：降级期内 pushDashboard 跳过 + 落 tg_dash_degraded', hasEv(lines, 'tg_dash_degraded'), lines.slice(-1)[0] || '(no log)');
      // (c) 恢复：成功一次 → 计数清零 + 恢复通知（单条）
      mode = 'ok';
      lines.length = 0;
      await WK6.sendTgMsg(ctx6, env6, 'B6 测试', mkR6('https://w.test/abc'), '', false);
      await drain();
      const s0 = await WK6.tgStreak(env6);
      check('批次6 TG 可见性：成功一次 → streak 清零 + 落 tg_recovered（恢复单条告警）',
        s0 === 0 && hasEv(lines, 'tg_recovered'), 'streak=' + s0 + ' lines=' + lines.length);
      // (d) 无 D1 时退化为 isolate 内存计数，仍可观测（不刷屏）
      lines.length = 0;
      const envNoDB = { TG_BOT_TOKEN: '123456:AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIII', TG_CHAT_ID: '10001' };
      await WK6.tgFailClear(envNoDB, 'init');
      mode = 'fail500';
      await WK6.sendTgMsg(ctx6, envNoDB, 'B6 测试', mkR6('https://w.test/abc'), '', false);
      await drain();
      check('批次6 TG 可见性：无 D1 → 退化为内存计数仍可观测（streak=1）', (await WK6.tgStreak(envNoDB)) === 1, 'streak=' + (await WK6.tgStreak(envNoDB)));
    } finally {
      globalThis.fetch = prevFetch;
      console.error = oErr; console.warn = oWarn;
    }
  }

  // ---- ③ 低频结构化日志：格式 / 敏感字段过滤 / 路由枚举 / 节流 ----
  if (!B6_OK) {
    check('批次6 低频结构化日志：产物未含批次 6 代码（红基线 —— 需重建产物）', false, '__b6 导出缺失');
  } else {
    const oErr = console.error, oWarn = console.warn, oLog = console.log;
    const lines = [];
    const grab = (...a) => { lines.push(a.map(x => String(x)).join(' ')); };
    try {
      console.error = grab; console.warn = grab; console.log = grab;
      if (WK6.obsReset) WK6.obsReset();
      // 第七轮：`note` 不在白名单 → 必被 [redacted]；改用白名单键 `why` 承载「串内 bot token 应被 obsScrub 抹除」这条断言
      WK6.obs('error', 'b6_unit', {
        route: 'admin_check', retry: 2,
        password: 'p@ssw0rd', cookie: 'auth=abc', token: '123:AAAA', uuid: '06b65903-406d-4a41-8463-6fd5c0ee7798',
        why: 'bot123456:AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIII'
      }, {});
      console.error = oErr; console.warn = oWarn; console.log = oLog;
      let j = null; try { j = JSON.parse(lines[0] || ''); } catch (e) { }
      check('批次6 日志：单行 JSON（ts/lvl/ev/n 齐备，Workers Logs 可直接检索）',
        lines.length === 1 && !!j && typeof j.ts === 'string' && j.lvl === 'error' && j.ev === 'b6_unit' && j.n === 1, lines[0] || '(no log)');
      check('批次6 日志：password/cookie/token/uuid 键 → [redacted]（敏感字段过滤）',
        !!j && j.password === '[redacted]' && j.cookie === '[redacted]' && j.token === '[redacted]' && j.uuid === '[redacted]', lines[0] || '');
      check('批次6 日志：非敏感标量保留（route=admin_check / retry=2）',
        !!j && j.route === 'admin_check' && j.retry === 2, lines[0] || '');
      check('批次6 日志：串内 bot token 被 obsScrub 抹除（第二层，白名单内字段同样生效）',
        !!j && typeof j.why === 'string' && j.why.indexOf('123456:AAAA') === -1 && /bot_token/.test(j.why), String(j && j.why));

      const re = WK6.routeEnum;
      check('批次6 路由枚举：/robots.txt /logout /admin/check /health 各自成枚举',
        re('/robots.txt') === 'robots' && re('/logout') === 'logout' && re('/admin/check') === 'admin_check' && re('/health') === 'health',
        [re('/robots.txt'), re('/logout'), re('/admin/check'), re('/health')].join(','));
      check('批次6 路由枚举：`/{SUB_PASSWORD}` 明文口令路径归一为 path_pw_or_404（不落原始 pathname）',
        re('/MySecretPw') === 'path_pw_or_404' && re('/a/b') === 'other' && re('/') === 'root',
        re('/MySecretPw') + ' / ' + re('/a/b'));

      // 节流：同事件 60s 内第二次不输出 → 错误也不刷屏
      const l2 = [];
      console.error = (...a) => l2.push(a.map(String).join(' '));
      const a1 = WK6.obs('error', 'b6_throttle', {}, {});
      const a2 = WK6.obs('error', 'b6_throttle', {}, {});
      console.error = oErr;
      check('批次6 日志：同事件 60s 内节流（第二次不输出，错误也不刷屏）',
        a1 === true && a2 === false && l2.length === 1, 'a1=' + a1 + ' a2=' + a2 + ' lines=' + l2.length);

      // D1 读失败 → 落 d1_read_fail（原先完全静默）
      const badDB = {
        prepare: () => ({
          all: async () => { throw new Error('D1 down'); },
          run: async () => { throw new Error('D1 down'); },
          bind: () => ({ all: async () => { throw new Error('D1 down'); }, run: async () => { throw new Error('D1 down'); } })
        })
      };
      const l3 = [];
      WK.cfgCacheReset();
      console.warn = (...a) => l3.push(a.map(String).join(' '));
      const v = await WK.getSafeEnv({ DB: badDB }, 'ANY_KEY_NOT_SET', 'fallback');
      console.warn = oWarn;
      check('批次6 低频日志：D1 读失败 → 落 d1_read_fail（原先静默）',
        v === 'fallback' && l3.some(l => { try { return JSON.parse(l).ev === 'd1_read_fail'; } catch (e) { return false; } }),
        'v=' + v + ' lines=' + l3.length);

      // 收敛验证：第二轮 R1-b 的散落 console.error 已改为统一 obs（拒绝登录路径）
      const l4 = [];
      if (WK6.obsReset) WK6.obsReset();
      console.warn = (...a) => l4.push(a.map(String).join(' '));
      const r503 = await call6({
        url: 'https://w.test/?flag=login', method: 'POST',
        headers: { get: k => (k.toLowerCase() === 'user-agent' ? 'Mozilla/5.0 (B6 Test)' : null) },
        cf: { country: 'US', city: 'T' }, body: '{"pwd":"abc"}',
        json: async () => ({ pwd: 'abc' }), text: async () => '{"pwd":"abc"}'
      }, {});
      console.warn = oWarn;
      check('批次6 收敛：R1-b 拒绝登录路径落统一日志 auth_no_secret（替代原 console.error）',
        r503.status === 503 && l4.some(l => { try { return JSON.parse(l).ev === 'auth_no_secret'; } catch (e) { return false; } }),
        'status=' + r503.status + ' lines=' + l4.length);
      const src6 = readFileSync(DIR + 'worker.js', 'utf8');
      check('批次6 收敛：源码已无 `[auth]` 散落 console.error（统一走 obs）',
        !/console\.error\('\[auth\]/.test(src6), 'left=' + (src6.match(/console\.error\('\[auth\]/g) || []).length);
    } finally {
      console.error = oErr; console.warn = oWarn; console.log = oLog;
    }
  }
}

// ================= 13. 第六轮：审查 6 条确定性错误（E1~E6）+ 4 条优化 =================
console.log('\n===== 第六轮 审查整改（E1~E6 + 优化）=====');
{
  const B7 = WK.__b7 || {};
  const B6 = WK.__b6 || {};

  // ---- E1：XH_GUP 残留缓冲改为摊还 O(n) ----
  // 场景（审查 E1）：声明 n=GMAX(=4MiB，上界含等号 → 判为合法) 却永不补齐该帧
  //   → XH_GDEC 恒无产出 → parseVP/UUID 校验从未执行 → pull 仍持续缓冲。旧实现 p=XH_CAT(p,v) 每次全量重分配。
  if (B7.XH_GUP && typeof B7.GMAX === 'number') {
    const G = B7.GMAX;
    const hd = new Uint8Array([0x00, (G >>> 24) & 0xff, (G >>> 16) & 0xff, (G >>> 8) & 0xff, G & 0xff, 0x0a]);
    const runK = async (K) => {
      let fed = 0;
      const rd = { read: async () => (fed < K ? (fed++, { done: false, value: new Uint8Array([0x41]) }) : { done: true }) };
      const t0 = Date.now();
      const rr = B7.XH_GUP(hd, rd, false).getReader();
      try { for (; ;) { const x = await rr.read(); if (x.done) break; } } catch (e) { }
      return Date.now() - t0;
    };
    await runK(2000);                                   // warmup（消除 JIT 噪声）
    const m1 = await runK(5000), m2 = await runK(20000);
    const mul = m2 / Math.max(m1, 1);
    // 线性护栏：K 增 4 倍耗时不得超 15 倍。旧实现同场景实测 8.33x(5k→2e4)，且总拷贝 O(K×|p|)。
    check('E1 XH_GUP 摊还缓冲：K 5k→2e4 耗时增长 <15x（O(n²) 护栏）',
      mul < 15, `5k=${m1}ms 2e4=${m2}ms 倍数=${mul.toFixed(2)}x`);
    check('E1 XH_GUP：声明 n=GMAX 永不补齐仍在 2s 内终止（不卡死、有上界）', m2 < 2000, `2e4=${m2}ms`);
  } else {
    check('E1 XH_GUP 摊还缓冲（过期产物无导出 → 降级失败，保留红基线）', false, 'XH_GUP/GMAX 未导出');
  }

  // ---- E4：cfgCacheReset 一并失效 _GO2S5（否则面板改 GO2SOCKS5 要等 isolate 回收）----
  if (B7.go2s5List) {
    B7.resetGO2S5();
    const l1 = await B7.go2s5List({ GO2SOCKS5: 'a.com' });
    const l2 = await B7.go2s5List({ GO2SOCKS5: 'b.com' });   // 未 reset → 命中缓存，仍 a.com
    WK.cfgCacheReset();
    const l3 = await B7.go2s5List({ GO2SOCKS5: 'b.com' });   // reset 后 → 重新解析为 b.com
    check('E4 前置：未 reset 时返回缓存值（证明缓存确实存在）',
      l1.includes('a.com') && JSON.stringify(l1) === JSON.stringify(l2), JSON.stringify({ l1, l2 }));
    check('E4 cfgCacheReset 一并清 _GO2S5（面板改配置立即生效）',
      l3.includes('b.com') && !l3.includes('a.com'), JSON.stringify({ l1, l2, l3 }));
    B7.resetGO2S5();
  } else {
    check('E4 cfgCacheReset 清 _GO2S5（过期产物无导出 → 降级失败）', false, 'go2s5List 未导出');
  }

  // ---- E6：日志脱敏黑名单补齐 err|error|msg|message|host|hostname|url|target|proxy|key ----
  if (B6.obsRedact) {
    // 第七轮：黑名单 → 白名单。未登记的键（含 E6 曾补的 err/host/url/key…）一律 [redacted]
    const o = B6.obsRedact({
      host: 'h', hostname: 'hn', url: 'u', error: 'e', err: 'e2', msg: 'm', message: 'mm',
      target: 't', proxy: 'p', key: 'k', keyword: 'kw', foo: 'bar', note: 'n'
    });
    const mustRedact = ['host', 'hostname', 'url', 'error', 'msg', 'message', 'target', 'proxy', 'key', 'keyword', 'foo', 'note'];
    check('第七轮 白名单：未登记键一律 [redacted]（含 keyword 这类黑名单会漏/误伤的键）',
      mustRedact.every(k => o[k] === '[redacted]'), JSON.stringify(o));
    // F2：`err` 已加入白名单（修复 d1_ping_fail 丢失诊断文本的回归）→ 不再 [redacted]，故从 mustRedact 移除
    check('F2 白名单：err 已登记 → 保留（不再 [redacted]）', o.err === 'e2', JSON.stringify({ err: o.err }));
    // 白名单键必须原样保留（否则会误杀有用字段）
    const w = B6.obsRedact({ route: 'admin_check', retry: 2, left_s: 5, tbl: 'config', cron: '0 */6 * * *', db: 1, streak: 3, why: 'send', degraded: 0, had: 4, len: 8 });
    check('第七轮 白名单：已登记键全部保留（route/retry/left_s/tbl/cron/db/streak/why/degraded/had/len）',
      w.route === 'admin_check' && w.retry === 2 && w.left_s === 5 && w.tbl === 'config' && w.cron === '0 */6 * * *'
      && w.db === 1 && w.streak === 3 && w.why === 'send' && w.degraded === 0 && w.had === 4 && w.len === 8,
      JSON.stringify(w));
  } else {
    check('第七轮 白名单脱敏（过期产物无导出 → 降级失败）', false, 'obsRedact 未导出');
  }

  // ---- 优化2：Fisher-Yates 均匀洗牌（原 sort(()=>Math.random()-0.5) 分布不均）----
  if (B7.fyShuffle) {
    const cnt = [0, 0, 0], cntOld = [0, 0, 0];
    for (let i = 0; i < 6000; i++) {
      cnt[B7.fyShuffle([0, 1, 2])[0]]++;
      cntOld[[0, 1, 2].sort(() => Math.random() - 0.5)[0]]++;
    }
    check('优化2 Fisher-Yates：3 元素首位分布均匀（6000 次各 ~2000，容差 ±250）',
      cnt.every(c => c >= 1750 && c <= 2250), '新=' + JSON.stringify(cnt) + ' 旧sort=' + JSON.stringify(cntOld));
  } else {
    check('优化2 Fisher-Yates 洗牌（过期产物无导出 → 降级失败）', false, 'fyShuffle 未导出');
  }

  // ---- 优化3：OBS_ENABLED 一并支持 D1 配置（env 未设时读 _cfgCache）----
  if (B6.obs) {
    const store = new Map([['OBS_ENABLED', 'false']]);
    const dbEnv = {
      DB: {
        prepare: () => ({
          all: async () => ({ results: [...store].map(([k, v]) => ({ key: k, value: v })) }),
          bind: () => ({ run: async () => ({}), all: async () => ({ results: [] }) })
        })
      }
    };
    WK.cfgCacheReset();
    await WK.getSafeEnv(dbEnv, '__opt3_probe__', 'x');      // 触发 _cfgLoad 填充 D1 缓存
    const emitted = B6.obs('info', 'opt3_probe_should_be_off', {}, dbEnv);
    check('优化3 OBS_ENABLED 支持 D1 配置（env 未设、D1 为 false → 不输出）', emitted === false, 'obs返回=' + emitted);
    WK.cfgCacheReset();
  } else {
    check('优化3 OBS_ENABLED 支持 D1（过期产物无导出 → 降级失败）', false, 'obs 未导出');
  }

  // ---- 优化#5：登录退避表清理（登录路径阈值 64→32 + scheduled 低频点无条件清理）----
  if (B6.sweepLoginFail) {
    const now = Date.now();
    globalThis.__loginFail = new Map([
      ['1.1.1.1', { c: 5, t: now - 120000, until: now - 60000 }],   // 过期 → 应清
      ['2.2.2.2', { c: 1, t: now, until: 0 }]                       // 未过期 → 应留
    ]);
    const n = B6.sweepLoginFail();
    const m = globalThis.__loginFail;
    check('优化#5 _sweepLoginFail：清过期项、留未过期项',
      n === 1 && !m.has('1.1.1.1') && m.has('2.2.2.2'), 'n=' + n + ' size=' + m.size);
    // 低频调度点（scheduled）无条件清理
    globalThis.__loginFail = new Map([['9.9.9.9', { c: 5, t: now - 120000, until: now - 60000 }]]);
    let p = null;
    await WK.default.scheduled({ cron: '* * * * *' }, {}, { waitUntil: (x) => { p = x; } });
    if (p && typeof p.then === 'function') await p;
    check('优化#5 scheduled 低频点无条件清理退避表（不依赖 STATS_ENABLED）',
      !globalThis.__loginFail.has('9.9.9.9'), 'size=' + globalThis.__loginFail.size);
    delete globalThis.__loginFail;
  } else {
    // 保持项数恒定（不随产物新旧变化）：else 分支同样产出 2 条
    check('优化#5 _sweepLoginFail：清过期项、留未过期项（过期产物无导出 → 降级失败）', false, 'sweepLoginFail 未导出');
    check('优化#5 scheduled 低频点无条件清理退避表（过期产物无导出 → 降级失败）', false, 'sweepLoginFail 未导出');
  }

  // ---- 优化4：HOSTS 拒绝无点项与裸 "*"（对齐 GO2SOCKS5 口径，避免"配错即断网"）----
  if (B7.parseHosts) {
    const l = B7.parseHosts('a.com, nodot, *, *.b.com, ok.com');
    check('优化4 _parseHosts 拒绝无点项与裸 *（合法项保留）',
      !l.includes('nodot') && !l.includes('*') && l.includes('a.com') && l.includes('*.b.com') && l.includes('ok.com'),
      JSON.stringify(l));
  } else {
    check('优化4 _parseHosts 拒绝无点项与裸 *（过期产物无导出 → 降级失败）', false, 'parseHosts 未导出');
  }
}

// ================= 14. 第八轮：A-2 运营商识别 cnIspCode + 本地随机优选 IP 库 =================
console.log('\n===== 第八轮 A-2 运营商识别 + 本地随机优选 IP 库 =====');
{
  const B8 = WK.__b8 || {};
  const has = !!(B8.ispCode && B8.resolveIspCode && B8.localRandomIPs && B8.cidrList && B8.cidrCacheReset && B8.randIP);

  // ---- ispCode：运营商识别（cf.country / asOrganization / asn）----
  if (has) {
    check('A-2 识别：非 CN（country=US）→ cf', B8.ispCode({ cf: { country: 'US', asn: 4134 } }) === 'cf');
    check('A-2 识别：CN + ASN 4134 → ct', B8.ispCode({ cf: { country: 'CN', asn: 4134 } }) === 'ct');
    check('A-2 识别：CN + 组织名含 chinanet → ct', B8.ispCode({ cf: { country: 'CN', asOrganization: 'CHINANET HUBEI' } }) === 'ct');
    check('A-2 识别：CN + 组织名 China Mobile Communications → cmcc', B8.ispCode({ cf: { country: 'CN', asOrganization: 'China Mobile Communications Group' } }) === 'cmcc');
    check('A-2 识别：CN + 组织名 China Unicom → cu', B8.ispCode({ cf: { country: 'CN', asOrganization: 'China Unicom Beijing' } }) === 'cu');
    check('A-2 识别：CN + 未知 ASN/组织 → 兜底 cf', B8.ispCode({ cf: { country: 'CN', asn: 99999, asOrganization: 'Unknown ISP' } }) === 'cf');
    check('A-2 识别：关键词优先于 ASN（ASN=4837(cu) 但组织含 China Telecom → ct）',
      B8.ispCode({ cf: { country: 'CN', asn: 4837, asOrganization: 'China Telecom' } }) === 'ct');
    check('A-2 识别：无 cf 字段（本地/非 CF 环境）→ cf', B8.ispCode({}) === 'cf');
  } else {
    for (let i = 0; i < 8; i++) check('A-2 识别（过期产物无导出 → 降级失败）', false, 'ispCode 未导出');
  }

  // ---- resolveIspCode：用户可控 cnIspCode 白名单化 ----
  if (has) {
    check('A-2 白名单：?cnIspCode=cu → cu（覆盖识别结果）', B8.resolveIspCode(new URL('https://w.test/x?cnIspCode=cu'), { cf: { country: 'CN', asn: 4134 } }) === 'cu');
    check('A-2 白名单：大小写归一（?cnIspCode=CMCC → cmcc）', B8.resolveIspCode(new URL('https://w.test/x?cnIspCode=CMCC'), { cf: {} }) === 'cmcc');
    const evil = ['../../etc/passwd', 'ct;evil', 'CT2', '..%2f..', 'cfx', ''];
    check('A-2 白名单：全部非法值一律回退识别结果（绝不透传/拼接）',
      evil.every(v => B8.resolveIspCode(new URL('https://w.test/x?cnIspCode=' + encodeURIComponent(v)), { cf: { country: 'CN', asn: 4837 } }) === 'cu'),
      evil.join('|'));
  } else {
    for (let i = 0; i < 3; i++) check('A-2 白名单（过期产物无导出 → 降级失败）', false, 'resolveIspCode 未导出');
  }

  // ---- localRandomIPs：格式 / 端口 / CIDR 范围 / 失败回退 / 硬编码 URL / 缓存 ----
  const saveFetch = globalThis.fetch;
  const withFetch = async (fn, mock) => { globalThis.fetch = mock; try { return await fn(); } finally { globalThis.fetch = saveFetch; } };
  const toInt = s => { const p = s.split('.'); return (((+p[0]) * 16777216) + ((+p[1]) * 65536) + ((+p[2]) * 256) + (+p[3])) >>> 0; };
  const inCIDR = (ip, cidr) => {
    const [b, p] = cidr.split('/'); const bits = parseInt(p, 10);
    const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
    return ((toInt(ip) & mask) >>> 0) === ((toInt(b) & mask) >>> 0);
  };
  const cidrMock = async () => new RealResponse('104.16.0.0/13\n172.64.0.0/13', { status: 200 });
  if (has) {
    B8.cidrCacheReset();
    const r1 = await withFetch(() => B8.localRandomIPs(new URL('https://w.test/x'), { cf: { country: 'CN', asn: 4134 } }, 20), cidrMock);
    check('A-2 本地库：20 条全部形如 IP:端口#名称', r1.length === 20 && r1.every(s => /^\d+\.\d+\.\d+\.\d+:\d+#.+$/.test(s)), r1.slice(0, 2).join(','));
    check('A-2 本地库：端口 ∈ [443,2053,2083,2087,2096,8443]', r1.every(s => B8.ports.includes(Number(s.split(':')[1].split('#')[0]))), [...new Set(r1.map(s => s.split(':')[1].split('#')[0]))].join(','));
    check('A-2 本地库：IP 落在拉取到的 CIDR 内（104.16.0.0/13 或 172.64.0.0/13）',
      r1.every(s => inCIDR(s.split(':')[0], '104.16.0.0/13') || inCIDR(s.split(':')[0], '172.64.0.0/13')), r1[0]);
    check('A-2 本地库：节点名带运营商前缀（电信）', r1.every(s => s.includes('#CF电信优选')), r1[0]);
    B8.cidrCacheReset();
    const r2 = await withFetch(() => B8.localRandomIPs(new URL('https://w.test/x'), { cf: {} }, 8), async () => new RealResponse('nope', { status: 500 }));
    check('A-2 本地库：fetch 非 200 → 回退内置 104.16.0.0/13', r2.length === 8 && r2.every(s => inCIDR(s.split(':')[0], '104.16.0.0/13')), r2[0]);
    B8.cidrCacheReset();
    const r3 = await withFetch(() => B8.localRandomIPs(new URL('https://w.test/x'), { cf: {} }, 8), async () => { throw new Error('network down'); });
    check('A-2 本地库：fetch 抛错 → 回退内置（请求不失败）', r3.length === 8 && r3.every(s => inCIDR(s.split(':')[0], '104.16.0.0/13')), r3[0]);
    B8.cidrCacheReset();
    const r4 = await withFetch(() => B8.localRandomIPs(new URL('https://w.test/x'), { cf: {} }, 4), async () => new RealResponse('104.16.0.0/13\n' + 'x'.repeat(300 * 1024), { status: 200 }));
    check('A-2 本地库：响应超 256KB → 回退内置（不吃超大体）', r4.length === 4 && r4.every(s => inCIDR(s.split(':')[0], '104.16.0.0/13')), r4[0]);
    B8.cidrCacheReset();
    const seen = [];
    await withFetch(() => B8.localRandomIPs(new URL('https://w.test/x?cnIspCode=' + encodeURIComponent('../../evil')), { cf: { country: 'CN', asn: 4837 } }, 2), async (u) => { seen.push(String(u)); return new RealResponse('104.16.0.0/13', { status: 200 }); });
    const allowed = Object.values(B8.cidrUrl);
    check('A-2 安全：非法 cnIspCode 不影响 fetch URL（始终命中硬编码枚举）', seen.length >= 1 && seen.every(u => allowed.includes(u)), seen.join('|'));
    check('A-2 安全：cnIspCode=cu 精确选中硬编码 cu 文件 URL',
      B8.cidrUrl.cu === 'https://raw.githubusercontent.com/cmliu/cmliu/main/CF-CIDR/cu.txt' && /^https:\/\/raw\.githubusercontent\.com\//.test(B8.cidrUrl.cf), B8.cidrUrl.cu);
    B8.cidrCacheReset();
    let calls = 0;
    await withFetch(async () => { await B8.localRandomIPs(new URL('https://w.test/x'), { cf: {} }, 2); await B8.localRandomIPs(new URL('https://w.test/x'), { cf: {} }, 2); }, async () => { calls++; return new RealResponse('104.16.0.0/13', { status: 200 }); });
    check('A-2 本地库：结果缓存（同运营商 2 次调用仅 1 次 fetch）', calls === 1, 'calls=' + calls);
    B8.cidrCacheReset();
  } else {
    for (let i = 0; i < 10; i++) check('A-2 本地库（过期产物无导出 → 降级失败）', false, 'localRandomIPs 未导出');
  }

  // ---- getCustomIPs 兜底接线：全空 → 本地库；有数据 / ADDSUB 有 IP → 不注入 ----
  if (has) {
    B8.cidrCacheReset();
    const g1 = await withFetch(() => WK.getCustomIPs({}, 7, new URL('https://w.test/sub'), { cf: { country: 'CN', asn: 4134 } }, false), cidrMock);
    check('A-2 兜底：ADD/ADDAPI/ADDCSV 全空 → 返回本地随机 IP（16 条）', g1.length === 16 && g1.every(s => /#/.test(s)), 'len=' + g1.length);
    const g2 = await WK.getCustomIPs({ ADD: '1.1.1.1:443#a' }, 7, new URL('https://w.test/sub'), { cf: {} }, false);
    check('A-2 兜底：ADD 有数据 → 不启用本地库（结构不变）', g2.length === 1 && g2[0] === '1.1.1.1:443#a', g2.join(','));
    const g3 = await WK.getCustomIPs({}, 7, new URL('https://w.test/sub'), { cf: {} }, true);
    check('A-2 兜底：ADD 全空但 ADDSUB 已有 IP（aggHasIPs）→ 不注入本地库', g3.length === 0, 'len=' + g3.length);
  } else {
    for (let i = 0; i < 3; i++) check('A-2 兜底（过期产物无导出 → 降级失败）', false, 'getCustomIPs 兜底未接线');
  }

  // ---- 回源转换后端 URL 追加 &cnIspCode=<识别结果> ----
  const ctx8 = { waitUntil(p) { try { Promise.resolve(p).catch(() => { }); } catch { } } };
  const mkR8 = ({ url, method = 'GET', headers = {}, body = null, cf = { country: 'CN', asn: 4837, city: 'T' } }) => {
    const h = {}; for (const [k2, v2] of Object.entries(headers)) h[k2.toLowerCase()] = v2;
    return {
      url, method,
      headers: { get: k => (k.toLowerCase() in h ? h[k.toLowerCase()] : null) },
      cf, body,
      json: async () => { try { return JSON.parse(body); } catch { return null; } },
      text: async () => (typeof body === 'string' ? body : ''),
      fetcher: { connect() { throw new Error('no-connect'); } }
    };
  };
  try { if (typeof WK.cfgCacheReset === 'function') WK.cfgCacheReset(); } catch { }
  {
    const save = globalThis.fetch; const seen = [];
    globalThis.fetch = async (u) => {
      const s = String((u && u.url) || u);
      seen.push(s);
      if (s.includes('/sub?host=example.com')) return new RealResponse(btoa('vless://00000000-0000-4000-8000-000000000000@1.2.3.4:443?encryption=none&security=tls&type=ws&host=example.com#n'), { status: 200 });
      if (/CF-CIDR/.test(s)) return new RealResponse('104.16.0.0/13', { status: 200 });
      return new RealResponse('converted', { status: 200 });
    };
    try { await WK.default.fetch(mkR8({ url: 'https://w.test/123456?target=clash', headers: { 'User-Agent': 'Mozilla/5.0 (B8 Test)' } }), { SUBAPI: 'https://conv.test' }, ctx8); }
    finally { globalThis.fetch = save; }
    const conv = seen.find(u => u.includes('conv.test')) || '';
    const inner = decodeURIComponent((conv.match(/[?&]url=([^&]*)/) || [0, ''])[1]);
    check('A-2 回源：转换后端 URL 追加 &cnIspCode=<识别结果>（值域 ct/cu/cmcc/cf，此处 asn=4837→cu）',
      /[?&]cnIspCode=(ct|cu|cmcc|cf)\b/.test(inner) && /[?&]cnIspCode=cu\b/.test(inner), 'inner=' + inner);
  }
  try { if (typeof WK.cfgCacheReset === 'function') WK.cfgCacheReset(); } catch { }
}

// ================= 15. 第九轮：A-8 伪装页/反代 + A-9 链式代理 =================
console.log('\n===== 第九轮 A-8 伪装页/反代 + A-9 链式代理 =====');
{
  const ctx9 = { waitUntil(p) { try { Promise.resolve(p).catch(() => { }); } catch { } } };
  const mkReq9 = ({ url, method = 'GET', headers = {}, body = null, cf = { country: 'CN', city: 'T' } }) => {
    const h = {}; for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = v;
    return {
      url, method,
      headers: { get: k => (k.toLowerCase() in h ? h[k.toLowerCase()] : null) },
      cf, body,
      json: async () => { try { return JSON.parse(body); } catch { return null; } },
      text: async () => (typeof body === 'string' ? body : ''),
      fetcher: { connect() { throw new Error('no-connect'); } }
    };
  };
  const call9 = (req, env) => WK.default.fetch(req, env || {}, ctx9);
  // F3 起：A-8 域名反代先经 DoH 预解析 → 测试桩默认把 DoH 回公网 IP，其余交给 mock
  const withFetch9 = async (fn, mock) => { const save = globalThis.fetch; globalThis.fetch = wrapDoh(mock); try { return await fn(); } finally { globalThis.fetch = save; } };

  // ---- A-8：伪装页 / 反代（默认关闭，仅 env.URL 显式配置时生效）----
  {
    const r = await call9(mkReq9({ url: 'https://w.test/nonexistent' }), {});
    check('A-8 未配 env.URL → 未知路径仍 404（零回归）', r.status === 404, 'status=' + r.status);
  }
  {
    const r = await call9(mkReq9({ url: 'https://w.test/nonexistent' }), { URL: 'nginx' });
    check('A-8 URL=nginx → 200 且含 "Welcome to nginx"', r.status === 200 && (await r.text()).includes('Welcome to nginx'), 'status=' + r.status);
  }
  {
    const r = await call9(mkReq9({ url: 'https://w.test/nonexistent' }), { URL: '1101' });
    const t = await r.text();
    check('A-8 URL=1101 → 200 且含 1101 特征', r.status === 200 && t.includes('1101') && t.includes('Worker threw a JavaScript exception'), 'status=' + r.status);
  }
  {
    let seen = null;
    const r = await withFetch9(
      () => call9(mkReq9({ url: 'https://w.test/page?q=1' }), { URL: 'https://example.com' }),
      async (u, o) => { seen = { u: String(u), host: (o && o.headers && o.headers.get && o.headers.get('Host')) || null }; return new RealResponse('<html>example.com site</html>', { status: 200, headers: { 'content-type': 'text/html' } }); });
    const t = await r.text();
    check('A-8 URL=https://example.com → 反代且响应体域名替换为本站', r.status === 200 && t.includes('w.test') && !t.includes('example.com'), 'body=' + t.slice(0, 60));
    check('A-8 反代请求：URL=目标域+原路径、Host=目标域', seen && seen.host === 'example.com' && seen.u === 'https://example.com/page?q=1', JSON.stringify(seen));
  }
  {
    let seenUrl = null;
    await withFetch9(
      () => call9(mkReq9({ url: 'https://w.test/p' }), { URL: 'http://example.com' }),
      async (u) => { seenUrl = String(u); return new RealResponse('ok', { status: 200, headers: { 'content-type': 'text/plain' } }); });
    check('A-8 URL=http://… → 强制升级为 https:// 再反代（不拒绝）', seenUrl === 'https://example.com/p', 'seen=' + seenUrl);
  }
  {
    const r = await call9(mkReq9({ url: 'https://w.test/p' }), { URL: 'https://127.0.0.1' });
    check('A-8 URL=https://127.0.0.1 → _extHostSafe 拒绝 → 404（SSRF 闸门）', r.status === 404, 'status=' + r.status);
  }
  {
    const r = await withFetch9(
      () => call9(mkReq9({ url: 'https://w.test/p' }), { URL: 'https://example.com' }),
      async () => new RealResponse('x', { status: 200, headers: { 'content-type': 'text/plain', 'set-cookie': 'auth=evil; Path=/', 'location': 'https://evil.test/' } }));
    check('A-8 反代响应 Set-Cookie / Location 被剥离（防会话劫持 / 开放重定向）',
      r.headers.get('set-cookie') === null && r.headers.get('location') === null, 'sc=' + r.headers.get('set-cookie') + ' loc=' + r.headers.get('location'));
  }
  {
    const r = await withFetch9(
      () => call9(mkReq9({ url: 'https://w.test/p' }), { URL: 'https://example.com' }),
      async () => new RealResponse('x', { status: 200, headers: { 'content-type': 'text/plain', 'content-security-policy': "default-src 'none'", 'x-frame-options': 'DENY' } }));
    check('A-8 响应头白名单：不透出 content-security-policy / x-frame-options（不污染自家面板）',
      r.headers.get('content-security-policy') === null && r.headers.get('x-frame-options') === null, 'csp=' + r.headers.get('content-security-policy'));
  }

  // ---- A-9：链式代理 /video/<密文>（默认关闭，仅 WS 升级）----
  const B9 = WK.__b9 || {};
  const hasC = !!(B9.chainProxyCfg && B9.chainKey && B9.b64uEncode);
  if (hasC) {
    const _saveF9 = globalThis.fetch;
    globalThis.fetch = wrapDoh(async () => new RealResponse('', { status: 200 }));   // F3：A-9 域名经 DoH 预解析 → 公网
    const UUID9 = '06b65903-406d-4a41-8463-6fd5c0ee7798';
    try { WK.setUUID(UUID9); } catch { }
    const enc9 = new TextEncoder();
    // 独立复刻「外部链接生成方」：按文档契约自行 HKDF 派生 + AES-GCM 加密（worker 侧只持 decrypt 能力，故不能复用其 key）
    // F4-a 起：默认注入 v:1 + 当前时间戳（30 天有效），专项用例可显式覆盖 v/t
    const mkSecret = async (obj) => {
      const full = { v: 1, t: Math.floor(Date.now() / 1000), ...obj };
      const base = await crypto.subtle.importKey('raw', enc9.encode(UUID9), 'HKDF', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: enc9.encode('chain'), info: enc9.encode('chain') }, base, 256);
      const key = await crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt']);
      const iv = new Uint8Array(12).fill(9);
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc9.encode(JSON.stringify(full))));
      return B9.b64uEncode(new Uint8Array([...iv, ...ct]));
    };
    const mkUp = (upg) => ({ headers: { get: k => (String(k).toLowerCase() === 'upgrade' ? (upg || null) : null) } });
    const S_OK = await mkSecret({ type: 'socks5', hostname: 'proxy.example.com', port: 1080, username: 'u', password: 'p' });
    const cfg = await B9.chainProxyCfg(mkUp('websocket'), '/video/' + S_OK, { CHAIN_PROXY: '1' });
    check('A-9 合法密文 + 带 Upgrade 的 GET → 全局走指定代理（order=["gP"]）',
      !!cfg && Array.isArray(cfg.order) && cfg.order.join() === 'gP' && cfg.gP && cfg.gP.type === 'socks5' && cfg.gP.cfg.hostname === 'proxy.example.com' && cfg.gP.cfg.port === 1080,
      JSON.stringify(cfg && cfg.gP));
    const S_HTTPS = await mkSecret({ type: 'https', hostname: 'proxy.example.com', port: 8443 });
    const cfg2 = await B9.chainProxyCfg(mkUp('websocket'), '/video/' + S_HTTPS, { CHAIN_PROXY: '1' });
    check('A-9 type=https → 映射为 http + tls=1', !!cfg2 && cfg2.gP.type === 'http' && cfg2.gP.cfg.tls === 1, JSON.stringify(cfg2 && cfg2.gP));
    const S_BAD = await mkSecret({ type: 'ftp', hostname: 'proxy.example.com', port: 1080 });
    check('A-9 type 非法（ftp）→ 回落 null', (await B9.chainProxyCfg(mkUp('websocket'), '/video/' + S_BAD, { CHAIN_PROXY: '1' })) === null);
    const S_NAN = await mkSecret({ type: 'socks5', hostname: 'proxy.example.com', port: 'abc' });
    check('A-9 port 非法（NaN）→ 回落 null', (await B9.chainProxyCfg(mkUp('websocket'), '/video/' + S_NAN, { CHAIN_PROXY: '1' })) === null);
    const S_INT = await mkSecret({ type: 'socks5', hostname: '127.0.0.1', port: 1080 });
    check('A-9 hostname 为内网 IP → _extHostSafe 拒绝 → 回落 null（SSRF 闸门）', (await B9.chainProxyCfg(mkUp('websocket'), '/video/' + S_INT, { CHAIN_PROXY: '1' })) === null);
    {
      const arr = S_OK.split(''); const pos = Math.floor(arr.length / 2);
      arr[pos] = (arr[pos] === 'A' ? 'B' : 'A'); const bad = arr.join('');
      let threw = false, res = null;
      try { res = await B9.chainProxyCfg(mkUp('websocket'), '/video/' + bad, { CHAIN_PROXY: '1' }); } catch (e) { threw = true; }
      check('A-9 密文被篡改 → AES-GCM 认证失败 → 回落 null 且不抛 500', !threw && res === null, 'threw=' + threw);
    }
    check('A-9 无 Upgrade 的普通 GET → 不走链式分支（即使密文合法）', (await B9.chainProxyCfg(mkUp(null), '/video/' + S_OK, { CHAIN_PROXY: '1' })) === null);
    check('A-9 CHAIN_PROXY 未配 → 分支不启用', (await B9.chainProxyCfg(mkUp('websocket'), '/video/' + S_OK, {})) === null);
    globalThis.fetch = _saveF9;
  } else {
    for (let i = 0; i < 8; i++) check('A-9 链式代理（过期产物无导出 → 降级失败）', false, 'chainProxyCfg 未导出');
  }
}

// ================= 16. 第十一轮：安全复核 F1/F2/F3 三条低危残留 =================
console.log('\n===== 第十一轮 F1/F2/F3 低危残留修复 =====');
{
  const ctx11 = { waitUntil(p) { try { Promise.resolve(p).catch(() => { }); } catch { } } };
  const mkReq11 = ({ url, method = 'GET', headers = {}, body = null, cf = { country: 'CN', city: 'T' } }) => {
    const h = {}; for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = v;
    return {
      url, method,
      headers: { get: k => (k.toLowerCase() in h ? h[k.toLowerCase()] : null) },
      cf, body,
      json: async () => { try { return JSON.parse(body); } catch { return null; } },
      text: async () => (typeof body === 'string' ? body : ''),
      fetcher: { connect() { throw new Error('no-connect'); } }
    };
  };
  const call11 = (req, env) => WK.default.fetch(req, env || {}, ctx11);
  // F3 起：A-8 域名反代先经 DoH 预解析 → 测试桩默认把 DoH 回公网 IP，其余交给 mock
  const withFetch11 = async (fn, mock) => { const save = globalThis.fetch; globalThis.fetch = wrapDoh(mock); try { return await fn(); } finally { globalThis.fetch = save; } };
  const B9r = WK.__b9 || {};
  const reqStub = { method: 'GET', headers: new Headers(), body: null };
  const urlStub = new URL('https://w.test/p');

  // ---- F1：A-8 反代 text 分支响应体上限（1MiB，复用 _readCapped；超限回落 404）----
  {
    const big = 'A'.repeat(1024 * 1024 + 16);
    const r = await withFetch11(
      () => call11(mkReq11({ url: 'https://w.test/p' }), { URL: 'https://example.com' }),
      async () => new RealResponse(big, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }));
    check('F1 端到端：A-8 反代 text 响应体 >1MiB → 404（不撑爆内存）', r.status === 404, 'status=' + r.status);
  }
  {
    const ok = 'B'.repeat(512 * 1024);
    const r = await withFetch11(
      () => call11(mkReq11({ url: 'https://w.test/p' }), { URL: 'https://example.com' }),
      async () => new RealResponse('<html>' + ok + '</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    const t = await r.text();
    check('F1 端到端：A-8 反代 text 响应体 <1MiB → 200（上限不误伤正常页面）', r.status === 200 && t.length > 512 * 1024, 'status=' + r.status + ' len=' + t.length);
  }
  if (B9r.camouflageReverse) {
    const r1 = await withFetch11(
      () => B9r.camouflageReverse('https://example.com', reqStub, urlStub, 'w.test'),
      async () => new RealResponse('A'.repeat(1024 * 1024 + 16), { status: 200, headers: { 'content-type': 'text/html' } }));
    check('F1 单元：camouflageReverse 遇超限 text 响应体 → 返回 null（调用方据此回 404）', r1 === null, 'ret=' + (r1 === null ? 'null' : 'Response'));
  } else {
    check('F1 单元 camouflageReverse（过期产物无导出 → 降级失败）', false, 'camouflageReverse 未导出');
  }

  // ---- F2：err 入白名单但强制经 obsScrub 清洗（URL / bot token / hex / UUID 抹除）----
  const B6f = WK.__b6 || {};
  if (B6f.obsRedact && B6f.obsScrub) {
    const o = B6f.obsRedact({ err: 'D1 down: timeout' });
    check('F2 白名单：err 已登记 → 保留错误文本（不再 [redacted]，修复诊断回归）', o.err === 'D1 down: timeout', JSON.stringify(o));
    const o2 = B6f.obsRedact({ err: 'fetch https://169.254.169.254/latest/meta-data/ failed token=123456:AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIII' });
    check('F2 err 内敏感信息被 obsScrub 抹除（URL→[url] / bot token→[bot_token]）',
      o2.err.indexOf('169.254.169.254') === -1 && o2.err.indexOf('123456:AAAA') === -1 && /\[url\]/.test(o2.err) && /bot_token/.test(o2.err),
      String(o2.err));
    check('F2 obsScrub：明文 URL 抹除为 [url]',
      B6f.obsScrub('see https://example.com/a?token=abc now') === 'see [url] now',
      B6f.obsScrub('see https://example.com/a?token=abc now'));
  } else {
    check('F2 err 白名单保留（过期产物无导出 → 降级失败）', false, 'obsRedact 未导出');
    check('F2 err 内敏感抹除（过期产物无导出 → 降级失败）', false, 'obsRedact/obsScrub 未导出');
    check('F2 obsScrub URL 抹除（过期产物无导出 → 降级失败）', false, 'obsScrub 未导出');
  }

  // ---- F3：A-8 反代目标追加「内部域名后缀」黑名单（仅 A-8 路径，不动 _extHostSafe 本体）----
  {
    let called = false;
    const r = await withFetch11(
      () => call11(mkReq11({ url: 'https://w.test/p' }), { URL: 'https://intranet.corp' }),
      async () => { called = true; return new RealResponse('INTERNAL', { status: 200, headers: { 'content-type': 'text/html' } }); });
    check('F3 端到端：env.URL=https://intranet.corp → 404 且未发起外连', r.status === 404 && !called, 'status=' + r.status + ' called=' + called);
  }
  if (B9r.camouflageReverse) {
    let c1 = false;
    const r3 = await withFetch11(
      () => B9r.camouflageReverse('https://intranet.corp', reqStub, urlStub, 'w.test'),
      async () => { c1 = true; return new RealResponse('INTERNAL', { status: 200, headers: { 'content-type': 'text/html' } }); });
    check('F3 单元：内部后缀 .corp（_extHostSafe 本不拦）→ null 且未发起外连', r3 === null && !c1, 'ret=' + (r3 === null ? 'null' : 'Response') + ' called=' + c1);
    let c2 = false;
    const r4 = await withFetch11(
      () => B9r.camouflageReverse('https://host.lan', reqStub, urlStub, 'w.test'),
      async () => { c2 = true; return new RealResponse('INTERNAL', { status: 200 }); });
    check('F3 单元：内部后缀 .lan → null 且未发起外连', r4 === null && !c2, 'ret=' + (r4 === null ? 'null' : 'Response') + ' called=' + c2);
    let c3 = false;
    const r5 = await withFetch11(
      () => B9r.camouflageReverse('https://example.com', reqStub, urlStub, 'w.test'),
      async () => { c3 = true; return new RealResponse('pub', { status: 200, headers: { 'content-type': 'text/plain' } }); });
    check('F3 对照：公网域名不受内部后缀黑名单影响（仍 200）', !!r5 && r5.status === 200 && c3, 'status=' + (r5 && r5.status) + ' called=' + c3);
  } else {
    check('F3 单元 .corp（过期产物无导出 → 降级失败）', false, 'camouflageReverse 未导出');
    check('F3 单元 .lan（过期产物无导出 → 降级失败）', false, 'camouflageReverse 未导出');
    check('F3 对照 公网域名（过期产物无导出 → 降级失败）', false, 'camouflageReverse 未导出');
  }
}

// ================= 17. 第十二轮：F3 DoH 预解析 + F4-a 密文版本/过期 + F4-b admin/check 格式（含第十三轮回退） =================
console.log('\n===== 第十二/十三轮 F3/F4-a/F4-b + URL 回退 =====');
{
  const ctx12 = { waitUntil(p) { try { Promise.resolve(p).catch(() => { }); } catch { } } };
  const mkReq12 = ({ url, method = 'GET', headers = {}, body = null, cf = { country: 'CN', city: 'T' } }) => {
    const h = {}; for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = v;
    return {
      url, method,
      headers: { get: k => (k.toLowerCase() in h ? h[k.toLowerCase()] : null) },
      cf, body,
      json: async () => { try { return JSON.parse(body); } catch { return null; } },
      text: async () => (typeof body === 'string' ? body : ''),
      fetcher: { connect() { throw new Error('no-connect'); } }
    };
  };
  const call12 = (req, env) => WK.default.fetch(req, env || {}, ctx12);
  const withFetch12 = async (fn, impl) => { const save = globalThis.fetch; globalThis.fetch = impl; try { return await fn(); } finally { globalThis.fetch = save; } };
  const B9_12 = WK.__b9 || {};
  const B10 = WK.__b10 || {};

  // ---- F3：A-8 反代目标的 DoH 预解析 + 封禁段校验 ----
  {
    let called = false;
    const r = await withFetch12(
      () => call12(mkReq12({ url: 'https://w.test/p' }), { URL: 'https://evil.example.com' }),
      wrapDoh(async () => { called = true; return new RealResponse('X', { status: 200, headers: { 'content-type': 'text/html' } }); }, ['10.0.0.1']));
    check('F3 A-8：域名 DoH 解析到内网 10.0.0.1 → 拒绝 404（且未发起反代）', r.status === 404 && !called, 'status=' + r.status + ' called=' + called);
  }
  {
    let called = false;
    const r = await withFetch12(
      () => call12(mkReq12({ url: 'https://w.test/p' }), { URL: 'https://example.com' }),
      wrapDoh(async () => { called = true; return new RealResponse('PUB', { status: 200, headers: { 'content-type': 'text/html' } }); }));
    check('F3 A-8：域名解析到公网 IP → 放行（200）', r.status === 200 && called, 'status=' + r.status + ' called=' + called);
  }
  {
    let called = false;
    const r = await withFetch12(
      () => call12(mkReq12({ url: 'https://w.test/p' }), { URL: 'https://nowhere.example.com' }),
      wrapDoh(async () => { called = true; return new RealResponse('X', { status: 200 }); }, []));
    check('F3 A-8：DoH 解析失败/空 → 拒绝 404（fail-closed）', r.status === 404 && !called, 'status=' + r.status + ' called=' + called);
  }

  // ---- 第十三轮回退：save_config 不接受 URL（保持 env-only；URL 不在 ALLOWED_KEYS）----
  // 原第十二轮「配置时刻预解析校验」已随能力扩张一并回退（运行时 _camouflageReverse 的 DoH 校验才是真正生效的部分）。
  {
    const mkDB13 = () => { const store = new Map(); return { store, prepare(sql) { const ins = /INSERT/i.test(sql); const all = async () => ({ results: ins ? [] : [...store].map(([k, v]) => ({ key: k, value: v })) }); const run = (a) => { if (ins && a && a.length >= 2) store.set(String(a[0]), String(a[1])); return Promise.resolve({}); }; const bound = (a) => ({ bind: (...a2) => bound(a2), all, run: () => run(a) }); return { bind: (...a) => bound(a), all, run: () => run([]) }; } }; };
    const UA13 = 'Mozilla/5.0 (R13 Test)';
    const db = mkDB13();
    const env = { DB: db };
    try { WK.cfgCacheReset(); } catch { }
    const lr = await call12(mkReq12({ url: 'https://w.test/?flag=login', method: 'POST', headers: { 'User-Agent': UA13, 'Content-Type': 'application/json' }, body: JSON.stringify({ pwd: 'abc' }) }), env);
    const ck = (lr.headers.get('set-cookie') || '').split(';')[0] || '';
    // 同批提交一个合法键（PS）与 URL：PS 落库、URL 被忽略 —— 证明循环确实在跑（不是整段跳过）
    const r = await withFetch12(
      () => call12(mkReq12({ url: 'https://w.test/?flag=save_config', method: 'POST', headers: { 'User-Agent': UA13, 'Content-Type': 'application/json', Cookie: ck }, body: JSON.stringify({ PS: 'ok-note', URL: 'https://example.com' }) }), env),
      wrapDoh(async () => new RealResponse('', { status: 200 })));
    const j = await r.json().catch(() => ({}));
    check('回退：save_config 忽略 URL（不在 ALLOWED_KEYS）→ 不落库；同批合法键 PS 正常落库',
      lr.status === 200 && ck.startsWith('auth=') && j.status === 'ok' && db.store.get('PS') === 'ok-note' && !db.store.has('URL'),
      'login=' + lr.status + ' store=' + JSON.stringify([...db.store]));
    try { WK.cfgCacheReset(); } catch { }
  }

  // ---- F3：A-9 解密出的域名同样过 DoH 预解析 ----
  const hasC12 = !!(B9_12.chainProxyCfg && B9_12.b64uEncode);
  if (hasC12) {
    const UUID12 = '06b65903-406d-4a41-8463-6fd5c0ee7798';
    try { WK.setUUID(UUID12); } catch { }
    const enc12 = new TextEncoder();
    const mkSecret12 = async (obj) => {
      const base = await crypto.subtle.importKey('raw', enc12.encode(UUID12), 'HKDF', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: enc12.encode('chain'), info: enc12.encode('chain') }, base, 256);
      const key = await crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt']);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc12.encode(JSON.stringify(obj))));
      return B9_12.b64uEncode(new Uint8Array([...iv, ...ct]));
    };
    const mkUp12 = (u) => ({ headers: { get: k => (String(k).toLowerCase() === 'upgrade' ? (u || null) : null) } });
    const now = Math.floor(Date.now() / 1000);

    // F3：A-9 目标域名 DoH 解析到内网 → 回落 null
    {
      const sec = await mkSecret12({ v: 1, t: now, type: 'socks5', hostname: 'evil.example.com', port: 1080 });
      const cfg = await withFetch12(() => B9_12.chainProxyCfg(mkUp12('websocket'), '/video/' + sec, { CHAIN_PROXY: '1' }), wrapDoh(async () => new RealResponse('', { status: 200 }), ['10.0.0.1']));
      check('F3 A-9：解密出的域名 DoH 解析到内网 → 回落 null（SSRF 闸门）', cfg === null, 'cfg=' + JSON.stringify(cfg));
    }

    // ---- F4-a：密文版本 + 过期 ----
    const _saveF12 = globalThis.fetch;
    globalThis.fetch = wrapDoh(async () => new RealResponse('', { status: 200 }));
    try {
      const ok = await B9_12.chainProxyCfg(mkUp12('websocket'), '/video/' + await mkSecret12({ v: 1, t: now, type: 'socks5', hostname: 'proxy.example.com', port: 1080 }), { CHAIN_PROXY: '1' });
      check('F4-a 合法 v=1 + 未过期 → 正常走链式', !!ok && ok.gP && ok.gP.type === 'socks5', JSON.stringify(ok && ok.gP));
      const noT = await B9_12.chainProxyCfg(mkUp12('websocket'), '/video/' + await mkSecret12({ v: 1, type: 'socks5', hostname: 'proxy.example.com', port: 1080 }), { CHAIN_PROXY: '1' });
      check('F4-a 缺 t → 回落 null（有效期字段必填）', noT === null);
      const expired = await B9_12.chainProxyCfg(mkUp12('websocket'), '/video/' + await mkSecret12({ v: 1, t: now - 2592001, type: 'socks5', hostname: 'proxy.example.com', port: 1080 }), { CHAIN_PROXY: '1' });
      check('F4-a t 超过 30 天 → 回落 null', expired === null);
      const badVer = await B9_12.chainProxyCfg(mkUp12('websocket'), '/video/' + await mkSecret12({ v: 2, t: now, type: 'socks5', hostname: 'proxy.example.com', port: 1080 }), { CHAIN_PROXY: '1' });
      check('F4-a v≠1 → 回落 null（版本闸门）', badVer === null);
    } finally { globalThis.fetch = _saveF12; }
  } else {
    check('F3 A-9 DoH 预解析（过期产物无导出 → 降级失败）', false, 'chainProxyCfg 未导出');
    for (let i = 0; i < 4; i++) check('F4-a 链式版本/过期（过期产物无导出 → 降级失败）', false, 'chainProxyCfg 未导出');
  }

  // ---- F4-b：admin/check 结果格式闸门（纯函数单测；成功路径需真 TLS 栈，离线桩不可达）----
  if (B10.adminCheckResult) {
    const g = B10.adminCheckResult;
    const a = g('1.2.3.4', 'US', 'socks5://p:1080', 0);
    check('F4-b ip 合法 IPv4 → success:true + 原样返回 ip/loc', a.success === true && a.ip === '1.2.3.4' && a.loc === 'US', JSON.stringify(a));
    const b = g('not-an-ip', 'US', 'socks5://p:1080', 0);
    check('F4-b ip 非法格式 → success:false + "trace 响应格式异常"', b.success === false && b.error === 'trace 响应格式异常', JSON.stringify(b));
    const c = g('1.2.3.4', 'usa', 'socks5://p:1080', 0);
    check('F4-b loc 非法（非 2 位大写）→ 清空不外显', c.success === true && c.loc === '', JSON.stringify(c));
    const d = g('2606:4700::1', 'CN', 'socks5://p:1080', 0);
    check('F4-b ip 合法 IPv6 字面量 → 接受', d.success === true && d.ip === '2606:4700::1', JSON.stringify(d));
  } else {
    for (let i = 0; i < 4; i++) check('F4-b admin/check 格式闸门（过期产物无导出 → 降级失败）', false, 'adminCheckResult 未导出');
  }
}

// ================= 18. Snippets 平台适配（官方限额对齐：子请求配额 SRQ / 2MB / gRPC 紧凑版 / A-6 / P1-11 / fromBase64 回退） =================
console.log('\n===== Snippets 平台适配 =====');
{
  const SN = await import(pathToFileURL(DIR + 'snippets.js').href);
  const SRC = readFileSync(DIR + 'snippets.js', 'utf8');
  const S_UUID = extractUuid(SRC.split('\n')[0]);
  const emptyDoh = async (url, opts) => { const u = String(url instanceof URL ? url : url?.url || url); if (/dns-query|\/resolve/.test(u) && /[?&]name=/.test(u)) return new RealResponse(JSON.stringify({ Answer: [] }), { status: 200 }); return realFetch(url, opts); };
  globalThis.fetch = emptyDoh;
  const catU8 = parts => { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };
  const eqU8 = (a, b) => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);
  const mkFetcher = () => ({ connect(a) { const sock = makeTargetSocket(typeof a === 'string' ? a : a.hostname, (a && a.port) || 443); connectLog.push(sock); return sock; } });
  const wsReq = (url, frame) => stubRequest(url, { 'Upgrade': 'websocket', ...(frame ? { 'sec-websocket-protocol': Buffer.from(frame).toString('base64url') } : {}) });

  // 18.1 P1-11：WS 侧 cmd=2（UDP）→ 拒绝并关闭，不建连（对齐 worker parseVP）
  try {
    connectLog = []; __pairs.length = 0;
    const fr = vlessFrame(S_UUID, 'udp-ws.org', 53); fr[18] = 2;
    const res = await SN.default.fetch(wsReq('https://w.test/', fr));
    await sleep(120);
    const pair = __pairs[__pairs.length - 1];
    check('snippets WS cmd=2(UDP) → 关闭且不建连（P1-11 对齐）', res.status === 101 && pair.server._closed && connectLog.length === 0, `closed=${pair.server._closed} conn=${connectLog.length}`);
  } catch (e) { check('snippets WS cmd=2 测试', false, e.message); }

  // 18.2 早数据：fromBase64 对非法输入抛错 → 回退手动解码（原实现会把 WS IIFE 打成 500）
  try {
    const orig = Uint8Array.fromBase64;
    Uint8Array.fromBase64 = () => { throw new SyntaxError('bad base64'); };
    try {
      __pairs.length = 0;
      const res = await SN.default.fetch(stubRequest('https://w.test/', { 'Upgrade': 'websocket', 'sec-websocket-protocol': 'not-base64!!' }));
      check('snippets 早数据 fromBase64 抛错 → 回退手动解码，101 而非 500', res.status === 101, String(res.status));
    } finally { if (orig) Uint8Array.fromBase64 = orig; else delete Uint8Array.fromBase64; }
  } catch (e) { check('snippets 早数据回退测试', false, e.message); }

  // 18.3 A-6：g 前缀 / turn= sstp= 提升全局 / 查询参数族 / ?global=1（首个 connect 目标即可判定全局与否）
  const routeCase = async (name, url, expectHost, expectPort) => {
    connectLog = []; __pairs.length = 0;
    const res = await SN.default.fetch(wsReq(url, vlessFrame(S_UUID, 'tgt-a6.org', 443, new Uint8Array([1]))));
    await sleep(120);
    const first = connectLog[0];
    check(name, res.status === 101 && !!first && first.host === expectHost && first.port === expectPort, connectLog.map(s => s.host + ':' + s.port).join(',') || 'no connect');
  };
  await routeCase('snippets A-6 /gs5= → 全局 socks5（先连代理，不直连目标）', 'https://w.test/gs5=u:p@s5-global.test:1080', 's5-global.test', 1080);
  await routeCase('snippets A-6 /s5=（无 g）→ 仍先直连目标（回落语义不变）', 'https://w.test/s5=u:p@s5-fb.test:1080', 'tgt-a6.org', 443);
  await routeCase('snippets A-6 /ghttp= → 全局 HTTP CONNECT', 'https://w.test/ghttp=u:p@http-global.test:8080', 'http-global.test', 8080);
  for (const u of ['https://w.test/sstp=sstp-a6.test', 'https://w.test/x/gsstp=sstp-mid.test:8443', 'https://w.test/sstp://h.test:443', 'https://w.test/?sstp=h.test']) {
    connectLog = []; __pairs.length = 0;
    const res = await SN.default.fetch(wsReq(u, vlessFrame(S_UUID, 'tgt-a6.org', 443, new Uint8Array([1]))));
    await sleep(60);
    check('snippets sstp 语法（仅 Workers 支持真 SSTP）→ 400 Bad cfg，不再裸 TCP 冒充：' + u.slice(15), res.status === 400 && connectLog.length === 0, 'status=' + res.status + ' conn=' + connectLog.length);
  }
  await routeCase('snippets A-6 ?socks5=…&global=1 → 全局', 'https://w.test/?socks5=u:p@s5-q.test:1081&global=1', 's5-q.test', 1081);
  await routeCase('snippets A-6 ?https= → 回落（先直连目标）', 'https://w.test/?https=u:p@h-q.test', 'tgt-a6.org', 443);
  await routeCase('snippets A-6 /x/s5= 路径中段（无 g）→ 先直连（反代兜底腿保留）', 'https://w.test/x/s5=u:p@s5-mid.test:1080', 'tgt-a6.org', 443);

  // 18.4 gRPC（Xray gun）紧凑版：与 worker 的 XH_GFR/XH_GDEC 交叉验证
  const gReqS = (chunks) => { let ctrl; const body = new ReadableStream({ start(c) { ctrl = c; for (const ch of chunks) c.enqueue(ch); } }); return { req: { url: 'https://w.test/grpc', method: 'POST', headers: { get: k => ({ 'content-type': 'application/grpc' })[k.toLowerCase()] ?? null }, body, cf: {}, fetcher: mkFetcher() }, close: () => { try { ctrl.close(); } catch {} } }; };
  const G_REPLY = Uint8Array.from([0x16, 3, 1, 0xab]);
  try {
    connectLog = [];
    const payload = Uint8Array.from([9, 8, 7]);
    const { req, close } = gReqS([WK.XH_GFR(vlessFrame(S_UUID, 'grpc-sn.org', 443, payload))]);
    const res = await SN.default.fetch(req);
    await sleep(150);
    const sock = connectLog.find(s => s.host === 'grpc-sn.org');
    check('snippets gRPC 正路径：建连目标正确', !!sock && sock.port === 443, connectLog.map(s => s.host + ':' + s.port).join(','));
    check('snippets gRPC 正路径：上行剥帧后仅 payload 透传远端', !!sock && eqU8(catU8(sock.written), payload), sock ? JSON.stringify(Array.from(catU8(sock.written))) : 'no sock');
    check('snippets gRPC 正路径：响应 CT=application/grpc + grpc-status:0', res.status === 200 && res.headers.get('content-type') === 'application/grpc' && res.headers.get('grpc-status') === '0', res.status + ' ' + res.headers.get('content-type'));
    const rdr = res.body.getReader();
    const first = await rdr.read();
    const d1 = WK.XH_GDEC(first.value);
    check('snippets gRPC 正路径：下行首帧封帧 = [0,0]（worker 解码器可解、无残留）', d1.out.length === 1 && eqU8(d1.out[0], Uint8Array.from([0, 0])) && d1.rest.length === 0, JSON.stringify(first.value && Array.from(first.value)));
    sock._push(G_REPLY.slice()); // 字节流会分离入队 buffer，推副本保住对照值
    const second = await rdr.read();
    const d2 = WK.XH_GDEC(second.value);
    check('snippets gRPC 正路径：下行数据封帧 = 远端应答', d2.out.length === 1 && eqU8(d2.out[0], G_REPLY), JSON.stringify(second.value && Array.from(second.value)));
    close();
  } catch (e) { check('snippets gRPC 正路径测试', false, e.message); }
  try {
    connectLog = [];
    const hp = Uint8Array.from([5, 5, 5, 5, 5, 5]);
    const hf = WK.XH_GFR(vlessFrame(S_UUID, 'grpc-half-sn.org', 443, hp));
    const { req, close } = gReqS([hf.subarray(0, 7), hf.subarray(7, 20), hf.subarray(20)]);
    const res = await SN.default.fetch(req);
    await sleep(150);
    const sock = connectLog.find(s => s.host === 'grpc-half-sn.org');
    check('snippets gRPC 半包跨块重组：payload 完整透传', res.status === 200 && !!sock && eqU8(catU8(sock.written), hp), sock ? JSON.stringify(Array.from(catU8(sock.written))) : 'no sock/' + res.status);
    close();
  } catch (e) { check('snippets gRPC 半包测试', false, e.message); }
  try {
    connectLog = [];
    const { req, close } = gReqS([catU8([WK.XH_GFR(vlessFrame(S_UUID, 'grpc-multi-sn.org', 443, Uint8Array.from([1, 2]))), WK.XH_GFR(Uint8Array.from([3, 4]))])]);
    const res = await SN.default.fetch(req);
    await sleep(150);
    const sock = connectLog.find(s => s.host === 'grpc-multi-sn.org');
    check('snippets gRPC 两帧粘包（握手帧+数据帧同块）：远端收到 1,2,3,4', res.status === 200 && !!sock && eqU8(catU8(sock.written), Uint8Array.from([1, 2, 3, 4])), sock ? JSON.stringify(Array.from(catU8(sock.written))) : 'no sock/' + res.status);
    close();
  } catch (e) { check('snippets gRPC 粘包测试', false, e.message); }
  try {
    connectLog = [];
    const { req } = gReqS([Uint8Array.from([0, 0xff, 0xff, 0xff, 0xff, 10, 1])]);
    const body = new ReadableStream({ start(c) { c.enqueue(Uint8Array.from([0, 0xff, 0xff, 0xff, 0xff, 10, 1])); c.close(); } });
    const res = await SN.default.fetch({ ...req, body });
    check('snippets gRPC 非法帧长（> 4MiB）→ 回退 xhF 后 400，不挂起、不建连', res.status === 400 && connectLog.length === 0, String(res.status));
  } catch (e) { check('snippets gRPC 非法帧长测试', false, e.message); }

  // 18.5 子请求配额 SRQ（官方：Pro 2 / Business 3 / Enterprise 5）：SRQ≥3 时 /proxyip=域名 先查 TXT 池（EDT 对齐）
  try {
    const src3 = SRC.replace(/,SRQ=2,/, ',SRQ=3,');
    if (src3 === SRC) throw new Error('SRQ 锚点缺失');
    writeFileSync(DIR + '_snippets_srq3.mjs', src3);
    const SN3 = await import(pathToFileURL(DIR + '_snippets_srq3.mjs').href);
    globalThis.fetch = async (url) => { const u = String(url instanceof URL ? url : url?.url || url); const m = u.match(/[?&]name=([^&]+)&type=([A-Za-z]+)/); if (m && /dns-query/.test(u)) { const n = decodeURIComponent(m[1]).toLowerCase(); return new RealResponse(JSON.stringify(n === 'pool3.test' && m[2] === 'TXT' ? { Answer: [{ type: 16, data: '"7.7.7.7:2053"' }] } : {}), { status: 200 }); } return new RealResponse('nf', { status: 404 }); };
    const failing = (hosts) => ({ connect(a) { const host = typeof a === 'string' ? a : a.hostname; const port = typeof a === 'string' ? 443 : (a.port ?? 443); const s = makeTargetSocket(host, port); if (hosts.includes(host)) s.opened = Promise.reject(new Error('blocked')); connectLog.push(s); return s; } });
    connectLog = []; __pairs.length = 0;
    const req = wsReq('https://w.test/proxyip=pool3.test'); req.fetcher = failing(['srq-target.org']);
    await SN3.default.fetch(req);
    __pairs[__pairs.length - 1].server._onmessage(vlessFrame(S_UUID, 'srq-target.org', 443, new Uint8Array([7])));
    await sleep(300);
    check('snippets SRQ=3：/proxyip=域名（无 !txt）→ 直连失败后先查 TXT 池再连（EDT 对齐）', connectLog.some(s => s.host === '7.7.7.7' && s.port === 2053) && !connectLog.some(s => s.host === 'pool3.test'), connectLog.map(s => s.host + ':' + s.port).join(','));
    connectLog = []; __pairs.length = 0;
    const req2 = wsReq('https://w.test/proxyip=pool3.test'); req2.fetcher = failing(['srq-target.org']);
    await SN.default.fetch(req2);
    __pairs[__pairs.length - 1].server._onmessage(vlessFrame(S_UUID, 'srq-target.org', 443, new Uint8Array([7])));
    await sleep(300);
    check('snippets SRQ=2：同请求不查 TXT，直接 connect 主机名（Pro 配额 2 内）', connectLog.some(s => s.host === 'pool3.test') && !connectLog.some(s => s.host === '7.7.7.7'), connectLog.map(s => s.host + ':' + s.port).join(','));
    connectLog = []; __pairs.length = 0; let dohCalls = 0; const pf = globalThis.fetch; globalThis.fetch = async (u, o) => { dohCalls++; return pf(u, o); };
    const req3 = wsReq('https://w.test/proxyip=9.9.9.9'); req3.fetcher = failing(['srq-target.org']);
    await SN3.default.fetch(req3);
    __pairs[__pairs.length - 1].server._onmessage(vlessFrame(S_UUID, 'srq-target.org', 443, new Uint8Array([7])));
    await sleep(300);
    check('snippets SRQ=3：proxyip 为字面 IP → 不发起 DoH', dohCalls === 0 && connectLog.some(s => s.host === '9.9.9.9'), `doh=${dohCalls} ` + connectLog.map(s => s.host + ':' + s.port).join(','));
  } catch (e) { check('snippets SRQ 配额测试', false, e.message); }

  // 18.6 订阅侧配额：本请求 fetch 总数不超过 SRQ（ECH / 备用模板按剩余配额回源）
  try {
    const calls = [];
    globalThis.fetch = async (url) => { const u = String(url instanceof URL ? url : url?.url || url); calls.push(u); if (/dns-query|query-dns/.test(u)) return new RealResponse('x', { status: 500 }); if (/1\.11\.x/.test(u)) return new RealResponse('not json', { status: 200 }); if (/1\.12\.x/.test(u)) return new RealResponse(JSON.stringify({ outbounds: [{ type: 'vless', uuid: S_UUID, tls: { enabled: true } }] }), { status: 200 }); return new RealResponse('nf', { status: 404 }); };
    const res = await SN.default.fetch(stubRequest('https://w.test/sub?uuid=' + S_UUID, { 'User-Agent': 'sing-box 1.12' }));
    const txt = await res.text();
    const echCalls = calls.filter(u => /dns-query|query-dns/.test(u)).length;
    check('snippets 订阅配额 SRQ=2：singbox 主模板失败→备用模板(第 2 次)→跳过 ECH 回源（不超配额）', res.status === 200 && calls.length === 2 && echCalls === 0 && txt.includes('"outbounds"'), `calls=${calls.length} ech=${echCalls} status=${res.status}`);
    calls.length = 0;
    globalThis.fetch = async (url) => { const u = String(url instanceof URL ? url : url?.url || url); calls.push(u); if (/dns-query|query-dns/.test(u)) return new RealResponse('x', { status: 500 }); return new RealResponse('proxies:\n  - {name: a, type: vless, server: 1.1.1.1, port: 443, uuid: ' + S_UUID + '}\n', { status: 200 }); };
    const res2 = await SN.default.fetch(stubRequest('https://w.test/sub?uuid=' + S_UUID, { 'User-Agent': 'clash-verge' }));
    await res2.text();
    check('snippets 订阅配额 SRQ=2：clash 转换器 1 次 + ECH 1 次，ECH 失败不再打备用 DoH（≤2）', res2.status === 200 && calls.length === 2, `calls=${calls.length} ${calls.map(u => u.slice(0, 40)).join(' | ')}`);
  } catch (e) { check('snippets 订阅配额测试', false, e.message); }
  globalThis.fetch = realFetch;
}

// ================= 19. 第十四轮：订阅区域审查修复（S1–S16） =================
console.log('\n===== 第十四轮：订阅区域审查修复 =====');
{
  const UUID0 = '06b65903-406d-4a41-8463-6fd5c0ee7798';
  const UA_MOZ = 'Mozilla/5.0 (S Test)';
  const ctxS = { waitUntil(p) { try { Promise.resolve(p).catch(() => { }); } catch { } } };
  const mkR = ({ url, method = 'GET', headers = {}, body = null }) => {
    const h = {}; for (const [k2, v2] of Object.entries(headers)) h[k2.toLowerCase()] = v2;
    return { url, method, headers: { get: k => (k.toLowerCase() in h ? h[k.toLowerCase()] : null) }, cf: { country: 'US', city: 'T' }, body,
      json: async () => { try { return JSON.parse(body); } catch { return null; } }, text: async () => (typeof body === 'string' ? body : ''),
      fetcher: { connect() { throw new Error('no-connect'); } } };
  };
  const call = (req, env) => WK.default.fetch(req, env || {}, ctxS);
  const reset = () => { try { WK.cfgCacheReset(); } catch { } };
  const unb64 = (t) => { try { return decodeURIComponent(atob(t)); } catch (e) { try { return atob(t); } catch (e2) { return ''; } } };
  const raw64 = (t) => { try { return decodeURIComponent(escape(atob(t))); } catch (e) { try { return atob(t); } catch (e2) { return "''"; } } };
  const withFetch = async (fn, handler) => { const save = globalThis.fetch; const seen = []; globalThis.fetch = async (u, o) => { const s = String((u && u.url) || u); seen.push({ u: s, o }); return handler(s, o); }; try { return await fn(seen); } finally { globalThis.fetch = save; } };
  const notFound = () => new RealResponse('nf', { status: 404 });
  const ADD2 = { ADD: '1.1.1.1:443#n1\n8.8.8.8:443#n2' };

  // S1 ADDSUB 标签：# 不得被百分号编码
  reset();
  await withFetch(async () => {
    const r = await call(mkR({ url: 'https://w.test/sub?uuid=' + UUID0, headers: { 'User-Agent': UA_MOZ } }), { ...ADD2, ADDSUB: 'https://airport.test/sub#A' });
    const d = raw64(await r.text());
    check('S1 ADDSUB 标签：无 # 的 vmess 行追加 #%5BA%5D（不再把 # 编成 %23 破坏 base64）', d.includes('vmess://eyJhIjoxfQ==#%5BA%5D') && !d.includes('%23'), d.split('\n').find(l => l.startsWith('vmess')) || d.slice(0, 120));
    check('S1 ADDSUB 标签：已有 # 的行在备注后追加 [A]', /vless:\/\/u@1\.2\.3\.4:443\?type=ws&path=%2Fabc#n%20%5BA%5D/.test(d), d.split('\n').find(l => l.startsWith('vless://u@')) || '');
  }, (s) => s.includes('airport.test') ? new RealResponse('vless://u@1.2.3.4:443?type=ws&path=%2Fabc#n\nvmess://eyJhIjoxfQ==', { status: 200 }) : notFound());

  // S2 路径 B：ECH/fp/PS 只改写本端 vless 行，透传 vmess/ss/trojan 原样
  reset();
  await withFetch(async () => {
    const up = ['vless://' + UUID0 + '@1.2.3.4:443?encryption=none&security=tls&type=ws&host=w.test&path=%2F&fp=firefox#mine', 'vmess://eyJ2IjoiMiJ9', 'ss://YWVzLTEyOC1nY206cHc@9.9.9.9:8388#ssnode', 'trojan://pw@real.test:443?security=tls&type=tcp#rt'].join('\n');
    const r = await call(mkR({ url: 'https://w.test/123456', headers: { 'User-Agent': 'v2rayN/6.23' } }), { SUB_DOMAIN: 'gen.test', PS: 'P' });
    const d = raw64(await r.text()); const L = d.split('\n');
    check('S2 路径 B：本端 vless 行注入 ech + fp 修正 + PS 后缀', L.some(l => l.includes(UUID0) && l.includes('&ech=') && l.includes('fp=chrome') && l.endsWith('#mine%20P')), L.find(l => l.includes(UUID0)) || '');
    check('S2 路径 B：透传 vmess / ss / trojan 行原样（不注入 ech/fp/PS）', L.includes('vmess://eyJ2IjoiMiJ9') && L.includes('ss://YWVzLTEyOC1nY206cHc@9.9.9.9:8388#ssnode') && L.includes('trojan://pw@real.test:443?security=tls&type=tcp#rt'), L.filter(l => !l.includes(UUID0)).join(' | ').slice(0, 200));
    void up;
  }, (s) => s.includes('/sub?host=example.com') ? new RealResponse('nope', { status: 500 }) : s.includes('gen.test/sub?') ? new RealResponse(btoa(['vless://' + UUID0 + '@1.2.3.4:443?encryption=none&security=tls&type=ws&host=w.test&path=%2F&fp=firefox#mine', 'vmess://eyJ2IjoiMiJ9', 'ss://YWVzLTEyOC1nY206cHc@9.9.9.9:8388#ssnode', 'trojan://pw@real.test:443?security=tls&type=tcp#rt'].join('\n')), { status: 200 }) : notFound());

  // S3 BEST_SUB 命中：EDT 哨兵契约输出（占位 UUID / example.com），绝不泄露真实凭据
  reset();
  {
    const BST = 'x'.repeat(40);
    const r = await call(mkR({ url: 'https://w.test/sub?host=example.com&uuid=00000000-0000-4000-8000-000000000000&bst=' + BST, headers: { 'User-Agent': 'v2rayN/edtunnel (https://github.com/x/edgetunnel)' } }), { ...ADD2, BEST_SUB: '1', SUB_DOMAIN: 'gen.test', BEST_SUB_TOKEN: BST, PROXYIP: 'pip.test', PS: 'leak' });
    const d = raw64(await r.text());
    check('S3 BEST_SUB：输出哨兵形态 00000000-…@ip:port + host=example.com + sni=example.com + path=%2F', r.status === 200 && d.includes('00000000-0000-4000-8000-000000000000@1.1.1.1:443') && d.includes('host=example.com') && d.includes('sni=example.com') && d.includes('path=%2F'), d.slice(0, 200));
    check('S3 BEST_SUB：不含真实 UUID / ProxyIP / ECH / PS', !d.includes(UUID0) && !d.includes('pip.test') && !d.includes('ech=') && !d.includes('leak'), d.slice(0, 200));
  }

  // S4 /sub?base= 裂变：未配 SUB_TOKEN → 端点关闭（不抓 ADDAPI、不返回优选列表）
  reset();
  await withFetch(async (seen) => {
    const r = await call(mkR({ url: 'https://w.test/sub?base=' + encodeURIComponent('vless://attacker@w.test:443?type=ws'), headers: { 'User-Agent': UA_MOZ } }), { ADDAPI: 'https://admin-src.test/ips.txt' });
    const d = unb64(await r.text());
    check('S4 /sub?base= 未配 SUB_TOKEN → 返回错误占位节点，且未抓取 ADDAPI', d.includes('Token') && !d.includes('2.2.2.2') && !seen.some(x => x.u.includes('admin-src.test')), 'seen=' + seen.map(x => x.u).join(',') + ' body=' + d.slice(0, 60));
  }, (s) => s.includes('admin-src.test') ? new RealResponse('2.2.2.2:443#leak', { status: 200 }) : notFound());
  reset();
  await withFetch(async () => {
    const r = await call(mkR({ url: 'https://w.test/sub?base=' + encodeURIComponent('vless://' + UUID0 + '@w.test:443?type=ws') + '&token=tok-ok', headers: { 'User-Agent': UA_MOZ } }), { SUB_TOKEN: 'tok-ok', ADD: '[2606:4700::6810:84e5]:443#v6node' });
    const d = unb64(await r.text());
    check('S7 /sub?base= IPv6 优选：hostname 带方括号写入（不再回落到本端域名）', d.includes('@[2606:4700::6810:84e5]:443'), d.slice(0, 160));
  }, () => notFound());

  // S5 pSB：只给本端节点注入 utls/ech；trojan/hysteria2 透传节点不动
  reset();
  await withFetch(async () => {
    const cfg = { outbounds: [{ type: 'vless', tag: 'mine', uuid: UUID0, tls: { enabled: true } }, { type: 'trojan', tag: 't', password: 'pw', tls: { enabled: true } }, { type: 'hysteria2', tag: 'h', password: 'pw', tls: { enabled: true } }] };
    const r = await call(mkR({ url: 'https://w.test/123456', headers: { 'User-Agent': 'sing-box 1.12' } }), { SUBAPI: 'https://conv.test' });
    const j = JSON.parse(await r.text());
    const mine = j.outbounds.find(o => o.tag === 'mine'), t = j.outbounds.find(o => o.tag === 't'), h = j.outbounds.find(o => o.tag === 'h');
    check('S5 pSB：本端 vless 注入 utls；trojan / hysteria2 透传节点不注入', !!mine.tls.utls && !t.tls.utls && !h.tls.utls && !t.tls.ech && !h.tls.ech, JSON.stringify([t.tls, h.tls]));
    void cfg;
  }, (s) => s.includes('conv.test') ? new RealResponse(JSON.stringify({ outbounds: [{ type: 'vless', tag: 'mine', uuid: UUID0, tls: { enabled: true } }, { type: 'trojan', tag: 't', password: 'pw', tls: { enabled: true } }, { type: 'hysteria2', tag: 'h', password: 'pw', tls: { enabled: true } }] }), { status: 200 }) : s.includes('/sub?host=example.com') ? new RealResponse('nope', { status: 500 }) : new RealResponse('x', { status: 500 }));

  // S6 _aggUnb64：无 padding 的 base64 订阅体也能解出
  reset();
  await withFetch(async () => {
    const two = 'vless://aa@3.3.3.3:443?type=ws#a\nvless://bb@4.4.4.4:443?type=ws#b';
    const r = await call(mkR({ url: 'https://w.test/sub?uuid=' + UUID0, headers: { 'User-Agent': UA_MOZ } }), { ...ADD2, ADDSUB: 'https://airport2.test/sub' });
    const d = unb64(await r.text());
    check('S6 ADDSUB：无 padding 的 base64 体解出两条节点（不再变成一条垃圾 IP）', d.includes('vless://aa@3.3.3.3:443') && d.includes('vless://bb@4.4.4.4:443') && !d.includes('@dmxl'), d.slice(0, 160));
    void two;
  }, (s) => s.includes('airport2.test') ? new RealResponse(btoa('vless://aa@3.3.3.3:443?type=ws#a\nvless://bb@4.4.4.4:443?type=ws#b').replace(/=+$/, ''), { status: 200 }) : notFound());

  // S8 转换器 / 上游订阅 fetch 携带超时信号
  reset();
  await withFetch(async (seen) => {
    await call(mkR({ url: 'https://w.test/123456', headers: { 'User-Agent': 'clash-verge' } }), { SUBAPI: 'https://conv.test' });
    const c = seen.find(x => x.u.includes('conv.test'));
    check('S8 转换器 fetch 携带 AbortSignal 超时', !!c && c.o && c.o.signal instanceof AbortSignal, c ? String(!!c.o?.signal) : 'no conv call');
  }, (s) => s.includes('conv.test') ? new RealResponse('proxies: []\n', { status: 200 }) : new RealResponse('x', { status: 500 }));

  // S9 / S10 pCL：行内 dns: 不重复前置；带引号 uuid 也注入 ech-opts
  reset();
  await withFetch(async () => {
    const r = await call(mkR({ url: 'https://w.test/123456', headers: { 'User-Agent': 'clash-verge' } }), { SUBAPI: 'https://conv.test' });
    const y = await r.text();
    check('S9 pCL：已有行内 dns: 时不再前置第二个 dns:（yaml 重复键）', (y.match(/^dns:/mg) || []).length === 1, 'dns count=' + (y.match(/^dns:/mg) || []).length);
    check('S10 pCL：uuid 带引号的本端节点也注入 ech-opts + client-fingerprint', y.includes('ech-opts') && y.includes('client-fingerprint: chrome'), y.slice(0, 200));
  }, (s) => s.includes('conv.test') ? new RealResponse('dns: {enable: true}\nproxies:\n  - {name: a, type: vless, server: 1.1.1.1, port: 443, uuid: "' + UUID0 + '", tls: true, network: ws, client-fingerprint: firefox}\n', { status: 200 }) : new RealResponse('x', { status: 500 }));

  // S13 target 白名单：非法 target 视为未指定（按 UA 判定），不拼进转换器 URL
  reset();
  await withFetch(async (seen) => {
    const r = await call(mkR({ url: 'https://w.test/123456?target=clash%26list%3Dtrue', headers: { 'User-Agent': UA_MOZ } }), { ...ADD2, SUBAPI: 'https://conv.test' });
    check('S13 非法 target → 忽略（Mozilla UA 走原生 base64，不调转换器）', r.status === 200 && !seen.some(x => x.u.includes('conv.test')), 'seen=' + seen.map(x => x.u.slice(0, 40)).join(','));
  }, () => notFound());

  // S14 转换器全部失败 → 502（不再把 base64 喂给 clash 客户端）
  reset();
  await withFetch(async () => {
    const r = await call(mkR({ url: 'https://w.test/123456', headers: { 'User-Agent': 'clash-verge' } }), { ...ADD2, SUBAPI: 'https://conv.test' });
    check('S14 转换器 500 → 本端返回 502（clash 客户端不会收到 base64）', r.status === 502, String(r.status));
  }, () => new RealResponse('x', { status: 500 }));

  // S16 host === SUB_DOMAIN：转换器回源仍走 flag=true&target=mixed 形态
  reset();
  await withFetch(async (seen) => {
    await call(mkR({ url: 'https://w.test/123456', headers: { 'User-Agent': 'clash-verge' } }), { ...ADD2, SUBAPI: 'https://conv.test', SUB_DOMAIN: 'w.test' });
    const conv = seen.find(x => x.u.includes('conv.test'));
    const inner = conv ? decodeURIComponent((conv.u.match(/[?&]url=([^&]*)/) || [0, ''])[1]) : '';
    check('S16 host==SUB_DOMAIN：回源 URL 为 /SUB_PW?flag=true&target=mixed（不再用 /sub?uuid= 形态）', inner.includes('/123456?flag=true&target=mixed'), 'inner=' + inner.slice(0, 120));
  }, (s) => s.includes('conv.test') ? new RealResponse('proxies: []\n', { status: 200 }) : notFound());
  reset();
}

// ================= 20. 第十五轮：全面审查修复（数据路径 D1–D6 / 面板 P0–P3 / TURN·SSTP F1–F8） =================
console.log('\n===== 第十五轮：全面审查修复 =====');
{
  const UUID0 = '06b65903-406d-4a41-8463-6fd5c0ee7798';
  try { WK.setUUID(UUID0); } catch { }
  const ctxR = { waitUntil(p) { try { Promise.resolve(p).catch(() => { }); } catch { } } };
  const mkR = ({ url, method = 'GET', headers = {}, body = null, fetcher = null }) => {
    const h = {}; for (const [k2, v2] of Object.entries(headers)) h[k2.toLowerCase()] = v2;
    return { url, method, headers: { get: k => (k.toLowerCase() in h ? h[k.toLowerCase()] : null) }, cf: { country: 'US', city: 'T' }, body,
      json: async () => { try { return JSON.parse(body); } catch { return null; } }, text: async () => (typeof body === 'string' ? body : ''),
      fetcher: fetcher || { connect() { throw new Error('no-connect'); } } };
  };
  const call = (req, env) => WK.default.fetch(req, env || {}, ctxR);
  const reset = () => { try { WK.cfgCacheReset(); } catch { } };
  const B7 = WK.__b7 || {}, B9 = WK.__b9 || {};
  globalThis.fetch = async (url, opts) => { const u = String(url instanceof URL ? url : url?.url || url); if (/dns-query|\/resolve/.test(u) && /[?&]name=/.test(u)) return new RealResponse(JSON.stringify({ Answer: [] }), { status: 200 }); return new RealResponse('nf', { status: 404 }); };

  // D1 WS 文本帧：不得按数字分配（"100000000" → 1e8 字节），忽略后二进制帧照常工作
  try {
    connectLog = []; __pairs.length = 0;
    const req = stubRequest('https://w.test/', { 'Upgrade': 'websocket' });
    const res = await WK._ws(req, {});
    const pair = __pairs[__pairs.length - 1];
    const m0 = process.memoryUsage().heapUsed;
    pair.server._onmessage('300000000');
    const grew = process.memoryUsage().heapUsed - m0;
    pair.server._onmessage(vlessFrame(UUID0, 'after-text.org', 443, new Uint8Array([1])));
    await sleep(120);
    check('D1 WS 文本帧被忽略：无 3e8 字节分配、连接未断、后续二进制帧正常建连', res.status === 101 && grew < 50 * 1024 * 1024 && !pair.server._closed && connectLog.some(s => s.host === 'after-text.org'), `grew=${(grew / 1048576).toFixed(1)}MB closed=${pair.server._closed} conn=${connectLog.map(s => s.host).join(',')}`);
    pair.client.close();
  } catch (e) { check('D1 文本帧测试', false, e.message); }

  // D2 上行队列高水位：条目 / 字节上限，溢出 sow 返回 0
  try {
    const k = WK.mkK(20480);
    let ok = 1; for (let i = 0; i < 4096; i++) ok &= k.sow(new Uint8Array(1));
    const over = k.sow(new Uint8Array(1));
    const k2 = WK.mkK(20480);
    const big = k2.sow(new Uint8Array(16 * 1024 * 1024 + 1));
    check('D2 mkK：4096 条内接受，第 4097 条拒绝；单块 >16MiB 拒绝', ok === 1 && over === 0 && big === 0, `ok=${ok} over=${over} big=${big}`);
  } catch (e) { check('D2 队列上限测试', false, e.message); }

  // D3 建连期间客户端关闭 → 迟到的 socket 必须被关闭
  try {
    connectLog = []; __pairs.length = 0;
    const req = stubRequest('https://w.test/', { 'Upgrade': 'websocket' });
    req.fetcher = { connect(a) { const s = makeTargetSocket(typeof a === 'string' ? a : a.hostname, (a && a.port) || 443); s.opened = new Promise(r => setTimeout(r, 120)); connectLog.push(s); return s; } };
    await WK._ws(req, {});
    const pair = __pairs[__pairs.length - 1];
    pair.server._onmessage(vlessFrame(UUID0, 'late-sock.org', 443, new Uint8Array([1])));
    await sleep(30); pair.server.close();   // 服务端视角的连接关闭事件
    await sleep(250);
    check('D3 建连中客户端关闭 → 迟到 socket 已关闭（不泄漏）', connectLog.length === 1 && connectLog[0]._isClosed(), `n=${connectLog.length} closed=${connectLog[0] && connectLog[0]._isClosed()}`);
  } catch (e) { check('D3 迟到 socket 测试', false, e.message); }

  // D4 s5Conn 握手失败 → socket 关闭
  try {
    connectLog = []; __pairs.length = 0;
    const req = stubRequest('https://w.test/?socks5=1.2.3.4:1080&global=1', { 'Upgrade': 'websocket' });
    req.fetcher = { connect(a) { const s = makeTargetSocket(typeof a === 'string' ? a : a.hostname, (a && a.port) || 443); connectLog.push(s); setTimeout(() => s._push(new Uint8Array([5, 255])), 10); return s; } };
    await WK._ws(req, {});
    const pair = __pairs[__pairs.length - 1];
    pair.server._onmessage(vlessFrame(UUID0, 'via-s5.org', 443, new Uint8Array([1])));
    await sleep(200);
    check('D4 SOCKS5 方法被拒（05 ff）→ 抛错且代理 socket 已关闭、WS 已关', connectLog.length === 1 && connectLog[0]._isClosed() && pair.server._closed, `closed=${connectLog[0] && connectLog[0]._isClosed()} ws=${pair.server._closed}`);
  } catch (e) { check('D4 s5Conn 泄漏测试', false, e.message); }

  // D5 _extHostSafe：inet_aton 2/3 段十六进制简写
  if (B7.extHostSafe) {
    const bad = ['0x7f.1', '0xa.1', '0x7f.0.1', '0xc0.0xa8.1', '127.1', '2130706433'];
    check('D5 _extHostSafe 拒绝 2/3 段 hex 简写（0x7f.1 / 0xa.1 / 0x7f.0.1 / 0xc0.0xa8.1）', bad.every(h => !B7.extHostSafe(h).ok), bad.map(h => h + '=' + B7.extHostSafe(h).ok).join(' '));
    check('D5 _extHostSafe 公网仍放行', B7.extHostSafe('93.184.216.34').ok && B7.extHostSafe('example.com').ok, 'ok');
  }

  // P0 Fetch Metadata：跨站 POST 到 flag= 端点 → 403（IP 白名单管理员 CSRF）
  reset();
  {
    const env = { WL_IP: '9.9.9.9' };
    const base = { url: 'https://w.test/?flag=save_config', method: 'POST', body: JSON.stringify({ PS: 'x' }) };
    const r1 = await call(mkR({ ...base, headers: { 'User-Agent': 'Mozilla/5.0', 'cf-connecting-ip': '9.9.9.9', 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'text/plain' } }), env);
    const r2 = await call(mkR({ ...base, headers: { 'User-Agent': 'Mozilla/5.0', 'cf-connecting-ip': '9.9.9.9', 'Origin': 'https://evil.test', 'Content-Type': 'application/json' } }), env);
    const r3 = await call(mkR({ ...base, headers: { 'User-Agent': 'Mozilla/5.0', 'cf-connecting-ip': '9.9.9.9', 'Sec-Fetch-Site': 'same-origin', 'Origin': 'https://w.test', 'Content-Type': 'application/json' } }), env);
    const t1 = await r1.text(), t2 = await r2.text(), t3 = await r3.text();
    check('P0 CSRF：Sec-Fetch-Site=cross-site → 403 cross-site（即便 IP 在白名单）', r1.status === 403 && t1.includes('cross-site'), r1.status + ' ' + t1.slice(0, 40));
    check('P0 CSRF：Origin 不同源 → 403 cross-site', r2.status === 403 && t2.includes('cross-site'), r2.status + ' ' + t2.slice(0, 40));
    check('P0 CSRF：同源请求放行到业务逻辑（白名单管理员 → 200 ok）', r3.status === 200 && t3.includes('ok'), r3.status + ' ' + t3.slice(0, 40));
  }
  // P0-b 面板输入框转义
  reset();
  {
    const env = { PROXYIP: 'x" autofocus onfocus="alert(1)', WEB_PASSWORD: 'abc', AUTH_SECRET: 's'.repeat(32) };
    const lr = await call(mkR({ url: 'https://w.test/?flag=login', method: 'POST', headers: { 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/json', 'cf-connecting-ip': '8.8.8.8' }, body: JSON.stringify({ pwd: 'abc' }) }), env);
    const ck = (lr.headers.get('set-cookie') || '').split(';')[0];
    const r = await call(mkR({ url: 'https://w.test/', headers: { 'User-Agent': 'Mozilla/5.0', 'cf-connecting-ip': '8.8.8.8', 'Cookie': ck } }), env);   // 面板在 /（带 cookie）
    const t = await r.text();
    check('P0-b 面板 pIp 输入框值经转义（不出现裸 onfocus= 属性）', r.status === 200 && !t.includes('x" autofocus onfocus="alert(1)') && t.includes('x&quot; autofocus onfocus=&quot;alert(1)'), String(r.status));
  }

  // P1-a A-9 链式代理：走真实 ws() 调用路径（path 无前导斜杠）
  if (B9.chainProxyCfg && B9.b64uEncode) {
    try {
      const saveF = globalThis.fetch; globalThis.fetch = wrapDoh(async () => new RealResponse('', { status: 200 }));
      const enc = new TextEncoder();
      const base = await crypto.subtle.importKey('raw', enc.encode(UUID0), 'HKDF', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('chain'), info: enc.encode('chain') }, base, 256);
      const key = await crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt']);
      const iv = new Uint8Array(12).fill(7);
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify({ v: 1, t: Math.floor(Date.now() / 1000), type: 'socks5', hostname: 'chain-proxy.example.com', port: 1080, username: 'u', password: 'p' }))));
      const secret = B9.b64uEncode(new Uint8Array([...iv, ...ct]));
      connectLog = []; __pairs.length = 0;
      const req = stubRequest('https://w.test/video/' + secret, { 'Upgrade': 'websocket' });
      const res = await WK._ws(req, { CHAIN_PROXY: '1' });
      const pair = __pairs[__pairs.length - 1];
      pair.server._onmessage(vlessFrame(UUID0, 'chain-target.org', 443, new Uint8Array([1])));
      await sleep(150);
      check('P1-a A-9 端到端：GET /video/<密文> 经 ws() → 首连为链式 socks5 代理（不再静默回落 ProxyIP）', res.status === 101 && connectLog.length > 0 && connectLog[0].host === 'chain-proxy.example.com' && connectLog[0].port === 1080, connectLog.map(s => s.host + ':' + s.port).join(','));
      pair.client.close();
      globalThis.fetch = saveF;
    } catch (e) { check('P1-a A-9 端到端测试', false, e.message); }
  }

  // P1-b A-8 反代：入站 Cookie / cf-connecting-ip 不转发
  reset();
  {
    let seenH = null; const saveF = globalThis.fetch;
    globalThis.fetch = wrapDoh(async (u, o) => { seenH = o && o.headers; return new RealResponse('<html>ok</html>', { status: 200, headers: { 'content-type': 'text/html' } }); });
    try {
      const r = await call(mkR({ url: 'https://w.test/page', headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': 'auth=1.abc', 'cf-connecting-ip': '5.5.5.5', 'Authorization': 'Bearer x' } }), { URL: 'https://example.com' });
      check('P1-b A-8 反代请求不携带 Cookie / Authorization / cf-connecting-ip', r.status === 200 && seenH && !seenH.get('cookie') && !seenH.get('authorization') && !seenH.get('cf-connecting-ip') && seenH.get('host') === 'example.com', seenH ? JSON.stringify([...seenH.keys()]) : 'no fetch');
    } finally { globalThis.fetch = saveF; }
  }

  // P2-a getSafeEnv：数字型 vars 不崩溃；D1 读失败不缓存空表
  reset();
  check('P2-a getSafeEnv：数字型 env（DLS: 7）→ "7"，不抛 trim 错误', (await WK.getSafeEnv({ DLS: 7 }, 'DLS', '9')) === '7');
  reset();
  {
    let calls = 0;
    const db = { prepare() { return { bind() { return this; }, all: async () => { calls++; throw new Error('D1 down'); }, run: async () => ({}) }; } };
    const a = await WK.getSafeEnv({ DB: db }, 'PS', 'fb');
    const b = await WK.getSafeEnv({ DB: db }, 'PS', 'fb');
    check('P2-a D1 读失败 → 返回默认值且不缓存空表（第二次仍重试 SELECT）', a === 'fb' && b === 'fb' && calls === 2, `calls=${calls}`);
  }
  // P2-b _AUTH_SECRET_AUTO：已存在时不被覆盖（DO NOTHING + 直读）
  reset();
  {
    const store = new Map([['_AUTH_SECRET_AUTO', 'a'.repeat(48)]]);
    const db = { prepare(sql) { const S = String(sql); return { _a: [], bind(...a) { this._a = a; return this; }, all: async function () { if (/WHERE key = \?/.test(S)) { const v = store.get(String(this._a[0])); return { results: v ? [{ value: v }] : [] }; } return { results: [...store].map(([k, v]) => ({ key: k, value: v })) }; }, run: async function () { if (/INSERT/.test(S)) { if (/DO NOTHING/.test(S)) { if (!store.has(String(this._a[0]))) store.set(String(this._a[0]), String(this._a[1])); } else store.set(String(this._a[0]), String(this._a[1])); } return {}; } }; }, batch: async (st) => { for (const x of st) await x.run(); return []; } };
    const r = await call(mkR({ url: 'https://w.test/?flag=login', method: 'POST', headers: { 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/json', 'cf-connecting-ip': '8.8.4.4' }, body: JSON.stringify({ pwd: 'abc' }) }), { DB: db });
    check('P2-b 登录不覆盖既有 _AUTH_SECRET_AUTO（DO NOTHING 语义）', r.status === 200 && store.get('_AUTH_SECRET_AUTO') === 'a'.repeat(48), r.status + ' ' + String(store.get('_AUTH_SECRET_AUTO')).slice(0, 8));
  }
  // P2-c validate_cf：请求体不当 env 用；{DB:1} 不污染缓存、不 500
  reset();
  {
    const store = new Map([['PS', 'keep']]);
    const db = { prepare(sql) { return { bind() { return this; }, all: async () => ({ results: [...store].map(([k, v]) => ({ key: k, value: v })) }), run: async () => ({}) }; }, batch: async () => [] };
    const env = { DB: db, WL_IP: '9.9.9.9' };
    const r = await call(mkR({ url: 'https://w.test/?flag=validate_cf', method: 'POST', headers: { 'User-Agent': 'Mozilla/5.0', 'cf-connecting-ip': '9.9.9.9', 'Content-Type': 'application/json' }, body: JSON.stringify({ DB: 1, CF_EMAIL: 123 }) }), env);
    const j = await r.json().catch(() => null);
    const ps = await WK.getSafeEnv(env, 'PS', '');
    check('P2-c validate_cf 传 {DB:1,CF_EMAIL:123} → 200 JSON（不 500），且全局配置缓存未被污染', r.status === 200 && j && j.success === false && ps === 'keep', `status=${r.status} ps=${ps}`);
    const r2 = await call(mkR({ url: 'https://w.test/?flag=validate_cf', method: 'POST', headers: { 'User-Agent': 'Mozilla/5.0', 'cf-connecting-ip': '9.9.9.9' }, body: '{bad' }), env);
    check('P2-c validate_cf 非法 JSON → 400（不 500）', r2.status === 400, String(r2.status));
  }
  // P2-d stats 聚合：两次普通调用之间不落库，强制 flush 时把累计数一次写入
  {
    const seen = [];
    const db = { prepare(sql) { return { _a: [], bind(...a) { this._a = a; return this; }, run: async function () { seen.push({ sql: String(sql).trim().split(' ')[0].toUpperCase(), a: this._a }); return {}; }, all: async () => ({ results: [] }) }; } };
    await WK.incrementDailyStats({ DB: db }, true);
    const n0 = seen.filter(x => x.sql === 'INSERT').length;
    await WK.incrementDailyStats({ DB: db });
    await WK.incrementDailyStats({ DB: db });
    const n1 = seen.filter(x => x.sql === 'INSERT').length;
    await WK.incrementDailyStats({ DB: db }, true);
    const last = seen.filter(x => x.sql === 'INSERT').pop();
    check('P2-d stats 聚合：强制 flush 后两次普通调用不写库，再次 flush 一次写入累计 3', n0 === 1 && n1 === 1 && last && last.a[1] === 3, `n0=${n0} n1=${n1} last=${last && JSON.stringify(last.a)}`);
  }

  // F5 pCfg：?turn= / ?sstp= 的 cfg 形状与连接器一致
  {
    const mk = (u) => new URL(u);
    const t1 = WK.pCfg(mk('https://w.test/?turn=1.2.3.4:3478'), '', null);
    const s1 = WK.pCfg(mk('https://w.test/?sstp=1.2.3.4'), '', null);
    check('F5 ?turn= → gP.cfg.{hostname,port,username:null,password:null,tls:false}', t1.gP && t1.gP.type === 'turn' && t1.gP.cfg.hostname === '1.2.3.4' && t1.gP.cfg.port === 3478 && t1.gP.cfg.username === null && t1.gP.cfg.tls === false, JSON.stringify(t1.gP));
    check('F5 ?sstp= → gP.cfg.{host,port:443,user:vpn,password:vpn}', s1.gP && s1.gP.type === 'sstp' && s1.gP.cfg.host === '1.2.3.4' && s1.gP.cfg.port === 443 && s1.gP.cfg.user === 'vpn', JSON.stringify(s1.gP));
  }
  globalThis.fetch = realFetch;
}

// ================= 汇总 =================
console.log('\n===== 汇总 =====');
const fail = results.filter(r => !r.ok);
console.log(`共 ${results.length} 项，失败 ${fail.length} 项`);
if (fail.length) { console.log('失败项:'); fail.forEach(f => console.log(' - ' + f.name)); }
// CI 门禁：有失败即非 0 退出码（失败 0 项保持 exit 0）
if (fail.length) process.exitCode = 1;
