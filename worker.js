
// =============================================================================
// 🟣 1. 用户配置区域 (优先级: 环境变量 > D1 > 硬编码)
// =============================================================================

// --- 基础账号与网络配置 ---
let UUID = "06b65903-406d-4a41-8463-6fd5c0ee7798"; //修改可用的uuid
const WEB_PASSWORD = "abc";  //修改你的登录密码
const SUB_PASSWORD = "123456";  //修改你的订阅密码
const SUB_TOKEN = "";  //ST裂变Token，留空不启用，支持环境变量 SUB_TOKEN 覆盖
const DEFAULT_PROXY_IP = 'Pro'+'xy'+'IP.CM'+'Liu'+'ssss.net'; //单个反代地址
const DEFAULT_SUB_DOMAIN = 'https://owo.o00o.ooo/'; //单个sub优选订阅
const DEFAULT_CONVERTER = 'htt'+'ps://su'+'bap'+'i.cm'+'liu'+'ssss.net'; //转换后端api
const AD_FILTER = 'telegram|t\\.me|premium'; //订阅生成器推广行过滤正则（正则源字符串，命中哨兵行直接丢弃；环境变量 AD_FILTER 可覆盖，如 'telegram|promo\\.example'）

// --- 界面与链接配置 ---
const LOGIN_PAGE_TITLE = "Worker Login"; // 修改你的登录页标题
const DASHBOARD_TITLE = "GrainTCP Worrkers"; //修改你的管理后台标题
const TG_GROUP_URL = "https://t.me/snove9999";       // 登录页“交流群”链接
const SITE_URL = "";        // 登录页链接
const GITHUB_URL = ""; // 登录页链接
const PROXY_CHECK_URL = "https://check.proxyip.cmliussss.net/";    // 后台 ProxyIP 检测跳转地址

// --- 订阅转换配置文件 (支持环境变量覆盖) ---
const CLASH_CONFIG = 'htt'+'ps://raw.git'+'hub'+'usercontent.com/cm'+'liu/ACL4'+'SSR/main/Cl'+'ash/config/ACL4SSR_Online_Full_MultiMode.ini'; //修改转换订阅配置文件ini
const SINGBOX_CONFIG_V12 = 'htt'+'ps://raw.git'+'hub'+'usercontent.com/sinspired/su'+'b-st'+'ore-template/main/1.12.x/si'+'ng-b'+'ox.json'; //修改singbox的json配置，默认使用1.11，如果无法使用才会切换1.12
const SINGBOX_CONFIG_V11 = 'htt'+'ps://raw.git'+'hub'+'usercontent.com/sinspired/su'+'b-st'+'ore-template/main/1.11.x/si'+'ng-b'+'ox.json'; //修改singbox的json配置，默认使用这个，如果无法使用才会切换1.12

// --- 通知与高级参数 ---
const TG_BOT_TOKEN = ""; //在此telegram bot的token令牌
const TG_CHAT_ID = ""; //在此修改添加你的telegram 用户id
const ADMIN_IP = ""; //在此修改添加你的白名单IP
const DLS = "7"; // ADDCSV 专用：速度下限筛选阈值 (单位 MB/s)
const SUB_FETCH_TIMEOUT = 10000, SUB_BODY_MAX = 1048576, SUB_SRC_MAX = 20; // 订阅侧外部抓取：超时 / 单响应体上限 / 单类来源条数上限
const NET = "ws"; // 订阅默认传输：ws | xhttp（env/D1 的 NET 覆盖；?net= 单次覆盖；xhttp 固定 mode=stream-one + padding 混淆 extra——本端无 GET 下行）

// =============================================================================
// 🟢 超神奇
const P_V = 'vl'+'ess';
const P_S = 'so'+'cks';
const P_S5 = 'so'+'cks5';

// ECH + 指纹伪装配置
let ECH = true;  // ECH 开关 (支持环境变量覆盖)
let ECH_DNS = 'https://odvr.nic.cz/doh';
const ECH_DNS_BACKUP = 'https://8.8.4.4/query-dns';
let ECH_SNI = 'cloudflare-ech.com';
let FP = 'chrome';

// ECH Config 动态获取 (二进制 DoH wire format)
let _echMemo = { k: '', pem: null, t: 0 };
async function _getECH(doh = ECH_DNS, allowBackup = true) {
  if (!ECH) return null;
  const _mk = ECH_SNI + '|' + ECH_DNS;
  if (allowBackup && _echMemo.pem && _echMemo.k === _mk && Date.now() - _echMemo.t < 600000) return _echMemo.pem;
  const _r = await _getECHRaw(doh, allowBackup);
  if (allowBackup && _r) _echMemo = { k: _mk, pem: _r, t: Date.now() };
  return _r;
}
async function _getECHRaw(doh = ECH_DNS, allowBackup = true) {
  const fallback = () => allowBackup && doh !== ECH_DNS_BACKUP ? _getECHRaw(ECH_DNS_BACKUP, false) : null;
  try {
    const parts = ECH_SNI.split('.');
    const qname = [];
    for (const p of parts) { qname.push(p.length, ...new TextEncoder().encode(p)); }
    qname.push(0);
    const hdr = new Uint8Array([0x00,0x01,0x01,0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x00]);
    const qtype = new Uint8Array([0x00,0x41]);
    const qclass = new Uint8Array([0x00,0x01]);
    const query = new Uint8Array([...hdr, ...qname, ...qtype, ...qclass]);
    const res = await fetch(doh, {
      method: 'POST',
      headers: { 'content-type': 'appli'+'cation/'+'dns-m'+'essage', 'accept': 'appli'+'cation/'+'dns-m'+'essage' },
      body: query,
      signal: AbortSignal.timeout(5000) // DoH 挂起时走 fallback，防止订阅生成被无限期阻塞
    });
    if (!res.ok) return fallback();
    const buf = new Uint8Array(await res.arrayBuffer());
    let offset = 12;
    const ancount = (buf[6] << 8) | buf[7];
    while (offset < buf.length && buf[offset] !== 0) { if ((buf[offset] & 0xc0) === 0xc0) { offset += 2; break; } offset += buf[offset] + 1; }
    if (buf[offset] === 0) offset++;
    offset += 4;
    for (let i = 0; i < ancount; i++) {
      if ((buf[offset] & 0xc0) === 0xc0) offset += 2;
      else { while (offset < buf.length && buf[offset] !== 0) offset += buf[offset] + 1; offset++; }
      const rtype = (buf[offset] << 8) | buf[offset + 1]; offset += 2;
      offset += 2; offset += 4;
      const rdlen = (buf[offset] << 8) | buf[offset + 1]; offset += 2;
      if (rtype === 65) {
        const rdataEnd = offset + rdlen;
        offset += 2;
        if (buf[offset] === 0) offset++;
        else if ((buf[offset] & 0xc0) === 0xc0) offset += 2;
        else { while (offset < buf.length && buf[offset] !== 0) offset += buf[offset] + 1; offset++; }
        while (offset < rdataEnd) {
          const key = (buf[offset] << 8) | buf[offset + 1]; offset += 2;
          const vlen = (buf[offset] << 8) | buf[offset + 1]; offset += 2;
          if (key === 5) {
            const echRaw = buf.slice(offset, offset + vlen);
            const b64 = btoa(String.fromCharCode(...echRaw));
            return '-----BEGIN ECH CONFIGS-----\n' + b64 + '\n-----END ECH CONFIGS-----';
          }
          offset += vlen;
        }
      } else { offset += rdlen; }
    }
    return fallback();
  } catch (e) { return fallback(); }
}

// SB ECH 注入
async function pSB(text, uuid) {
  try {
    const cfg = JSON.parse(text);
    const echPem = ECH ? await _getECH() : null;
    const OB = 'out'+'bou'+'nds';
    if (cfg[OB]) {
      for (const node of cfg[OB]) {
        if (!node.tls) continue;
        // UUID 过滤：只处理本项目生成的节点
        if (uuid && !(node.uuid === uuid || node['pass'+'word'] === uuid)) continue;
        if (ECH && echPem) node.tls.ech = { enabled: true, config: echPem };
        const UT = 'ut'+'ls';
        if (!node.tls[UT]) node.tls[UT] = {};
        node.tls[UT].enabled = true;
        node.tls[UT]['fing'+'erp'+'rint'] = FP;
      }
    }
    return JSON.stringify(cfg);
  } catch (e) { return text; }
}

// CL双格式 ECH 注入
async function pCL(text, uuid, h) {
  try {
    const _eo='ech'+'-opts',_qsn='query'+'-server'+'-name',_nsp='name'+'server'+'-po'+'licy';
    let _echB64 = '';
    if (ECH) {
      try {
        const _pem = await _getECH();
        if (_pem) {
          const m = _pem.match(/-----BEGIN ECH CONFIGS-----\n(.*)\n-----END ECH CONFIGS-----/);
          if (m) _echB64 = m[1];
        }
      } catch (e) {}
    }
    let y = text;

    if (ECH) {
      // Worker 预取 ECHConfig，Clash/Mihomo 动态查询作为兜底
      const baseDnsBlock = 'dns:\n  enable: true\n  default-nameserver:\n    - 223.5.5.5\n    - 119.29.29.29\n    - 114.114.114.114\n  use-hosts: true\n  nameserver:\n    - https://sm2.doh.pub/dns-query\n    - https://dns.alidns.com/dns-query\n  fallback:\n    - 8.8.4.4\n    - 208.67.220.220\n  fallback-filter:\n    geoip: true\n    geoip-code: CN\n    ipcidr:\n      - 240.0.0.0/4\n      - 127.0.0.1/32\n      - 0.0.0.0/32\n    domain:\n      - \'+.google.com\'\n      - \'+.facebook.com\'\n      - \'+.youtube.com\'\n';
      const _hasAnyDns = /^dns:/m.test(y), _hasBlockDns = /^dns:\s*(?:#[^\n]*)?(?:\n|$)/m.test(y);
      if (!_hasAnyDns) y = baseDnsBlock + y;
      if (!_hasAnyDns || _hasBlockDns) {

      const _bkDoH='https://do'+'h.cm.edu.kg/'+'C'+'ML'+'iu'+'ssss';
      const ne='    "'+h+'":\n      - '+ECH_DNS+'\n      - '+ECH_DNS_BACKUP+'\n      - '+_bkDoH+'\n    "'+ECH_SNI+'":\n      - '+ECH_DNS+'\n      - '+ECH_DNS_BACKUP+'\n      - '+_bkDoH;
      const hasNsp = /^\s{2}nameserver-policy:\s*(?:\n|$)/m.test(y);
      if (hasNsp) {
        y = y.replace(/^(\s{2}nameserver-policy:\s*\n)/m, '$1' + ne + '\n');
      } else {
        const ls = y.split('\n');
        let di = -1, iD = false;
        for (let i = 0; i < ls.length; i++) {
          if (/^dns:\s*(?:#[^\n]*)?$/.test(ls[i])) { iD = true; continue; }
          if (iD && /^[a-zA-Z]/.test(ls[i])) { di = i; break; }
        }
        const nspBlock = '  ' + _nsp + ':\n' + ne;
        if (di > 0) { ls.splice(di, 0, nspBlock); y = ls.join('\n'); }
        else { y += '\n' + nspBlock + '\n'; }
      }
      }
    }

    const L=y.split('\n'),R=[];let i=0;
    while(i<L.length){const l=L[i],tl=l.trim();
      if(tl.startsWith('- {')&&tl.includes('uuid:')){
        let fn=l,bc=(l.match(/\{/g)||[]).length-(l.match(/\}/g)||[]).length;
        while(bc>0&&i+1<L.length){i++;fn+='\n'+L[i];bc+=(L[i].match(/\{/g)||[]).length-(L[i].match(/\}/g)||[]).length;}
        const um=fn.match(/uuid:\s*([^,}\n]+)/);
        if(um&&um[1].trim().replace(/^["']|["']$/g,'')===uuid.trim()){
          fn=fn.replace(/client-fingerprint:\s*[^,}\s]+/i,'client-fingerprint: '+FP);
          if(ECH) fn=fn.replace(/\}(\s*)$/, ', '+_eo+': {enable: true, '+_qsn+': '+ECH_SNI+(_echB64 ? ', config: '+_echB64 : '')+'}}$1');
        }
        R.push(fn);i++;
      }else if(tl.startsWith('- name:')){
        let nl=[l];const bi=l.search(/\S/);i++;
        while(i<L.length){const nx=L[i],nt=nx.trim();
          if(!nt){nl.push(nx);i++;break;}
          if(nx.search(/\S/)<=bi&&nt.startsWith('- '))break;
          if(nx.search(/\S/)<bi&&nt)break;
          nl.push(nx);i++;}
        const um=nl.join('\n').match(/uuid:\s*([^\n]+)/);
        if(um&&um[1].trim().replace(/^["']|["']$/g,'')===uuid.trim()){
          for(let j=0;j<nl.length;j++){if(/client-fingerprint:/i.test(nl[j])){nl[j]=nl[j].replace(/client-fingerprint:\s*\S+/i,'client-fingerprint: '+FP);break;}}
          let ii=-1;for(let j=nl.length-1;j>=0;j--)if(nl[j].trim()){ii=j;break;}
          if(ECH&&ii>=0){const ind=' '.repeat(bi+2);const echLines=[ind+_eo+':',ind+'  enable: true',ind+'  '+_qsn+': '+ECH_SNI];if(_echB64)echLines.push(ind+'  config: '+_echB64);nl.splice(ii+1,0,...echLines);}}
        R.push(...nl);
      }else{R.push(l);i++;}}
    return R.join('\n');
  } catch (e) { return text; }
}

// =============================================================================
// 🧠 GrainTCP 代理内核
// =============================================================================
const CFG = { id: '2523c510-9ff0-415b-9582-93949bfae7e3', chunk: 64 * 1024, dnPack: 32 * 1024, dnTail: 512, dnQr: 4, upPack: 20 * 1024, maxED: 8 * 1024, concur: 4, autoConcur: true };

/* ---------- 部署环境自动识别 ----------
 * Snippets:   fetch(request)         → env === undefined → concur 强制 1
 * Workers:    fetch(request, env, ctx) → env 是对象 → 默认 4，可由 env.CONCUR 覆盖
 * Pages:      同 Workers
 *
 * 配置方式：
 *   - 默认值 concur=4（Workers/Pages 推荐）
 *   - Snippets 环境自动降到 1（CPU 预算和连接配额限制）
 *   - Workers 环境想改 concur，在 dashboard 加环境变量 CONCUR=2 或 CONCUR=8
 *   - 把 CFG.autoConcur 设为 false 可完全关闭自动识别，手动控制
 */
const detectRuntime = (() => {
  let done = false;
  return env => {
    if (done || !CFG.autoConcur) return;
    done = true;
    if (typeof env === 'undefined') {
      CFG.concur = 1;
      return;
    }
    const v = env && env.CONCUR;
    if (v !== undefined && v !== null && v !== '') {
      const n = parseInt(v, 10);
      if (Number.isFinite(n) && n >= 1 && n <= 16) CFG.concur = n;
    }
  };
})();

const hex = c => (c > 64 ? c + 9 : c) & 0xF;
const dec = new TextDecoder();
let idB = new Uint8Array(16);
let I0,I1,I2,I3,I4,I5,I6,I7,I8,I9,I10,I11,I12,I13,I14,I15;

function setUUID(uuid) {
  CFG.id = uuid;
  for (let i = 0, p = 0, c, h; i < 16; i++) {
    c = uuid.charCodeAt(p++); c === 45 && (c = uuid.charCodeAt(p++)); h = hex(c);
    c = uuid.charCodeAt(p++); c === 45 && (c = uuid.charCodeAt(p++));
    idB[i] = h << 4 | hex(c);
  }
  [I0,I1,I2,I3,I4,I5,I6,I7,I8,I9,I10,I11,I12,I13,I14,I15] = idB;
}
setUUID(CFG.id);

const matchID = c => c[1] === I0 && c[2] === I1 && c[3] === I2 && c[4] === I3 && c[5] === I4 && c[6] === I5 && c[7] === I6 && c[8] === I7 && c[9] === I8 && c[10] === I9 && c[11] === I10 && c[12] === I11 && c[13] === I12 && c[14] === I13 && c[15] === I14 && c[16] === I15;

const addr = (t, b) => t === 1
  ? `${b[0]}.${b[1]}.${b[2]}.${b[3]}`
  : t === 3
    ? dec.decode(b)
    : `[${Array.from({ length: 8 }, (_, i) => ((b[i * 2] << 8) | b[i * 2 + 1]).toString(16)).join(':')}]`;

const parseAddr = (b, o, t) => {
  const l = t === 3 ? b[o++] : t === 1 ? 4 : t === 4 ? 16 : null;
  if (l === null) return null;
  const n = o + l;
  return n > b.length ? null : { targetAddrBytes: b.subarray(o, n), dataOffset: n };
};

const parseVP = c => {
  if (c.length < 24 || !matchID(c)) return null;
  let o = 19 + c[17];
  if (c[o - 1] !== 1) return null;   // P1-11：仅接受 cmd=1(TCP)，拒绝 cmd=2(UDP)/MUX，对齐 xHTTP 侧
  const p = (c[o] << 8) | c[o + 1];
  let t = c[o + 2];
  if (t !== 1) t += 1;
  const a = parseAddr(c, o + 3, t);
  return a ? { addrType: t, ...a, port: p } : null;
};

/* ---------- IPv6 格式化工具 ---------- */
const stripIPv6Brackets = host => host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
const isIPv6Host = host => stripIPv6Brackets(host).includes(':');
const formatHostForUrl = host => isIPv6Host(host) ? `[${stripIPv6Brackets(host)}]` : stripIPv6Brackets(host);

/* ---------- 地址/端口解析（IPv6 兼容） ---------- */
const parseAddressPort = (seg) => {
  const raw = (seg || '').trim();
  if (!raw) return ['', 443];
  if (raw.startsWith('[')) {
    const m = raw.match(/^\[([^\]]+)\](?::(\d+))?$/);
    if (m) return [m[1], Number(m[2] || 443)];
    return [stripIPv6Brackets(raw), 443];
  }
  const colonCount = (raw.match(/:/g) || []).length;
  if (colonCount > 1) return [raw, 443];
  const idx = raw.lastIndexOf(':');
  if (idx > -1) {
    const addr = raw.slice(0, idx);
    const portText = raw.slice(idx + 1);
    if (/^\d+$/.test(portText)) return [addr, Number(portText)];
  }
  return [raw, 443];
};

/* ===== P0-2 方案B helper：ext_url 目标安全校验（自包含，无副作用；以 audit_E_ssrf_plan.md 附录 A.3 为准） ===== */
const _ipv4ToLong = (ip) => {
    const p = String(ip).split('.').map(Number);
    if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    return (((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]) >>> 0;
};
// [网段, 前缀]：覆盖 RFC1918 / 回环 / 链路本地 / CGNAT / 保留 / 组播 / 基准测试
const _BLOCKED_V4 = [
    ['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],
    ['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],
    ['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]
].map(([b,p]) => { const l = _ipv4ToLong(b); return [ (l >>> (32-p)) >>> 0, p ]; });
const _isBlockedV4 = (long) => long !== null && _BLOCKED_V4.some(([net,p]) => ((long >>> (32-p)) >>> 0) === net);
// 归一化各类 IPv4 字面量写法：十进制整数 / 0x 十六进制 / 八进制 / 混合段
const _normalizeV4Literal = (h) => {
    const parts = String(h).split('.');
    const toByte = (s) => /^0x[0-9a-f]+$/i.test(s) ? parseInt(s,16)
                       : /^0[0-7]+$/.test(s) && s.length>1 ? parseInt(s,8)
                       : /^\d+$/.test(s) ? Number(s) : NaN;
    const vals = parts.map(toByte);
    if (vals.length === 1 && Number.isInteger(vals[0]) && vals[0] >= 0 && vals[0] <= 0xFFFFFFFF)
        return [(vals[0]>>>24)&255,(vals[0]>>>16)&255,(vals[0]>>>8)&255,vals[0]&255].join('.');
    if (vals.length === 4 && vals.every(v => Number.isInteger(v) && v>=0 && v<=255)) return vals.join('.');
    // D5：inet_aton 2/3 段简写（a.b → a.0.0.b / a.b.c → a.b.0.c），末段承载低位字节
    if ((vals.length === 2 || vals.length === 3) && vals.every(v => Number.isInteger(v) && v >= 0)) {
        const lead = vals.slice(0, -1), last = vals[vals.length - 1], lastMax = vals.length === 2 ? 0xFFFFFF : 0xFFFF;
        if (lead.every(v => v <= 255) && last <= lastMax) {
            const tail = vals.length === 2 ? [(last>>>16)&255,(last>>>8)&255,last&255] : [(last>>>8)&255,last&255];
            return lead.concat(tail).join('.');
        }
    }
    return null;
};
// 展开 IPv6 为 8 个 16-bit 组：兼容 :: 压缩、尾部内嵌点分 v4、大小写、前导零
const _expandV6 = (h) => {
    const s = String(h).toLowerCase().replace(/^\[|\]$/g, '');
    let core = s, tail = null;
    const dot = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
    if (dot) { core = dot[1] + '0:0'; tail = _normalizeV4Literal(dot[2]); }
    const dbl = core.indexOf('::');
    let groups;
    if (dbl >= 0) {
        const head = core.slice(0, dbl).split(':').filter(x => x !== '');
        const tailg = core.slice(dbl + 2).split(':').filter(x => x !== '');
        const fill = 8 - head.length - tailg.length;
        if (fill < 0) return null;
        groups = [...head.map(x=>parseInt(x||'0',16)), ...Array(fill).fill(0), ...tailg.map(x=>parseInt(x||'0',16))];
    } else {
        groups = core.split(':').filter(x => x !== '').map(x=>parseInt(x||'0',16));
    }
    if (groups.length !== 8 || groups.some(g => !Number.isInteger(g) || g < 0 || g > 0xffff)) return null;
    if (tail) { const l = _ipv4ToLong(tail); groups[6] = (l>>>16)&0xffff; groups[7] = l&0xffff; }
    return groups;
};
// 位掩码判定回环/ULA/链路本地/组播 + 末 32 位提取 v4-embedded（mapped/translated/NAT64）
const _isBlockedV6 = (h) => {
    const g = _expandV6(h);
    if (!g) return true;                                                   // 无法解析 → 保守判为不安全
    if (g.every((x,i) => i===7 ? x===1 : x===0)) return true;              // ::1 回环
    if ((g[0] & 0xfe00) === 0xfc00) return true;                           // fc00::/7 ULA
    if ((g[0] & 0xffc0) === 0xfe80) return true;                           // fe80::/10 链路本地
    if ((g[0] & 0xff00) === 0xff00) return true;                           // ff00::/8 组播
    const compat = g[0]===0&&g[1]===0&&g[2]===0&&g[3]===0&&g[4]===0&&g[5]===0;             // ::/96 IPv4-compatible（含未指定 ::）
    if (compat) return true;                                               // 【附录D补丁①】整体封禁 ::/96
    const mapped = g[0]===0&&g[1]===0&&g[2]===0&&g[3]===0&&g[4]===0&&g[5]===0xffff;        // ::ffff:a.b.c.d
    const transl = g[0]===0&&g[1]===0&&g[2]===0&&g[3]===0&&g[4]===0xffff&&g[5]===0;        // ::ffff:0:a.b.c.d
    const nat64  = g[0]===0x64&&g[1]===0xff9b&&g[2]===0&&g[3]===0&&g[4]===0&&g[5]===0;     // 64:ff9b::/96
    if (mapped || transl || nat64) {
        const v4 = `${(g[6]>>8)&255}.${g[6]&255}.${(g[7]>>8)&255}.${g[7]&255}`;
        return _isBlockedV4(_ipv4ToLong(v4));
    }
    return false;
};
// 域名分支保留原字符串前缀黑名单（防回归）+ 补 .local/.internal
const _extHostSafe = (hostname) => {
    const h = String(hostname||'').replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (h.includes(':')) return { ok: !_isBlockedV6(h), host: h };
    const norm = _normalizeV4Literal(h);
    if (norm) return { ok: !_isBlockedV4(_ipv4ToLong(norm)), host: norm };
    if (/^(localhost$|127\.|10\.|192\.168\.|169\.254\.|0\.)/i.test(h)) return { ok: false, host: h };
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return { ok: false, host: h };
    if (/\.(local|internal)$/i.test(h)) return { ok: false, host: h };
    return { ok: true, host: h };
};
// 有上限读取（256KB）
const _readCapped = async (res, max = 262144) => {
    if (!res.body) return '';
    const reader = res.body.getReader(); const chunks = []; let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > max) { try { await reader.cancel(); } catch {} throw new Error('ext response too large'); }
        chunks.push(value);
    }
    const buf = new Uint8Array(total); let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
    return new TextDecoder().decode(buf);
};

/* ---------- SOCKS5 / HTTP 凭证解析 ---------- */
const addrParser = (raw, defPort = 1080) => {
  let username, password, hostname, port;

  // EDT 兼容：值允许自带协议前缀（/s5=socks5://user:pass@host 形式），统一剥掉
  raw = String(raw || '').trim().replace(/^(?:socks?5?|https?|turn|turns|sstp):\/\//i, '');
  // 旧 EDT 兼容：整段 base64("user:pass@host:port")，解码后须形如凭证@主机(:端口) 才采用
  if (!raw.includes('@') && raw.length >= 8 && /^[A-Za-z0-9+/=_-]+$/.test(raw)) {
    try {
      const decd = atob(raw.replace(/%3D/gi, '=').replace(/-/g, '+').replace(/_/g, '/').padEnd(raw.length + (4 - raw.length % 4) % 4, '='));
      if (/^[^@\s]+@[^@\s]+(?::\d+)?$/.test(decd)) raw = decd;
    } catch {}
  }

  if (raw.includes('://') && !raw.match(/^(socks?5?|https?):\/\//i)) {
    const u = new URL(raw);
    hostname = u.hostname;
    port = u.port || defPort;
    const auth = u.username || u.password ? `${u.username}:${u.password}` : u.username;
    if (auth && auth.includes(':')) [username, password] = auth.split(':');
    else if (auth) {
      try {
        const decd = atob(auth.replace(/%3D/g, '=').padEnd(auth.length + (4 - auth.length % 4) % 4, '='));
        const p = decd.split(':');
        if (p.length === 2) [username, password] = p;
      } catch {}
    }
  } else {
    let authPart = '', hostPart = raw;
    const at = raw.lastIndexOf('@');
    if (at !== -1) { authPart = raw.substring(0, at); hostPart = raw.substring(at + 1); }

    if (authPart && !authPart.includes(':')) {
      try {
        const decd = atob(authPart.replace(/%3D/g, '=').padEnd(authPart.length + (4 - authPart.length % 4) % 4, '='));
        const p = decd.split(':');
        if (p.length === 2) [username, password] = p;
      } catch {}
    }
    if (!username && authPart && authPart.includes(':')) [username, password] = authPart.split(':');

    const [h, p] = parseAddressPort(hostPart);
    hostname = h;
    port = p || defPort;
  }

  if (!hostname || isNaN(port)) throw new Error('Invalid config');
  return { username, password, hostname, port };
};

/* ---------- SOCKS5 握手（通过 fetcher.connect） ---------- */
async function s5Conn(fetcher, addressType, addressRemote, portRemote, cfg) {
  const { username, password, hostname, port } = cfg;
  const socket = fetcher.connect({ hostname, port });
  let writer = null, reader = null;
  try {
  if (socket.opened) await socket.opened;
  writer = socket.writable.getWriter();
  await writer.write(new Uint8Array([5, username ? 2 : 1, 0, username ? 2 : 0]));
  reader = socket.readable.getReader();
  const enc = new TextEncoder();
  const rd = async () => { const { value, done } = await reader.read(); if (done || !value || value.length < 2) throw new Error('S5 closed'); return value; };
  let resp = await rd();
  if (resp[1] === 2) {
    const ub = enc.encode(username || ''), pb = enc.encode(password || '');
    if (ub.length > 255 || pb.length > 255) throw new Error('S5 cred too long');
    await writer.write(new Uint8Array([1, ub.length, ...ub, pb.length, ...pb]));
    resp = await rd();
    if (resp[1] !== 0) throw new Error('S5 auth failed');
  } else if (resp[1] !== 0) throw new Error('S5 method rejected');
  let DST;
  // addrType 为内核内部语义：1=IPv4，3=domain，4=IPv6
  if (addressType === 1) DST = new Uint8Array([1, ...addressRemote.split('.').map(Number)]);
  else if (addressType === 4) {
    const raw = addressRemote.startsWith('[') ? addressRemote.slice(1, -1) : addressRemote;
    const bytes = raw.split(':').flatMap(h => {
      const hh = h.padStart(4, '0');
      return [parseInt(hh.slice(0, 2), 16), parseInt(hh.slice(2, 4), 16)];
    });
    DST = new Uint8Array([4, ...bytes]);
  }
  else { const hb = enc.encode(addressRemote); if (hb.length > 255) throw new Error('S5 host too long'); DST = new Uint8Array([3, hb.length, ...hb]); }
  await writer.write(new Uint8Array([5, 1, 0, ...DST, (portRemote >> 8) & 0xff, portRemote & 0xff]));
  resp = await rd();
  if (resp[1] !== 0) throw new Error('S5 conn failed');
  writer.releaseLock();
  reader.releaseLock();
  return socket;
  } catch (e) {
    try { writer?.releaseLock(); } catch {} try { reader?.releaseLock(); } catch {} try { socket.close(); } catch {}
    throw e;
  }
}

/* ---------- HTTP CONNECT 握手（通过 fetcher.connect；cfg.tls 走 TLS 隧道） ---------- */
async function htConn(fetcher, addressType, addressRemote, portRemote, cfg) {
  const { username, password, hostname, port, tls } = cfg;
  if (/[\s\r\n]/.test(String(addressRemote))) throw new Error('bad target host');   // D6：CONNECT 行注入防护
  const sock = fetcher.connect({ hostname, port }, tls ? { secureTransport: 'on' } : undefined);
  let reader = null;
  try {
  if (sock.opened) await sock.opened;

  let req = `CONNECT ${addressRemote}:${portRemote} HTTP/1.1\r\n` +
            `Host: ${addressRemote}:${portRemote}\r\n`;

  if (username && password) {
    req += `Proxy-Authorization: Basic ${btoa(`${username}:${password}`)}\r\n`;
  }

  req += `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36\r\n` +
         `Connection: keep-alive\r\n\r\n`;

  const writer = sock.writable.getWriter();
  await writer.write(new TextEncoder().encode(req));
  writer.releaseLock();

  reader = sock.readable.getReader();
  let buf = new Uint8Array(0);

  while (true) {
    const { value, done } = await reader.read();
    if (done) throw new Error('Proxy closed unexpectedly');

    const tmp = new Uint8Array(buf.length + value.length);
    tmp.set(buf);
    tmp.set(value, buf.length);
    buf = tmp;
    if (buf.length > 65536) throw new Error('Proxy response too large');
    const txt = new TextDecoder().decode(buf);
    if (txt.includes('\r\n\r\n')) {
      if (/^HTTP\/1\.[01] 2/i.test(txt.split('\r\n')[0])) {
        reader.releaseLock();
        return sock;
      }
      throw new Error(`Proxy refused: ${txt.split('\r\n')[0]}`);
    }
  }
  } catch (e) {
    try { reader?.releaseLock(); } catch {} try { sock.close(); } catch {}
    throw e;
  }
}

/* ---------- TURNS custom TLS compatibility layer ---------- */
const{TlsClient:t}=(()=>{const t=771,s=21,i=22,e=23,n=new TextEncoder,h=new TextDecoder,r=new Uint8Array(0),a=new Map(Object.entries({TLS_AES_128_GCM_SHA256:{id:4865,keyLen:16,ivLen:12,hash:"SHA-256",tls13:!0},TLS_AES_256_GCM_SHA384:{id:4866,keyLen:32,ivLen:12,hash:"SHA-384",tls13:!0},TLS_CHACHA20_POLY1305_SHA256:{id:4867,keyLen:32,ivLen:12,hash:"SHA-256",tls13:!0,chacha:!0},TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256:{id:49199,keyLen:16,ivLen:4,hash:"SHA-256",kex:"ECDHE"},TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384:{id:49200,keyLen:32,ivLen:4,hash:"SHA-384",kex:"ECDHE"},TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256:{id:52392,keyLen:32,ivLen:12,hash:"SHA-256",kex:"ECDHE",chacha:!0},TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256:{id:49195,keyLen:16,ivLen:4,hash:"SHA-256",kex:"ECDHE"},TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384:{id:49196,keyLen:32,ivLen:4,hash:"SHA-384",kex:"ECDHE"},TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256:{id:52393,keyLen:32,ivLen:12,hash:"SHA-256",kex:"ECDHE",chacha:!0}}).map(([,t])=>[t.id,t])),c=new Map([[29,"X25519"],[23,"P-256"]]),l=[2052,2053,2054,1025,1281,1537,1027,1283,1539],o=(...t)=>{const s=t=>{const i=[];for(const e of t)e instanceof Uint8Array?i.push(...e):Array.isArray(e)?i.push(...s(e)):"number"==typeof e&&i.push(e);return i};return new Uint8Array(s(t))},f=t=>[t>>8&255,255&t],u=(t,s)=>t[s]<<8|t[s+1],w=(t,s)=>t[s]<<16|t[s+1]<<8|t[s+2],p=(...t)=>{const s=t.filter(t=>t&&t.length>0),i=s.reduce((t,s)=>t+s.length,0),e=new Uint8Array(i);let n=0;for(const t of s)e.set(t,n),n+=t.length;return e},y=(t,s)=>{if(!t||!s||t.length!==s.length)return!1;let i=0;for(let e=0;e<t.length;e++)i|=t[e]^s[e];return 0===i},g=t=>"SHA-512"===t?64:"SHA-384"===t?48:32;async function k(t,s,i){const e=await crypto.subtle.importKey("raw",s,{name:"HMAC",hash:t},!1,["sign"]);return new Uint8Array(await crypto.subtle.sign("HMAC",e,i))}async function d(t,s){return new Uint8Array(await crypto.subtle.digest(t,s))}async function b(t,s,i,e,h="SHA-256"){const r=p(n.encode(s),i);let a=new Uint8Array(0),c=r;for(;a.length<e;){c=await k(h,t,c);const s=await k(h,t,p(c,r));a=p(a,s)}return a.slice(0,e)}async function A(t,s,i){return s&&s.length||(s=new Uint8Array(g(t))),k(t,s,i)}async function m(t,s,i,e,h){const r=n.encode("tls13 "+i);return async function(t,s,i,e){const n=g(t),h=Math.ceil(e/n);let r=new Uint8Array(0),a=new Uint8Array(0);for(let e=1;e<=h;e++)a=await k(t,s,p(a,i,[e])),r=p(r,a);return r.slice(0,e)}(t,s,o(f(h),r.length,r,e.length,e),h)}async function _(t="P-256"){if("X25519"===t){const t=await crypto.subtle.generateKey({name:"X25519"},!0,["deriveBits"]);return{kp:t,pk:new Uint8Array(await crypto.subtle.exportKey("raw",t.publicKey))}}const s=await crypto.subtle.generateKey({name:"ECDH",namedCurve:t},!0,["deriveBits"]);return{kp:s,pk:new Uint8Array(await crypto.subtle.exportKey("raw",s.publicKey))}}async function H(t,s,i="P-256"){if("X25519"===i){const i=await crypto.subtle.importKey("raw",s,{name:"X25519"},!1,[]);return new Uint8Array(await crypto.subtle.deriveBits({name:"X25519",public:i},t,256))}const e=await crypto.subtle.importKey("raw",s,{name:"ECDH",namedCurve:i},!1,[]),n="P-384"===i?384:"P-521"===i?528:256;return new Uint8Array(await crypto.subtle.deriveBits({name:"ECDH",public:e},t,n))}async function L(t,s,i,e){const n=await crypto.subtle.importKey("raw",t,{name:"AES-GCM"},!1,["encrypt"]);return new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv:s,additionalData:e,tagLength:128},n,i))}async function S(t,s,i,e){const n=await crypto.subtle.importKey("raw",t,{name:"AES-GCM"},!1,["decrypt"]);return new Uint8Array(await crypto.subtle.decrypt({name:"AES-GCM",iv:s,additionalData:e,tagLength:128},n,i))}function U(t,s){return(t<<s|t>>>32-s)>>>0}function C(t,s,i,e,n){t[s]=t[s]+t[i]>>>0,t[n]=U(t[n]^t[s],16),t[e]=t[e]+t[n]>>>0,t[i]=U(t[i]^t[e],12),t[s]=t[s]+t[i]>>>0,t[n]=U(t[n]^t[s],8),t[e]=t[e]+t[n]>>>0,t[i]=U(t[i]^t[e],7)}function E(t,s,i){const e=new Uint32Array(16);e[0]=1634760805,e[1]=857760878,e[2]=2036477234,e[3]=1797285236;const n=new DataView(t.buffer,t.byteOffset,t.byteLength);for(let t=0;t<8;t++)e[4+t]=n.getUint32(4*t,!0);e[12]=s;const h=new DataView(i.buffer,i.byteOffset,i.byteLength);e[13]=h.getUint32(0,!0),e[14]=h.getUint32(4,!0),e[15]=h.getUint32(8,!0);const r=new Uint32Array(e);for(let t=0;t<10;t++)C(r,0,4,8,12),C(r,1,5,9,13),C(r,2,6,10,14),C(r,3,7,11,15),C(r,0,5,10,15),C(r,1,6,11,12),C(r,2,7,8,13),C(r,3,4,9,14);for(let t=0;t<16;t++)r[t]=r[t]+e[t]>>>0;return new Uint8Array(r.buffer.slice(0))}function v(t,s,i){const e=new Uint8Array(i.length);let n=1;for(let h=0;h<i.length;h+=64){const r=E(t,n++,s),a=Math.min(64,i.length-h);for(let t=0;t<a;t++)e[h+t]=i[h+t]^r[t]}return e}function x(t,s){const i=t=>{let s=0n;for(let i=t.length-1;i>=0;i--)s=s<<8n|BigInt(t[i]);return s},e=(1n<<130n)-5n,n=t.slice(0,16),h=i(t.slice(16,32));n[3]&=15,n[7]&=15,n[11]&=15,n[15]&=15,n[4]&=252,n[8]&=252,n[12]&=252;const r=i(n);let a=0n;for(let t=0;t<s.length;t+=16){const n=s.subarray(t,Math.min(t+16,s.length));a=(a+(i(n)+(1n<<BigInt(8*n.length))))*r%e}a=a+h&(1n<<128n)-1n;const c=new Uint8Array(16);for(let t=0;t<16;t++)c[t]=Number(a>>BigInt(8*t)&0xffn);return c}function T(t,s,i,e){const n=E(t,0,s).slice(0,32),h=v(t,s,i),r=(16-e.length%16)%16,a=(16-h.length%16)%16,c=new Uint8Array(e.length+r+h.length+a+16);c.set(e,0),c.set(h,e.length+r);const l=new DataView(c.buffer,e.length+r+h.length+a);l.setBigUint64(0,BigInt(e.length),!0),l.setBigUint64(8,BigInt(h.length),!0);const o=x(n,c);return p(h,o)}function D(t,s,i,e){if(i.length<16)throw 0;const n=i.slice(-16),h=i.slice(0,-16),r=E(t,0,s).slice(0,32),a=(16-e.length%16)%16,c=(16-h.length%16)%16,l=new Uint8Array(e.length+a+h.length+c+16);l.set(e,0),l.set(h,e.length+a);const o=new DataView(l.buffer,e.length+a+h.length+c);o.setBigUint64(0,BigInt(e.length),!0),o.setBigUint64(8,BigInt(h.length),!0);const f=x(r,l);let u=0;for(let t=0;t<16;t++)u|=n[t]^f[t];if(0!==u)throw 0;return v(t,s,h)}function B(s,i,e=t){return o(s,f(e),f(i.length),i)}function M(t,s){return o(t,(t=>[t>>16&255,t>>8&255,255&t])(s.length),s)}class P{constructor(){this.b=new Uint8Array(0)}feed(t){this.b=p(this.b,t)}next(){if(this.b.length<5)return null;const t=this.b[0],s=u(this.b,1),i=u(this.b,3);if(i>18432)throw 0;if(this.b.length<5+i)return null;const e=this.b.slice(5,5+i);return this.b=this.b.slice(5+i),{type:t,version:s,length:i,fragment:e}}}class q{constructor(){this.b=new Uint8Array(0)}feed(t){this.b=p(this.b,t)}next(){if(this.b.length<4)return null;const t=this.b[0],s=w(this.b,1);if(this.b.length<4+s)return null;const i=this.b.slice(4,4+s),e=this.b.slice(0,4+s);return this.b=this.b.slice(4+s),{type:t,length:s,body:i,raw:e}}}function I(t){let s=0;const i=u(t,s);s+=2;const e=t.slice(s,s+32);s+=32;const n=t[s++],r=t.slice(s,s+n);s+=n;const a=u(t,s);s+=2;const c=t[s++];let l=i,o=null,f=null;if(s<t.length){const i=u(t,s);s+=2;const e=s+i;for(;s+4<=e;){const i=u(t,s);s+=2;const e=u(t,s);s+=2;const n=t.slice(s,s+e);if(s+=e,43===i&&e>=2)l=u(n,0);else if(51===i&&e>=4){const t=u(n,0),s=u(n,2);o={group:t,key:n.slice(4,4+s)}}else 16===i&&e>=3&&(f=h.decode(n.slice(3,3+n[2])))}}const w=new Uint8Array([207,33,173,116,229,154,97,17,190,29,140,2,30,101,184,145,194,162,17,22,122,187,140,94,7,158,9,226,200,168,51,156]);return{version:i,sr:e,sid:r,cs:a,comp:c,sv:l,ks:o,alpn:f,isHRR:y(e,w),isTls13:772===l}}function K(t,s=0){let i=0;if(s){const s=t[i++];i+=s}if(i+3>t.length)return null;const e=w(t,i);if(i+=3,!e||i+3>t.length)return null;const n=w(t,i);return i+=3,n?t.slice(i,i+n):null}function G(t){const s={alpn:null};let i=2;const e=2+u(t,0);for(;i+4<=e;){const e=u(t,i);i+=2;const n=u(t,i);if(i+=2,16===e&&n>=3){const e=t[i+2];e>0&&i+3+e<=i+n&&(s.alpn=h.decode(t.slice(i+3,i+3+e)))}i+=n}return s}const R=t=>t&&1===t[0]&&112===t[1];function W(s,i,e,{tls13:h=!0,tls12:r=!0,alpn:a=null}={}){i=(t=>{if("["===(t=String(t??"").trim())[0]&&"]"===t[t.length-1]&&(t=t.slice(1,-1)),!t||t.includes(":"))return"";const s=t.split(".");if(4!==s.length)return t;for(const i of s){if(""===i||i.length>3)return t;let s=0;for(let e=0;e<i.length;e++){const n=i.charCodeAt(e)-48;if(n<0||n>9)return t;s=10*s+n}if(s>255)return t}return""})(i);const c=[];h&&c.push(4865,4866,4867),r&&c.push(49199,49200,52392,49195,49196,52393);const u=o(...c.flatMap(f)),w=[o(255,1,0,1,0)];if(i){const t=n.encode(i),s=o(0,f(t.length),t);w.push(o(f(0),f(s.length+2),f(s.length),s))}w.push(o(f(11),0,2,1,0)),w.push(o(f(10),0,6,0,4,0,29,0,23));const y=o(...l.flatMap(f));w.push(o(f(13),f(y.length+2),f(y.length),y));const g=Array.isArray(a)?a.filter(Boolean):a?[a]:[];if(g.length){const t=p(...g.map(t=>{const s=n.encode(t);return o(s.length,s)}));w.push(o(f(16),f(t.length+2),f(t.length),t))}if(h&&e){let t;if(w.push(r?o(f(43),0,5,4,3,4,3,3):o(f(43),0,3,2,3,4)),w.push(o(f(45),0,2,1,1)),e?.x25519&&e?.p256)t=p(o(0,29,f(e.x25519.length),e.x25519),o(0,23,f(e.p256.length),e.p256));else if(e?.x25519)t=o(0,29,f(e.x25519.length),e.x25519);else if(e?.p256)t=o(0,23,f(e.p256.length),e.p256);else{if(!(e instanceof Uint8Array))throw 0;t=o(0,23,f(e.length),e)}w.push(o(f(51),f(t.length+2),f(t.length),t))}const k=p(...w);return M(1,o(f(t),s,0,f(u.length),u,1,0,f(k.length),k))}const X=t=>{const s=new Uint8Array(8);return new DataView(s.buffer).setBigUint64(0,t,!1),s},O=(t,s)=>{const i=t.slice(),e=X(s);for(let t=0;t<8;t++)i[i.length-8+t]^=e[t];return i},V=(t,s,i,e)=>Promise.all([m(t,s,"key",r,i),m(t,s,"iv",r,e)]),j=t=>{let s=t.length-1;for(;s>=0&&0===t[s];)s--;if(s<0)throw 0;return{data:t.slice(0,s),type:t[s]}},Y=0xffffffffffffffffn;return{TlsClient:class{constructor(t,s={}){this.sk=t,this.sn=s.serverName||"",this.s13=!1!==s.tls13,this.s12=!1!==s.tls12,this.alpn=Array.isArray(s.alpn)?s.alpn:s.alpn?[s.alpn]:null,this.to=s.timeout??3e4,this.cr=crypto.getRandomValues(new Uint8Array(32)),this.sr=null,this.hk=[],this.hc=!1,this.na=null,this.cs=null,this.cc=null,this.is13=!1,this.ms=null,this.hs=null,this.cwk=null,this.swk=null,this.cwi=null,this.swi=null,this.chk=null,this.shk=null,this.chi=null,this.shi=null,this.cak=null,this.sak=null,this.cai=null,this.sai=null,this.cats=null,this.sats=null,this.csn=0n,this.ssn=0n,this.rp=new P,this.hp=new q,this.kps=new Map,this.ekp=null,this.sc=!1,this.pq=[],this.rr=[],this.closed=!1,this.closing=!1,this.failed=!1,this.wq=Promise.resolve(),this.rq=Promise.resolve(),this.cp=null,this.rb=new Uint8Array(65536)}rh(t){this.hk.push(t)}ts(){return 1===this.hk.length?this.hk[0]:p(...this.hk)}gfc(t){return a.get(t)||null}fc(){if(this.csn>Y)throw 0;return this.csn++}fs(){if(this.ssn>Y)throw 0;return this.ssn++}fail(){this.failed=!0,this.closed=!0;try{this.sk.close()}catch{}}async rc(t,s){if(!this.to)return s?t.read(s):t.read();let i;const e=s?t.read(s):t.read(),n=await Promise.race([e,new Promise(t=>i=setTimeout(t,this.to,0))]).finally(()=>clearTimeout(i));if(n)return n;try{await t.cancel("err")}catch{}try{await e}catch{}throw 0}async pr(t,s,i){for(;;){let i;for(;i=this.rp.next();)if(await s(i))return;const{value:e,done:n}=await this.rc(t);if(n)throw 0;this.rp.feed(e)}}async ph(t,e,n){for(let t;t=this.hp.next();)if(await e(t))return;return this.pr(t,async t=>{if(t.type===s){if(R(t.fragment))return;throw 0}if(t.type===i){this.hp.feed(t.fragment);for(let t;t=this.hp.next();)if(await e(t))return 1}},n)}async ac(t){if(!t?.length)throw 0;this.sc=!0}async handshake(){const[t,s]=await Promise.all([_("P-256"),_("X25519")]);this.kps=new Map([[23,t],[29,s]]),this.ekp=t.kp;const e=this.sk.readable.getReader(),n=this.sk.writable.getWriter();try{const h=W(this.cr,this.sn,{x25519:s.pk,p256:t.pk},{tls13:this.s13,tls12:this.s12,alpn:this.alpn});this.rh(h),await n.write(B(i,h,769));const r=await this.rsh(e);if(r.isHRR)throw 0;if(r.ks?.group&&this.kps.has(r.ks.group)){const t=this.kps.get(r.ks.group);this.ekp=t.kp}r.isTls13?await this.h13(e,n,r):await this.h12(e,n),this.hc=!0}finally{e.releaseLock(),n.releaseLock()}}async rsh(t){for(;;){const{value:e,done:n}=await this.rc(t);if(n)throw 0;let h;for(this.rp.feed(e);h=this.rp.next();){if(h.type===s){if(R(h.fragment))continue;throw 0}if(h.type!==i)continue;let t;for(this.hp.feed(h.fragment);t=this.hp.next();){if(2!==t.type)continue;this.rh(t.raw);const s=I(t.body),i=this.gfc(s.cs);if(!i||s.comp||s.isTls13!==!!i.tls13||s.isTls13&&!this.s13||!s.isTls13&&(!this.s12||771!==s.sv))throw 0;return this.sr=s.sr,this.cs=s.cs,this.cc=i,this.is13=s.isTls13,this.na=s.alpn||null,s}}}}async h12(t,e){let n=null,h=!1;if(await this.ph(t,async t=>{switch(t.type){case 11:{this.rh(t.raw);const s=K(t.body);if(!s)throw 0;await this.ac(s);break}case 12:this.rh(t.raw),n=function(t){let s=0;s++;const i=u(t,s);s+=2;const e=t[s++];return{nc:i,spk:t.slice(s,s+e)}}(t.body);break;case 14:return this.rh(t.raw),h=!0,1;case 13:throw 0;default:this.rh(t.raw)}},"err"),!this.sc)throw 0;if(!n)throw 0;const r=c.get(n.nc);if(!r)throw 0;const a=this.kps.get(n.nc);if(!a)throw 0;const l=await H(a.kp.privateKey,n.spk,r),f=M(16,o(a.pk.length,a.pk));this.rh(f);const g=this.cc.hash;this.ms=await b(l,"master secret",p(this.cr,this.sr),48,g);const k=this.cc.keyLen,A=this.cc.ivLen,m=await b(this.ms,"key expansion",p(this.sr,this.cr),2*k+2*A,g);this.cwk=m.slice(0,k),this.swk=m.slice(k,2*k),this.cwi=m.slice(2*k,2*k+A),this.swi=m.slice(2*k+A,2*k+2*A),await e.write(B(i,f)),await e.write(B(20,o(1)));const _=M(20,await b(this.ms,"client finished",await d(g,this.ts()),12,g));this.rh(_),await e.write(B(i,await this.e12(_,i)));let L=!1;await this.pr(t,async t=>{if(t.type===s){if(R(t.fragment))return;throw 0}if(20===t.type)return void(L=!0);if(t.type!==i||!L)return;const e=await this.d12(t.fragment,i);if(20!==e[0])return;const n=w(e,1),h=e.slice(4,4+n),r=await b(this.ms,"server finished",await d(g,this.ts()),12,g);if(!y(h,r))throw 0;return 1},"err")}async h13(t,n,h){const a=c.get(h.ks?.group);if(!a||!h.ks?.key?.length)throw 0;const l=this.cc.hash,o=g(l),f=this.cc.keyLen,u=this.cc.ivLen,w=await H(this.ekp.privateKey,h.ks.key,a),b=await A(l,null,new Uint8Array(o)),_=await m(l,b,"derived",await d(l,r),o);this.hs=await A(l,_,w);const L=await d(l,this.ts()),S=await m(l,this.hs,"c hs traffic",L,o),U=await m(l,this.hs,"s hs traffic",L,o);[this.chk,this.chi]=await V(l,S,f,u),[this.shk,this.shi]=await V(l,U,f,u);const C=await m(l,U,"finished",r,o);let E=!1;const v=async t=>{switch(t.type){case 8:{const s=G(t.body);s.alpn&&(this.na=s.alpn),this.rh(t.raw);break}case 11:{const s=K(t.body,1);if(!s)throw 0;await this.ac(s),this.rh(t.raw);break}case 13:throw 0;case 15:default:this.rh(t.raw);break;case 20:{const s=await k(l,C,await d(l,this.ts()));if(!y(s,t.body))throw 0;this.rh(t.raw),E=!0;break}}};await this.pr(t,async t=>{if(20===t.type||t.type===i)return;if(t.type===s){if(R(t.fragment))return;throw 0}if(t.type!==e)return;const{data:n,type:h}=await this.d13h(t.fragment),r=n;if(h===i){this.hp.feed(r);for(let t;t=this.hp.next();)if(await v(t),E)return 1}},"err");const x=await d(l,this.ts()),T=await m(l,this.hs,"derived",await d(l,r),o),D=await A(l,T,new Uint8Array(o)),P=await m(l,D,"c ap traffic",x,o),q=await m(l,D,"s ap traffic",x,o);this.cats=P,this.sats=q,[this.cak,this.cai]=await V(l,P,f,u),[this.sak,this.sai]=await V(l,q,f,u);const I=await m(l,S,"finished",r,o),W=M(20,await k(l,I,await d(l,this.ts())));this.rh(W),await n.write(B(e,await this.e13h(p(W,[i])))),this.csn=0n,this.ssn=0n}async e12(s,i,e=this.fc()){const n=X(e),h=p(n,[i],f(t),f(s.length));if(this.cc.chacha){const t=O(this.cwi,e);return T(this.cwk,t,s,h)}const r=n;return p(r,await L(this.cwk,p(this.cwi,r),s,h))}async d12(s,i,e=this.fs()){const n=X(e);if(this.cc.chacha){const h=O(this.swi,e);return D(this.swk,h,s,p(n,[i],f(t),f(s.length-16)))}const h=s.slice(0,8),r=s.slice(8);return S(this.swk,p(this.swi,h),r,p(n,[i],f(t),f(r.length-16)))}async e13h(t){const s=O(this.chi,this.fc()),i=o(e,3,3,f(t.length+16));return this.cc.chacha?T(this.chk,s,t,i):L(this.chk,s,t,i)}async d13h(t){const s=O(this.shi,this.fs()),i=o(e,3,3,f(t.length)),n=this.cc.chacha?D(this.shk,s,t,i):await S(this.shk,s,t,i);return j(n)}async e13(t,s=this.fc(),i=e){const n=p(t,[i]),h=O(this.cai,s),r=o(e,3,3,f(n.length+16));return this.cc.chacha?T(this.cak,h,n,r):L(this.cak,h,n,r)}async d13(t,s=this.fs(),i=this.sak,n=this.sai){const h=O(n,s),r=o(e,3,3,f(t.length)),a=this.cc.chacha?D(i,h,t,r):await S(i,h,t,r);return j(a)}write(t){if(!this.hc||this.failed||this.closing)return Promise.reject(0);const s=this.wq.then(()=>this._write(t)).catch(t=>{throw this.fail(),t});return this.wq=s.catch(()=>{}),s}async _write(t){if(this.failed||this.closing)throw 0;const s=this.sk.writable.getWriter();try{if(t.length<=16384)await s.write(B(e,this.is13?await this.e13(t):await this.e12(t,e)));else for(let i=0;i<t.length;){const n=[];for(let s=0;s<8&&i<t.length;s++,i+=16384){const s=t.subarray(i,Math.min(i+16384,t.length)),h=this.fc();n.push(this.is13?this.e13(s,h).then(t=>B(e,t)):this.e12(s,e,h).then(t=>B(e,t)))}await s.write(p(...await Promise.all(n)))}}finally{s.releaseLock()}}read(){if(this.failed)return Promise.reject(0);const t=this.rq.then(()=>this._read()).catch(t=>{throw this.fail(),t});return this.rq=t.catch(()=>{}),t}async _read(){for(;;){if(this.pq.length)return this.pq.shift();if(this.closed)return null;const t=[];let n;for(;t.length<8&&(n=this.rr.length?this.rr.shift():this.rp.next());){if(this.is13){if(20===n.type)continue;if(n.type!==e)throw 0}else if(n.type!==e&&n.type!==s&&n.type!==i)throw 0;t.push(n)}if(t.length){if(this.is13){const s=this.ssn,i=this.sak,e=this.sai;if(s+BigInt(t.length-1)>Y)throw 0;let n;try{n=await Promise.all(t.map((t,n)=>this.d13(t.fragment,s+BigInt(n),i,e)))}catch{n=null}if(n)for(let i=0;i<n.length;i++){this.ssn=s+BigInt(i+1);const e=await this.p13(n[i]);if(null!==e){i+1<t.length&&this.rr.unshift(...t.slice(i+1));const s=1===e?this.qku():null;await this.usr(),s&&await s;break}}else for(let s=0;s<t.length;s++){const i=await this.d13(t[s].fragment,this.ssn);this.ssn++;const e=await this.p13(i);if(null!==e){s+1<t.length&&this.rr.unshift(...t.slice(s+1));const i=1===e?this.qku():null;await this.usr(),i&&await i;break}}}else{const s=this.ssn;if(s+BigInt(t.length-1)>Y)throw 0;const i=await Promise.all(t.map((t,i)=>this.d12(t.fragment,t.type,s+BigInt(i))));this.ssn=s+BigInt(t.length);for(let s=0;s<i.length;s++)this.pt(i[s],t[s].type)}if(this.pq.length)return this.pq.shift();if(this.closed)return null;continue}if(this.closed)return null;const h=this.sk.readable.getReader({mode:"byob"});try{const{value:t,done:s}=await this.rc(h,this.rb);if(s)return null;t.length>49152?(this.rp.feed(t.subarray()),this.rb=new Uint8Array(65536)):(this.rp.feed(t.slice()),this.rb=new Uint8Array(t.buffer))}finally{h.releaseLock()}}}pt(t,n){if(n===e)this.pq.push(t);else if(n===s)this.pa(t);else if(n===i){let s;for(this.hp.feed(t);s=this.hp.next();)if(24===s.type)throw 0}}pa(t){if(2!==t.length)throw 0;if(0!==t[1])throw 0;this.closed=!0,this.close()}async p13({data:t,type:n}){if(n===e)return this.pq.push(t),null;if(n===s)return this.pa(t),null;if(n!==i)throw 0;let h,r=null;for(this.hp.feed(t);h=this.hp.next();)if(4!==h.type&&24===h.type){if(1!==h.body.length||h.body[0]>1||null!==r)throw 0;r=h.body[0]}return r}async usr(){const t=this.cc.hash,s=g(t);this.sats=await m(t,this.sats,"traffic upd",r,s),[this.sak,this.sai]=await V(t,this.sats,this.cc.keyLen,this.cc.ivLen),this.ssn=0n}qku(){const t=this.wq.then(()=>this.sku()).catch(t=>{throw this.fail(),t});return this.wq=t.catch(()=>{}),t}async sku(){if(this.failed||this.closing)throw 0;const t=this.sk.writable.getWriter();try{const s=M(24,o(0));await t.write(B(e,await this.e13(s,this.fc(),i)))}finally{t.releaseLock()}const s=this.cc.hash,n=g(s);this.cats=await m(s,this.cats,"traffic upd",r,n),[this.cak,this.cai]=await V(s,this.cats,this.cc.keyLen,this.cc.ivLen),this.csn=0n}close(){if(this.cp)return this.cp;if(this.failed||!this.hc){try{this.sk.close()}catch{}return this.cp=Promise.resolve()}this.closing=!0;const t=this.wq.then(async()=>{const t=this.sk.writable.getWriter();try{const i=o(1,0),n=this.is13?await this.e13(i,this.fc(),s):await this.e12(i,s);await t.write(B(this.is13?e:s,n))}finally{t.releaseLock()}});return this.cp=t.catch(()=>{}).finally(()=>{this.closed=!0;try{this.sk.close()}catch{}}),this.wq=this.cp,this.cp}}}})();
// 修复（第七轮实测发现）：上一行把 class 解构到局部名 `t`，模块内并不存在 `TlsClient` 标识符
// （实测 `typeof TlsClient === 'undefined'`）→ 原 `_turnOpenCustomTls`（`new TlsClient(...)`）一旦被调用即抛 ReferenceError。
// 补一个可读别名，同时修好该既有缺陷与 admin/check 的 TLS 路径。
const TlsClient = t;

/* ---------- shared TURN/TURNS TCP relay (RFC 6062) ---------- */
const TURN_CONNECT_TIMEOUT_MS = 10000;
const TURN_DNS_TTL_MS = 180000;
const TURN_DNS_NEGATIVE_TTL_MS = 30000;
const TURN_DNS_CACHE_LIMIT = 400;
const TURN_MAGIC = new Uint8Array([0x21, 0x12, 0xa4, 0x42]);
const TURN_TYPE = {
  ALLOCATE_REQUEST: 0x0003,
  ALLOCATE_SUCCESS: 0x0103,
  REFRESH_REQUEST: 0x0004,
  REFRESH_SUCCESS: 0x0104,
  CREATE_PERMISSION_REQUEST: 0x0008,
  CREATE_PERMISSION_SUCCESS: 0x0108,
  CONNECT_REQUEST: 0x000a,
  CONNECT_SUCCESS: 0x010a,
  CONNECTION_BIND_REQUEST: 0x000b,
  CONNECTION_BIND_SUCCESS: 0x010b
};
const TURN_ATTR = {
  USERNAME: 0x0006,
  MESSAGE_INTEGRITY: 0x0008,
  ERROR_CODE: 0x0009,
  LIFETIME: 0x000d,
  XOR_PEER_ADDRESS: 0x0012,
  REALM: 0x0014,
  NONCE: 0x0015,
  REQUESTED_TRANSPORT: 0x0019,
  CONNECTION_ID: 0x002a
};
const _turnEncoder = new TextEncoder();
const _turnDecoder = new TextDecoder();
const _turnDnsCache = new Map();
const _turnDnsPending = new Map();
const _turnDnsEndpoints = [
  'https://dns.alidns.com/resolve',
  'https://cloudflare-dns.com/dns-query',
  'https://dns.google/resolve'
];

const _turnConcat = (...chunks) => {
  const size = chunks.reduce((sum, chunk) => sum + (chunk?.byteLength || 0), 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    if (!chunk?.byteLength) continue;
    const bytes = chunk instanceof Uint8Array
      ? chunk
      : new Uint8Array(chunk.buffer || chunk, chunk.byteOffset || 0, chunk.byteLength);
    out.set(bytes, offset);
    offset += bytes.byteLength;
  }
  return out;
};

const _turnToBytes = value => value instanceof Uint8Array
  ? value
  : ArrayBuffer.isView(value)
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : new Uint8Array(value);

const _turnEqual = (left, right) => {
  if (!left || !right || left.byteLength !== right.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < left.byteLength; i++) diff |= left[i] ^ right[i];
  return diff === 0;
};

const _turnWithTimeout = (promise, message, timeout = TURN_CONNECT_TIMEOUT_MS) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeout);
    })
  ]).finally(() => clearTimeout(timer));
};

const _turnStripBrackets = value => {
  const text = String(value || '').trim();
  return text.startsWith('[') && text.endsWith(']') ? text.slice(1, -1) : text;
};

const _turnIsIPv4 = value => {
  const parts = String(value || '').split('.');
  return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
};

const _turnIPv6Bytes = value => {
  let text = _turnStripBrackets(value).toLowerCase();
  if (!text.includes(':')) throw new Error('TURN invalid IPv6');
  if (text.includes('.')) {
    const index = text.lastIndexOf(':');
    const ipv4 = text.slice(index + 1);
    if (!_turnIsIPv4(ipv4)) throw new Error('TURN invalid IPv6');
    const octets = ipv4.split('.').map(Number);
    text = text.slice(0, index) + ':' +
      ((octets[0] << 8) | octets[1]).toString(16) + ':' +
      ((octets[2] << 8) | octets[3]).toString(16);
  }
  const sides = text.split('::');
  if (sides.length > 2) throw new Error('TURN invalid IPv6');
  const left = sides[0] ? sides[0].split(':') : [];
  const right = sides[1] ? sides[1].split(':') : [];
  if (sides.length === 1 && left.length !== 8) throw new Error('TURN invalid IPv6');
  if (left.length + right.length > 8) throw new Error('TURN invalid IPv6');
  const groups = sides.length === 2
    ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
    : left;
  if (groups.length !== 8) throw new Error('TURN invalid IPv6');
  const out = new Uint8Array(16);
  groups.forEach((group, index) => {
    if (!/^[0-9a-f]{1,4}$/i.test(group || '0')) throw new Error('TURN invalid IPv6');
    const number = parseInt(group || '0', 16);
    out[index * 2] = number >> 8;
    out[index * 2 + 1] = number & 0xff;
  });
  return out;
};

const _turnIsIPv6 = value => {
  try {
    _turnIPv6Bytes(value);
    return true;
  } catch {
    return false;
  }
};

const _turnParseHostPort = (value, defaultPort) => {
  const text = String(value || '').trim();
  if (!text) return ['', defaultPort];
  if (text.startsWith('[')) {
    const match = text.match(/^\[([^\]]+)\](?::(\d+))?$/);
    return match ? [match[1], Number(match[2] || defaultPort)] : ['', defaultPort];
  }
  const colonCount = (text.match(/:/g) || []).length;
  if (colonCount > 1) return [text, defaultPort];
  const index = text.lastIndexOf(':');
  if (index > 0 && /^\d+$/.test(text.slice(index + 1))) {
    return [text.slice(0, index), Number(text.slice(index + 1))];
  }
  return [text, defaultPort];
};

const _turnDecodeBase64 = value => {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + (4 - normalized.length % 4) % 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return _turnDecoder.decode(bytes);
};

const _turnParseEndpoint = (value, tls) => {
  let text = String(value || '').trim().replace(/^(?:turns?):\/\//i, '');
  if (!text || text.includes(',')) throw new Error('TURN only one server is supported');
  const at = text.lastIndexOf('@');
  let auth = at >= 0 ? text.slice(0, at) : '';
  let hostPort = at >= 0 ? text.slice(at + 1) : text;
  try { auth = decodeURIComponent(auth); } catch {}
  try { hostPort = decodeURIComponent(hostPort); } catch {}
  let username = null;
  let password = null;
  if (auth) {
    if (!auth.includes(':')) {
      try {
        const decoded = _turnDecodeBase64(auth);
        if (decoded.includes(':')) auth = decoded;
      } catch {}
    }
    const separator = auth.indexOf(':');
    if (separator < 0) throw new Error('TURN invalid credentials');
    username = auth.slice(0, separator);
    password = auth.slice(separator + 1);
  }
  const [hostname, port] = _turnParseHostPort(hostPort, tls ? 5349 : 3478);
  if (!hostname || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('TURN invalid server');
  }
  return { hostname: _turnStripBrackets(hostname), port, username, password, tls };
};

function parseTurnProxyConfig(value) {
  let text = String(value || '');
  for (let i = 0; i < 2; i++) {
    try {
      const decoded = decodeURIComponent(text);
      if (decoded === text) break;
      text = decoded;
    } catch {
      break;
    }
  }
  const match = text.match(/(?:^|\/)(turns?)(?:(:\/\/)|=)(?:(turns?):\/\/)?([^?#\s]+)/i);
  if (!match) return null;
  const tls = (match[3] || match[1]).toLowerCase() === 'turns';
  return {
    cfg: _turnParseEndpoint(match[4], tls),
    global: Boolean(match[2])
  };
}

const _turnCacheSet = (key, value, ttl) => {
  if (!_turnDnsCache.has(key) && _turnDnsCache.size >= TURN_DNS_CACHE_LIMIT) {
    _turnDnsCache.delete(_turnDnsCache.keys().next().value);
  }
  _turnDnsCache.set(key, { value, expires: Date.now() + ttl });
};

const _turnQueryDns = async (hostname, type) => {
  const key = type + ':' + hostname.toLowerCase();
  const cached = _turnDnsCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  if (cached) _turnDnsCache.delete(key);
  if (_turnDnsPending.has(key)) return _turnDnsPending.get(key);
  const pending = (async () => {
    const recordType = type === 'AAAA' ? 28 : 1;
    for (const endpoint of _turnDnsEndpoints) {
      try {
        const response = await _turnWithTimeout(fetch(
          endpoint + '?name=' + encodeURIComponent(hostname) + '&type=' + type,
          { headers: { Accept: 'application/dns-json' } }
        ), 'TURN DNS request timed out');
        if (!response.ok) continue;
        const data = await _turnWithTimeout(response.json(), 'TURN DNS body timed out');
        const values = (data.Answer || data.answer || [])
          .filter(record => Number(record.type) === recordType)
          .map(record => String(record.data || '').replace(/\.$/, ''))
          .filter(value => type === 'A' ? _turnIsIPv4(value) : _turnIsIPv6(value));
        if (values.length) {
          _turnCacheSet(key, values, TURN_DNS_TTL_MS);
          return values;
        }
      } catch {}
    }
    _turnCacheSet(key, [], TURN_DNS_NEGATIVE_TTL_MS);
    return [];
  })();
  _turnDnsPending.set(key, pending);
  try {
    return await pending;
  } finally {
    _turnDnsPending.delete(key);
  }
};

const _turnResolveTarget = async (hostname, familyHint) => {
  const host = _turnStripBrackets(hostname);
  if (_turnIsIPv4(host)) return [{ address: host, family: 'ipv4' }];
  if (_turnIsIPv6(host)) return [{ address: host, family: 'ipv6' }];
  const wants4 = familyHint !== 'ipv6';
  const wants6 = familyHint !== 'ipv4';
  const [ipv4, ipv6] = await Promise.all([
    wants4 ? _turnQueryDns(host, 'A') : Promise.resolve([]),
    wants6 ? _turnQueryDns(host, 'AAAA') : Promise.resolve([])
  ]);
  return [
    ...ipv4.map(address => ({ address, family: 'ipv4' })),
    ...ipv6.map(address => ({ address, family: 'ipv6' }))
  ];
};

const _turnOpenNative = async (openSocket, hostname, port, tls) => {
  const socket = openSocket(
    { hostname, port },
    tls ? { secureTransport: 'on' } : undefined
  );
  if (socket.opened) {
    try { await _turnWithTimeout(socket.opened, tls ? 'TURNS TLS connection timed out' : 'TURN connection timed out'); }
    catch (e) { try { socket.close(); } catch {} throw e; }   // F4：超时/握手失败不留半开 socket
  }
  return socket;
};

const _turnOpenCustomTls = async (openSocket, hostname, port) => {
  const raw = await _turnOpenNative(openSocket, hostname, port, false);
  const client = new TlsClient(raw, {
    serverName: _turnIsIPv4(hostname) || _turnIsIPv6(hostname) ? '' : hostname,
    timeout: TURN_CONNECT_TIMEOUT_MS
  });
  try {
    await _turnWithTimeout(client.handshake(), 'TURNS custom TLS handshake timed out');
  } catch (error) {
    try { raw.close(); } catch {}
    throw error;
  }
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try { client.close(); } catch {}
    try { raw.close(); } catch {}
  };
  const readable = new ReadableStream({
    async pull(controller) {
      try {
        const value = await client.read();
        if (value === null) {
          controller.close();
          close();
        } else if (value?.byteLength) {
          controller.enqueue(value);
        }
      } catch (error) {
        try { controller.error(error); } catch {}
        close();
      }
    },
    cancel: close
  });
  const writable = new WritableStream({
    write(chunk) {
      return client.write(_turnToBytes(chunk));
    },
    close,
    abort: close
  });
  return {
    readable,
    writable,
    opened: Promise.resolve(),
    closed: raw.closed,
    close
  };
};

const _turnOpenTransport = async (openSocket, cfg) => {
  if (!cfg.tls) return _turnOpenNative(openSocket, cfg.hostname, cfg.port, false);
  // F2：域名 TURNS 只走运行时原生 TLS（校验证书）；失败即失败，不降级到不校验证书的自实现 TLS。
  //     IP 字面量目标无 SNI/主机名可校验，运行时原生 TLS 通常握手失败 → 才使用自实现（README 已标注该形态不校验证书链）。
  if (!_turnIsIPv4(cfg.hostname) && !_turnIsIPv6(cfg.hostname)) return _turnOpenNative(openSocket, cfg.hostname, cfg.port, true);
  return _turnOpenCustomTls(openSocket, cfg.hostname, cfg.port);
};

const _turnPad = length => -length & 3;

const _turnAttribute = (type, value) => {
  const bytes = _turnToBytes(value);
  const out = new Uint8Array(4 + bytes.byteLength + _turnPad(bytes.byteLength));
  const view = new DataView(out.buffer);
  view.setUint16(0, type);
  view.setUint16(2, bytes.byteLength);
  out.set(bytes, 4);
  return out;
};

const _turnRandomId = () => crypto.getRandomValues(new Uint8Array(12));

const _turnMessage = (type, id, attributes) => {
  const body = _turnConcat(...attributes);
  const header = new Uint8Array(20);
  const view = new DataView(header.buffer);
  view.setUint16(0, type);
  view.setUint16(2, body.byteLength);
  header.set(TURN_MAGIC, 4);
  header.set(id, 8);
  return _turnConcat(header, body);
};

const _turnParseMessage = data => {
  if (data.byteLength < 20) throw new Error('TURN short response');
  if (TURN_MAGIC.some((value, index) => data[4 + index] !== value)) {
    throw new Error('TURN invalid magic cookie');
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const bodyLength = view.getUint16(2);
  if (20 + bodyLength !== data.byteLength || bodyLength % 4) {
    throw new Error('TURN invalid response length');
  }
  const attributes = new Map();
  for (let offset = 20; offset + 4 <= data.byteLength;) {
    const type = view.getUint16(offset);
    const length = view.getUint16(offset + 2);
    if (offset + 4 + length > data.byteLength) throw new Error('TURN invalid attribute');
    attributes.set(type, data.slice(offset + 4, offset + 4 + length));
    offset += 4 + length + _turnPad(length);
  }
  return {
    type: view.getUint16(0),
    id: data.slice(8, 20),
    attributes
  };
};

const _turnReadMessage = async (context, label) => {
  const pull = async () => {
    const { value, done } = await _turnWithTimeout(context.reader.read(), label);
    if (done || !value) throw new Error('TURN server closed connection');
    context.buffer = _turnConcat(context.buffer, _turnToBytes(value));
  };
  while (context.buffer.byteLength < 20) await pull();
  const size = 20 + ((context.buffer[2] << 8) | context.buffer[3]);
  if (size > 65555) throw new Error('TURN response too large');
  while (context.buffer.byteLength < size) await pull();
  const message = _turnParseMessage(context.buffer.slice(0, size));
  context.buffer = context.buffer.byteLength > size
    ? context.buffer.slice(size)
    : new Uint8Array(0);
  return message;
};

const _turnSignMessage = async (message, key) => {
  const signed = new Uint8Array(message);
  const view = new DataView(signed.buffer);
  view.setUint16(2, view.getUint16(2) + 24);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, signed));
  return _turnConcat(signed, _turnAttribute(TURN_ATTR.MESSAGE_INTEGRITY, signature));
};

const _turnErrorCode = value => value?.byteLength >= 4
  ? (value[2] & 7) * 100 + value[3]
  : 0;

const _turnUint32 = value => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0);
  return out;
};

const _turnAuthAttributes = auth => auth.key
  ? [
      _turnAttribute(TURN_ATTR.USERNAME, _turnEncoder.encode(auth.username)),
      _turnAttribute(TURN_ATTR.REALM, _turnEncoder.encode(auth.realm)),
      _turnAttribute(TURN_ATTR.NONCE, auth.nonce)
    ]
  : [];

const _turnUpdateAuth = async (auth, cfg, message) => {
  const nonce = message.attributes.get(TURN_ATTR.NONCE);
  const realmBytes = message.attributes.get(TURN_ATTR.REALM);
  if (!nonce?.byteLength) throw new Error('TURN authentication nonce missing');
  const realm = realmBytes?.byteLength ? _turnDecoder.decode(realmBytes) : auth.realm;
  if (!realm) throw new Error('TURN authentication realm missing');
  if (cfg.username == null || cfg.password == null) {
    throw new Error('TURN credentials required');
  }
  auth.username = cfg.username;
  auth.realm = realm;
  auth.nonce = nonce;
  auth.key = new Uint8Array(await crypto.subtle.digest(
    'MD5',
    _turnEncoder.encode(cfg.username + ':' + realm + ':' + cfg.password)
  ));
};

const _turnPeerValue = (address, port, id) => {
  const raw = _turnIsIPv4(address)
    ? new Uint8Array(address.split('.').map(Number))
    : _turnIPv6Bytes(address);
  const mask = _turnConcat(TURN_MAGIC, id);
  const value = new Uint8Array(4 + raw.byteLength);
  value[1] = raw.byteLength === 4 ? 1 : 2;
  new DataView(value.buffer).setUint16(2, port ^ 0x2112);
  for (let i = 0; i < raw.byteLength; i++) value[4 + i] = raw[i] ^ mask[i];
  return value;
};

const _turnExchange = async (
  context,
  cfg,
  requestType,
  successType,
  createAttributes,
  options = {}
) => {
  const signed = options.signed !== false;
  const allowError = Boolean(options.allowError);
  const retryStale = options.retryStale !== false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const id = _turnRandomId();
    const attributes = [
      ...(createAttributes ? createAttributes(id) : []),
      ...(signed ? _turnAuthAttributes(context.auth) : [])
    ];
    let request = _turnMessage(requestType, id, attributes);
    if (signed && context.auth.key) request = await _turnSignMessage(request, context.auth.key);
    await _turnWithTimeout(context.writer.write(request), 'TURN request timed out');
    for (let skipped = 0; skipped < 16; skipped++) {
      const response = await _turnReadMessage(context, 'TURN response timed out');
      if (!_turnEqual(response.id, id)) continue;
      if (response.type === successType) return { ok: true, message: response };
      if (response.type === (successType | 0x0010)) {
        const code = _turnErrorCode(response.attributes.get(TURN_ATTR.ERROR_CODE));
        if (code === 438 && retryStale && attempt === 0) {
          await _turnUpdateAuth(context.auth, cfg, response);
          break;
        }
        if (allowError) return { ok: false, code, message: response };
        throw new Error('TURN request failed: ' + (code || response.type));
      }
      throw new Error('TURN unexpected response: ' + response.type);
    }
  }
  throw new Error('TURN transaction did not complete');
};

const _turnLifetime = message => {
  const value = message.attributes.get(TURN_ATTR.LIFETIME);
  return value?.byteLength === 4
    ? new DataView(value.buffer, value.byteOffset, value.byteLength).getUint32(0)
    : 600;
};

async function _turnConnectSingle(openSocket, cfg, targetAddress, targetPort) {
  let controlSocket = null;
  let dataSocket = null;
  let controlReader = null;
  let controlWriter = null;
  let dataReader = null;
  let dataWriter = null;
  let refreshTimer = null;
  let closed = false;
  let resolveClosed;
  const closedPromise = new Promise(resolve => { resolveClosed = resolve; });
  const close = () => {
    if (closed) return;
    closed = true;
    if (refreshTimer) clearTimeout(refreshTimer);
    try { controlReader?.cancel(); } catch {}
    try { dataReader?.cancel(); } catch {}
    try { controlReader?.releaseLock(); } catch {}
    try { controlWriter?.releaseLock(); } catch {}
    try { dataReader?.releaseLock(); } catch {}
    try { dataWriter?.releaseLock(); } catch {}
    try { controlSocket?.close(); } catch {}
    try { dataSocket?.close(); } catch {}
    resolveClosed();
  };
  try {
    controlSocket = await _turnOpenTransport(openSocket, cfg);
    controlWriter = controlSocket.writable.getWriter();
    controlReader = controlSocket.readable.getReader();
    const auth = { key: null, username: null, realm: '', nonce: null };
    const control = {
      reader: controlReader,
      writer: controlWriter,
      buffer: new Uint8Array(0),
      auth
    };
    const requestedTransport = _turnAttribute(
      TURN_ATTR.REQUESTED_TRANSPORT,
      new Uint8Array([6, 0, 0, 0])
    );
    let allocate = await _turnExchange(
      control,
      cfg,
      TURN_TYPE.ALLOCATE_REQUEST,
      TURN_TYPE.ALLOCATE_SUCCESS,
      () => [requestedTransport],
      { signed: false, allowError: true, retryStale: false }
    );
    if (!allocate.ok) {
      if (allocate.code !== 401) throw new Error('TURN Allocate failed: ' + allocate.code);
      await _turnUpdateAuth(auth, cfg, allocate.message);
      allocate = await _turnExchange(
        control,
        cfg,
        TURN_TYPE.ALLOCATE_REQUEST,
        TURN_TYPE.ALLOCATE_SUCCESS,
        () => [requestedTransport]
      );
    }
    const lifetime = _turnLifetime(allocate.message);
    const peerAttributes = id => [
      _turnAttribute(TURN_ATTR.XOR_PEER_ADDRESS, _turnPeerValue(targetAddress, targetPort, id))
    ];
    await _turnExchange(
      control,
      cfg,
      TURN_TYPE.CREATE_PERMISSION_REQUEST,
      TURN_TYPE.CREATE_PERMISSION_SUCCESS,
      peerAttributes
    );
    const connected = await _turnExchange(
      control,
      cfg,
      TURN_TYPE.CONNECT_REQUEST,
      TURN_TYPE.CONNECT_SUCCESS,
      peerAttributes
    );
    const connectionId = connected.message.attributes.get(TURN_ATTR.CONNECTION_ID);
    if (!connectionId?.byteLength) throw new Error('TURN Connection ID missing');

    dataSocket = await _turnOpenTransport(openSocket, cfg);
    dataWriter = dataSocket.writable.getWriter();
    dataReader = dataSocket.readable.getReader();
    const dataContext = {
      reader: dataReader,
      writer: dataWriter,
      buffer: new Uint8Array(0),
      auth
    };
    await _turnExchange(
      dataContext,
      cfg,
      TURN_TYPE.CONNECTION_BIND_REQUEST,
      TURN_TYPE.CONNECTION_BIND_SUCCESS,
      () => [_turnAttribute(TURN_ATTR.CONNECTION_ID, connectionId)]
    );
    const firstPayload = dataContext.buffer;
    dataContext.buffer = new Uint8Array(0);

    const scheduleRefresh = () => {
      if (closed) return;
      const delay = Math.max(30000, Math.min(Math.floor(lifetime * 500), 300000));
      refreshTimer = setTimeout(async () => {
        try {
          await _turnExchange(
            control,
            cfg,
            TURN_TYPE.REFRESH_REQUEST,
            TURN_TYPE.REFRESH_SUCCESS,
            () => [_turnAttribute(TURN_ATTR.LIFETIME, _turnUint32(lifetime))]
          );
          scheduleRefresh();
        } catch {
          close();
        }
      }, delay);
    };
    scheduleRefresh();

    const readable = new ReadableStream({
      start(controller) {
        if (firstPayload?.byteLength) controller.enqueue(firstPayload);
      },
      async pull(controller) {
        try {
          const { value, done } = await dataReader.read();
          if (done) {
            controller.close();
            close();
          } else if (value?.byteLength) {
            controller.enqueue(_turnToBytes(value));
          }
        } catch (error) {
          try { controller.error(error); } catch {}
          close();
        }
      },
      cancel: close
    });
    const writable = new WritableStream({
      async write(chunk) {
        if (closed) throw new Error('TURN connection closed');
        try {
          await dataWriter.write(_turnToBytes(chunk));
        } catch (error) {
          close();
          throw error;
        }
      },
      close: () => dataWriter.close().catch(() => {}),   // F3：半关闭数据侧，读方向继续（对齐原生 socket 语义）
      abort: close
    });
    return {
      readable,
      writable,
      opened: Promise.resolve(),
      closed: closedPromise,
      close
    };
  } catch (error) {
    close();
    throw error;
  }
}

const TURN_TOTAL_BUDGET_MS = 20000;
async function connectViaTurnProxy(openSocket, cfg, targetHost, targetPort, familyHint = 'domain') {
  // F7：Allocate 未携带 REQUESTED-ADDRESS-FAMILY（RFC 6156）→ 中继固定 IPv4，IPv6 目标必然在 CreatePermission 被拒，直接跳过
  const targets = (await _turnResolveTarget(targetHost, familyHint === 'ipv6' ? 'ipv6' : 'ipv4')).filter(t => t.family === 'ipv4');
  if (!targets.length) throw new Error('TURN target DNS resolution failed (IPv4 only)');
  const run = (async () => {
    let lastError = null;
    for (const target of targets) {
      try {
        return await _turnConnectSingle(openSocket, cfg, target.address, targetPort);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('TURN connection failed');
  })();
  return _turnWithTimeout(run, 'TURN connect budget exceeded', TURN_TOTAL_BUDGET_MS);
}

/* ---------- SSTP 全局代理（移植自 cmliu/edgetunnel sstpConnect：TLS → SSTP_DUPLEX_POST → PPP LCP/PAP/IPCP → TCP-in-IP 封装） ----------
 * 此前 'sstp' 分支只是裸 TCP 连到 sstp 主机再直写 VLESS 载荷，从未按 SSTP 协议握手（审查 F1）。
 * 以下为逐标识符翻译（数据转Uint8Array→_turnToBytes / 拼接字节数据→_sstpCat / withTimeout→_sstpTimeout / DoH查询→_dohQRaw），逻辑未改。 */
const SSTP_CONNECT_TIMEOUT_MS = 10000;
const SSTP_TCP_MSS = 1400;
const _sstpCat = (...parts) => { let n = 0; for (const p of parts) n += p.byteLength; const o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.byteLength; } return o; };
const _sstpTimeout = (promise, timeoutMs, message) => _turnWithTimeout(promise, message, timeoutMs);
const _sstpIsV4 = (s) => /^(25[0-5]|2[0-4]d|1?d?d)(.(25[0-5]|2[0-4]d|1?d?d)){3}$/.test(String(s || ''));
const SSTP_EMPTY_BYTES = new Uint8Array(0);

function readSstpUint16(bytes, offset = 0) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readSstpUint32(bytes, offset = 0) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function randomSstpUint16() {
  return readSstpUint16(crypto.getRandomValues(new Uint8Array(2)));
}

function internetChecksum(bytes, offset, length) {
  let sum = 0;
  for (let index = offset; index < offset + length - 1; index += 2) sum += readSstpUint16(bytes, index);
  if (length & 1) sum += bytes[offset + length - 1] << 8;
  while (sum >> 16) sum = (sum & 0xffff) + (sum >> 16);
  return (~sum) & 0xffff;
}

async function sstpConnect(proxy, targetHost, targetPort, openSocket) {
  proxy = { ...proxy, username: proxy.username ?? null, password: proxy.password ?? null };
  let bufferedBytes = SSTP_EMPTY_BYTES, pppIdentifier = 1, socket = null, reader = null, writer = null;
  let closedSettled = false, resolveClosed, rejectClosed;
  const closed = new Promise((resolve, reject) => {
    resolveClosed = resolve;
    rejectClosed = reject;
  });
  const settleClosed = (settle, value) => {
    if (closedSettled) return;
    closedSettled = true;
    settle(value);
  };
  const close = () => {
    try { reader?.cancel?.().catch?.(() => { }) } catch (e) { }
    try { reader?.releaseLock?.() } catch (e) { }
    try { writer?.close?.().catch?.(() => { }) } catch (e) { }
    try { writer?.releaseLock?.() } catch (e) { }
    try { socket?.close?.() } catch (e) { }
    settleClosed(resolveClosed);
  };

  const readSocketChunk = async () => {
    const { value, done } = await reader.read();
    if (done || !value) throw new Error('SSTP socket closed');
    return _turnToBytes(value);
  };
  const readBytes = async length => {
    while (bufferedBytes.byteLength < length) {
      const chunk = await readSocketChunk();
      bufferedBytes = bufferedBytes.byteLength ? _sstpCat(bufferedBytes, chunk) : chunk;
    }
    const result = bufferedBytes.subarray(0, length);
    bufferedBytes = bufferedBytes.subarray(length);
    return result;
  };
  const readHttpLine = async () => {
    for (; ;) {
      const lineEnd = bufferedBytes.indexOf(10);
      if (lineEnd >= 0) {
        const line = _turnDecoder.decode(bufferedBytes.subarray(0, lineEnd));
        bufferedBytes = bufferedBytes.subarray(lineEnd + 1);
        return line.replace(/\r$/, '');
      }
      const chunk = await readSocketChunk();
      bufferedBytes = bufferedBytes.byteLength ? _sstpCat(bufferedBytes, chunk) : chunk;
    }
  };
  const readPacket = async (timeoutMs = SSTP_CONNECT_TIMEOUT_MS) => {
    const header = await _sstpTimeout(readBytes(4), timeoutMs, 'SSTP read timeout');
    const length = readSstpUint16(header, 2) & 0x0fff;
    if (length < 4) throw new Error('Invalid SSTP packet length');
    return {
      isControl: (header[1] & 1) !== 0,
      body: length > 4 ? await _sstpTimeout(readBytes(length - 4), timeoutMs, 'SSTP packet body read timeout') : SSTP_EMPTY_BYTES
    };
  };
  const buildSstpDataPacket = pppFrame => {
    const packetLength = 6 + pppFrame.byteLength;
    const packet = new Uint8Array(packetLength);
    packet.set([0x10, 0x00, ((packetLength >> 8) & 0x0f) | 0x80, packetLength & 0xff, 0xff, 0x03]);
    packet.set(pppFrame, 6);
    return packet;
  };
  const buildPppConfigurePacket = (protocol, code, id, options = []) => {
    const optionsLength = options.reduce((size, option) => size + 2 + option.data.byteLength, 0);
    const frame = new Uint8Array(6 + optionsLength);
    const view = new DataView(frame.buffer);
    view.setUint16(0, protocol);
    frame[2] = code;
    frame[3] = id;
    view.setUint16(4, 4 + optionsLength);
    options.reduce((offset, option) => {
      frame[offset] = option.type;
      frame[offset + 1] = 2 + option.data.byteLength;
      frame.set(option.data, offset + 2);
      return offset + 2 + option.data.byteLength;
    }, 6);
    return frame;
  };
  const parsePPPFrame = data => {
    const offset = data.byteLength >= 2 && data[0] === 0xff && data[1] === 0x03 ? 2 : 0;
    if (data.byteLength - offset < 4) return null;
    const protocol = readSstpUint16(data, offset);
    if (protocol === 0x0021) return { protocol, ipPacket: data.subarray(offset + 2) };
    if (data.byteLength - offset < 6) return null;
    return { protocol, code: data[offset + 2], id: data[offset + 3], payload: data.subarray(offset + 6), rawPacket: data.subarray(offset) };
  };
  const parsePppOptions = data => {
    const options = [];
    for (let offset = 0; offset + 2 <= data.byteLength;) {
      const type = data[offset];
      const length = data[offset + 1];
      if (length < 2 || offset + length > data.byteLength) break;
      options.push({ type, data: data.subarray(offset + 2, offset + length) });
      offset += length;
    }
    return options;
  };

  try {
    const serverHost = stripIPv6Brackets(proxy.hostname);
    const serverPort = proxy.port;
    socket = openSocket({ hostname: serverHost, port: serverPort }, { secureTransport: 'on', allowHalfOpen: false });
    await _sstpTimeout(socket.opened, SSTP_CONNECT_TIMEOUT_MS, 'SSTP server connection timed out');
    reader = socket.readable.getReader();
    writer = socket.writable.getWriter();

    const displayHost = serverHost.includes(':') ? `[${serverHost}]` : serverHost;
    const httpRequest = _turnEncoder.encode(
      `SSTP_DUPLEX_POST /sra_{BA195980-CD49-458b-9E23-C84EE0ADCD75}/ HTTP/1.1\r\n`
      + `Host: ${Number(serverPort) === 443 ? displayHost : `${displayHost}:${serverPort}`}\r\n`
      + 'Content-Length: 18446744073709551615\r\n'
      + `SSTPCORRELATIONID: {${crypto.randomUUID()}}\r\n\r\n`
    );
    const encapsulatedProtocol = new Uint8Array(2);
    new DataView(encapsulatedProtocol.buffer).setUint16(0, 1);
    const maximumReceiveUnit = new Uint8Array(2);
    new DataView(maximumReceiveUnit.buffer).setUint16(0, 1500);
    const sstpConnectRequest = new Uint8Array(12 + encapsulatedProtocol.byteLength);
    const sstpConnectView = new DataView(sstpConnectRequest.buffer);
    sstpConnectRequest[0] = 0x10;
    sstpConnectRequest[1] = 0x01;
    sstpConnectView.setUint16(2, sstpConnectRequest.byteLength | 0x8000);
    sstpConnectView.setUint16(4, 0x0001);
    sstpConnectView.setUint16(6, 1);
    sstpConnectRequest[9] = 1;
    sstpConnectView.setUint16(10, 4 + encapsulatedProtocol.byteLength);
    sstpConnectRequest.set(encapsulatedProtocol, 12);

    await _sstpTimeout(writer.write(_sstpCat(
      httpRequest,
      sstpConnectRequest,
      buildSstpDataPacket(buildPppConfigurePacket(0xc021, 1, pppIdentifier++, [
        { type: 1, data: maximumReceiveUnit }
      ]))
    )), SSTP_CONNECT_TIMEOUT_MS, 'SSTP HTTP handshake request timed out');

    const statusLine = await _sstpTimeout(readHttpLine(), SSTP_CONNECT_TIMEOUT_MS, 'SSTP HTTP handshake timed out');
    for (; ;) {
      const line = await _sstpTimeout(readHttpLine(), SSTP_CONNECT_TIMEOUT_MS, 'SSTP HTTP header read timed out');
      if (line === '') break;
    }
    if (!/HTTP\/\d(?:\.\d)?\s+2\d\d/i.test(statusLine)) throw new Error(`SSTP HTTP handshake failed: ${statusLine || 'invalid status'}`);

    let localLcpAcked = false, peerLcpAcked = false, papRequired = false, papSent = false, papDone = false, ipcpStarted = false, ipcpFinished = false, sourceIp = null;
    const sendPapIfReady = async () => {
      if (!localLcpAcked || !peerLcpAcked || !papRequired || papSent) return;
      if (proxy.username === null || proxy.password === null) throw new Error('SSTP server requires PAP authentication');
      const username = _turnEncoder.encode(proxy.username);
      const password = _turnEncoder.encode(proxy.password);
      if (username.byteLength > 255 || password.byteLength > 255) throw new Error('SSTP username/password is too long');
      const papLength = 6 + username.byteLength + password.byteLength;
      const frame = new Uint8Array(2 + papLength);
      const view = new DataView(frame.buffer);
      view.setUint16(0, 0xc023);
      frame[2] = 1;
      frame[3] = pppIdentifier++;
      view.setUint16(4, papLength);
      frame[6] = username.byteLength;
      frame.set(username, 7);
      frame[7 + username.byteLength] = password.byteLength;
      frame.set(password, 8 + username.byteLength);
      await _sstpTimeout(writer.write(buildSstpDataPacket(frame)), SSTP_CONNECT_TIMEOUT_MS, 'SSTP PAP authentication request timed out');
      papSent = true;
    };
    const startIpcpIfReady = async () => {
      if (!localLcpAcked || !peerLcpAcked || ipcpStarted || (papRequired && !papDone)) return;
      await _sstpTimeout(writer.write(buildSstpDataPacket(buildPppConfigurePacket(0x8021, 1, pppIdentifier++, [
        { type: 3, data: new Uint8Array(4) }
      ]))), SSTP_CONNECT_TIMEOUT_MS, 'SSTP IPCP request timed out');
      ipcpStarted = true;
    };

    for (let round = 0; round < 50 && !ipcpFinished; round++) {
      const packet = await readPacket(SSTP_CONNECT_TIMEOUT_MS);
      if (packet.isControl) continue;
      const ppp = parsePPPFrame(packet.body);
      if (!ppp) continue;

      if (ppp.protocol === 0xc021) {
        if (ppp.code === 1) {
          const authOption = parsePppOptions(ppp.payload).find(option => option.type === 3);
          if (authOption?.data?.byteLength >= 2) {
            const authProtocol = readSstpUint16(authOption.data);
            if (authProtocol !== 0xc023) throw new Error(`SSTP unsupported PPP authentication protocol: 0x${authProtocol.toString(16)}`);
            papRequired = true;
          }
          const ack = new Uint8Array(ppp.rawPacket);
          ack[2] = 2;
          await _sstpTimeout(writer.write(buildSstpDataPacket(ack)), SSTP_CONNECT_TIMEOUT_MS, 'SSTP LCP Configure-Ack timed out');
          peerLcpAcked = true;
          await sendPapIfReady();
          await startIpcpIfReady();
        } else if (ppp.code === 2) {
          localLcpAcked = true;
          await sendPapIfReady();
          await startIpcpIfReady();
        }
        continue;
      }

      if (ppp.protocol === 0xc023) {
        if (ppp.code === 2) {
          papDone = true;
          await startIpcpIfReady();
        } else if (ppp.code === 3) throw new Error('SSTP PAP authentication failed');
        continue;
      }

      if (ppp.protocol === 0x8021) {
        if (ppp.code === 1) {
          const ack = new Uint8Array(ppp.rawPacket);
          ack[2] = 2;
          await _sstpTimeout(writer.write(buildSstpDataPacket(ack)), SSTP_CONNECT_TIMEOUT_MS, 'SSTP IPCP Configure-Ack timed out');
          await startIpcpIfReady();
        } else if (ppp.code === 3) {
          const addressOption = parsePppOptions(ppp.payload).find(option => option.type === 3);
          if (addressOption?.data?.byteLength === 4) {
            sourceIp = [...addressOption.data].join('.');
            await _sstpTimeout(writer.write(buildSstpDataPacket(buildPppConfigurePacket(0x8021, 1, pppIdentifier++, [
              { type: 3, data: addressOption.data }
            ]))), SSTP_CONNECT_TIMEOUT_MS, 'SSTP IPCP address request timed out');
            ipcpStarted = true;
          }
        } else if (ppp.code === 2) {
          const addressOption = parsePppOptions(ppp.payload).find(option => option.type === 3);
          if (addressOption?.data?.byteLength === 4) sourceIp = [...addressOption.data].join('.');
          ipcpFinished = true;
        }
      }
    }
    if (!sourceIp) throw new Error('SSTP did not assign an IPv4 address');

    const target = stripIPv6Brackets(targetHost);
    /** @type {string | null} */
    let targetIp = _sstpIsV4(target) ? target : null;
    if (!targetIp) {
      const records = await _dohQRaw(target, 'A');
      const recordData = records.find(item => item.type === 1 && _sstpIsV4(item.data))?.data;
      targetIp = typeof recordData === 'string' ? recordData : null;
    }
    if (!targetIp) throw new Error(`Could not resolve ${targetHost} to an IPv4 address for SSTP`);

    const sourcePort = 10000 + (randomSstpUint16() % 50000);
    const sourceAddress = new Uint8Array(String(sourceIp || '').split('.').map(Number));
    const destinationAddress = new Uint8Array(String(targetIp || '').split('.').map(Number));
    let sequenceNumber = readSstpUint32(crypto.getRandomValues(new Uint8Array(4)));
    let acknowledgementNumber = 0;
    const ipHeaderTemplate = new Uint8Array(20);
    ipHeaderTemplate.set([0x45, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40, 0x00, 64, 6]);
    ipHeaderTemplate.set(sourceAddress, 12);
    ipHeaderTemplate.set(destinationAddress, 16);
    const tcpPseudoHeader = new Uint8Array(1432);
    tcpPseudoHeader.set(sourceAddress);
    tcpPseudoHeader.set(destinationAddress, 4);
    tcpPseudoHeader[9] = 6;
    const buildTcpFrame = (flags, payload = SSTP_EMPTY_BYTES) => {
      const bytes = _turnToBytes(payload);
      const payloadLength = bytes.byteLength;
      const tcpLength = 20 + payloadLength;
      const ipLength = 20 + tcpLength;
      const sstpLength = 8 + ipLength;
      const frame = new Uint8Array(sstpLength);
      const view = new DataView(frame.buffer);
      frame.set([0x10, 0x00, ((sstpLength >> 8) & 0x0f) | 0x80, sstpLength & 0xff, 0xff, 0x03, 0x00, 0x21]);
      frame.set(ipHeaderTemplate, 8);
      view.setUint16(10, ipLength);
      view.setUint16(12, randomSstpUint16());
      view.setUint16(18, internetChecksum(frame, 8, 20));
      view.setUint16(28, sourcePort);
      view.setUint16(30, targetPort);
      view.setUint32(32, sequenceNumber);
      view.setUint32(36, acknowledgementNumber);
      frame[40] = 0x50;
      frame[41] = flags;
      view.setUint16(42, 65535);
      if (payloadLength) frame.set(bytes, 48);
      tcpPseudoHeader[10] = tcpLength >> 8;
      tcpPseudoHeader[11] = tcpLength & 0xff;
      tcpPseudoHeader.set(frame.subarray(28, 28 + tcpLength), 12);
      view.setUint16(44, internetChecksum(tcpPseudoHeader, 0, 12 + tcpLength));
      return frame;
    };
    const matchIncomingIpPacket = ipPacket => {
      if (ipPacket.byteLength < 40 || ipPacket[9] !== 6) return null;
      const ipHeaderLength = (ipPacket[0] & 0x0f) * 4;
      if (ipPacket.byteLength < ipHeaderLength + 20) return null;
      if (readSstpUint16(ipPacket, ipHeaderLength) !== targetPort) return null;
      if (readSstpUint16(ipPacket, ipHeaderLength + 2) !== sourcePort) return null;
      return {
        flags: ipPacket[ipHeaderLength + 13],
        sequence: readSstpUint32(ipPacket, ipHeaderLength + 4),
        payloadOffset: ipHeaderLength + ((ipPacket[ipHeaderLength + 12] >> 4) & 0x0f) * 4
      };
    };

    await _sstpTimeout(writer.write(buildTcpFrame(0x02)), SSTP_CONNECT_TIMEOUT_MS, 'SSTP TCP SYN write timed out');
    sequenceNumber = (sequenceNumber + 1) >>> 0;
    let tcpReady = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const packet = await readPacket(SSTP_CONNECT_TIMEOUT_MS);
      if (packet.isControl) continue;
      const ppp = parsePPPFrame(packet.body);
      if (!ppp || ppp.protocol !== 0x0021) continue;
      const tcp = matchIncomingIpPacket(ppp.ipPacket);
      if (!tcp || (tcp.flags & 0x12) !== 0x12) continue;
      acknowledgementNumber = (tcp.sequence + 1) >>> 0;
      await _sstpTimeout(writer.write(buildTcpFrame(0x10)), SSTP_CONNECT_TIMEOUT_MS, 'SSTP TCP ACK write timed out');
      tcpReady = true;
      break;
    }
    if (!tcpReady) throw new Error('TCP handshake through SSTP timed out');

    /** @type {ReadableStreamDefaultController<Uint8Array> | null} */
    let streamController = null;
    const readable = new ReadableStream({
      start(controller) {
        streamController = controller;
      },
      cancel() {
        close();
      }
    });

    (async () => {
      try {
        let pendingChunks = [], pendingLength = 0;
        const flush = () => {
          if (!pendingLength) return;
          if (!streamController) throw new Error('SSTP readable stream is not ready');
          streamController.enqueue(pendingChunks.length === 1 ? pendingChunks[0] : _sstpCat(...pendingChunks));
          pendingChunks = [];
          pendingLength = 0;
          writer.write(buildTcpFrame(0x10)).catch(() => { });
        };

        for (; ;) {
          const packet = await readPacket(60000);
          if (packet.isControl) continue;
          const ppp = parsePPPFrame(packet.body);
          if (!ppp || ppp.protocol !== 0x0021) continue;
          const incoming = matchIncomingIpPacket(ppp.ipPacket);
          if (!incoming) continue;

          if (incoming.payloadOffset < ppp.ipPacket.byteLength) {
            const payload = ppp.ipPacket.subarray(incoming.payloadOffset);
            if (payload.byteLength) {
              acknowledgementNumber = (incoming.sequence + payload.byteLength) >>> 0;
              pendingChunks.push(new Uint8Array(payload));
              pendingLength += payload.byteLength;
            }
          }

          if (incoming.flags & 0x01) {
            flush();
            acknowledgementNumber = (acknowledgementNumber + 1) >>> 0;
            writer.write(buildTcpFrame(0x11)).catch(() => { });
            const controller = streamController;
            if (controller) {
              try { controller.close() } catch (e) { }
            }
            close();
            return;
          }

          if (bufferedBytes.byteLength < 4 || pendingLength >= 32768) flush();
        }
      } catch (error) {
        const controller = streamController;
        if (controller) {
          try { controller.error(error) } catch (e) { }
        }
        settleClosed(rejectClosed, error);
        try { socket?.close?.() } catch (e) { }
      }
    })();

    const writable = new WritableStream({
      async write(chunk) {
        const bytes = _turnToBytes(chunk);
        if (!bytes.byteLength) return;
        if (bytes.byteLength <= SSTP_TCP_MSS) {
          await writer.write(buildTcpFrame(0x18, bytes));
          sequenceNumber = (sequenceNumber + bytes.byteLength) >>> 0;
          return;
        }
        const frames = [];
        for (let offset = 0; offset < bytes.byteLength; offset += SSTP_TCP_MSS) {
          const segment = bytes.subarray(offset, Math.min(offset + SSTP_TCP_MSS, bytes.byteLength));
          frames.push(buildTcpFrame(0x18, segment));
          sequenceNumber = (sequenceNumber + segment.byteLength) >>> 0;
        }
        await writer.write(_sstpCat(...frames));
      },
      close() {
        return writer.write(buildTcpFrame(0x11)).catch(() => { });
      },
      abort(error) {
        close();
        if (error) settleClosed(rejectClosed, error);
      }
    });

    return { readable, writable, closed, close };
  } catch (error) {
    close();
    throw error;
  }
}


/* ---------- URL 路由解析：路径快捷方式 + 查询参数 ---------- */
function pCfg(url, path, fbPIP = null) {
  let pIP = null, s5 = null, enS = null, turn = null, gP = null, order = null;

  // 0. 路径百分号解码（EDT 对齐：先 decodeURIComponent；非法百分号编码安全降级，不抛 500）
  try { path = decodeURIComponent(path); } catch (e) { /* 保留原值 */ }

  // 1a. TURN/TURNS：:// 为全局代理，= 为直连失败后回落
  const turnRoute = parseTurnProxyConfig('/' + path);
  if (turnRoute) {
    if (turnRoute.global) {
      gP = { type: 'turn', cfg: turnRoute.cfg };
      order = ['gP'];
    } else {
      turn = turnRoute.cfg;
      order = ['direct', 'turn'];
    }
    return { pIP, s5, enS, turn, gP, order };
  }

  // 1b. 全局 SOCKS5 / HTTP / HTTPS（EDT：socks:// 与 socks5:// 均为全局）
  const globalMatch = path.match(/(socks?5?|https?):\/\/([^/#?]+)/i);
  if (globalMatch) {
    const scheme = globalMatch[1].toLowerCase();
    const cfg = addrParser(globalMatch[2], scheme === 'https' ? 443 : scheme.startsWith('h') ? 80 : 1080);
    const isS5 = scheme.startsWith('s');
    if (scheme === 'https') cfg.tls = 1;
    gP = { type: isS5 ? 'socks5' : 'http', cfg };
    order = ['gP'];
    return { pIP, s5, enS, turn, gP, order };
  }

  // 1b-2. sstp:// 全局代理（TCP 443/指定端口透传，默认凭证 vpn/vpn）
  const sstpMatch = path.match(/^sstp:\/\/([^\/?#]+)/i);
  if (sstpMatch) {
    let su = null; try { su = new URL("sstp://" + sstpMatch[1]) } catch {}
    if (su) return { pIP, s5, enS, turn, gP: { type: "sstp", cfg: { host: su.hostname, port: parseInt(su.port) || 443, user: su.username ? decodeURIComponent(su.username) : "vpn", password: su.password ? decodeURIComponent(su.password) : "vpn" } }, order: ["gP"] };
  }

  // 1c. 路径任意位置的 proxyip= / proxyip. / proxyip/ / pyip= / ip=（EDT 对齐：不锚定、解码、去尾随斜杠）
  //     命中即强制 order=['direct','proxy'] 并提前返回（保持原 1c 语义）
  const pxRe = /(?:^|\/)(proxyip[=.\/]|pyip=|ip[=.\/])([^?#\s]+)/i;
  const pxMatch = path.match(pxRe);
  if (pxMatch) {
    let seg = pxMatch[2];
    const slash = seg.indexOf('/');
    if (slash > 0) seg = seg.slice(0, slash);
    seg = seg.replace(/\/+$/, '').trim();
    const [a, p = 443] = parseAddressPort(seg);
    pIP = { address: a.includes('[') ? a.slice(1, -1) : a, port: +p };
    order = ['direct', 'proxy'];
    return { pIP, s5, enS, turn, gP, order };
  }

  // 1d. /s5= 或 /socks5= 或 /socks=
  const s5PathRe = /^(socks?5?|s5)=(.+)/i;
  if (s5PathRe.test(path)) {
    const match = path.match(s5PathRe);
    s5 = addrParser(match[2]);
    enS = 'socks5';
    order = ['direct', 's5'];
    return { pIP, s5, enS, turn, gP, order };
  }

  // 1e. /http= 或 /https=（EDT：https= 为 TLS HTTP CONNECT，默认端口 443）
  const httpPath = path.match(/^(https?)=(.+)/i);
  if (httpPath) {
    s5 = addrParser(httpPath[2], httpPath[1].toLowerCase() === 'https' ? 443 : 80);
    enS = httpPath[1].toLowerCase();
    if (enS === 'https') s5.tls = 1;
    order = ['direct', 's5'];
    return { pIP, s5, enS, turn, gP, order };
  }

  // 路径任意位置的 /ip= /proxyip= 已统一至 1c（避免两套逻辑互相覆盖）

  // 路径任意位置的 /s5= /socks5= /http= /https= /turn= /sstp=（EDT `_ref_edgetunnel.tmp:6270`）
  // A-6：补齐 g 前缀（gs5= / ghttp= / ghttps= / gturn= / gsstp=）=「此代理全局生效」（连 ProxyIP 也走代理）。
  //      正则仅在原字符集前加可选 `g`，原有无 g 输入的匹配结果与改动前完全一致。
  let gLocal = false;
  const localMatch = path.match(/(?:^|\/)(g?socks?5?|g?s5|g?https?|g?turn|g?sstp)[=\/]([^/#?]+)/i);
  if (localMatch && !s5) {
    const ltRaw = localMatch[1].toLowerCase();
    gLocal = ltRaw.startsWith('g');
    const lt = gLocal ? ltRaw.slice(1) : ltRaw;
    const isHttp = lt === 'http' || lt === 'https';
    s5 = addrParser(localMatch[2], lt === 'https' ? 443 : lt === 'sstp' ? 443 : lt === 'turn' ? 3478 : isHttp ? 80 : 1080);
    enS = lt === 'sstp' ? 'sstp' : (lt === 'turn' ? 'turn' : (isHttp ? lt : 'socks5'));
    if (lt === 'https') s5.tls = 1;
  }

  // 查询参数（EDT：?s5= ?socks5= ?http= ?https= ?turn= ?sstp=；?globalproxy 或 ?global=1 提升为全局）
  let qScheme = null, qValue = null;
  for (const [k, t] of [['s5', 'socks5'], ['socks5', 'socks5'], ['http', 'http'], ['https', 'https'], ['turn', 'turn'], ['sstp', 'sstp']]) {
    const v = url.searchParams.get(k);
    if (v) { qScheme = t; qValue = v; break; }
  }
  if (qValue && !s5 && !gP) {
    s5 = addrParser(qValue, qScheme === 'https' || qScheme === 'sstp' ? 443 : qScheme === 'http' ? 80 : qScheme === 'turn' ? 3478 : 1080);
    enS = qScheme;
    if (qScheme === 'https') s5.tls = 1;
  }
  // A-6：g 前缀 = 全局（与既有 ?globalproxy / ?global=1 同义）
  //      sstp / turn 一并提升为全局：回落分支（enS==='s5'）只实现 socks5/http，
  //      若让 sstp/turn 留在回落里会走 htConn 发出错误的握手，故统一走 gP（与既有 ?turn= 一致）。
  if (s5 && !gP && (gLocal || enS === 'sstp' || enS === 'turn' || url.searchParams.has('globalproxy') || /^(?:1|true)$/i.test(url.searchParams.get('global') || ''))) {
    gP = enS === 'sstp' ? { type: 'sstp', cfg: { host: s5.hostname, port: s5.port, user: s5.username || 'vpn', password: s5.password || 'vpn' } }
       : enS === 'turn' ? { type: 'turn', cfg: { hostname: s5.hostname, port: s5.port, username: s5.username ?? null, password: s5.password ?? null, tls: !!s5.tls } }
       : { type: enS === 'socks5' ? 'socks5' : 'http', cfg: s5 };
    s5 = null; enS = null;
  }
  const pxParam = url.searchParams.get('proxyip');
  if (pxParam && !pIP) {
    const [a, p = 443] = parseAddressPort(pxParam);
    pIP = { address: a.includes('[') ? a.slice(1, -1) : a, port: +p };
  }
  for (const key of ['turn', 'turns']) {
    const value = url.searchParams.get(key);
    if (!value || turn || gP) continue;
    const parsed = parseTurnProxyConfig(key + '=' + value);
    if (!parsed) continue;
    if (
      url.searchParams.has('globalproxy') ||
      /^(?:1|true)$/i.test(url.searchParams.get('global') || '')
    ) {
      gP = { type: 'turn', cfg: parsed.cfg };
      order = ['gP'];
    } else {
      turn = parsed.cfg;
    }
    break;
  }

  // 查询参数提升的全局 socks/http：order 直接走 gP
  if (gP && !order) order = ['gP'];

  // 连接顺序
  if (!order) {
    const mode = url.searchParams.get('mode') || 'auto';
    if (mode === 'proxy') {
      order = ['direct', 'proxy'];
    } else if (mode !== 'auto') {
      order = [mode];
    } else {
      order = [];
      const searchStr = url.search.slice(1);
      for (const pair of searchStr.split('&')) {
        const key = pair.split('=')[0].toLowerCase();
        if (key === 'direct') order.push('direct');
        else if (key === 's5') order.push('s5');
        else if (key === 'turn' || key === 'turns') order.push('turn');
        else if (key === 'proxyip') order.push('proxy');
      }
      if (order.includes('s5') && !order.includes('direct')) order.unshift('direct');
      if (order.includes('turn') && !order.includes('direct')) order.unshift('direct');
      if (order.includes('proxy') && !order.includes('direct')) order.unshift('direct');
      if (!order.length) {
        order = ['direct'];
        if (turn) order.push('turn');
        order.push('s5', 'proxy');
      }
    }
  }

  // 路径与查询参数均未指定任何代理时，回落到内置兜底地址
  if (!pIP && !s5 && !turn && !gP && fbPIP) {
    const [a, p = 443] = parseAddressPort(fbPIP);
    pIP = { address: a.includes('[') ? a.slice(1, -1) : a, port: +p };
    if (!order.includes('proxy')) order.push('proxy');
  }

  return { pIP, s5, enS, turn, gP, order };
}

/* ---------- GrainTCP 原生建连：单路 + 4 路竞速 ---------- */
const sprout = (f, h, p, s = f.connect({ hostname: h, port: p })) => { let d = !1; return new Promise((res, rej) => { const c = setTimeout(() => { if (!d) { d = !0; try { s.close() } catch {} rej(new Error("TO")) } }, 12e3); s.opened.then(o => { if (!d) { d = !0; clearTimeout(c); res(s) } }, e => { if (!d) { d = !0; clearTimeout(c); rej(e) } }) }) };

/* ---------- DoH JSON 查询（EDT 对齐：直连预解析与反代池展开共用；120s 缓存，5s 超时，双端点回退） ---------- */
const _dohCache = new Map();
/* 原始 Answer 数组（保留 type 字段）：EDT「解析地址端口」按 r.type 过滤 A(1)/AAAA(28)/TXT(16)，
   若在此处就把 type 丢掉，反代腿就无法区分 CNAME 链里的 A 记录与真正的 AAAA */
const _dohQRaw = async (name, type) => {
  const key = type + ':' + String(name || '').toLowerCase().replace(/\.$/, '');
  const now = Date.now();
  const c = _dohCache.get(key);
  if (c && now - c.t < 120000) return c.l;
  let out = [];
  for (const ep of ['https://cloudflare-dns.com/dns-query', 'https://dns.alidns.com/resolve']) {
    try {
      const r = await fetch(ep + '?name=' + encodeURIComponent(name) + '&type=' + type, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(5000) });
      if (!r.ok) continue;
      out = ((await r.json()).Answer || []);
      if (out.length) break;
    } catch (e) {}
  }
  _dohCache.set(key, { l: out, t: now });
  if (_dohCache.size > 200) _dohCache.clear();
  return out;
};
const _dohQ = async (name, type) => (await _dohQRaw(name, type)).map(x => String(x.data));
const _v4 = s => { s = String(s || '').replace(/\.$/, ''); return /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s) ? s : null; };
const _isIpHost = h => _v4(h) || String(h).includes(':');
/* 反代地址展开（EDT「解析地址端口」6437-6509 对齐：域名 TXT 池 → A → AAAA → 保留原域名；180s 缓存）
   注意：Snippets 侧**故意不实现** A/AAAA 兜底——Snippets 出站预算仅 2 次（fetch 与 connect 合并计数），
   TXT+A 并行查询 + 直连腿就会超预算，故 Snippets 保持隐式 connect(主机名)。这是逐环境适配。 */
const PIP_TP1 = ['proxyip.tp1.090227.xyz', 1]; // CMLiu 生态按机房寻找服务（EDT 同款末级兜底）
const _pipCache = new Map();
const pipExpand = async pIP => {
  const a = String(pIP.address || '').replace(/!txt$/i, '').trim();
  const port = +pIP.port || 443;
  const key = a.toLowerCase() + ':' + port;
  const now = Date.now();
  const c = _pipCache.get(key);
  if (c && now - c.t < 180000) return c.l;
  let list = [];
  if (!_isIpHost(a)) {
    let txt = [], a4 = [];
    try {
      // EDT 同款：TXT 与 A 并行发起（Workers 有 1000 次 subrequest 预算，可以这么花）
      const [tr, ar] = await Promise.all([_dohQRaw(a, 'TXT'), _dohQRaw(a, 'A')]);
      txt = tr.filter(r => r.type === 16).map(r => String(r.data));
      a4 = ar.filter(r => r.type === 1).map(r => String(r.data)).map(_v4).filter(Boolean);
    } catch (e) {}
    if (txt.length) {
      list = txt.flatMap(d => String(d).replace(/^"|"$/g, '').replace(/\\010/g, ',').split(','))
        .map(s => s.trim()).filter(Boolean).slice(0, 6)
        .map(s => { const [h2, p2] = parseAddressPort(s); return [h2, +p2 || 443]; });
    }
    if (!list.length && a4.length) list = a4.map(ip => [ip, port]);
    if (!list.length) {
      try {
        const a6 = (await _dohQRaw(a, 'AAAA')).filter(r => r.type === 28).map(r => '[' + String(r.data) + ']');
        if (a6.length) list = a6.map(ip => [ip, port]);
      } catch (e) {}
    }
  }
  if (!list.length) list = [[a, port]]; // 三级全空 → 保留原域名
  _pipCache.set(key, { l: list, t: now });
  if (_pipCache.size > 200) _pipCache.clear();
  return list;
};
/* 竞速拨号（EDT 预加载竞速对齐：域名先 DoH A/AAAA 解析成字面 IP 再竞速——CF 目标对字面 IP 被同步拒绝，快速回落反代链） */
const raceSprout = async (f, h, p) => {
  if (!f?.connect) throw new Error('connect unavailable');
  let targets = null;
  if (!_isIpHost(h)) {
    const key = 'H:' + h.toLowerCase();
    const now = Date.now();
    const c = _dohCache.get(key);
    if (c && now - c.t < 120000) targets = c.l;
    else {
      try {
        const a4 = (await _dohQ(h, 'A')).map(_v4).filter(Boolean);
        let a6 = a4.length >= CFG.concur ? [] : (await _dohQ(h, 'AAAA')).map(s => String(s).replace(/\.$/, '')).filter(x => x.includes(':') && !x.includes('.')).map(x => '[' + x + ']');
        targets = [...new Set(a4.concat(a6))].slice(0, Math.max(+CFG.concur || 1, 1));
        _dohCache.set(key, { l: targets, t: now });
      } catch (e) { targets = []; }
    }
  }
  const ts = (targets && targets.length ? targets : [h]).map(x => sprout(f, x, p));
  if (ts.length === 1) return ts[0];
  const w = await Promise.any(ts);
  ts.forEach(t => t.then(s => s !== w && s.close(), () => {}));
  return w;
};

/* ---------- 按 order 回落建连 ---------- */
/* ---------- A-12：GO2SOCKS5 直连白名单（对齐 EDT `_ref_edgetunnel.tmp:3` / `:50`） ---------- */
let _GO2S5 = null;                                   // isolate 级缓存，对齐 EDT 的 缓存SOCKS5白名单
async function _go2s5List(env) {
  if (_GO2S5 !== null) return _GO2S5;
  let raw = '';
  try { raw = String((env && await getSafeEnv(env, 'GO2SOCKS5', '')) || ''); } catch (e) { raw = ''; }
  _GO2S5 = raw.split(',').map(s => s.trim().toLowerCase())
    // 格式闸门：只接受 [a-z0-9.*-]；显式禁止裸 '*' / '*.' / '**'（否则等于整体关闭 ProxyIP 出网收敛）
    .filter(s => s && /^[a-z0-9.*-]+$/.test(s) && s !== '*' && s !== '*.' && s !== '**');
  return _GO2S5;
}
// 匹配：精确主机名，或**点分后缀**（`*a.com` / `*.a.com` → host === 'a.com' || host.endsWith('.a.com')）。
// 刻意不写 endsWith(s) 的子串包含，避免 'evil-a.com' 命中 'a.com'。
function _go2s5Hit(list, hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h || !list || !list.length) return false;
  for (const p of list) {
    if (p.startsWith('*')) {
      const s = p.startsWith('*.') ? p.slice(2) : p.slice(1);
      if (s && (h === s || h.endsWith('.' + s))) return true;
    } else if (h === p) return true;
  }
  return false;
}

const tryCon = async (fetcher, addrType, host, port, routeCfg, env) => {
  const { pIP, s5, enS, turn, gP, order } = routeCfg;
  const openSocket = (address, options) => fetcher.connect(address, options);
  const family = addrType === 1 ? 'ipv4' : addrType === 4 ? 'ipv6' : 'domain';

  // A-12：命中 GO2SOCKS5 白名单 → 跳过 ProxyIP / 回落代理，改为直连。
  // ★ 硬红线：白名单只改变「走不走代理」，**不改变「能不能连」** —— 目标仍必须过 _extHostSafe，
  //   不豁免内网 / 回环 / 链路本地等封禁（白名单 ≠ 放行内网）。
  //   未配 GO2SOCKS5 → 列表为空 → 恒 false → 对现有路径零影响。
  if (_go2s5Hit(await _go2s5List(env), host)) {
    if (!_extHostSafe(String(host)).ok) throw new Error('GO2SOCKS5 target blocked');
    return await raceSprout(fetcher, host, port);
  }

  // 全局代理优先，不回落到直连
  if (gP) {
    if (gP.type === 'socks5') return s5Conn(fetcher, addrType, host, port, gP.cfg);
    if (gP.type === 'http') return htConn(fetcher, addrType, host, port, gP.cfg);
    if (gP.type === 'sstp') return sstpConnect({ hostname: gP.cfg.host, port: gP.cfg.port, username: gP.cfg.user ?? null, password: gP.cfg.password ?? null }, host, port, openSocket);
    if (gP.type === 'turn') {
      return connectViaTurnProxy(openSocket, gP.cfg, host, port, family);
    }
  }

  let lastErr = null;
  for (const method of order) {
    try {
      if (method === 'direct') {
        return await raceSprout(fetcher, host, port);
      }
      if (method === 'turn' && turn) {
        return await connectViaTurnProxy(openSocket, turn, host, port, family);
      }
      if (method === 's5' && s5) {
        return enS === 'socks5'
          ? await s5Conn(fetcher, addrType, host, port, s5)
          : await htConn(fetcher, addrType, host, port, s5);
      }
      if (method === 'proxy' && pIP) {
        const raceList = list => {
          const ts = list.map(([h2, p2]) => sprout(fetcher, h2, p2));
          return Promise.any(ts).then(w => { ts.forEach(t => t.then(s => s !== w && s.close(), () => {})); return w; });
        };
        try { return await raceList(await pipExpand(pIP)); }
        catch (e) { lastErr = e; return await raceList([PIP_TP1]); }
      }
    } catch (error) {
      lastErr = error;
    }
  }
  throw lastErr || new Error('All methods failed');
};

/* ---------- 队列核（GrainTCP 新版，上行/下行复用，无背压） ---------- */
const UQ_MAX_BYTES = 16 * 1024 * 1024, UQ_MAX_ITEMS = 4096;   // D2：上行队列高水位（EDT 同款），溢出即断开而非无界增长
const mkK = (cap, cpy = 0) => {
  let q = [], h = 0, b = 0, buf = null;
  const e = () => h >= q.length;
  const trim = () => { h > 32 && h * 2 >= q.length && (q = q.slice(h), h = 0); };
  const clear = () => { q = []; h = 0; b = 0; };
  const take = () => { if (e()) return null; const d = q[h]; q[h++] = undefined; b -= d.byteLength; trim(); return d; };
  const sow = d => { const n = d?.byteLength || 0; if (!n) return 1; if (b + n > UQ_MAX_BYTES || q.length - h >= UQ_MAX_ITEMS) return 0; q.push(d); b += n; return 1; };
  const pack = d => {
    d ||= take();
    if (!d || e()) return [d, 0];
    let n = d.byteLength, j = h;
    while (j < q.length) { const x = q[j], nn = n + x.byteLength; if (nn > cap) break; n = nn; j++; }
    if (j === h) return [d, 0];
    const out = buf ||= new Uint8Array(cap);
    out.set(d);
    for (let o = d.byteLength; h < j;) { const x = q[h]; q[h++] = undefined; b -= x.byteLength; out.set(x, o); o += x.byteLength; }
    trim();
    const u = out.subarray(0, n);
    return [cpy ? u.slice() : u, 1];
  };
  return { e, get b() { return b; }, clear, take, sow, pack };
};

/* ---------- 上行队列（GrainTCP 新版，无背压） ---------- */
const mkQ = cap => {
  const k = mkK(cap);
  return {
    get empty() { return k.e(); },
    clear: k.clear,
    sow: k.sow,
    bundle: d => k.pack(d)
  };
};

/* ---------- 下行打包器（GrainTCP 新版：复用 mkK，zero-copy 入队） ---------- */
const mkDn = w => {
  const cap = CFG.dnPack, tail = CFG.dnTail, low = Math.max(4096, tail * 12), k = mkK(cap, 1);
  let tp = 0, gen = 0, qk = 0, qr = 0;
  const reap = () => { tp && clearTimeout(tp); tp = 0; qr = 0; for (;;) { const [u] = k.pack(); if (!u) break; w.send(u); } };
  const ripen = () => {
    if (k.e() || tp) return;
    if (k.b >= cap || cap - k.b < tail) return reap();
    tp = setTimeout(() => {
      tp = 0;
      if (k.e()) return;
      if (k.b >= cap || cap - k.b < tail) return reap();
      if (qr < CFG.dnQr && (gen !== qk || k.b < low)) { qr++; qk = gen; return ripen(); }
      reap();
    }, 1);
  };
  return {
    send(u) {
      let o = 0, n = u?.byteLength || 0;
      if (!n) return;
      while (o < n) {
        const m = Math.min(cap - k.b, n - o);
        if (!m) { reap(); continue; }
        k.sow(o || m !== n ? u.subarray(o, o + m) : u);
        gen++; o += m;
        if (k.b >= cap || cap - k.b < tail) reap();
        else ripen();
      }
    },
    reap
  };
};

/* ---------- 下行 BYOB 读取（GrainTCP 原生） ---------- */
const mill = async (rd, w) => {
  let r, byob = true;
  try { r = rd.getReader({ mode: 'byob' }); } catch { r = rd.getReader(); byob = false; }
  const tx = mkDn(w);
  let buf = byob ? new ArrayBuffer(CFG.chunk) : null;
  try {
    for (;;) {
      const { done, value: v } = byob ? await r.read(new Uint8Array(buf, 0, CFG.chunk)) : await r.read();
      if (done) break;
      if (!v?.byteLength) continue;
      const u = v instanceof Uint8Array ? v : new Uint8Array(v);
      if (u.byteLength >= (CFG.chunk >> 1)) { tx.reap(); w.send(u); if (byob) buf = new ArrayBuffer(CFG.chunk); }
      else { tx.send(u.slice()); if (byob) buf = v.buffer; }
    }
    tx.reap();
  } catch {}
  finally {
    try { tx.reap(); } catch {}
    try { r.releaseLock(); } catch {}
  }
};

/* ---------- base64url 手动解码（fromBase64 fallback，查表法不含编码特征） ---------- */
const b64uToU8 = (s) => {
  try {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    const T = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const bytes = new Uint8Array(s.replace(/=+$/, '').length * 3 >> 2);
    let p = 0;
    for (let i = 0, b = 0, bits = 0; i < s.length; i++) {
      const v = T.indexOf(s[i]);
      if (v < 0) continue;
      b = (b << 6) | v; bits += 6;
      if (bits >= 8) { bits -= 8; bytes[p++] = (b >> bits) & 0xFF; }
    }
    return bytes;
  } catch (e) { return null; }
};

/* ===== A-8 / A-9 辅助：伪装页 · 反代 · 链式代理 ===== */

// ---- A-8：内置伪装页（默认不启用；仅当显式配置 env.URL 时生效）----
const nginxPage = () => `<!DOCTYPE html><html><head><title>Welcome to nginx!</title><style>body{width:35em;margin:0 auto;font-family:Tahoma,Verdana,Arial,sans-serif}</style></head><body><h1>Welcome to nginx!</h1><p>If you see this page, the nginx web server is successfully installed and working. Further configuration is required.</p><p>For online documentation and support please refer to <a href="http://nginx.org/">nginx.org</a>.<br/>Commercial support is available at <a href="http://nginx.com/">nginx.com</a>.</p><p><em>Thank you for using nginx.</em></p></body></html>`;
const cf1101Page = (hostName, ip) => `<!DOCTYPE html><html><head><title>${hostName} | 1101: Worker threw a JavaScript exception</title></head><body><div id="cf-wrapper"><h1>Error 1101</h1><h2>Ray ID: 1101-${Math.random().toString(36).slice(2, 14)}</h2><p>You've requested a page on a website (${hostName}) that is on the Cloudflare network. Unfortunately, a Worker threw a JavaScript exception.</p><p>Cloudflare Ray ID: <strong>1101</strong> &middot; Your IP: ${ip || '0.0.0.0'} &middot; Performance &amp; security by Cloudflare</p></div></body></html>`;
// 响应头白名单（硬约束#4：绝不 Object.fromEntries 全量展开，避免带入 CSP/X-Frame-Options 破坏自家面板）
const _CAM_HDR_ALLOW = ['content-type', 'cache-control', 'etag', 'last-modified'];
// F1：反代 text 分支响应体上限 1MiB —— 反代的是真实站点 HTML/JSON，过小会误伤正常页面；超限回落 404（复用 _readCapped）
const _CAM_BODY_MAX = 1048576;
// F3：A-8 反代**专用**「内部域名后缀」黑名单（DNS 层兜底）。只作用于反代路径，**不改 `_extHostSafe` 本体**（避免波及其他已验证路径）。
// 说明：Workers 无法在 fetch 前预解析域名，故对「解析到内网/169.254.169.254 的域名」只能做后缀/名称启发式拦截；残余风险见 README。
const _CAM_BLOCK_SUFFIX = ['.localhost', '.local', '.internal', '.lan', '.home', '.localdomain', '.intranet', '.corp'];
const _camHostBlocked = (h) => {
    const x = String(h || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    return x === 'localhost' || _CAM_BLOCK_SUFFIX.some(sfx => x.endsWith(sfx));
};
// F3：DoH 预解析 + 封禁段校验（复用既有 _dohQ 通道 + _extHostSafe 位掩码校验，不新造）。
// Workers 无法在 fetch 前钉死第三方域名解析（cf.resolveOverride 仅同 zone 生效），此为本平台内最实质的收敛。
// fail-closed：解析不出 / 任一解析结果命中封禁段 → 拒绝（不猜、不放行）。字面量 IP 直接复用闸门（不做 DoH）。
const _camResolveSafe = async (hostname) => {
    const h = String(hostname || '').replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (h.includes(':') || _v4(h)) return _extHostSafe(h).ok;      // 字面量 IP：调用方已过 _extHostSafe，这里复核
    let ips = [];
    try {
        const [a4, a6] = await Promise.all([_dohQ(h, 'A'), _dohQ(h, 'AAAA')]);
        ips = [...a4, ...a6].map(x => String(x).trim()).filter(Boolean);
    } catch (e) { return false; }
    if (!ips.length) return false;                                 // 解析不出 → 拒绝（fail-closed）
    for (const ip of ips) { if (!_extHostSafe(ip).ok) return false; }   // 任一解析结果命中封禁段 → 拒绝
    return true;
};
// F4-b：/admin/check 结果整形（纯函数，便于离线单测）。
// 所用 TLS 实现不校验证书链 → 输出不保证真实性；此处只做**格式闸门**：ip 必须是合法 IPv4/IPv6 字面量，否则判响应异常。
function _adminCheckResult(ip, loc, tag, t0) {
    const _ip = String(ip || '').trim();
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(_ip) && !/^[0-9a-f:]+$/i.test(_ip))
        return { success: false, proxy: tag, error: 'trace 响应格式异常', responseTime: Date.now() - t0 };
    let _loc = String(loc || '').trim();
    if (_loc && !/^[A-Z]{2}$/.test(_loc)) _loc = '';      // 非法 loc 直接清空，不外显
    return { success: true, proxy: tag, ip: _ip, loc: _loc, responseTime: Date.now() - t0 };
}
// 反代：归一化（http:// 强制升级为 https://）+ SSRF 闸门 + 头剥离 + 白名单拷贝；任何失败返回 null（调用方回 404）
async function _camouflageReverse(rawUrl, r, url, host) {
    try {
        let s = String(rawUrl || '').trim().replace(/\/+$/, '');
        if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
        s = s.replace(/^http:\/\//i, 'https://');              // 硬约束#5：http:// 强制升级（不拒绝）
        const u = new URL(s);
        if (u.protocol !== 'https:') return null;
        if (!_extHostSafe(u.hostname).ok) return null;          // ★ 硬约束#1：SSRF 闸门（复用既有校验，不新造）
        if (_camHostBlocked(u.hostname)) return null;           // ★ F3：内部域名后缀黑名单（仅 A-8 路径）
        if (!(await _camResolveSafe(u.hostname))) return null;  // ★ F3：DoH 预解析 + 封禁段校验（fail-closed）
        const h = new Headers(r.headers);
        for (const k of ['cookie', 'authorization', 'proxy-authorization', 'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor', 'cf-worker', 'x-real-ip', 'x-forwarded-for', 'x-forwarded-proto', 'true-client-ip']) h.delete(k);   // P1：会话 cookie / 客户端标识不出站
        h.set('Host', u.host); h.set('Referer', u.origin); h.set('Origin', u.origin);
        const init = { method: r.method, headers: h, redirect: 'manual' };
        if (r.method !== 'GET' && r.method !== 'HEAD' && r.body) { init.body = r.body; init.duplex = 'half'; }
        const up = await fetch(u.origin + url.pathname + url.search, init);
        const outH = new Headers();
        for (const k of _CAM_HDR_ALLOW) { const v = up.headers.get(k); if (v) outH.set(k, v); }
        outH.set('Cache-Control', 'no-store');
        outH.set('X-Content-Type-Options', 'nosniff');
        outH.delete('Location'); outH.delete('Set-Cookie');     // ★ 硬约束#2/#3：绝不透出（开放重定向 / 会话劫持）
        const ct = up.headers.get('content-type') || '';
        if (/text|javascript|json|xml/i.test(ct)) {
            let body;
            try { body = await _readCapped(up, _CAM_BODY_MAX); } catch (e) { return null; }   // ★ F1：超 1MiB → cancel + 回落 404（不撑爆内存）
            return new Response(body.split(u.host).join(host), { status: up.status, headers: outH });   // 响应体域名替换（对齐 EDT）
        }
        return new Response(up.body, { status: up.status, headers: outH });
    } catch (e) { return null; }
}

// ---- A-9：链式代理 /video/<base64Secret>（仅 Workers；默认关闭，需 CHAIN_PROXY=1）----
const _CHAIN_TYPES = ['socks5', 'http', 'https', 'turn', 'sstp'];
// 密钥派生（硬约束#2）：HKDF-SHA256(ikm=UUID, salt='chain', info='chain') → AES-256-GCM；不直接用 UUID
async function _chainKey(uuid) {
    const enc = new TextEncoder();
    const base = await crypto.subtle.importKey('raw', enc.encode(String(uuid)), 'HKDF', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('chain'), info: enc.encode('chain') }, base, 256);
    return crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['decrypt']);
}
const _b64uEncode = (u8) => { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
// 密文 = base64url( iv[12] || AES-GCM密文 )；被篡改 → GCM 认证失败抛错（硬约束#3，调用方静默回落）
async function _chainDecrypt(secret, uuid) {
    const raw = b64uToU8(String(secret).replace(/\+/g, '-').replace(/\//g, '_'));
    if (!raw || raw.length < 13) throw new Error('bad secret');
    const key = await _chainKey(uuid);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, key, raw.subarray(12));
    return new TextDecoder().decode(pt);
}
// 明文 type → 连接器可消费的全局代理配置（对齐 pCfg 各分支的 cfg 形状）
function _chainGp(type, hostname, port, username, password) {
    if (type === 'socks5') return { type: 'socks5', cfg: { username, password, hostname, port } };
    if (type === 'http')   return { type: 'http', cfg: { username, password, hostname, port } };
    if (type === 'https')  return { type: 'http', cfg: { username, password, hostname, port, tls: 1 } };
    if (type === 'sstp')   return { type: 'sstp', cfg: { host: hostname, port, user: username || 'vpn', password: password || 'vpn' } };
    if (type === 'turn')   return { type: 'turn', cfg: { hostname, port, username: username || null, password: password || null, tls: false } };
    return null;
}
// 解析 /video/<密文> → 全局代理配置；任何不合法 → null（静默回落，绝不抛 500）
async function chainProxyCfg(req, path, env) {
    const upg = String((req && req.headers && req.headers.get('Upgrade')) || '').toLowerCase();
    if (upg !== 'websocket') return null;                       // ★ 硬约束#4：仅 WS 升级请求走链式
    let on = '';
    try { on = String(await getSafeEnv(env, 'CHAIN_PROXY', '')); } catch (e) { on = ''; }
    if (!['1', 'true'].includes(on.toLowerCase())) return null; // ★ 默认关闭
    const m = String(path || '').match(/(?:^|\/)video\/(.+)$/i);   // ws() 传入的 path 无前导斜杠
    if (!m) return null;
    try {
        const obj = JSON.parse(await _chainDecrypt(m[1].replace(/\/+$/, ''), CFG.id));
        if (Number(obj && obj.v) !== 1) throw new Error('bad ver');                                  // ★ F4-a：版本闸门（为未来轮换留路）
        const _ct = Number(obj && obj.t);
        if (!Number.isFinite(_ct) || Date.now() / 1000 - _ct > 2592000) throw new Error('expired');  // ★ F4-a：30 天有效期（无 t / 超期 → 回落）
        const type = String((obj && obj.type) || '').toLowerCase();
        const hostname = String((obj && obj.hostname) || '');
        const port = Number(obj && obj.port);
        if (!_CHAIN_TYPES.includes(type)) throw new Error('bad type');                        // ★ 硬约束#6
        if (!hostname || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('bad host/port');
        if (!_extHostSafe(hostname).ok) throw new Error('ssrf');                              // ★ 硬约束#1：SSRF 闸门
        if (!(await _camResolveSafe(hostname))) throw new Error('ssrf-dns');                  // ★ F3：DoH 预解析 + 封禁段校验
        return { pIP: null, s5: null, enS: null, turn: null, gP: _chainGp(type, hostname, port, obj.username, obj.password), order: ['gP'] };
    } catch (e) { return null; }                                // 解密/解析失败 → 静默回落
}

/* ---------- WebSocket 入口 ---------- */
const ws = async (req, env) => {
  // URL 编码修复（%3F 被转义进 path 的场景）
  const url = new URL(req.url);
  if (url.pathname.includes('%3F')) {
    try {
      const decoded = decodeURIComponent(url.pathname);
      const queryIndex = decoded.indexOf('?');
      if (queryIndex !== -1) {
        url.search = decoded.substring(queryIndex);
        url.pathname = decoded.substring(0, queryIndex);
      }
    } catch (e) { /* 非法百分号编码：保留原值，安全降级（与 pCfg 一致，不抛 500） */ }
  }
  const path = url.pathname.slice(1);

  let routeCfg;
  let fbPIP = null;
  try { fbPIP = await getSafeEnv(env, 'PROXYIP', DEFAULT_PROXY_IP); } catch (e) { fbPIP = DEFAULT_PROXY_IP; }
  if (fbPIP) fbPIP = String(fbPIP).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  // A-9：链式代理 —— 仅当 CHAIN_PROXY=1 且本请求为 WS 升级时，尝试从 /video/<密文> 解出全局代理；否则正常解析
  let _chainCfg = null;
  try { _chainCfg = await chainProxyCfg(req, path, env); } catch (e) { _chainCfg = null; }
  try { routeCfg = _chainCfg || pCfg(url, path, fbPIP); }
  catch { return new Response('Invalid proxy config', { status: 400 }); }

  const [client, server] = Object.values(new WebSocketPair());
  server.accept({ allowHalfOpen: true });
  server.binaryType = 'arraybuffer';
  const fetcher = req.fetcher;

  const edStr = req.headers.get('sec-websocket-protocol');
  let ed = null;
  if (edStr && edStr.length <= CFG.maxED * 4 / 3 + 4) {
    try {
      ed = /** @type {*} */ (Uint8Array).fromBase64(edStr, { alphabet: 'base64url' });
    } catch (e) {
      ed = b64uToU8(edStr);
    }
  }

  let curW = null, sock = null, closed = false, busy = false;
  const uq = mkQ(CFG.upPack);

  const wither = () => {
    if (closed) return;
    closed = true;
    uq.clear();
    try { curW?.releaseLock(); } catch {}
    try { sock?.close(); } catch {}
    try { server.close(); } catch {}
  };

  const toU8 = d => d instanceof Uint8Array ? d : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : new Uint8Array(d);
  const sow = d => {
    const u = toU8(d), n = u.byteLength;
    if (!n) return 1;
    if (uq.sow(u)) return 1;
    wither();
    return 0;
  };

  const thresh = async () => {
    if (busy || closed) return;
    busy = true;
    try {
      for (;;) {
        if (closed) break;
        if (!sock) {
          const [d] = uq.bundle();
          if (!d) break;
          const r = parseVP(d);
          if (!r) throw wither();
          server.send(new Uint8Array([d[0], 0]));
          const host = addr(r.addrType, r.targetAddrBytes), port = r.port;
          const payload = d.subarray(r.dataOffset);
          sock = await tryCon(fetcher, r.addrType, host, port, routeCfg, env);
          if (closed) { try { sock?.close(); } catch {} sock = null; break; }   // D3：建连期间已 wither → 关掉迟到的 socket
          if (!sock) throw wither();
          curW = sock.writable.getWriter();
          const [first] = uq.bundle(payload);
          first?.byteLength && await curW.write(first);
          mill(sock.readable, server).finally(() => wither());
          continue;
        }
        const [d] = uq.bundle();
        if (!d) break;
        await curW.write(d);
      }
    } catch { wither(); }
    finally {
      busy = false;
      !uq.empty && !closed && thresh();
    }
  };

  if (ed && sow(ed)) thresh();
  server.addEventListener('message', e => { closed || typeof e.data === 'string' || (sow(e.data) && thresh()); });   // D1：文本帧不入队（字符串会被 Uint8Array 当长度解析）
  server.addEventListener('close', () => wither());
  server.addEventListener('error', () => wither());

  return new Response(null, { status: 101, webSocket: client, headers: _chainCfg ? { 'Sec-WebSocket-Extensions': '', 'Referrer-Policy': 'no-referrer' } : { 'Sec-WebSocket-Extensions': '' } });
};

// =============================================================================
// 🔭 批次 6：可观测性（低频结构化日志 + SLO 探针 + TG 推送可见性）
// -----------------------------------------------------------------------------
// ① 热路径零日志：WS / xHTTP 每帧、每连接路径上**不得**出现 obs() 调用
// ② 单行 JSON：字段均为枚举/标量，Workers Logs / `wrangler tail` 可直接检索
// ③ obs 只**同步**读 env.*（不查 D1）→ 零异步、零热路径开销
// ④ 敏感值一律不落日志：cookie / token / 口令 / UUID / AUTH_SECRET / bot token / IP
// ⑤ 按事件节流（60s/ev），错误也不刷屏；被抑制的条数计入 drop 字段
// =============================================================================
const OBS_LV = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const OBS_THROTTLE_MS = 60000;
const _obsSt = { last: Object.create(null), drop: Object.create(null), n: 0 };
function _obsReset() { _obsSt.last = Object.create(null); _obsSt.drop = Object.create(null); _obsSt.n = 0; }
// 值脱敏：抹掉可能夹带的凭据（UUID / bot token / 长 hex），并截断长度
function obsScrub(v, max = 160) {
  let s;
  try { s = (typeof v === 'string') ? v : String(v); } catch (e) { return '[unstringifiable]'; }
  s = String(s == null ? '' : s)
    .replace(/\bhttps?:\/\/[^\s"'<>]+/gi, '[url]')          // F2：抹除明文 URL（防内网地址 / 查询串里的凭据外泄）
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[uuid]')
    .replace(/\d{6,12}:[A-Za-z0-9_-]{30,}/g, '[bot_token]')
    .replace(/\b[0-9a-f]{32,}\b/gi, '[hex]');
  return s.length > max ? s.slice(0, max) + '…(' + s.length + ')' : s;
}
// 路由枚举：日志只记**枚举值**，绝不记原始 pathname
// ⚠️ `/{SUB_PASSWORD}` 的 pathname 本身就是明文订阅口令 → 必须归一化（单段未知路径统一归为 path_pw_or_404）
function routeEnum(pathname) {
  const p = String(pathname || '');
  if (p === '' || p === '/') return 'root';
  if (p === '/health') return 'health';
  if (p === '/robots.txt') return 'robots';
  if (p === '/logout') return 'logout';
  if (p === '/admin/check') return 'admin_check';
  if (p === '/sub') return 'sub_query';
  if (p === '/tg/webhook') return 'tg_webhook';
  if (p === '/favicon.ico') return 'favicon';
  if (p === '/version') return 'version';
  if (/^\/[^/]+$/.test(p)) return 'path_pw_or_404';   // `/{SUB_PASSWORD}` 或未知单段 → 归一
  return 'other';
}
// 第七轮（E6 后续）：脱敏由**黑名单**改**白名单** —— 只放行已知安全的键，其余一律 [redacted]。
// 理由：黑名单永远漏键，且新增字段默认放行不可控（如 E6 补的 `key` 会误伤 `keyword`）；白名单默认拒绝更稳。
// 白名单必须覆盖**全部** obs 调用点的键；新增字段须显式登记。
// `route` 仍是枚举（由 routeEnum 产出，如 path_pw_or_404），绝不落原始 pathname。
// 注意：error/msg/message/host/hostname/url/target/proxy/key/password/cookie/token/uuid… 均**不在**白名单 → 一律脱敏。
// F2：`err` 例外 —— 它在册（否则 d1_ping_fail 等丢失诊断文本），但白名单内的字符串仍强制过 `obsScrub`（URL/bot token/hex/UUID 一律抹除）。
const _OBS_ALLOW = new Set(['ts', 'lvl', 'ev', 'n', 'drop', 'route', 'why', 'streak', 'db', 'degraded', 'had', 'left_s', 'len', 'cron', 'tbl', 'retry', 'err']);
function obsRedact(extra) {
  const out = {};
  if (!extra || typeof extra !== 'object') return out;
  for (const k of Object.keys(extra)) {
    const v = extra[k];
    if (!_OBS_ALLOW.has(k)) { out[k] = '[redacted]'; continue; }   // 白名单外一律脱敏
    if (v && typeof v === 'object') out[k] = '[obj]';
    else if (typeof v === 'string') out[k] = obsScrub(v, 120);
    else out[k] = v;
  }
  return out;
}
// obs(lvl, ev, extra?, env?) —— 同步、可直接在 catch 里调用；返回是否真的输出
function obs(lvl, ev, extra, env) {
  try {
    // 优化3：OBS_ENABLED 一并支持 D1 配置（同步读 _cfgCache，避免把 obs 改成 async 污染调用点）；env 显式配置优先
    let _oe = env ? env.OBS_ENABLED : undefined;
    if (_oe === undefined || _oe === null || _oe === '') {
      try { const _m = _cfgCache && _cfgCache.map; if (_m && _m.has('OBS_ENABLED')) _oe = _m.get('OBS_ENABLED'); } catch (e) { }
    }
    if (String(_oe) === 'false') return false;
    const name = String(ev || 'unknown');
    const lv = OBS_LV[lvl] !== undefined ? OBS_LV[lvl] : OBS_LV.info;
    let min = OBS_LV.info;
    if (env && typeof env.OBS_MIN_LEVEL === 'string' && OBS_LV[env.OBS_MIN_LEVEL.toLowerCase()] !== undefined) min = OBS_LV[env.OBS_MIN_LEVEL.toLowerCase()];
    if (lv < min) return false;
    const now = Date.now();
    if (now - (_obsSt.last[name] || 0) < OBS_THROTTLE_MS) { _obsSt.drop[name] = (_obsSt.drop[name] || 0) + 1; return false; }
    _obsSt.last[name] = now;
    const rec = { ts: new Date(now).toISOString(), lvl: lvl, ev: name, n: ++_obsSt.n };
    if (_obsSt.drop[name]) { rec.drop = _obsSt.drop[name]; _obsSt.drop[name] = 0; }
    const e = obsRedact(extra);
    for (const k of Object.keys(e)) if (!(k in rec)) rec[k] = e[k];
    const line = JSON.stringify(rec);
    if (lv >= OBS_LV.error) console.error(line); else if (lv >= OBS_LV.warn) console.warn(line); else console.log(line);
    return true;
  } catch (e) { return false; }
}

// =============================================================================
// 🗄️ 存储与配置
// =============================================================================
/* ---------- D1 config 全量缓存（30s TTL + 单飞加载；写路径调 cfgCacheReset 立即失效） ----------
 * 原实现每个未设键每次请求单独查一次 config 表，代理连接入口要串行打 ~40 次 D1；
 * 现改为每隔离实例 30s 缓存一张全表，所有键从内存解析 */
const _cfgCache = { t: 0, map: null, p: null };
// E4：面板改配置时一并失效 GO2SOCKS5 白名单缓存（否则要等 isolate 回收才生效）
function cfgCacheReset() { _cfgCache.t = 0; _cfgCache.map = null; try { _GO2S5 = null; } catch (e) { } }
function _cfgFresh() { return _cfgCache.map && Date.now() - _cfgCache.t < 30000; }
async function _cfgLoad(env) {
    const m = new Map();
    try {
        const { results } = await env.DB.prepare("SELECT key, value FROM config").all();
        for (const row of (results || [])) if (row && row.key) m.set(row.key, row.value);
    } catch(e) { obs('warn', 'd1_read_fail', { tbl: 'config' }, env); _cfgCache.map = null; _cfgCache.t = 0; return m; }   // P2：读失败不缓存空表
    _cfgCache.map = m; _cfgCache.t = Date.now();
    return m;
}
async function getSafeEnv(env, key, fallback) {
    const ev = env ? env[key] : undefined;
    if (typeof ev === 'string') { if (ev.trim() !== '') return ev; }
    else if (ev !== undefined && ev !== null && typeof ev !== 'object' && typeof ev !== 'function') return String(ev);   // P2：数字/布尔型 vars 转字符串
    if (env.DB) {
        if (!_cfgFresh()) { if (!_cfgCache.p) _cfgCache.p = _cfgLoad(env).finally(() => { _cfgCache.p = null; }); await _cfgCache.p; }
        const v = _cfgCache.map && _cfgCache.map.get(key);
        if (v) return v;
    }
    return fallback;
}
/* ---------- 多值分隔工具（CF 新版环境变量 UI 只能单行输入，不再支持回车换行） ----------
 * 分隔符不区分中英文：换行 / 半角空格 / Tab / 全角空格 / 英文逗号 , / 中文逗号 ， / 顿号 、
 * splitMulti    : 全部分隔符一律切开。用于 URL、IP 等本身不含空格和逗号的值
 * splitNodeList : ADD 专用。先按行切（保留 # 注释行过滤），行内再切；
 *                 「不像新条目开头」的碎片回贴到上一条备注名，防止 #备注名 含空格/逗号被误切
 */
const SEP_RE = /[\s,，、]+/;
const splitMulti = (value) => String(value || '').split(SEP_RE).map(s => s.trim()).filter(Boolean);
const splitCSV = splitMulti; // 兼容旧调用名（WL_IP / ADMIN_IP）
const splitNodeList = (value) => {
    const looksLikeAddr = (s) => { const h = String(s).split('#')[0]; return h.includes('.') || h.includes(':'); };
    // 逗号/顿号仅在「后续每一段都像新条目」时才视为分隔符，否则原样保留在备注名里（不破坏 #美国，洛杉矶）
    const byComma = (tok) => {
        if (!/[,，、]/.test(tok)) return [tok];
        const parts = tok.split(/[,，、]/);
        return parts.slice(1).every(looksLikeAddr) ? parts : [tok];
    };
    const out = [];
    for (const rawLine of String(value || '').split(/[\n\r]+/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue; // 空行 / 整行注释
        let cur = '';
        for (const raw of line.split(/\s+/)) { // \s 已覆盖全角空格 U+3000
            if (!raw) continue;
            for (const tok of byComma(raw)) {
                if (!tok) continue;
                if (looksLikeAddr(tok) || !cur) { if (cur) out.push(cur); cur = tok; }
                else cur += ' ' + tok; // 不像新条目 → 并回上一条的备注名
            }
        }
        if (cur) out.push(cur);
    }
    return out;
};
const _throttleMap = new Map();
let _tCnt = 0;
function isThrottled(ip, action, ttlMs = 30000) {
    const key = `${ip}|${action}`;
    const now = Date.now();
    if (_throttleMap.get(key) > now) return true;
    _throttleMap.set(key, now + ttlMs);
    if (++_tCnt >= 100) { _tCnt = 0; for (const [k, v] of _throttleMap) { if (v <= now) _throttleMap.delete(k); } }
    return false;
}
const parseLogTimeMs = (value) => {
    const m = (value || '').match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})$/);
    if (!m) return 0;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]) - 8, Number(m[5]), Number(m[6]));
};
const normalizeLogEntry = (log) => {
    if (!log) return null;
    const normalized = {
        id: Number(log.id || 0),
        time: log.time || '',
        ip: log.ip || '',
        region: log.region || '',
        action: log.action || ''
    };
    normalized.sortTime = parseLogTimeMs(normalized.time);
    return normalized;
};
async function getStoredDailyStats(env, dateStr) {
    if (env.DB) {
        try {
            const { results } = await env.DB.prepare("SELECT count FROM stats WHERE date = ?").bind(dateStr).all();
            const val = results[0]?.count;
            if (val !== undefined && val !== null) return val.toString();
        } catch(e) {}
    }
    return "0";
}
async function checkWhitelist(env, ip) {
    if (!ip) return false;
    const envWL = await getSafeEnv(env, 'WL_IP', ADMIN_IP);
    if (splitCSV(envWL).includes(ip) || splitCSV(ADMIN_IP).includes(ip)) return true;
    if (env.DB) { try { const { results } = await env.DB.prepare("SELECT 1 FROM whitelist WHERE ip = ?").bind(ip).all(); if (results && results.length > 0) return true; } catch(e) {} }
    return false;
}
async function parseJSONBody(r) {
    try { return await r.json(); }
    catch (e) {
        try { return JSON.parse(await r.text()); }
        catch (_) { return null; }
    }
}
async function addWhitelist(env, ip) {
    const time = Date.now();
    let wroteDB = false, errors = [];
    if (env.DB) {
        try {
            await env.DB.prepare("INSERT OR IGNORE INTO whitelist (ip, created_at) VALUES (?, ?)").bind(ip, time).run();
            wroteDB = true;
        } catch(e) { errors.push(`D1:${e.message || e}`); }
    }
    return { ok: wroteDB, errors };
}
async function delWhitelist(env, ip) {
    let wroteDB = false, errors = [];
    if (env.DB) {
        try {
            await env.DB.prepare("DELETE FROM whitelist WHERE ip = ?").bind(ip).run();
            wroteDB = true;
        } catch(e) { errors.push(`D1:${e.message || e}`); }
    }
    return { ok: wroteDB, errors };
}
async function getAllWhitelist(env) {
    let systemSet = new Set(), manualSet = new Set();
    if(typeof ADMIN_IP !== 'undefined' && ADMIN_IP) splitCSV(ADMIN_IP).forEach(i => systemSet.add(i));
    const envWL = await getSafeEnv(env, 'WL_IP', ""); if(envWL) splitCSV(envWL).forEach(i => systemSet.add(i));
    if (env.DB) { try { const { results } = await env.DB.prepare("SELECT ip FROM whitelist ORDER BY created_at DESC").all(); results.forEach(row => manualSet.add(row.ip)); } catch(e) {} }
    let result = []; systemSet.forEach(ip => result.push({ ip: ip, type: 'system' }));
    manualSet.forEach(ip => { if (!systemSet.has(ip)) result.push({ ip: ip, type: 'manual' }); });
    return result;
}
async function logAccess(env, ip, region, action) {
    const time = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const safeIP = ip || 'Unknown';
    const safeRegion = region || 'Unknown';
    const safeAction = action || '';
    if (env.DB) {
        try {
            const _ins = env.DB.prepare("INSERT INTO logs (time, ip, region, action) VALUES (?, ?, ?, ?)").bind(time, safeIP, safeRegion, safeAction);
            const _del = env.DB.prepare("DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT 2000)");
            if (typeof env.DB.batch === 'function') await env.DB.batch([_ins, _del]);   // 官方 D1 batch：一次往返、事务化
            else { await _ins.run(); await _del.run(); }
        } catch (e) { obs('warn', 'd1_write_fail', { tbl: 'logs' }, env); }
    }
}
async function logAccessThrottled(env, ip, region, action, ttlSeconds = 30) {
    if (ttlSeconds > 0 && isThrottled(ip, action, ttlSeconds * 1000)) return;
    await logAccess(env, ip, region, action);
}
let _statsCleanDay = '';
// P2：每请求一次 D1 UPSERT 会在扫描流量下耗尽免费额度（100k 行写/天）→ isolate 内聚合，30s 或 200 次落一次
let _statsPending = 0, _statsLast = 0, _statsDay = '';
const STATS_FLUSH_MS = 30000, STATS_FLUSH_N = 200;
async function incrementDailyStats(env, force = false) {
    const dateStr = new Date().toISOString().split('T')[0];
    let result = "0";
    if (env.DB) {
        if (_statsDay && _statsDay !== dateStr && _statsPending) { try { await env.DB.prepare(`INSERT INTO stats (date, count) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET count = count + ?`).bind(_statsDay, _statsPending, _statsPending).run(); } catch (e) {} _statsPending = 0; }
        _statsDay = dateStr; _statsPending += 1;
        const now = Date.now();
        if (!force && now - _statsLast < STATS_FLUSH_MS && _statsPending < STATS_FLUSH_N) return result;
        const n = _statsPending; _statsPending = 0; _statsLast = now;
        try {
            await env.DB.prepare(`INSERT INTO stats (date, count) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET count = count + ?`).bind(dateStr, n, n).run();
            if (_statsCleanDay !== dateStr) { // 过期清理每天一次，不再逐连接执行；回读 SELECT 已去除（返回值无消费方）
                const cutoff = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                await env.DB.prepare("DELETE FROM stats WHERE date < ?").bind(cutoff).run();
                _statsCleanDay = dateStr;
            }
            result = "1";
        } catch(e) { obs('warn', 'd1_write_fail', { tbl: 'stats' }, env); }
    }
    return result;
}
async function getDynamicUUID(key, refresh = 86400) {
    const time = Math.floor(Date.now() / 1000 / refresh);
    const msg = new TextEncoder().encode(`${key}-${time}`);
    const hash = await crypto.subtle.digest('SHA-256', msg); const b = new Uint8Array(hash);
    return [...b.slice(0, 16)].map(n => n.toString(16).padStart(2, '0')).join('').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
}
async function getCloudflareUsage(env) {
    const Email = await getSafeEnv(env, 'CF_EMAIL', ""); const GlobalAPIKey = await getSafeEnv(env, 'CF_KEY', "");
    const AccountID = await getSafeEnv(env, 'CF_ID', ""); const APIToken = await getSafeEnv(env, 'CF_TOKEN', "");
    if (!AccountID && (!Email || !GlobalAPIKey)) return { success: false, msg: "未配置 CF 凭证" };
    const API = "https://api.cloudflare.com/client/v4"; const cfg = { "Content-Type": "application/json" };
    try {
        let finalAccountID = AccountID;
        if (!finalAccountID) { const r = await fetch(`${API}/accounts`, { method: "GET", headers: { ...cfg, "X-AUTH-EMAIL": Email, "X-AUTH-KEY": GlobalAPIKey } });
            if (!r.ok) throw new Error(`账户获取失败: ${r.status}`); const d = await r.json();
            const idx = d.result?.findIndex(a => a.name?.toLowerCase().startsWith(Email.toLowerCase())); finalAccountID = d.result?.[idx >= 0 ? idx : 0]?.id; }
        if(!finalAccountID) throw new Error("无法获取 Account ID");
        const now = new Date(); now.setUTCHours(0, 0, 0, 0);
        const hdr = APIToken ? { ...cfg, "Authorization": `Bearer ${APIToken}` } : { ...cfg, "X-AUTH-EMAIL": Email, "X-AUTH-KEY": GlobalAPIKey };
        const res = await fetch(`${API}/graphql`, { method: "POST", headers: hdr, body: JSON.stringify({ query: `query getBillingMetrics($AccountID: String!, $filter: AccountWorkersInvocationsAdaptiveFilter_InputObject) { viewer { accounts(filter: {accountTag: $AccountID}) { pagesFunctionsInvocationsAdaptiveGroups(limit: 1000, filter: $filter) { sum { requests } } workersInvocationsAdaptive(limit: 10000, filter: $filter) { sum { requests } } } } }`, variables: { AccountID: finalAccountID, filter: { datetime_geq: now.toISOString(), datetime_leq: new Date().toISOString() } } }) });
        if (!res.ok) throw new Error(`查询失败: ${res.status}`); const result = await res.json();
        const acc = result?.data?.viewer?.accounts?.[0]; const pages = acc?.pagesFunctionsInvocationsAdaptiveGroups?.reduce((t, i) => t + (i?.sum?.requests || 0), 0) || 0;
        const workers = acc?.workersInvocationsAdaptive?.reduce((t, i) => t + (i?.sum?.requests || 0), 0) || 0;
        return { success: true, total: pages + workers, pages, workers };
    } catch (e) { return { success: false, msg: e.message }; }
}
async function getZoneUsage(env) {
  const ZoneID = await getSafeEnv(env, 'CF_ZONE_ID', "");
  if (!ZoneID) return { success: false, msg: "未配置 CF_ZONE_ID" };
  const Email = await getSafeEnv(env, 'CF_EMAIL', ""); const GlobalAPIKey = await getSafeEnv(env, 'CF_KEY', "");
  const APIToken = await getSafeEnv(env, 'CF_TOKEN', "");
  if (!APIToken && (!Email || !GlobalAPIKey)) return { success: false, msg: "未配置 CF 凭证" };
  const cfg = { "Content-Type": "application/json" };
  const hdr = APIToken ? { ...cfg, "Authorization": `Bearer ${APIToken}` } : { ...cfg, "X-AUTH-EMAIL": Email, "X-AUTH-KEY": GlobalAPIKey };
  try {
    const today = new Date().toISOString().split('T')[0];
    const res = await fetch("https://api.cloudflare.com/client/v4/graphql", { method: "POST", headers: hdr, body: JSON.stringify({ query: `query($zoneTag:String!,$since:String!){viewer{zones(filter:{zoneTag:$zoneTag}){httpRequests1dGroups(limit:1,filter:{date_geq:$since}){sum{requests cachedRequests bytes threats}}}}}`, variables: { zoneTag: ZoneID, since: today } }) });
    if (!res.ok) throw new Error(`查询失败: ${res.status}`);
    const result = await res.json();
    const g = result?.data?.viewer?.zones?.[0]?.httpRequests1dGroups?.[0]?.sum;
    if (!g) return { success: false, msg: "无数据或 Zone ID 错误" };
    return { success: true, requests: g.requests || 0, cached: g.cachedRequests || 0, bytes: g.bytes || 0, threats: g.threats || 0 };
  } catch (e) { return { success: false, msg: e.message }; }
}
async function getZoneDetail(env) {
  const ZoneID = await getSafeEnv(env, 'CF_ZONE_ID', "");
  if (!ZoneID) return { success: false };
  const Email = await getSafeEnv(env, 'CF_EMAIL', ""); const GlobalAPIKey = await getSafeEnv(env, 'CF_KEY', "");
  const APIToken = await getSafeEnv(env, 'CF_TOKEN', "");
  if (!APIToken && (!Email || !GlobalAPIKey)) return { success: false };
  const cfg = { "Content-Type": "application/json" };
  const hdr = APIToken ? { ...cfg, "Authorization": `Bearer ${APIToken}` } : { ...cfg, "X-AUTH-EMAIL": Email, "X-AUTH-KEY": GlobalAPIKey };
  try {
    const since = new Date(); since.setUTCHours(0, 0, 0, 0);
    const q = `query($z:String!,$s:Time!){viewer{zones(filter:{zoneTag:$z}){`
      + `byCountry:httpRequestsAdaptiveGroups(limit:5,filter:{datetime_geq:$s},orderBy:[count_DESC]){count dimensions{clientCountryName}}`
      + `byStatus:httpRequestsAdaptiveGroups(limit:5,filter:{datetime_geq:$s},orderBy:[count_DESC]){count dimensions{edgeResponseStatus}}`
      + `byDevice:httpRequestsAdaptiveGroups(limit:5,filter:{datetime_geq:$s},orderBy:[count_DESC]){count dimensions{clientDeviceType}}`
      + `}}}`;
    const res = await fetch("https://api.cloudflare.com/client/v4/graphql", { method: "POST", headers: hdr, body: JSON.stringify({ query: q, variables: { z: ZoneID, s: since.toISOString() } }) });
    if (!res.ok) return { success: false };
    const j = await res.json();
    const z = j && j.data && j.data.viewer && j.data.viewer.zones && j.data.viewer.zones[0];
    if (!z) return { success: false };
    const pick = (arr, dim) => (arr || []).map(x => ({ k: (x.dimensions && x.dimensions[dim]) || '?', c: x.count || 0 }));
    return { success: true, countries: pick(z.byCountry, 'clientCountryName'), statuses: pick(z.byStatus, 'edgeResponseStatus'), devices: pick(z.byDevice, 'clientDeviceType') };
  } catch (e) { return { success: false }; }
}
/* ---------- 批次 6：TG 推送可见性（连续失败计数 → 降级 → 恢复单次告警） ----------
 * 改动前：sendTgMsg 是 fire-and-forget，fetch 失败被 .catch(()=>{}) 吞掉；
 *        pushDashboard 的 edit→send 两级兜底若都失败，运维侧**零信号**。
 * 改动后：失败计数入 D1（无 D1 时退化为 isolate 内存）+ 结构化日志；
 *        连续失败 ≥3 次进降级冷却（TG_DEGRADE_MS 内不再反复尝试）；
 *        恢复时发**一条**通知，且该条不参与失败计数（避免自激循环）。
 */
const TG_FAIL_DEGRADE = 3;
const TG_DEGRADE_MS = 600000;
let _tgStreakMem = 0, _tgDegradedMem = 0, _tgRecoverMem = false;
async function tgStreak(env) {
  if (env && env.DB) { const n = parseInt(await getSafeEnv(env, '_tg_fail_streak', ''), 10); return Number.isFinite(n) ? n : 0; }
  return _tgStreakMem;
}
async function tgDegradedUntil(env) {
  if (env && env.DB) { const n = parseInt(await getSafeEnv(env, '_tg_degraded_until', ''), 10); return Number.isFinite(n) ? n : 0; }
  return _tgDegradedMem;
}
async function _tgSet(env, key, val, which) {
  if (env && env.DB && await _dashWrite(env, key, val)) return true;
  const n = parseInt(val, 10);
  if (which === 'streak') _tgStreakMem = Number.isFinite(n) ? n : 0; else _tgDegradedMem = Number.isFinite(n) ? n : 0;
  return false;
}
async function tgFailBump(env, route, why) {
  _tgRecoverMem = false;
  const n = (await tgStreak(env)) + 1;
  await _tgSet(env, '_tg_fail_streak', String(n), 'streak');
  const dg = n >= TG_FAIL_DEGRADE;
  if (dg) await _tgSet(env, '_tg_degraded_until', String(Date.now() + TG_DEGRADE_MS), 'degraded');
  obs('error', 'tg_fail', { route: route || 'unknown', why: why || 'unknown', streak: n, db: (env && env.DB) ? 1 : 0, degraded: dg ? 1 : 0 }, env);
  return n;
}
async function tgFailClear(env, route) {
  const n = await tgStreak(env);
  if (n > 0) {
    await _tgSet(env, '_tg_fail_streak', '0', 'streak');
    await _tgSet(env, '_tg_degraded_until', '0', 'degraded');
    obs('warn', 'tg_recovered', { route: route || 'unknown', had: n }, env);
  }
  return n;
}
async function sendTgMsg(ctx, env, title, r, detail = "", isAdmin = false) {
  const token = await getSafeEnv(env, 'TG_BOT_TOKEN', TG_BOT_TOKEN); const chat_id = await getSafeEnv(env, 'TG_CHAT_ID', TG_CHAT_ID);
  if (!token || !chat_id) return;
  let icon = "📡"; if (title.includes("登录")) icon = "🔐"; else if (title.includes("订阅")) icon = "🔄"; else if (title.includes("检测")) icon = "🔍"; else if (title.includes("点击")) icon = "🌟";
  const roleTag = isAdmin ? "🛡️ <b>管理员操作</b>" : "👤 <b>用户访问</b>";
  try {
    const url = new URL(r.url); const ip = r.headers.get('cf-connecting-ip') || 'Unknown'; const ua = r.headers.get('User-Agent') || 'Unknown'; const city = r.cf?.city || 'Unknown'; const time = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const safe = (str) => (str || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const text = `<b>${icon} ${safe(title)}</b>\n${roleTag}\n\n` + `<b>🕒 时间:</b> <code>${time}</code>\n` + `<b>🌍 IP:</b> <code>${safe(ip)}</code>\n` + `<b>🔗 域名:</b> <code>${safe(url.hostname)}</code>\n` + `<b>🛣️ 路径:</b> <code>${safe(url.pathname)}</code>\n` + `<b>📱 客户端:</b> <code>${safe(ua)}</code>\n` + (detail ? `<b>ℹ️ 详情:</b> ${safe(detail)}` : "");
    const params = { chat_id: chat_id, text: text, parse_mode: 'HTML', disable_web_page_preview: true };
    const rt = routeEnum(url.pathname);   // 明文口令路径在此归一化；日志只记枚举
    const p = fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) })
      .then(async (res) => {
        let bad = !res || !res.ok, why = 'http_' + ((res && res.status) || 0);
        // TG 业务错误常以 HTTP 200 + {"ok":false} 返回，必须读 body 才看得见
        if (!bad) { try { const t = await res.text(); if (/"ok"\s*:\s*false/.test(t)) { bad = true; why = 'api_false'; } } catch (e) {} }
        if (bad) { await tgFailBump(env, rt, why); return; }
        const had = await tgFailClear(env, rt);
        // 降级后首次成功 → 只发**一条**恢复通知；该条不参与失败计数（不再走 tgFailBump）
        if (had >= TG_FAIL_DEGRADE && !_tgRecoverMem) {
          _tgRecoverMem = true;
          try { await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat_id, text: `✅ TG 推送已恢复（此前连续失败 ${had} 次）` }) }).catch(() => {}); } catch (e) {}
        }
      })
      .catch(async () => { await tgFailBump(env, rt, 'network'); });
    if(ctx && ctx.waitUntil) ctx.waitUntil(p);
  } catch(e) {}
}

// =============================================================================
// 📊 CF 用量 TG 仪表盘（Cron 实时刷新 + /stats 命令）
// =============================================================================
async function tgApi(token, method, params) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params)
    });
    return await res.json();
  } catch (e) { return null; }
}
function fmtCfStats(cur, last, zone) {
  const DAILY = 100000;
  const fmt = n => (Number(n) || 0).toLocaleString('en-US');
  const fmtBytes = n => { n = Number(n) || 0; if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB'; if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB'; if (n >= 1e3) return (n / 1e3).toFixed(1) + ' KB'; return n + ' B'; };
  const total = cur.total || 0;
  const ratio = Math.min(1, total / DAILY);
  const pct = (ratio * 100).toFixed(1);
  const remain = Math.max(0, DAILY - total);
  const BARS = 15, filled = Math.round(ratio * BARS);
  const bar = '▓'.repeat(filled) + '░'.repeat(BARS - filled);
  const light = ratio < 0.5 ? '🟢' : ratio < 0.8 ? '🟡' : '🔴';
  let trend = '─';
  if (last != null && Number.isFinite(Number(last))) {
    const d = total - Number(last);
    trend = d > 0 ? `▲ +${fmt(d)}` : d < 0 ? `▼ ${fmt(d)}` : '─ 0';
  }
  const time = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  let out = `<b>📊 Cloudflare 用量监控</b>\n\n` +
    `${light} 已用 ${pct}%\n` +
    `<code>${bar}</code>\n` +
    `<code>${fmt(total)} / ${fmt(DAILY)}</code>\n\n` +
    `⚡ Workers   <code>${fmt(cur.workers || 0)}</code>\n` +
    `📄 Pages      <code>${fmt(cur.pages || 0)}</code>\n` +
    `💚 剩余     <code>${fmt(remain)}</code>\n` +
    `📈 趋势     ${trend}`;
  if (zone && zone.success) {
    const cacheRate = zone.requests > 0 ? ((zone.cached / zone.requests) * 100).toFixed(1) : '0.0';
    out += `\n\n━━━━━━━━━━━━━━━\n` +
      `<b>🌐 区域流量 (Zone)</b>\n` +
      `📨 总请求   <code>${fmt(zone.requests)}</code>\n` +
      `🛡️ 威胁拦截  <code>${fmt(zone.threats)}</code>\n` +
      `💾 缓存率   <code>${cacheRate}%</code>\n` +
      `📦 流量    <code>${fmtBytes(zone.bytes)}</code>`;
  }
  out += `\n\n🕐 ${time} 北京`;
  return out;
}
function fmtZoneDetail(d) {
  if (!d || !d.success) return '';
  const fmt = n => (Number(n) || 0).toLocaleString('en-US');
  const seg = (title, arr, emoji) => (!arr || !arr.length) ? '' : `\n${emoji} <b>${title}</b>\n` + arr.map(x => `  ${x.k}  <code>${fmt(x.c)}</code>`).join('\n');
  const body = seg('国家 Top5', d.countries, '🌍') + seg('状态码 Top5', d.statuses, '📊') + seg('设备 Top5', d.devices, '📱');
  return body ? `\n\n━━━━━━━━━━━━━━━` + body : '';
}
async function _dashRead(env, keys) {
  const out = {};
  if (env.DB) {
    try {
      const ph = keys.map(() => '?').join(',');
      const { results } = await env.DB.prepare(`SELECT key, value FROM config WHERE key IN (${ph})`).bind(...keys).all();
      for (const row of (results || [])) out[row.key] = row.value;
    } catch (e) {}
  }
  return out;
}
// P2：仅当键不存在时写入，随后**直读** D1（绕过 30s 缓存）返回实际值；失败返回 ''
async function _dashWriteAbsent(env, key, value) {
  if (!env.DB) return '';
  try {
    await env.DB.prepare("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING").bind(key, String(value)).run();
    const { results } = await env.DB.prepare("SELECT value FROM config WHERE key = ?").bind(key).all();
    const v = results && results[0] && results[0].value;
    try { cfgCacheReset(); } catch (e) {}
    return v ? String(v) : '';
  } catch (e) { obs('error', 'd1_write_fail', { tbl: 'config' }, env); return ''; }
}
async function _dashWrite(env, key, value) {
  // R1-a：返回写入是否成功（原先吞掉全部异常，调用方无法判断值是否已持久化）
  if (!env.DB) return false;
  // 批次 6：写库失败留 signal（不记录 key/value，避免配置值进日志）
  try { await env.DB.prepare("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?").bind(key, String(value), String(value)).run(); } catch (e) { obs('error', 'd1_write_fail', { tbl: 'config' }, env); return false; }
  try { cfgCacheReset(); } catch (e) {}
  return true;
}
// 优化#5：登录失败退避表清理（登录路径 + scheduled 低频调度点共用）
// 登录路径此前仅在 size>64 时惰性扫描 → 阈值偏保守、且无 D1 时表可能长期驻留；现改为：
//   · 低频点（scheduled cron）**无条件**清理；
//   · 登录路径阈值 64 → 32（仍是 O(size) 扫描，size 小、代价可忽略）。
function _sweepLoginFail() {
  const m = globalThis.__loginFail;
  if (!m || !m.size) return 0;
  const now = Date.now();
  let n = 0;
  for (const [k, v] of m) if (v && v.until <= now && now - v.t > 60000) { m.delete(k); n++; }
  if (m.size > 10000) { m.clear(); }
  return n;
}
async function pushDashboard(env) {
  const enabled = await getSafeEnv(env, 'STATS_ENABLED', 'false');
  if (enabled !== 'true') return;
  // 批次 6：降级冷却 —— 连续失败 ≥TG_FAIL_DEGRADE 次后不再每个周期硬试（信号已在 tg_fail 日志里）
  const _dgUntil = await tgDegradedUntil(env);
  if (_dgUntil && Date.now() < _dgUntil) { obs('warn', 'tg_dash_degraded', { left_s: Math.round((_dgUntil - Date.now()) / 1000) }, env); return; }
  const token = await getSafeEnv(env, 'TG_BOT_TOKEN', TG_BOT_TOKEN);
  const chat_id = (await getSafeEnv(env, 'STATS_CHAT_ID', '')) || (await getSafeEnv(env, 'TG_CHAT_ID', TG_CHAT_ID));
  if (!token || !chat_id) return;
  const cur = await getCloudflareUsage(env);
  if (!cur.success) return;
  const zone = await getZoneUsage(env);
  const st = await _dashRead(env, ['_dash_msg_id', '_dash_last_total']);
  const text = fmtCfStats(cur, st._dash_last_total, zone);
  let msgId = st._dash_msg_id, ok = false;
  if (msgId) {
    const r = await tgApi(token, 'editMessageText', { chat_id, message_id: Number(msgId), text, parse_mode: 'HTML', disable_web_page_preview: true });
    ok = !!(r && (r.ok || (r.description && r.description.includes('not modified'))));
  }
  if (!ok) {
    const s = await tgApi(token, 'sendMessage', { chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true });
    if (s && s.ok && s.result) { msgId = s.result.message_id; await _dashWrite(env, '_dash_msg_id', msgId); await tgFailClear(env, 'dash'); }
    else await tgFailBump(env, 'dash', 'send');   // edit + send 两级兜底均失败 → 计数 + 日志（不再静默）
  } else await tgFailClear(env, 'dash');
  await _dashWrite(env, '_dash_last_total', cur.total);
}
async function replyStats(env, chatId) {
  const token = await getSafeEnv(env, 'TG_BOT_TOKEN', TG_BOT_TOKEN);
  if (!token || !chatId) return;
  const cur = await getCloudflareUsage(env);
  const zone = await getZoneUsage(env);
  let text = cur.success ? fmtCfStats(cur, null, zone) : `<b>📊 查询失败</b>\n<code>${cur.msg || '未配置 CF 凭证'}</code>`;
  if (cur.success) { const detail = await getZoneDetail(env); text += fmtZoneDetail(detail); }
  await tgApi(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true });
}

// =============================================================================
// 🟢 主入口 (防1101保护)
// =============================================================================// ===== xHTTP/gRPC 入站（POST 流式；借鉴 EDT 叉HTTP，VLESS-only） =====
// 响应头对齐 EDT 处理叉HTTP请求（609-614/621-625）：逐跳头 Connection 不得出现在 H2/H3 响应（RFC 9113 §8.2.2）；grpc-status 属 gRPC 路径（EDT 991-996），xHTTP 保留无害
const XH_HD={'Content-Type':'application/octet-stream','grpc-status':'0','X-Accel-Buffering':'no','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'},
// 首包就绪判定：对齐 EDT 读取叉HTTP首包（823-861）——校验 cmd∈{1,2}；domain 需 addrType+len+域名字节齐备（原 n>=o+3+l 少 1 字节，会误判就绪后 400）
XH_HS=b=>{const n=b.length;if(n<19)return 1;const o=19+b[17];if(n<o+3)return 1;const c=b[o-1];if(1!==c&&2!==c)return-1;const t=b[o+2];if(1===t)return n>=o+7?0:1;if(3===t)return n>=o+19?0:1;if(2===t){if(n<o+4)return 1;const l=b[o+3];return l?n>=o+4+l?0:1:-1}return-1},
XH_R=t=>{try{t&&t.close&&t.close()}catch{}},
XH_TS=()=>typeof IdentityTransformStream<"u"?new IdentityTransformStream():new TransformStream();
const XH_HF=[13, 23, 28, 28, 28, 28, 28, 28, 28, 24, 30, 28, 28, 30, 28, 28,28, 28, 28, 28, 28, 28, 30, 28, 28, 28, 28, 28, 28, 28, 28, 28,6, 10, 10, 12, 13, 6, 8, 11, 10, 10, 8, 11, 8, 6, 6, 6,5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 7, 8, 15, 6, 12, 10,13, 6, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,7, 7, 7, 7, 7, 7, 7, 7, 8, 7, 8, 13, 19, 13, 14, 6,15, 5, 6, 5, 6, 5, 6, 6, 6, 5, 7, 7, 6, 6, 6, 5,6, 7, 6, 5, 5, 6, 7, 7, 7, 7, 7, 15, 11, 14, 13, 28,20, 22, 20, 20, 22, 22, 22, 23, 22, 23, 23, 23, 23, 23, 24, 23,24, 24, 22, 23, 24, 23, 23, 23, 23, 21, 22, 23, 22, 23, 23, 24,22, 21, 20, 22, 22, 23, 23, 21, 23, 22, 22, 24, 21, 22, 23, 23,21, 21, 22, 21, 23, 22, 23, 23, 20, 22, 22, 22, 23, 22, 22, 23,26, 26, 20, 19, 22, 23, 22, 25, 26, 26, 26, 27, 27, 26, 24, 25,19, 21, 26, 27, 27, 26, 27, 24, 21, 21, 26, 26, 28, 27, 27, 27,20, 24, 20, 21, 22, 21, 21, 23, 22, 22, 25, 25, 24, 24, 26, 23,26, 27, 26, 26, 27, 27, 27, 27, 27, 28, 27, 27, 27, 27, 27, 26,30];
let XH_PDH="",XH_PDK="",XH_B62="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
// padding 头名/键名由 UUID 派生（对齐 EDT `获取叉HTTPPadding标识`）：入站 XH_PDH/XH_PDK 与订阅 extra 共用此一处，防两边漂移
const XH_pdId=u=>[u.slice(1,7),"_"+u.slice(25,31)],
// xhttp 节点 extra（EDT 同款字段与顺序）：客户端开 xPaddingObfsMode，padding 改放 XH_PDH 头、tokenish 随机值。
// Xray ≥ v26.1.31 / mihomo 新版识别；旧内核忽略 → 退回 Referer x_padding，入站 XH_pdChk 无值放行、grpF 首帧回退 xhF，照常可连
XH_extra=u=>{const[h,k]=XH_pdId(u);return"&extra="+encodeURIComponent(JSON.stringify({xPaddingObfsMode:!0,xPaddingMethod:"tokenish",xPaddingPlacement:"queryInHeader",xPaddingHeader:h,xPaddingKey:k}))};
const XH_hfLen=t=>{const b=new TextEncoder().encode(t);let n=0;for(let i=0;i<b.length;i++)n+=XH_HF[b[i]];return Math.ceil(n/8)},
XH_pdGen=n=>{let r="";for(let i=0;i<n;i++)r+=XH_B62[Math.random()*62|0];return r},
XH_pdChk=e=>{const h=e.headers.get(XH_PDH);let v="";if(h){try{const q=new URL(h,"https://x.invalid").searchParams.get(XH_PDK);v=q||h}catch{v=h}}v=v||new URL(e.url).searchParams.get(XH_PDK)||"";if(!v)return!0;const l=XH_hfLen(v);return l>=98&&l<=1002},
XH_ST=h=>{h=String(h).toLowerCase();return h==="speed.cloudflare.com"||h==="cp.cloudflare.com"||h.endsWith(".speed.cloudflare.com")||h.endsWith(".cp.cloudflare.com")},
XH_UP=rm=>{const w=rm.writable.getWriter(),b=new Uint8Array(20480);let n=0,t=null,q=Promise.resolve(),pending=0,err=null;
const fl=()=>{if(!n)return;const c=b.slice(0,n);n=0;pending+=c.length;q=q.then(()=>w.write(c)).then(()=>{pending-=c.length}).catch(e=>{err=e})};
const wq=v=>{pending+=v.length;q=q.then(()=>w.write(v)).then(()=>{pending-=v.length}).catch(e=>{err=e})};
return{put(v){if(!v||!v.length)return;if(v.length>=20480){fl();wq(v);return pending>=1048576?q:void 0}n+v.length>20480&&fl();b.set(v,n),n+=v.length,t||(t=setTimeout(()=>{t=null;fl()},1));return pending>=1048576?q:void 0},end(){t&&(clearTimeout(t),t=null);fl();return q.then(()=>{if(err)throw err;return w.close()})}}},
XH_CAT=(a,b)=>{const o=new Uint8Array(a.length+b.length);return o.set(a),o.set(b,a.length),o};
// ===== gRPC 传输（Xray gun 协议，对齐 EDT 处理gRPC请求 978-1222）=====
// 帧 = [1B 压缩标志 0x00] [4B 大端长度] [消息体]；消息体 = protobuf Hunk（field1=bytes: 0x0a + varint(len) + data）
// 上行剥帧并解 Hunk；下行封 Hunk 再封帧
const GMAX=0x400000,XH_GMAXBUF=0x800000;
const XH_GCHK=b=>{if(!b||b.length<5||b[0]!==0)return!1;const n=((b[1]<<24)>>>0)|(b[2]<<16)|(b[3]<<8)|b[4];if(n<1||n>GMAX)return!1;if(b.length<6||b[5]!==10)return!1;return!0};
const XH_GFR=c=>{c=c instanceof Uint8Array?c:new Uint8Array(c);const L=[];let r=c.byteLength>>>0;while(r>127){L.push((r&127)|128);r>>>=7}L.push(r);const n=1+L.length+c.byteLength,f=new Uint8Array(5+n);f[0]=0;f[1]=(n>>>24)&255;f[2]=(n>>>16)&255;f[3]=(n>>>8)&255;f[4]=n&255;f[5]=10;f.set(new Uint8Array(L),6);f.set(c,6+L.length);return f};
const XH_GDEC=b=>{const o=[];const p=b;const len=p.length;let off=0;while(len-off>=5){const n=((p[off+1]<<24)>>>0)|(p[off+2]<<16)|(p[off+3]<<8)|p[off+4];if(n<1||n>GMAX)break;const f=5+n;if(len-off<f)break;const body=p.subarray(off+5,off+f);off+=f;if(!body.length)continue;let q=body;if(q.length>=2&&q[0]===10){let i=1,s=0,k=!1;while(i<q.length){const c=q[i++];if(!(c&128)){k=!0;break}s+=7;if(s>35)break}if(k)q=q.subarray(i)}if(q.length)o.push(q)}return{out:o,rest:off?p.subarray(off):p}};
const XH_GUP=(head,rd,d0)=>{
// E1（中危）：原实现用 `p=XH_CAT(p,v)` 每次追加都全量重分配 → 单次 O(|p|)，
// 攻击者声明 n=GMAX(=4MiB) 却永不补齐该帧时，XH_GDEC 恒无产出、parseVP 永不执行（UUID 校验绕不过去），
// 但 pull 仍持续缓冲至 8MiB → 总拷贝 O(K×|p|)。改为「容量倍增 + 高位游标压缩」的摊还 O(n) 缓冲：
//   · 追加：容量不足时才倍增重分配 → 摊还 O(1)
//   · 压缩：仅当游标越过半程（off > len/2，即死区 > 活区）才 copyWithin → 摊还 O(1)
let _b=(head&&head.length)?head:new Uint8Array(0),_len=_b.length,_off=0,_cap=_b.length;
const _grow=add=>{let c=_cap||4096;while(c<_len+add)c*=2;const nb=new Uint8Array(c);nb.set(_b.subarray(_off,_len));_len-=_off;_off=0;_b=nb;_cap=c};
const _push=v=>{if(_off>(_len>>1)){_b.copyWithin(0,_off,_len);_len-=_off;_off=0}if(_len+v.byteLength>_cap)_grow(v.byteLength);_b.set(v,_len);_len+=v.byteLength};
const _view=()=>_b.subarray(_off,_len);
let end=!!d0;
const em=c=>{const v=_view();const r=XH_GDEC(v);_off+=v.length-r.rest.length;let k=0;for(let i=0;i<r.out.length;i++){c.enqueue(r.out[i]);k++}return k};
const badLen=()=>{const v=_view();if(v.length<5)return!1;const n=((v[1]<<24)>>>0)|(v[2]<<16)|(v[3]<<8)|v[4];return n<1||n>GMAX};
return new ReadableStream({
async pull(c){
try{
if(em(c))return;
if(badLen()){try{c.error(new Error('grpc bad frame length'))}catch{}end=!0;return}
if(end){c.close();return}
for(;;){
const{done,value}=await rd.read();
if(done){end=!0;em(c);c.close();return}
if(!value||!value.byteLength)continue;
const v=value instanceof Uint8Array?value:new Uint8Array(value);
if((_len-_off)+v.byteLength>XH_GMAXBUF){try{c.error(new Error('grpc frame too large'))}catch{}end=!0;return}
_push(v);
if(em(c))return;
}
}catch(e){try{c.error(e)}catch{}}
}
});
};
const XH_REW=(head,rd,d0)=>{let hd=head;return new ReadableStream({
async pull(c){
try{
if(hd&&hd.length){const h=hd;hd=null;c.enqueue(h);return}
if(d0){c.close();return}
for(;;){const{done,value}=await rd.read();if(done){c.close();return}if(value&&value.byteLength){c.enqueue(value);return}}
}catch(e){try{c.error(e)}catch{}}
}
});};
const XH_pdFeat=e=>{const h=e.headers.get(XH_PDH);let v="";if(h){try{const q=new URL(h,"https://x.invalid").searchParams.get(XH_PDK);v=q||h}catch{v=h}}v=v||new URL(e.url).searchParams.get(XH_PDK)||"";return!!v};
const XH_isGrpc=e=>{const ct=((e.headers.get('content-type')||'').toLowerCase().split(';')[0]).trim();return ct==='application/grpc'&&!XH_pdFeat(e)};
async function xhF(req, env, fbPip){if(!req.body)return new Response(null,{status:400});if(!XH_pdChk(req))return new Response("Bad Request",{status:400});
// ① 读首包：XH_HS 就绪判定 + parseVP（内含 matchID UUID 校验），读完立即 releaseLock（对齐 EDT 读取叉HTTP首包）
const rd0=req.body.getReader();let buf=new Uint8Array(0),ss=null;
try{for(;;){const st=XH_HS(buf);if(!st){ss=parseVP(buf);if(!ss)throw 0;break}if(st<0||buf.length>=16384)throw 0;
const{done,value}=await rd0.read();if(done)throw 0;buf=XH_CAT(buf,value)}}
catch{try{rd0.cancel()}catch{}return new Response(null,{status:400})}
try{rd0.releaseLock()}catch{}
if(buf[18+buf[17]]===2)return new Response("UDP is not supported",{status:400});
// ② 路由配置 + 建连（204 短路沿用既有实现：已线上实测有效）
const url=new URL(req.url);if(url.pathname.includes("%3F")){try{const d2=decodeURIComponent(url.pathname),q2=d2.indexOf("?");-1!==q2&&(url.search=d2.substring(q2),url.pathname=d2.substring(0,q2))}catch{}}
let rm=null;
try{let fbPIP=fbPip||DEFAULT_PROXY_IP;if(fbPIP)fbPIP=String(fbPIP).replace(/^https?:\/\//i,"").replace(/\/+$/,"");
const rc=pCfg(url,url.pathname.slice(1),fbPIP),hn=addr(ss.addrType,ss.targetAddrBytes);
if(!rc.gP&&XH_ST(hn))return new Response(XH_CAT(new Uint8Array([buf[0],0]),new TextEncoder().encode("HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")),{status:200,headers:XH_HD});
rm=await tryCon(req.fetcher,ss.addrType,hn,ss.port,rc,env)}catch(e2){try{XH_R(rm)}catch{}return new Response("xhERR:"+((e2&&e2.message)||"unknown"),{status:502})}
// ③ 首包负载直写远端
try{const w2=rm.writable.getWriter();try{if(ss.dataOffset<buf.length)await w2.write(buf.subarray(ss.dataOffset))}finally{try{w2.releaseLock()}catch{}}}catch(e3){try{XH_R(rm)}catch{}return new Response("xhERR:"+((e3&&e3.message)||"unknown"),{status:502})}
// ④ 响应头
// ④ ACAO：EDT WriteResponseHeader 对齐——有 Origin 则回显（浏览器可带凭据/任意源），否则 XH_HD 的 '*'
// ④ 响应 padding：值取 Xray 服务端 queryInHeader 形态 `?<键>=<随机>`（原 `https://x.invalid/?…` 是全部署一致的固定前缀）；客户端不校验此头
let hh;try{hh=new Headers(XH_HD)}catch{hh=new Headers()}try{const og=req.headers.get('Origin');og&&hh.set('Access-Control-Allow-Origin',og)}catch{}try{hh.set(XH_PDH,"?"+XH_PDK+"="+XH_pdGen(100+Math.floor(Math.random()*901)))}catch{}
// ⑤ 上下行：严格对齐 EDT「处理叉HTTP请求」的双 Promise + 自有 AbortController
//    · 下行：显式 writer 写握手前缀 → releaseLock → 再 pipeTo（不用 pipeTo+preventClose：
//      该写法依赖运行时对 preventClose 的抑制语义，workerd 的 IdentityTransformStream 与
//      Node 的 TransformStream 不等价，桩测覆盖不到）
//    · 上行：只在【失败】时清理（EDT 为 上行Promise.catch(清理)）。此前"请求体一结束就 drop
//      远端 socket"会把 socket 两侧一起强关（官方 close() 语义），正是下行被掐断的元凶
//    · 解绑 req.signal：改用自有 AbortController，避免信号提前 abort 误杀 socket
const ts=XH_TS(),ac=new AbortController();let done=!1,rd=null;
const clean=()=>{if(done)return;done=!0;try{ac.abort()}catch{}try{XH_R(rm)}catch{}try{rd&&rd.cancel()}catch{}};
const dnP=(async()=>{const w=ts.writable.getWriter();
try{await w.write(new Uint8Array([buf[0],0]))}catch(e){try{await w.abort(e)}catch{}throw e}finally{try{w.releaseLock()}catch{}}
await rm.readable.pipeTo(ts.writable,{signal:ac.signal})})();
dnP.then(clean,clean);
const upP=(async()=>{const ub=XH_UP(rm);rd=req.body.getReader();
try{for(;;){const{done:dn,value}=await rd.read();if(dn)break;if(value&&value.byteLength)await ub.put(value)}}finally{try{await ub.end()}catch(e){clean()}}})();
upP.catch(clean);
return new Response(ts.readable,{status:200,headers:hh})}
// gRPC 入口：先嗅探首帧确认是否 gRPC 帧；是则上行剥帧 → 复用 xhF → 下行封帧；否则回退 xhF（保护 packet-up/raw）
async function grpF(req, env, fbPip){
  if(!req.body)return new Response(null,{status:400});
  const rd=req.body.getReader();let head=new Uint8Array(0),d0=!1;
  try{while(head.length<6){const{done,value}=await rd.read();if(done){d0=!0;break}if(value&&value.byteLength)head=XH_CAT(head,value instanceof Uint8Array?value:new Uint8Array(value))}}catch{d0=!0}
  const mk=body=>({url:req.url,method:req.method,headers:req.headers,body,cf:req.cf,fetcher:req.fetcher});
  if(!XH_GCHK(head))return xhF(mk(XH_REW(head,rd,d0)),env,fbPip);
  const res=await xhF(mk(XH_GUP(head,rd,d0)),env,fbPip);
  if(!res.body)return res;
  const hh=new Headers(res.headers);hh.set('Content-Type','application/grpc');hh.set('grpc-status','0');
  const out=new ReadableStream({async start(c){const rr=res.body.getReader();try{for(;;){const{done,value}=await rr.read();if(done)break;if(value&&value.byteLength)c.enqueue(XH_GFR(value))}}catch{}try{c.close()}catch{}}});
  return new Response(out,{status:res.status,headers:hh});
}


export default {
  async fetch(r, env, ctx) {
    detectRuntime(env);
    try {
      const url = new URL(r.url);
      const host = url.hostname; 
      const UA = (r.headers.get('User-Agent') || "").toLowerCase();
      const UA_L = UA;
      const clientIP = r.headers.get('cf-connecting-ip');
      const country = r.cf?.country || 'UNK';
      const city = r.cf?.city || 'Unknown';

      const _UUID = env.KEY ? await getDynamicUUID(env.KEY, env.UUID_REFRESH || 86400) : (await getSafeEnv(env, 'UUID', UUID));
      setUUID(_UUID);[XH_PDH,XH_PDK]=XH_pdId(_UUID);
      const _WEB_PW = await getSafeEnv(env, 'WEB_PASSWORD', WEB_PASSWORD);
      const _SUB_PW = await getSafeEnv(env, 'SUB_PASSWORD', SUB_PASSWORD);
      // P1-3：默认弱口令「告警不阻断」——命中默认值时面板横幅 + TG 一次性通知（绝不拒绝启动）
      const _WEAK_PW = new Set(['abc', '123456', 'sub', 'password', 'admin']);
      const _weakPw = _WEAK_PW.has(_WEB_PW) || _WEAK_PW.has(_SUB_PW);
      const _SUB_TOKEN = (await getSafeEnv(env, 'SUB_TOKEN', SUB_TOKEN) || '').trim();
      
      let _PROXY_IP = await getSafeEnv(env, 'PROXYIP', DEFAULT_PROXY_IP);
      _PROXY_IP = _PROXY_IP.replace(/^https?:\/\//i, '').replace(/\/+$/, '');

      const _PS = await getSafeEnv(env, 'PS', "");
      const _LOGIN_TITLE = await getSafeEnv(env, 'LOGIN_PAGE_TITLE', LOGIN_PAGE_TITLE);
      const _DASH_TITLE = await getSafeEnv(env, 'DASHBOARD_TITLE', DASHBOARD_TITLE); 
      
      // EDT 迁移兼容：edgetunnel 用 SUB / SUBCONFIG 命名，此处作为别名兼容（SUB_DOMAIN / CLASH_CONFIG 优先）
      let _SUB_DOMAIN_STR = (await getSafeEnv(env, 'SUB_DOMAIN', '')) || (await getSafeEnv(env, 'SUB', '')) || DEFAULT_SUB_DOMAIN;
      let _CONVERTER_STR = await getSafeEnv(env, 'SUBAPI', DEFAULT_CONVERTER);
      // 清洗单值：去协议头和尾部斜杠
      let _SUB_DOMAIN = _SUB_DOMAIN_STR.trim(); if(_SUB_DOMAIN.includes("://")) _SUB_DOMAIN=_SUB_DOMAIN.split("://")[1]; if(_SUB_DOMAIN.includes("/")) _SUB_DOMAIN=_SUB_DOMAIN.split("/")[0]; _SUB_DOMAIN = _SUB_DOMAIN || host;
      let _CONVERTER = _CONVERTER_STR.trim(); if(_CONVERTER.endsWith("/")) _CONVERTER=_CONVERTER.slice(0,-1); if(!_CONVERTER.includes("://")) _CONVERTER="https://"+_CONVERTER; _CONVERTER = _CONVERTER || DEFAULT_CONVERTER;

      // ⭐ 功能4: DLS速度下限筛选
      const _DLS = await getSafeEnv(env, 'DLS', DLS);

      // 🔐 ECH 环境变量覆盖 (优先级: 环境变量 > D1 > 硬编码)
      const _echFlag = await getSafeEnv(env, 'ECH_ENABLED', ECH ? 'true' : 'false');
      ECH = _echFlag === 'true';
      ECH_SNI = await getSafeEnv(env, 'ECH_SNI', ECH_SNI);
      ECH_DNS = await getSafeEnv(env, 'ECH_DNS', ECH_DNS);
      FP = 'chrome';

      // 🚫 生成器推广行过滤正则（AD_FILTER 环境变量覆盖默认值；正则源字符串，非法则保留原值）
      try { const _ad = await getSafeEnv(env, 'AD_FILTER', AD_FILTER); if (_ad !== _adSrc) { GEN_AD_RE = new RegExp(_ad, 'i'); _adSrc = _ad; } } catch (e) {}

      // 👇 变量去重与统一调用逻辑：优先 getSafeEnv(环境变量, 默认常量)
      const _TG_GROUP_URL = await getSafeEnv(env, 'TG_GROUP_URL', TG_GROUP_URL);
      const _PROXY_CHECK_URL = await getSafeEnv(env, 'PROXY_CHECK_URL', PROXY_CHECK_URL);
      const _SITE_URL = await getSafeEnv(env, 'SITE_URL', SITE_URL);
      const _GITHUB_URL = await getSafeEnv(env, 'GITHUB_URL', GITHUB_URL);
      const _CLASH_CONFIG = (await getSafeEnv(env, 'CLASH_CONFIG', '')) || (await getSafeEnv(env, 'SUBCONFIG', '')) || CLASH_CONFIG;
      const _SINGBOX_CONFIG_V11 = await getSafeEnv(env, 'SINGBOX_CONFIG_V11', SINGBOX_CONFIG_V11);
      const _SINGBOX_CONFIG_V12 = await getSafeEnv(env, 'SINGBOX_CONFIG_V12', SINGBOX_CONFIG_V12);
      
      // 🟢 GrainTCP 代理入口（EDT 兼容：WS 连接不做 UA 过滤，客户端 UA 千奇百怪；
      //    凭据校验在 VLESS 协议层 matchID，路径仅供代理配置）
      if ((r.headers.get('Upgrade') || '').toLowerCase() === 'websocket') {
        if (!url.searchParams.has('flag') && env.DB) ctx.waitUntil(incrementDailyStats(env));
        return ws(r, env);
      }

      // 🟣 xHTTP/gRPC 入口（EDT 对齐：POST 即进，不再限定 Content-Type）
      // 放宽理由：Xray packet-up 模式（FillPacketRequest）**不设 Content-Type**，旧门槛
      //   `ct==='application/grpc'||'application/octet-stream'` 会把 packet-up 的 POST 挡在门外，
      //   直接落到面板 404。EDT 的做法是 `request.method === 'POST'`（仅排除 admin/ 与 login）。
      // 面板/管理端点必须**显式排除**（否则后台 POST 表单会被当成 VLESS 首包解析 → 400）：
      //   · /tg/webhook                    —— TG 回调（/stats 命令）
      //   · ?flag=*                        —— 后台管理 API：add_whitelist / del_whitelist /
      //                                       validate_tg / validate_cf / set_webhook / save_config
      //   · /sub、/{_SUB_PW}               —— 订阅端点
      //   · /favicon.ico、/version         —— 固定 404 探测端点
      const xhExcl = r.method === 'POST' && (
        url.pathname === '/tg/webhook' || url.pathname === '/sub' ||
        url.pathname === '/favicon.ico' || url.pathname === '/version' ||
        url.pathname === '/robots.txt' ||
        (_SUB_PW && url.pathname === `/${_SUB_PW}`) || url.searchParams.has('flag'));
      if (r.method === 'POST' && !xhExcl) {
        if (!url.searchParams.has('flag') && env.DB) ctx.waitUntil(incrementDailyStats(env));
        // gRPC/xHTTP 共用入口：EDT 规则先判候选（application/grpc 且无 xHTTP padding 特征），
        // 再由 grpF 以「首帧合法性」确认；非 gRPC 帧回退 xhF（packet-up/raw 不受影响）
        return XH_isGrpc(r) ? grpF(r, env, _PROXY_IP) : xhF(r, env, _PROXY_IP);
      }

      // 📊 TG Webhook：/stats 命令查询 CF 用量（仅响应配置的 chat_id）
      if (url.pathname === '/tg/webhook' && r.method === 'POST') {
        // P1-4：校验 Telegram secret_token（未配置 secret 时放行，平滑过渡）
        const _tgs = await getSafeEnv(env, 'TG_WEBHOOK_SECRET', '');
        if (_tgs && !_ctEq(String(r.headers.get('X-Telegram-Bot-Api-Secret-Token') || ''), _tgs)) return new Response('forbidden', { status: 403 });
        // R4：未配置 secret 时告警（一次性；仍放行以免打断现网，收敛靠用户配置 TG_WEBHOOK_SECRET）
        // 残留#5：无 D1 时 _dashWrite 无效、_wh_secret_warned 恒读空 → 公开 POST 端点可被匿名放大成管理员 TG 骚扰
        //        故无 D1 时改用 isolate 级内存标志保证「一次性」（有 D1 时保持持久化语义）
        if (!_tgs) {
          try {
            if (env.DB) {
              if (!(await getSafeEnv(env, '_wh_secret_warned', ''))) { ctx.waitUntil(sendTgMsg(ctx, env, "⚠️ 安全告警：TG webhook 未配置 secret_token，建议在面板点「设置 Webhook」", r, "webhook 自检", true)); await _dashWrite(env, '_wh_secret_warned', '1'); }
            } else if (!globalThis.__whWarned) {
              globalThis.__whWarned = 1;
              ctx.waitUntil(sendTgMsg(ctx, env, "⚠️ 安全告警：TG webhook 未配置 secret_token，建议在面板点「设置 Webhook」", r, "webhook 自检", true));
            }
          } catch (e) {}
        }
        try {
          const update = await r.json();
          const msg = update && (update.message || update.channel_post);
          const text = (msg && msg.text) || '';
          const fromChat = msg && msg.chat && msg.chat.id;
          const allowChat = (await getSafeEnv(env, 'STATS_CHAT_ID', '')) || (await getSafeEnv(env, 'TG_CHAT_ID', TG_CHAT_ID));
          if (Number.isInteger(fromChat) && text.replace(/^\//, '').split(/[@\s]/)[0] === 'stats' && String(fromChat) === String(allowChat)) {
            ctx.waitUntil(replyStats(env, fromChat));
          }
        } catch (e) {}
        return new Response('ok');
      }

      // A-11：/robots.txt —— 必须插在蜘蛛拦截之前，否则搜索引擎永远拿不到（EDT `_ref_edgetunnel.tmp:500`）
      if (url.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /', { status: 200, headers: { 'Content-Type': 'text/plain; charset=UTF-8', 'Cache-Control': 'no-store' } });

      // 批次 6：/health —— SLO 探针存活端点（同样必须在蜘蛛拦截之前，否则 curl/拨测 UA 一律 404）
      // ⚠️ 只返回「健康与否必需的最小信息」：不含版本号 / 部署形态 / UUID / 任何配置值；不写日志、不计数
      if (url.pathname === '/health') return new Response(JSON.stringify({ ok: true, t: Math.floor(Date.now() / 1000) }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

      if (UA_L.includes('spider') || UA_L.includes('bot') || UA_L.includes('python') || UA_L.includes('scrapy') || UA_L.includes('curl') || UA_L.includes('wget')) {
          return new Response('Not Found', { status: 404 });
      }

      let isGlobalAdmin = await checkWhitelist(env, clientIP);
      let hasAuthCookie = false; 

      // ===== P1-1 鉴权加固 helper（HMAC 会话 cookie + 恒定时间比较）=====
      const _enc = new TextEncoder();
      const _hex = (buf) => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
      async function _hmacHex(secret, msg) {
        const key = await crypto.subtle.importKey('raw', _enc.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        return _hex(await crypto.subtle.sign('HMAC', key, _enc.encode(String(msg))));
      }
      function _ctEq(a, b) {
        a = String(a || ''); b = String(b || '');
        if (a.length !== b.length) return false;
        let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
        return d === 0;
      }
      // R1-a / 残留#3 / R1-b：返回 HMAC 会话密钥；返回 '' 表示「无安全密钥可用」，调用方必须据此拒绝签发 cookie
      //   ① AUTH_SECRET（长度 ≥16，弱密钥一律忽略并告警）→ ② D1 持久化的 24B 随机（写后读回校验）→ ③ 写库失败则回退口令派生并告警
      //   ④ 无 D1 且未配 AUTH_SECRET → 返回 ''（不拿公开默认口令当密钥，见 R1-b）
      const _authSecret = async (env) => {
        const cfg = String(await getSafeEnv(env, 'AUTH_SECRET', '') || '');
        if (cfg) {
          if (cfg.length >= 16) return cfg;
          obs('warn', 'auth_secret_weak', { len: cfg.length }, env);
        }
        let auto = String(await getSafeEnv(env, '_AUTH_SECRET_AUTO', '') || '');
        if (!auto && env.DB) {
          const gen = _hex(crypto.getRandomValues(new Uint8Array(24)));
          auto = await _dashWriteAbsent(env, '_AUTH_SECRET_AUTO', gen);   // P2：DO NOTHING + 直读，既有密钥绝不被覆盖
          if (!auto) {
            // R1-a/E5：绝不返回「未持久化的随机值」（否则每请求轮换、登录后立即掉线）。
            // E5：此分支若回退 _WEB_PW，HMAC 密钥可能仍是源码公开默认口令，与 R1-b 的 fail-closed 不一致 →
            //     统一返回 ''，由登录端点走 503 no_secret 路径，绝不签发 cookie。
            obs('error', 'auth_secret_persist_fail', {}, env);
            return '';
          }
        }
        return auto;   // 无 D1 且未配强 AUTH_SECRET → '' → R1-b：登录端点据此拒绝签发
      };

      if (_WEB_PW) {
        const m = /(?:^|;\s*)auth=([^;]+)/.exec(r.headers.get('Cookie') || '');
        if (m) {
          const v = m[1], dot = v.lastIndexOf('.');
          const exp = Number(v.slice(0, dot)), sig = v.slice(dot + 1);
          if (Number.isFinite(exp) && exp > Date.now()) {
            const _sec = await _authSecret(env);
            if (_sec) {
              const ua = r.headers.get('User-Agent') || '';
              const expect = await _hmacHex(_sec, `${ua}|${exp}`);
              if (_ctEq(sig, expect)) hasAuthCookie = true;
            }
          }
        }
      }

      if (url.pathname === '/favicon.ico') return new Response(null, { status: 404 });

      // 🔎 /version 探测端点（EDT 面板兼容）：与 edgetunnel 相同的模糊校验（前 8 位和 + 后 12 位）
      if (url.pathname === '/version') {
        const reqUUID = (url.searchParams.get('uuid') || '').toLowerCase();
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(reqUUID)) {
          const tgt = String(_UUID).toLowerCase();
          let reqSum = 0, tgtSum = 0;
          for (let i = 0; i < 8; i++) { reqSum += parseInt(reqUUID[i], 16); tgtSum += parseInt(tgt[i], 16); }
          if (reqSum === tgtSum && reqUUID.slice(-12) === tgt.slice(-12)) {
            return new Response(JSON.stringify({ Version: 2142, Kernel: 'GrainTCP' }), { status: 200, headers: { 'Content-Type': 'application/json;charset=utf-8', 'Cache-Control': 'no-store' } });
          }
        }
        return new Response(null, { status: 404 });
      }
      
      // A-11：GET /logout —— 路径形式（EDT `_ref_edgetunnel.tmp:300`）；现有 ?flag=logout 保持可用。
      // Location 固定为 '/'，无开放重定向面。
      if (url.pathname === '/logout') {
        const _lo = new Response('重定向中...', { status: 302, headers: { 'Location': '/', 'Cache-Control': 'no-store' } });
        _lo.headers.set('Set-Cookie', 'auth=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax');
        return _lo;
      }

      // A-11：admin/check —— 用指定代理连 cloudflare.com/cdn-cgi/trace 验证出口连通（EDT `_ref_edgetunnel.tmp:138`）
      // 三重闸门：① 强制鉴权 ② 代理主机过 _extHostSafe（SSRF）③ 目标主机固定 cloudflare.com:443（不可由参数指定）
      if (url.pathname === '/admin/check') {
        const _cj = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
        if (!hasAuthCookie && !isGlobalAdmin) return new Response('403 Forbidden', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        const _ckProto = ['socks5', 'http', 'https'].find(t => url.searchParams.has(t)) || null;
        if (!_ckProto) return _cj({ success: false, error: '缺少代理参数（socks5 / http / https）' }, 400);
        const _ckCfg = addrParser(url.searchParams.get(_ckProto), _ckProto === 'https' ? 443 : _ckProto === 'http' ? 80 : 1080);
        if (!_ckCfg || !_ckCfg.hostname || !_ckCfg.port) return _cj({ success: false, error: '代理参数解析失败' }, 400);
        if (!_extHostSafe(String(_ckCfg.hostname)).ok) return _cj({ success: false, error: '代理主机不在允许范围' }, 400); // ★ SSRF 闸门
        if (_ckProto === 'https') _ckCfg.tls = 1;
        const _ckTag = _ckProto + '://' + _ckCfg.hostname + ':' + _ckCfg.port;
        const _ckT0 = Date.now();
        // 超时兜底：connect 阶段 8s、写阶段 5s（优化#1）、读阶段单次 5s、整体 12s。任一超限 → 明确错误，绝不挂起。
        // E3：给 Promise.race 的**败方**挂 .catch(()=>{})，避免超时/异常后产生未处理 rejection。
        const _ckTO = (p, ms, msg) => {
          let t = null;
          if (p && typeof p.catch === 'function') p.catch(() => { });
          const tp = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); });
          tp.catch(() => { });
          return Promise.race([p, tp]).finally(() => { if (t) clearTimeout(t); });
        };
        // E3：socket / TLS client 提到 try 外，清理统一放 finally —— 异常路径同样必须关闭，否则连接泄漏至 isolate 回收
        let _ckSock = null, _ckTls = null;
        try {
          const _ckF = r.fetcher;
          if (!_ckF || typeof _ckF.connect !== 'function') return _cj({ success: false, proxy: _ckTag, error: '当前运行环境不支持出口检测', responseTime: Date.now() - _ckT0 }, 501);
          // A-11：目标固定 cloudflare.com:**443**，经代理建连后**走 TLS**（对齐 EDT `_ref_edgetunnel.tmp:137-205` 的 443+TLS 方案）。
          // 复用现成 TlsClient（`worker.js:514`），与 `_turnOpenCustomTls`（`worker.js:789`）同模式：handshake 失败时关闭 raw。
          _ckSock = await _ckTO(
            _ckProto === 'socks5'
              ? s5Conn(_ckF, 3, 'cloudflare.com', 443, _ckCfg)
              : htConn(_ckF, 3, 'cloudflare.com', 443, _ckCfg),
            8000, '连接代理超时（8s）');
          // TlsClient 选项仅 serverName/tls13/tls12/alpn/timeout；无 `insecure` 选项（其实现本就不做证书链校验，接受任意证书）
          _ckTls = new TlsClient(_ckSock, { serverName: 'cloudflare.com', timeout: 8000 });
          await _ckTO(_ckTls.handshake(), 8000, 'TLS 握手超时（8s）');
          await _ckTO(
            _ckTls.write(new TextEncoder().encode('GET /cdn-cgi/trace HTTP/1.1\r\nHost: cloudflare.com\r\nUser-Agent: Mozilla/5.0\r\nConnection: close\r\n\r\n')),
            5000, '写检测请求超时（5s）');
          let _ckBuf = '', _ckIp = '', _ckLoc = '';
          while (Date.now() - _ckT0 < 12000 && _ckBuf.length <= 65536) {   // 读上限 64KB（EDT 同）
            const _rdP = _ckTls.read(); _rdP.catch(() => { });
            const _ckV = await Promise.race([
              _rdP,
              new Promise(res => setTimeout(() => res(null), 5000))
            ]);
            if (!_ckV || !_ckV.byteLength) break;                        // EOF / 读超时 → 结束
            _ckBuf += new TextDecoder().decode(_ckV);
            const _m = _ckBuf.match(/^ip=(.*)$/m);
            if (_m) { _ckIp = _m[1].trim(); const _l = _ckBuf.match(/^loc=(.*)$/m); _ckLoc = _l ? _l[1].trim() : ''; break; }
          }
          // 未取到 ip= → 明确报「TLS 出网不可达/被拒」，不静默返回 success:false 而不给原因
          if (!_ckIp) return _cj({ success: false, proxy: _ckTag, error: '未取到 cloudflare.com:443/cdn-cgi/trace 响应（TLS 出网不可达或被代理拒绝）', responseTime: Date.now() - _ckT0 });
          // F4-b：格式闸门 + loc 清洗（见 _adminCheckResult 注释；TLS 不校验证书链 → 输出不保证真实性）
          return _cj(_adminCheckResult(_ckIp, _ckLoc, _ckTag, _ckT0));
        } catch (e) {
          // TlsClient 在协议错误时抛数字哨兵（如 0），直接 String 会得到无意义的 "0" → 归一为可读文案
          const _em = (e && e.message) ? String(e.message) : ('TLS/连接失败：' + String(e));
          return _cj({ success: false, proxy: _ckTag, error: _em, responseTime: Date.now() - _ckT0 });
        } finally {
          try { _ckTls && _ckTls.close(); } catch (e) { }
          try { _ckSock && _ckSock.close(); } catch (e) { }
        }
      }

      const flag = url.searchParams.get('flag');
      // P0：Fetch Metadata 资源隔离——浏览器发起的跨站 POST（Sec-Fetch-Site=cross-site/same-site 或 Origin 不同源）一律 403；
      //     非浏览器客户端（无这两个头）与同源页面放行。IP 白名单管理员此前无需 cookie 即可被任意网页 CSRF 改配置。
      if (flag && r.method === 'POST') {
        const _sfs = String(r.headers.get('Sec-Fetch-Site') || '').toLowerCase(), _org = r.headers.get('Origin');
        if ((_sfs && _sfs !== 'same-origin' && _sfs !== 'none') || (_org && _org !== url.origin)) return new Response('403 Forbidden (cross-site)', { status: 403 });
      }
      if (!flag && env.DB) ctx.waitUntil(incrementDailyStats(env));
      // P1-1：服务端登录/登出（HMAC 会话 cookie，HttpOnly）
      if (flag === 'login' && r.method === 'POST') {
        // R3：IP 维度失败退避（isolate 级 best-effort，防在线暴破；60s 内 5 次失败→封 60s）
        const _lf = (globalThis.__loginFail ||= new Map());
        const _lk = clientIP || 'unknown', _now = Date.now();
        // 残留#4 + 优化#5：惰性清理已过期项（阈值 64→32）；容量硬上限 10k 在 _sweepLoginFail 内处理
        if (_lf.size > 32) _sweepLoginFail();
        const _lr = _lf.get(_lk);
        // 残留#4：'unknown' 桶（无 cf-connecting-ip，如经前置代理）不参与退避 —— 否则单一攻击者可占满该桶误封所有合法用户
        if (_lk !== 'unknown' && _lr && _lr.until > _now) return new Response(JSON.stringify({ ok: false, msg: 'too many attempts' }), { status: 429, headers: { 'Content-Type': 'application/json' } });
        const body = await parseJSONBody(r).catch(() => null);
        const pw = String((body && body.pwd) || '');
        if (!_ctEq(pw, _WEB_PW)) {
          const c = (_lr && _now - _lr.t < 60000) ? _lr.c + 1 : 1;
          _lf.set(_lk, { c, t: _now, until: c >= 5 ? _now + 60000 : 0 });
          ctx.waitUntil(logAccessThrottled(env, clientIP, `${city},${country}`, "登录失败(密码错误)", 30));
          return new Response(JSON.stringify({ ok: false }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        _lf.delete(_lk);
        // R1-b：无 D1 且未配置（强）AUTH_SECRET 时，HMAC 密钥只能是公开默认口令 → 拒绝面板登录、不签发 cookie
        const _sec = await _authSecret(env);
        if (!_sec) {
          obs('warn', 'auth_no_secret', {}, env);
          return new Response(JSON.stringify({ ok: false, msg: 'no_secret: 请绑定 D1 数据库，或配置 AUTH_SECRET（≥16 字符）后重试；当前环境无法安全签发面板会话' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
        }
        const ua = r.headers.get('User-Agent') || '';
        const exp = Date.now() + 86400000;
        const sig = await _hmacHex(_sec, `${ua}|${exp}`);
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': `auth=${exp}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`
        } });
      }
      if (flag === 'logout' && r.method === 'POST') {
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': 'auth=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
        } });
      }
      if (flag) {
          // R6：github 全仓无调用方 → 补鉴权彻底收敛（原仅节流，保留登录页直达的收益已无意义）
          if (flag === 'github') { if (!hasAuthCookie && !isGlobalAdmin) return new Response('403 Forbidden', { status: 403 }); ctx.waitUntil(logAccessThrottled(env, clientIP, `${city},${country}`, "github点击", 30)); await sendTgMsg(ctx, env, "🌟 用户点击了项目", r, "来源: 登录页面直达链接", isGlobalAdmin); return new Response(null, { status: 204 }); }
          if (flag === 'log_proxy_check') { if (!hasAuthCookie && !isGlobalAdmin) return new Response('403 Forbidden', { status: 403 }); ctx.waitUntil(logAccessThrottled(env, clientIP, `${city},${country}`, "检测ProxyIP", 30)); await sendTgMsg(ctx, env, "🔍 用户点击了 ProxyIP 检测", r, "来源: 后台管理面板", isGlobalAdmin); return new Response(null, { status: 204 }); }
          if (flag === 'log_sub_test') { if (!hasAuthCookie && !isGlobalAdmin) return new Response('403 Forbidden', { status: 403 }); ctx.waitUntil(logAccessThrottled(env, clientIP, `${city},${country}`, "订阅测试点击", 30)); await sendTgMsg(ctx, env, "🌟 用户点击了订阅测试", r, "来源: 后台管理面板", isGlobalAdmin); return new Response(null, { status: 204 }); }
          if (flag === 'stats') { if (!hasAuthCookie && !isGlobalAdmin) return new Response('403 Forbidden', { status: 403 }); const dateStr = new Date().toISOString().split('T')[0]; const reqCount = await getStoredDailyStats(env, dateStr); const cfStats = await getCloudflareUsage(env); const storageStatus = env.DB ? 'D1 OK' : 'Missing'; const reqLabel = storageStatus === 'Missing' ? 'Internal' : 'API'; const finalReq = storageStatus === 'Missing' ? '不统计' : (cfStats.success ? `${cfStats.total} (${reqLabel})` : `${reqCount} (${reqLabel})`); const cfConfigured = cfStats.success || (!!await getSafeEnv(env, 'CF_EMAIL', "") && !!await getSafeEnv(env, 'CF_KEY', "")); return new Response(JSON.stringify({ req: finalReq, ip: clientIP, loc: `${city}, ${country}`, storageStatus: storageStatus, cfConfigured: cfConfigured }), { headers: { 'Content-Type': 'application/json' } }); }
          if (flag === 'get_logs') { if (!hasAuthCookie && !isGlobalAdmin) return new Response('403 Forbidden', { status: 403 }); let logs = []; if (env.DB) { try { const { results } = await env.DB.prepare("SELECT * FROM logs ORDER BY id DESC LIMIT 50").all(); logs = (results || []).map(normalizeLogEntry).filter(Boolean); } catch(e) {} } if (logs.length > 0) { return new Response(JSON.stringify({ type: 'd1', logs: logs }), { headers: { 'Content-Type': 'application/json' } }); } return new Response(JSON.stringify({ logs: "No Storage" }), { headers: { 'Content-Type': 'application/json' } }); }
          if (flag === 'get_whitelist') { if (!hasAuthCookie && !isGlobalAdmin) return new Response('403 Forbidden', { status: 403 }); const list = await getAllWhitelist(env); return new Response(JSON.stringify({ list }), { headers: { 'Content-Type': 'application/json' } }); }
          if (flag === 'add_whitelist' && r.method === 'POST') { if (!hasAuthCookie && !isGlobalAdmin) return new Response('403 Forbidden', { status: 403 }); const body = await parseJSONBody(r); if(!body?.ip) return new Response(JSON.stringify({status:'error',msg:'Missing IP'}), {headers:{'Content-Type':'application/json'}}); const ipStr = body.ip.trim(); if (!/^[\d.:a-fA-F]+$/.test(ipStr) || ipStr.length > 45) return new Response(JSON.stringify({status:'error',msg:'Invalid IP format'}), {headers:{'Content-Type':'application/json'}}); const result = await addWhitelist(env, ipStr); return new Response(JSON.stringify(result.ok ? {status:'ok', ...result} : {status:'error', msg: result.errors.join(' | ') || 'No writable storage', ...result}), {headers:{'Content-Type':'application/json'}}); }
          if (flag === 'del_whitelist' && r.method === 'POST') { if (!hasAuthCookie && !isGlobalAdmin) return new Response('403 Forbidden', { status: 403 }); const body = await parseJSONBody(r); if(!body?.ip) return new Response(JSON.stringify({status:'error',msg:'Missing IP'}), {headers:{'Content-Type':'application/json'}}); const result = await delWhitelist(env, body.ip.trim()); return new Response(JSON.stringify(result.ok ? {status:'ok', ...result} : {status:'error', msg: result.errors.join(' | ') || 'No writable storage', ...result}), {headers:{'Content-Type':'application/json'}}); }
          if (flag === 'validate_tg' && r.method === 'POST') { if (!hasAuthCookie && !isGlobalAdmin) return new Response('403 Forbidden', { status: 403 }); const body = await parseJSONBody(r); if (!body) return new Response(JSON.stringify({success:false, msg:'bad json'}), {status: 400, headers:{'Content-Type':'application/json'}}); await sendTgMsg(ctx, { TG_BOT_TOKEN: String(body.TG_BOT_TOKEN || ''), TG_CHAT_ID: String(body.TG_CHAT_ID || '') }, "🤖 TG 推送可用性验证", r, "配置有效", true); return new Response(JSON.stringify({success:true, msg:"验证消息已发送"}), {headers:{'Content-Type':'application/json'}}); }
          if (flag === 'validate_cf' && r.method === 'POST') { if (!hasAuthCookie && !isGlobalAdmin) return new Response('403 Forbidden', { status: 403 }); const body = await parseJSONBody(r); if (!body) return new Response(JSON.stringify({success:false, msg:'bad json'}), {status: 400, headers:{'Content-Type':'application/json'}}); const _cfIn = {}; for (const k of ['CF_EMAIL','CF_KEY','CF_ID','CF_TOKEN','CF_ZONE_ID']) if (typeof body[k] === 'string') _cfIn[k] = body[k]; const res = await getCloudflareUsage(_cfIn); return new Response(JSON.stringify({success:res.success, msg: res.success ? `验证通过: 总请求 ${res.total}` : `验证失败: ${res.msg}`}), {headers:{'Content-Type':'application/json'}}); }
          if (flag === 'set_webhook' && r.method === 'POST') { if (!hasAuthCookie && !isGlobalAdmin) return new Response('403 Forbidden', { status: 403 }); const token = await getSafeEnv(env, 'TG_BOT_TOKEN', TG_BOT_TOKEN); if (!token) return new Response(JSON.stringify({success:false, msg:'未配置 TG_BOT_TOKEN'}), {headers:{'Content-Type':'application/json'}}); const webhookUrl = `https://${url.hostname}/tg/webhook`; const secret = (await getSafeEnv(env, 'TG_WEBHOOK_SECRET', '')) || _hex(crypto.getRandomValues(new Uint8Array(24))); if (env.DB) { try { await env.DB.prepare("INSERT INTO config (key, value) VALUES ('TG_WEBHOOK_SECRET', ?) ON CONFLICT(key) DO UPDATE SET value = ?").bind(secret, secret).run(); cfgCacheReset(); } catch(e) {} } const wres = await tgApi(token, 'setWebhook', { url: webhookUrl, allowed_updates: ['message'], secret_token: secret }); return new Response(JSON.stringify({success: !!(wres && wres.ok), msg: (wres && wres.ok) ? (`Webhook 已设置: ${webhookUrl}` + (env.DB ? '' : '（警告：无 D1，secret 未持久化，校验将不生效）')) : ((wres && wres.description) || '设置失败')}), {headers:{'Content-Type':'application/json'}}); }
          if (flag === 'save_config' && r.method === 'POST') { if (!hasAuthCookie && !isGlobalAdmin) return new Response('403 Forbidden', { status: 403 }); try { const body = await r.json(); const ALLOWED_KEYS = new Set(['ADD','ADDAPI','ADDCSV','ADDSUB','DLS','TG_BOT_TOKEN','TG_CHAT_ID','CF_ID','CF_TOKEN','CF_EMAIL','CF_KEY','PROXYIP','SUB_DOMAIN','SUBAPI','PS','LOGIN_PAGE_TITLE','DASHBOARD_TITLE','TG_GROUP_URL','SITE_URL','GITHUB_URL','PROXY_CHECK_URL','CLASH_CONFIG','SINGBOX_CONFIG_V11','SINGBOX_CONFIG_V12','WL_IP','ECH_ENABLED','ECH_SNI','ECH_DNS','STATS_ENABLED','STATS_CHAT_ID','CF_ZONE_ID','NET']); const _stmts = []; for (const [k, v] of Object.entries(body || {})) { if (!ALLOWED_KEYS.has(k)) continue; if (env.DB) _stmts.push(env.DB.prepare("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?").bind(k, String(v ?? ''), String(v ?? ''))); } try { if (_stmts.length) { if (typeof env.DB.batch === 'function') await env.DB.batch(_stmts); else for (const st of _stmts) await st.run(); } } finally { if (env.DB) cfgCacheReset(); } return new Response(JSON.stringify({status: 'ok'}), { headers: { 'Content-Type': 'application/json' } }); } catch(e) { return new Response(JSON.stringify({status: 'error', msg: e.toString()}), { headers: { 'Content-Type': 'application/json' } }); } }
      }

      // A-7：TLS 分片订阅参数（对齐 EDT `_ref_edgetunnel.tmp:353`）
      // 仅用户显式配置 TLS_FRAGMENT 时追加；未配 → 空串，对订阅输出零影响。
      // A-3：订阅域名随机化（默认关闭；需 RANDOM_HOST=1 且配置 HOSTS 才生效 → 未开启时零影响）
      const _rndOn = ['1', 'true'].includes(String(await getSafeEnv(env, 'RANDOM_HOST', '')).toLowerCase());
      const _rndHosts = _rndOn ? _parseHosts(await getSafeEnv(env, 'HOSTS', '')) : [];
      // A-7：TLS 分片订阅参数（对齐 EDT `_ref_edgetunnel.tmp:353`）
      // 仅用户显式配置 TLS_FRAGMENT 时追加；未配 → 空串，对订阅输出零影响。
      const _fragMode = String(await getSafeEnv(env, 'TLS_FRAGMENT', '')).trim().toLowerCase();
      const _fragQ = _fragMode === 'shadowrocket' ? '&fragment=' + encodeURIComponent('1,40-60,30-50,tlshello')
          : _fragMode === 'happ' ? '&fragment=' + encodeURIComponent('3,1,tlshello') : '';
      // NET：订阅默认传输（env/D1 NET → 默认 ws）；?net=ws|xhttp 单次覆盖；转换器回源（flag= / subconverter UA）恒 ws——
      // mihomo / sing-box 等不支持 xhttp，且回源链接若带 xhttp 会让转换后端产出无法解析的节点。
      const _netCfg = String(await getSafeEnv(env, 'NET', NET)).trim().toLowerCase();
      const _netQ = String(url.searchParams.get('net') || '').trim().toLowerCase();
      const _net = (url.searchParams.has('flag') || UA_L.includes('subconverter')) ? 'ws' : ((_netQ === 'xhttp' || _netQ === 'ws') ? _netQ : (_netCfg === 'xhttp' ? 'xhttp' : 'ws'));

      if (_SUB_PW && url.pathname === `/${_SUB_PW}`) {
          ctx.waitUntil(logAccessThrottled(env, clientIP, `${city},${country}`, "订阅更新", 30));
          const isFlagged = url.searchParams.has('flag');
          if (!isFlagged) {
              try {
                  const rules = [['Mi'+'homo', 'mi'+'homo'], ['Fl'+'Cl'+'ash', 'fl'+'cl'+'ash'], ['Cl'+'ash', 'cl'+'ash'], ['Cl'+'ash', 'me'+'ta'], ['Cl'+'ash', 'st'+'ash'], ['Hi'+'ddify', 'hi'+'ddify'], ['Si'+'ng-'+'box', 'si'+'ng-'+'box'], ['Si'+'ng-'+'box', 'si'+'ng'+'box'], ['Si'+'ng-'+'box', 'sfi'], ['Si'+'ng-'+'box', 'box'], ['v2'+'ray'+'N/Core', 'v2'+'ray'], ['Su'+'rge', 'su'+'rge'], ['Qu'+'antumult'+' X', 'qu'+'antumult'], ['Sh'+'adow'+'rocket', 'sh'+'adow'+'rocket'], ['Lo'+'on', 'lo'+'on'], ['Ha'+'A', 'ha'+'pp']];
                  let cName = "Unknown"; let isProxy = false;
                  for (const [n, k] of rules) { if (UA_L.includes(k)) { cName = n; isProxy = true; break; } }
                  if (!isProxy && (UA_L.includes('mo'+'zilla') || UA_L.includes('ch'+'rome'))) cName = "Browser";
                  const title = isProxy ? "🔄 快速订阅更新" : "🌐 访问快速订阅页";
                  const p = sendTgMsg(ctx, env, title, r, `类型: ${cName}`, isGlobalAdmin);
                  if(ctx && ctx.waitUntil) ctx.waitUntil(p);
              } catch (e) {}
          }
          let requestProxyIp = (url.searchParams.get('proxyip') || _PROXY_IP).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
          const pathParam = requestProxyIp ? "/proxyip=" + requestProxyIp : "/";
          
          // ===== 自适应订阅：完整客户端适配（参考 EDT 2.1）=====
          const _manualTarget = (t => ['clash', 'singbox', 'surge', 'quanx', 'loon', 'mixed'].includes(t) ? t : null)(String(url.searchParams.get('target') || '').toLowerCase());
          // A-4：target=mixed = 钉死「通用 base64 混合订阅」（对齐 EDT 回源约定 `_ref_edgetunnel.tmp:457`）。
          // 我们不是「忘了钉 target」而是没有 target 概念：`flag=true` 的原生路径本身即 mixed 语义。
          // 注意：若把 mixed 当成普通 target 交给转换后端，会形成「本端→后端→本端」递归，故显式判空走原生路径。
          const _mtMixed = String(_manualTarget || '').toLowerCase() === 'mixed';
          const 订阅类型 = _mtMixed
            ? null
            : (_manualTarget
            ? _manualTarget
            : (UA_L.includes('cl'+'ash') || UA_L.includes('me'+'ta') || UA_L.includes('mi'+'ho'+'mo') || UA_L.includes('fl'+'cl'+'ash') || UA_L.includes('st'+'ash') || UA_L.includes('nek'+'obo'+'x'))
              ? 'clash'
              : (UA_L.includes('si'+'ng-'+'box') || UA_L.includes('si'+'ng'+'box') || UA_L.includes('sfi') || UA_L.includes('hid'+'dify') || UA_L.includes('kar'+'ing'))
                ? 'singbox'
                : UA_L.includes('su'+'rge')
                  ? 'surge'
                  : UA_L.includes('qua'+'ntu'+'mult')
                    ? 'quanx'
                    : UA_L.includes('lo'+'on')
                      ? 'loon'
                      : null);

          // 构造上游 subUrl：同时兼容 Desire 与 workerVless2sub 参数契约
          let _subUrl;
          {
              const _workerSubParams = `uuid=${_UUID}&${'enc'+'ryption'}=none&${'secu'+'rity'}=tls&sni=${host}&fp=${FP}&allowInsecure=0&type=ws&host=${host}&path=${encodeURIComponent(pathParam)}`;
              if (_SUB_TOKEN) {
                  const _desireIPs = await getCustomIPs(env, _DLS, url, r, false);
                  const _desireIP = (_desireIPs[0] || _PROXY_IP || host);
                  const _desireNode = genNodes(host, _UUID, _PROXY_IP, _desireIP ? [_desireIP] : [], _PS);
                  const _desireBase = (typeof _desireNode === 'string' ? _desireNode : _desireNode.split('\n')[0]).split('\n')[0];
                  _subUrl = `https://${_SUB_DOMAIN}/sub?base=${encodeURIComponent(_desireBase)}&token=${encodeURIComponent(_SUB_TOKEN)}&${_workerSubParams}` + (ECH ? `&ech=${encodeURIComponent((ECH_SNI ? ECH_SNI + '+' : '') + ECH_DNS)}` : '');
              } else {
                  _subUrl = `https://${_SUB_DOMAIN}/sub?${_workerSubParams}` + (ECH ? `&ech=${encodeURIComponent((ECH_SNI ? ECH_SNI + '+' : '') + ECH_DNS)}` : '');
              }
          }

          // 通用响应头
          const _subHeaders = {
              'Profile-Update-Interval': '3',
              'Subscription-Userinfo': `upload=0; download=0; total=${24 * 1099511627776}; expire=4102329600`,
              'Cache-Control': 'no-store'
          };
          if (!UA_L.includes('mozilla')) _subHeaders['Content-Disposition'] = `attachment; filename*=utf-8''${encodeURIComponent(_PS || 'AK1.32V2')}`;

          // ADDSUB 汇聚订阅：统一取一次，供下面三条路径复用
          const _agg = await getAggregated(env);
          const _aggPrefix = _agg.links.length ? _agg.links.join('\n') + '\n' : '';

          // ===== 路径A：需要订阅转换的客户端（clash/singbox/surge/quanx/loon）=====
          if (订阅类型) {
              const subApiTarget = 订阅类型 === 'surge' ? 'surge&ver=4' : 订阅类型;
              const configList = (订阅类型 === 'singbox')
                  ? Array.from(new Set([_SINGBOX_CONFIG_V11, _SINGBOX_CONFIG_V12].filter(Boolean)))
                  : [_CLASH_CONFIG];

              // 汇聚源以 | 追加为多源参数（转换后端逐个抓取合并）。
              // 只追加机场订阅 URL 与现成节点：sub:// 生成器和优选IP列表返回的是地址而非节点，后端无法解析。
              let _urlParam = _subUrl;
              {
              // EDT 2.1 哨兵契约优先：新版生成器（sub.cmliussss.net 等）旧参数只返回占位节点。
              // 不内联重建链接（转换后端 URL 有长度上限，一百多个节点会被截断），
              // 让转换后端回源抓本端订阅端点（端点内部完成哨兵重建，输出全部节点）
              if (host.toLowerCase() === _SUB_DOMAIN.toLowerCase()) {
                  _urlParam = `https://${host}/${_SUB_PW}?flag=true&target=mixed&cnIspCode=${ispCode(r)}` + (requestProxyIp ? `&proxyip=${encodeURIComponent(requestProxyIp)}` : '');
              } else {
                  try {
                      const gen = await fetchSubGenerator('sub://' + _SUB_DOMAIN);
                      if (gen.ips.length) {
                          // A-4：回源钉 &target=mixed，确保转换后端回来抓到的是通用混合格式（EDT `_ref_edgetunnel.tmp:457`）
                          // A-2：追加 &cnIspCode=<识别结果>（值域仅 ct/cu/cmcc/cf 四字面量，供后端选运营商优选文件）
                          _urlParam = `https://${host}/${_SUB_PW}?flag=true&target=mixed&cnIspCode=${ispCode(r)}` + (requestProxyIp ? `&proxyip=${encodeURIComponent(requestProxyIp)}` : '');
                      }
                  } catch(e) {}
              }
                  const extra = [];
                  for (const u of _agg.fetchUrls) { const s = u.split('#')[0].trim(); if (s) extra.push(s); }
                  for (const l of _agg.rawLinks) { const s = l.trim(); if (s) extra.push(s); }
                  for (const one of extra) {
                      if (_urlParam.length + one.length + 1 > 6000) break; // 防超长被后端拒绝
                      _urlParam += '|' + one;
                  }
              }

              // A-5：转换器补 udp / xudp / tls13 / append_type（EDT `_ref_edgetunnel.tmp:457`），默认全开
              const _cvtExtra = `&udp=${encodeURIComponent(await getSafeEnv(env, 'SUB_UDP', 'true'))}`
                  + `&xudp=${encodeURIComponent(await getSafeEnv(env, 'SUB_XUDP', 'true'))}`
                  + `&tls13=${encodeURIComponent(await getSafeEnv(env, 'SUB_TLS13', 'true'))}`
                  + `&append_type=${encodeURIComponent(await getSafeEnv(env, 'SUB_APPEND_TYPE', 'true'))}`;
              let lastRes = null;
              for (const config of configList) {
                  const subApi = `${_CONVERTER}/${'sub?tar'+'get='}${subApiTarget}&url=${encodeURIComponent(_urlParam)}&config=${encodeURIComponent(config)}${'&emo'+'ji=true&li'+'st=false&so'+'rt=false&fd'+'n=false&sc'+'v=false'}${_cvtExtra}`;
                  try {
                      const res = await fetch(subApi, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }, signal: AbortSignal.timeout(SUB_FETCH_TIMEOUT) });
                      if (res.ok) { lastRes = res; break; }
                  } catch(e) {}
              }

              if (lastRes) {
                  let _body = await _readCapped(lastRes, SUB_BODY_MAX);
                  // ECH 精准注入：只对支持 ECH 的客户端
                  if (ECH) {
                      if (订阅类型 === 'singbox') _body = await pSB(_body, _UUID);
                      else if (订阅类型 === 'clash') _body = await pCL(_body, _UUID, url.hostname);
                      // surge/quanx/loon 不支持 ECH，不注入
                  }
                  if (订阅类型 === 'clash') _subHeaders['Content-Type'] = 'application/x-yaml; charset=utf-8';
                  else if (订阅类型 === 'singbox') _subHeaders['Content-Type'] = 'application/json; charset=utf-8';
                  else _subHeaders['Content-Type'] = 'text/plain; charset=utf-8';
                  return new Response(_body, { status: 200, headers: _subHeaders });
              }
              return new Response('subscription converter unavailable', { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
          }

          // ===== 路径B：原生订阅（v2rayN/Shadowrocket/Happ/浏览器等）=====
          try {
            let success = false;
            let body = "";

            if (host.toLowerCase() !== _SUB_DOMAIN.toLowerCase()) {
                // EDT 2.1 哨兵契约优先（sub.cmliussss.net 等新版生成器）：地址剥出后套本端模板，透传节点原样保留
                try {
                    const gen = await fetchSubGenerator('sub://' + _SUB_DOMAIN);
                    if (gen.ips.length) {
                        body = (gen.links.length ? gen.links.join('\n') + '\n' : '') + genNodes(host, _UUID, requestProxyIp, gen.ips, "", null, _fragQ, _net);
                        success = true;
                    }
                } catch(e) {}
            }

            if (!success && host.toLowerCase() !== _SUB_DOMAIN.toLowerCase()) {
                try {
                    const res = await fetch(_subUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(SUB_FETCH_TIMEOUT) });
                    if (res.ok) {
                        body = await _readCapped(res, SUB_BODY_MAX);
                        success = true;
                    }
                } catch(e) {}
            }

            if (success) {
                try {
                  const nodeLinePattern = /(?:^|\n)\s*(?:vless|vmess|trojan|ssr?|hysteria2?|hy2|tuic):\/\//i;
                  const rawBody = body.trim();
                  let decoded = rawBody;
                  if (!nodeLinePattern.test(decoded)) {
                    const compactBody = rawBody.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
                    const paddedBody = compactBody + '='.repeat((4 - compactBody.length % 4) % 4);
                    try { decoded = decodeURIComponent(escape(atob(paddedBody))); }
                    catch { try { decoded = atob(paddedBody); } catch { decoded = ''; } }
                  }
                  if (!nodeLinePattern.test(decoded)) throw new Error('Invalid upstream subscription');
                  let lines = decoded.split('\n').map(line => {
                    line = line.trim();
                    if (!line || !line.includes('://')) return line;
                    // 只改写本端节点（vless + 本端 UUID）：外来透传节点（vmess/ss/trojan/他人 vless）注入 ECH/fp/PS 会直接把它们改坏
                    if (!(/^vless:\/\//i.test(line) && line.includes(_UUID) && line.includes('?'))) return line;
                    // ECH URI 注入（v2rayN/Shadowrocket 支持）
                    const _echURI = UA_L.includes('v2'+'ray') || UA_L.includes('sha'+'dow'+'roc'+'ket') || UA_L.includes('ha'+'pp');
                    if (ECH && _echURI && !line.includes('&ech=')) {
                      const echVal = encodeURIComponent((ECH_SNI ? ECH_SNI + '+' : '') + ECH_DNS);
                      const hashIdx = line.indexOf('#');
                      if (hashIdx > 0) {
                        line = line.slice(0, hashIdx) + '&ech=' + echVal + line.slice(hashIdx);
                      } else {
                        line = line + '&ech=' + echVal;
                      }
                    }
                    // FP 修正
                    if (/fp=/i.test(line)) {
                      line = line.replace(/fp=[^&#]+/i, 'fp=' + FP);
                    }
                    // alpn 交给客户端自行协商：剔除上游模板自带的 alpn（只动 # 之前的查询串，备注里的同名文本不碰）
                    {
                      const hashIdx = line.indexOf('#'), q = hashIdx < 0 ? line : line.slice(0, hashIdx);
                      line = q.replace(/([?&])alpn=[^&]*(&?)/i, (m, p, t) => t ? p : '') + (hashIdx < 0 ? '' : line.slice(hashIdx));
                    }
                    // NET=xhttp：上游生成器套的是 ws 模板，仅对含本端 UUID 的行改写为 xhttp + stream-one + padding 混淆 extra（透传的外来节点不动）
                    if (_net === 'xhttp' && line.includes(_UUID) && /[?&]type=ws(?=&|#|$)/i.test(line) && !/[?&]mode=/i.test(line)) {
                      line = line.replace(/([?&])type=ws(?=&|#|$)/i, '$1type=xhttp&mode=stream-one' + XH_extra(_UUID));
                    }
                    // PS 后缀
                    if (_PS) {
                      if (line.includes('#')) line = line + encodeURIComponent(` ${_PS}`);
                      else line = line + '#' + encodeURIComponent(_PS);
                    }
                    return line;
                  });
                  // 所有客户端（包括浏览器）统一返回 UTF-8 Base64 订阅
                  // ADDSUB 汇聚节点原样透传，排在最前
                  body = btoa(unescape(encodeURIComponent(_aggPrefix + lines.join('\n'))));
                  _subHeaders['Content-Type'] = 'text/plain; charset=utf-8';
                  return new Response(body, { status: 200, headers: _subHeaders });
                } catch(e) {}
            }
          } catch(e) {}

          // ===== 兜底：本地生成 =====
          const allIPs = await getCustomIPs(env, _DLS, url, r, _agg.ips.length > 0);
          const _fbIPs = _agg.ips.length ? [...new Set(allIPs.concat(_agg.ips))] : allIPs;
          const listText = genNodes(host, _UUID, requestProxyIp, _fbIPs, _PS, _agg.pipSet, _fragQ, _net);
          const fallbackBody = btoa(unescape(encodeURIComponent(_aggPrefix + listText)));
          _subHeaders['Content-Type'] = 'text/plain; charset=utf-8';
          return new Response(fallbackBody, { status: 200, headers: _subHeaders });
      }

      if (url.pathname === '/sub') {
          const baseLink = url.searchParams.get('base');

          // ===== Desire 兼容模式：有 base= 参数时走节点裂变逻辑 =====
          if (baseLink) {
              const reqToken = url.searchParams.get('token');
              const expectedToken = _SUB_TOKEN;
              // 未配置 SUB_TOKEN → 端点关闭（fail-closed）；配置后须常量时间比较
              if (!expectedToken || !_ctEq(String(reqToken || ''), expectedToken)) {
                  ctx.waitUntil(logAccessThrottled(env, clientIP, `${city},${country}`, "裂变订阅失败(Token错误)", 30));
                  const errNode = `${'vl'+'ess'}://00000000-0000-0000-0000-000000000000@127.0.0.1:80?${'enc'+'ryption'}=none&${'secu'+'rity'}=none&type=tcp#${encodeURIComponent('❌ Token验证失败')}`;
                  return new Response(btoa(errNode), { headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
              }
              const source = url.searchParams.get('source');
              const extUrl = url.searchParams.get('ext_url');
              let allIPs;
              let _extOk = false;
              if (extUrl) {
                  try {
                      const _u = new URL(extUrl);
                      const _safe = _extHostSafe(_u.hostname);
                      const _port = _u.port ? Number(_u.port) : 443;
                      _extOk = _u.protocol === 'https:' && _safe.ok && (_port === 443);
                  } catch {}
              }
              if (source === 'ext' && extUrl && _extOk) {
                  try {
                      const extRes = await fetch(extUrl, {
                          headers: { 'User-Agent': 'Mozilla/5.0' },
                          redirect: 'manual',                     // 不自动跟随，阻断重定向打内网
                          signal: AbortSignal.timeout(5000)       // 超时，阻断慢速资源耗尽
                      });
                      if (extRes.status >= 300 && extRes.status < 400) {  // 显式处理重定向：校验后再决定
                          const loc = extRes.headers.get('Location');
                          const lu = loc ? new URL(loc, extUrl) : null;
                          if (!lu || lu.protocol !== 'https:' || !_extHostSafe(lu.hostname).ok || (lu.port ? Number(lu.port) : 443) !== 443) { allIPs = []; }
                          else { const r2 = await fetch(lu.toString(), { headers:{'User-Agent':'Mozilla/5.0'}, redirect:'manual', signal: AbortSignal.timeout(5000) }); allIPs = (await _readCapped(r2)).split('\n').map(l=>l.trim()).filter(l=>l && !l.startsWith('#')); }
                      } else {
                          const extText = await _readCapped(extRes);
                          allIPs = extText.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
                      }
                  } catch { allIPs = []; }
              } else {
                  allIPs = await getCustomIPs(env, _DLS, url, r, false);
              }
              const links = allIPs.map(ipInfo => {
                  let [addrPart, ...nameParts] = ipInfo.split('#');
                  const nodeName = nameParts.join('#').trim();
                  addrPart = addrPart.trim();
                  let [ip, port] = parseAddressPort(addrPart);
                  port = String(port || 443);
                  try {
                      if (baseLink.startsWith('vl'+'ess://')) {
                          const u = new URL(baseLink);
                          const origHost = u.hostname;
                          u.hostname = formatHostForUrl(ip); u.port = port;
                          u.hash = nodeName || ip;
                          if (!u.searchParams.has('host')) u.searchParams.set('host', origHost);
                          if (!u.searchParams.has('sni')) u.searchParams.set('sni', origHost);
                          return u.toString();
                      } else if (baseLink.startsWith('vm'+'ess://')) {
                          const b64 = baseLink.slice(8).replace(/-/g, '+').replace(/_/g, '/');
                          const cfg = JSON.parse(decodeURIComponent(escape(atob(b64))));
                          if (!cfg.sni) cfg.sni = cfg.add;
                          if (!cfg.host) cfg.host = cfg.add;
                          cfg.add = ip; cfg.port = port;
                          cfg.ps = nodeName || ip;
                          return ('vm'+'ess://') + btoa(unescape(encodeURIComponent(JSON.stringify(cfg))));
                      }
                  } catch { return null; }
                  return null;
              }).filter(Boolean);
              const output = links.length
                  ? links.join('\n')
                  : `${'vl'+'ess'}://00000000-0000-0000-0000-000000000000@127.0.0.1:80?${'enc'+'ryption'}=none&${'secu'+'rity'}=none&type=tcp#${encodeURIComponent('❌ 无可用优选IP')}`;
              return new Response(btoa(unescape(encodeURIComponent(output))), {
                  headers: { 'Content-Type': 'text/plain;charset=utf-8' }
              });
          }
          // ===== 原有逻辑保持不变 =====

          // A-1：BEST_SUB 订阅生成器哨兵（对齐 EDT `_ref_edgetunnel.tmp:305`）
          // 命中时把 /sub 当作上游优选订阅生成器调用，跳过 UUID 校验 → **安全面**。
          //
          // E2（中危）：原屏障无效。① SUB_DOMAIN 只是 save_config 的常规面板配置项，普遍会填，不是秘密；
          //   ② 三个魔术参数（host=example.com / uuid=00000000-… / UA 含 tunnel (https://github.com/）
          //   **全是源码字面量，本项目开源，任何人可读**；命中后返回 genNodes(host,_UUID,…) 的完整
          //   base64 订阅，内含真实 UUID / proxyIP / 优选 IP = 凭据完全泄露。
          // → 改为强随机令牌 BEST_SUB_TOKEN（≥32 字符），未配置则整个分支**永不启用**；
          //   请求须以 ?bst= 携带该令牌并做**常量时间比较**。三个魔术参数保留为「形状信号」，不再是唯一屏障。
          const _bstCfg = String(await getSafeEnv(env, 'BEST_SUB_TOKEN', '') || '');
          // 纵深防御：SUB_DOMAIN 门槛（team-lead 第四轮裁定）与强令牌**叠加**，不是二选一
          const _subDomCfg = String((await getSafeEnv(env, 'SUB_DOMAIN', '')) || (await getSafeEnv(env, 'SUB', '')) || '').trim();
          const _bstOn = !!_subDomCfg && _bstCfg.length >= 32;
          const _bstReq = String(url.searchParams.get('bst') || '');
          const _BEST_SUB = _bstOn
              && _ctEq(_bstReq, _bstCfg)
              && ['1', 'true'].includes(String(await getSafeEnv(env, 'BEST_SUB', '')).toLowerCase())
              && url.searchParams.get('host') === 'example.com'
              && url.searchParams.get('uuid') === '00000000-0000-4000-8000-000000000000'
              && UA_L.includes('tunnel (https://github.com/');
          const requestUUID = url.searchParams.get('uuid');
          if (!_BEST_SUB && (!requestUUID || !_ctEq(requestUUID.toLowerCase(), _UUID.toLowerCase()))) {
              ctx.waitUntil(logAccessThrottled(env, clientIP, `${city},${country}`, "常规订阅失败(UUID错误)", 30));
              return new Response('Invalid UUID', { status: 403 });
          }
          ctx.waitUntil(logAccess(env, clientIP, `${city},${country}`, "常规订阅"));
          let proxyIp = (url.searchParams.get('proxyip') || _PROXY_IP).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
          const pathParam = url.searchParams.get('path');
          if (pathParam && pathParam.includes('/proxyip=')) proxyIp = pathParam.split('/proxyip=')[1];
          // ADDSUB 汇聚：透传节点在前，优选地址合并进节点模板（先取汇聚结果，供 getCustomIPs 判断是否需要本地兜底）
          const _agg2 = await getAggregated(env);
          const allIPs = await getCustomIPs(env, _DLS, url, r, _agg2.ips.length > 0); // 传入 DLS
          const _regIPs = _agg2.ips.length ? [...new Set(allIPs.concat(_agg2.ips))] : allIPs;
          // A-1：作为上游优选订阅生成器被调用时，输出 EDT 哨兵契约形态（AGG_ID@ip:port … host=example.com&sni=example.com&path=%2F），
          // 由调用方按自身 UUID/域名重建；绝不输出真实 UUID / ProxyIP / ECH（对齐 EDT `_ref …:452-455`）
          if (_BEST_SUB) {
              const _bstOut = genNodes(AGG_HOST, AGG_ID, '', _regIPs, '', null, '', 'ws', true);
              return new Response(btoa(unescape(encodeURIComponent(_bstOut))), { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
          }
          const listText = genNodes(host, _UUID, proxyIp, _regIPs, _PS, _agg2.pipSet, _fragQ, _net);
          let _regBody = (_agg2.links.length ? _agg2.links.join('\n') + '\n' : '') + listText;
          // A-3：替换必须在 base64 之前；EDT 在 UA 含 subconverter 时跳过（转换后端需稳定回源）
          if (_rndHosts.length && !UA_L.includes('subconverter')) _regBody = _randHostBody(_regBody, host, _rndHosts);
          return new Response(btoa(unescape(encodeURIComponent(_regBody))), { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }

      if (r.headers.get('Upgrade') !== 'websocket') {
        const noCacheHeaders = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' };
        if (url.pathname !== '/') {
          // A-8：伪装页 / 反代真实站点（默认 '' 保持 404；仅显式配置 env.URL 才启用）
          const _camUrl = String(await getSafeEnv(env, 'URL', '')).trim();
          if (_camUrl === '1101') return new Response(cf1101Page(url.hostname, clientIP), { status: 200, headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
          if (_camUrl === 'nginx') return new Response(nginxPage(), { status: 200, headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
          if (_camUrl) {
            const _camRes = await _camouflageReverse(_camUrl, r, url, url.hostname);
            if (_camRes) return _camRes;
            return new Response('Not Found', { status: 404, headers: { ...noCacheHeaders, 'Content-Type': 'text/plain; charset=utf-8' } }); // 硬约束#6：反代失败仍 404
          }
          return new Response('订阅密码错误或链接不存在', { status: 404, headers: { ...noCacheHeaders, 'Content-Type': 'text/plain; charset=utf-8' } });
        }
        if (!hasAuthCookie) return new Response(loginPage(_TG_GROUP_URL, _SITE_URL, _GITHUB_URL, _LOGIN_TITLE), { status: 200, headers: noCacheHeaders });
        await sendTgMsg(ctx, env, "✅ 后台登录成功", r, "进入管理面板", true);
        ctx.waitUntil(logAccess(env, clientIP, `${city},${country}`, "登录后台"));

        const _maskVal = (v) => v ? ('****' + v.slice(-4)) : '';
        const sysParams = { tgToken: _maskVal(env.TG_BOT_TOKEN || TG_BOT_TOKEN), tgId: _maskVal(env.TG_CHAT_ID || TG_CHAT_ID), cfId: _maskVal(env.CF_ID || ""), cfToken: _maskVal(env.CF_TOKEN || ""), cfMail: _maskVal(env.CF_EMAIL || ""), cfKey: _maskVal(env.CF_KEY || "") };
        const _tgTokenRaw = await getSafeEnv(env, 'TG_BOT_TOKEN', TG_BOT_TOKEN); const _tgIdRaw = await getSafeEnv(env, 'TG_CHAT_ID', TG_CHAT_ID);
        const _cfIdRaw = await getSafeEnv(env, 'CF_ID', ''); const _cfTokenRaw = await getSafeEnv(env, 'CF_TOKEN', '');
        const _cfMailRaw = await getSafeEnv(env, 'CF_EMAIL', ''); const _cfKeyRaw = await getSafeEnv(env, 'CF_KEY', '');
        const tgToken = _maskVal(_tgTokenRaw); const tgId = _maskVal(_tgIdRaw);
        const cfId = _maskVal(_cfIdRaw); const cfToken = _maskVal(_cfTokenRaw);
        const cfMail = _maskVal(_cfMailRaw); const cfKey = _maskVal(_cfKeyRaw);
        const tgState = !!(_tgTokenRaw && _tgIdRaw); const cfState = (!!(_cfIdRaw && _cfTokenRaw)) || (!!(_cfMailRaw && _cfKeyRaw));
        const _ADD = await getSafeEnv(env, 'ADD', ""); const _ADDAPI = await getSafeEnv(env, 'ADDAPI', ""); const _ADDCSV = await getSafeEnv(env, 'ADDCSV', ""); const _ADDSUB = await getSafeEnv(env, 'ADDSUB', "");

        // 传入 _DLS 参数到 dashPage
        const _ECH_ENABLED = await getSafeEnv(env, 'ECH_ENABLED', ECH ? 'true' : 'false');
        const _ECH_SNI_VAL = await getSafeEnv(env, 'ECH_SNI', ECH_SNI);
        const _ECH_DNS_VAL = await getSafeEnv(env, 'ECH_DNS', ECH_DNS);
        const _STATS_ENABLED = await getSafeEnv(env, 'STATS_ENABLED', 'false');
        const _STATS_CHAT_ID = await getSafeEnv(env, 'STATS_CHAT_ID', '');
        const _CF_ZONE = _maskVal(await getSafeEnv(env, 'CF_ZONE_ID', ''));
        // P1-3：弱口令 TG 一次性通知（持久化标记避免刷屏；DB 不可用时可能重复，属可接受）
        if (_weakPw) { try { if (!(await getSafeEnv(env, '_weak_pw_notified', ''))) { ctx.waitUntil(sendTgMsg(ctx, env, "⚠️ 安全告警：仍在使用默认口令，请尽快修改 WEB_PASSWORD / SUB_PASSWORD", r, "启动自检", true)); await _dashWrite(env, '_weak_pw_notified', '1'); } } catch (e) {} }
        return new Response(dashPage(url.hostname, _UUID, _PROXY_IP, _SUB_PW, _SUB_DOMAIN, _CONVERTER, _SUB_TOKEN, env, clientIP, hasAuthCookie, tgState, cfState, _ADD, _ADDAPI, _ADDCSV, tgToken, tgId, cfId, cfToken, cfMail, cfKey, sysParams, _DASH_TITLE, _PROXY_CHECK_URL, _DLS, _ECH_ENABLED, _ECH_SNI_VAL, _ECH_DNS_VAL, _STATS_ENABLED, _STATS_CHAT_ID, _CF_ZONE, _ADDSUB, _weakPw), { status: 200, headers: noCacheHeaders });
      }
      

      // WS 连接已在上方提前分发；此处为兜底，正常不会到达
      return ws(r, env);

  } catch (err) {
      return new Response('Internal Server Error', { status: 500 });
    }
  },
  async scheduled(event, env, ctx) {
    // 批次 6：Cron 自检（辅探针）—— D1 连通性探测 + 心跳；失败落结构化日志（按事件 60s 节流）
    ctx.waitUntil((async () => {
      if (env.DB) {
        try { await env.DB.prepare("SELECT 1").all(); }
        catch (e) { obs('error', 'd1_ping_fail', { err: String((e && e.message) || e) }, env); }
      }
      obs('info', 'sched_tick', { cron: String((event && event.cron) || '?'), db: env.DB ? 1 : 0 }, env);
      _sweepLoginFail();   // 优化#5：低频点无条件清理登录退避表（不依赖 STATS_ENABLED）
      await pushDashboard(env);
    })());
  }
};

// =============================================================================
// 📋 UI & 节点生成
// =============================================================================

/* ---------- A-3：订阅域名随机化（对齐 EDT `_ref_edgetunnel.tmp:469` + `5424`） ---------- */
// HOSTS 白名单：只接受 [a-z0-9.*-]，拒绝含 / @ : 的值，防止节点 URI 被注入
// 优化4：对齐 GO2SOCKS5 口径 —— 拒绝裸 "*" 与无点项（避免"配错即断网"：无点项会替换掉整段入口域名，裸 * 等于全量随机化）
const _parseHosts = (s) => String(s || '').split(',').map(x => x.trim().toLowerCase()).filter(x => x && /^[a-z0-9.*-]+$/.test(x) && x !== '*' && x.includes('.'));
// 优化2：Fisher-Yates 均匀洗牌（原 sort(()=>Math.random()-0.5) 分布不均，会让前几个域名出现频率偏高）
function _fyShuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
// 把域名里的 * 换成 3~16 位随机 [a-z0-9]
function _starRand(s) {
  if (typeof s !== 'string' || !s.includes('*')) return s;
  const cs = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return s.replace(/\*/g, () => { let o = ''; const n = Math.floor(Math.random() * 14) + 3; for (let i = 0; i < n; i++) o += cs[Math.floor(Math.random() * cs.length)]; return o; });
}
// 每 2 次出现换一个域名（EDT 节奏），base 为占位/原入口域名
function _randHostBody(body, base, hosts) {
  if (!body || !base || !hosts || !hosts.length) return body;
  const shuffled = _fyShuffle([...hosts]);
  const esc = String(base).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let cnt = 0, cur = null;
  return body.replace(new RegExp(esc, 'g'), () => {
    if (cnt % 2 === 0) cur = _starRand(shuffled[Math.floor(cnt / 2) % shuffled.length]);
    cnt++;
    return cur;
  });
}

function genNodes(host, uuid, proxyIP, customIPs, psName, pipSet, fragQ = '', net = 'ws', bare = false) {
  let echParam = '';
  if (ECH && !bare) {
    echParam = `&ech=${encodeURIComponent((ECH_SNI ? ECH_SNI + '+' : '') + ECH_DNS)}`;
  }
  // 不写 alpn：交给客户端自行协商（xhttp 默认走 h2）；xhttp 附 padding 混淆 extra（bare 哨兵输出与 ECH 一样不带）
  const commonUrlPart = `?enc`+`ryption=none&secu`+`rity=tls&sni=${host}&fp=${FP}&type=${net === 'xhttp' ? 'xhttp' : 'ws'}&host=${host}` + (net === 'xhttp' ? '&mode=stream-one' + (bare ? '' : XH_extra(uuid)) : '') + echParam;
  const separator = psName ? ` ${psName}` : '';
  const result = [];
  if (!customIPs || customIPs.length === 0) {
      const path = proxyIP ? `/proxyip=${proxyIP}` : "/";
      const nodeName = `${psName || 'Worker'} - Default`;
      const defaultHost = formatHostForUrl(host);
      const vLink = `${P_V}://${uuid}@${defaultHost}:443${commonUrlPart}&path=${encodeURIComponent(path)}${fragQ}#${encodeURIComponent(nodeName)}`;
      return vLink;
  }
  for (const ipInfo of customIPs) {
      let [addressPart, ...nameParts] = ipInfo.split('#');
      let uniqueName = nameParts.join('#').trim();
      addressPart = addressPart.trim();
      let [ip, port] = parseAddressPort(addressPart);
      let path = proxyIP ? `/proxyip=${proxyIP}` : "/";
      // ADDSUB 的 ?proxyip=true：该地址既作入口又作反代，path 换成 /proxyip=<自身>
      if (pipSet && pipSet.size) {
          for (const p of pipSet) { if (p && parseAddressPort(p)[0] === ip) { path = `/proxyip=${p}`; break; } }
      }
      let nodeName = uniqueName || ip; if (psName) nodeName = `${nodeName}${separator}`;
      const vLink = `${P_V}://${uuid}@${formatHostForUrl(ip)}:${port}${commonUrlPart}&path=${encodeURIComponent(path)}${fragQ}#${encodeURIComponent(nodeName)}`;
      result.push(vLink);
  }
  return result.join('\n');
}

// ===== A-2：运营商识别 + 本地随机优选 IP 库（CF-CIDR） =====
// 运营商识别：req.cf 平台可信字段；非 CN → cf；组织名关键词 → ASN 映射 → 兜底 cf
const ISP_ASN = { 4134:'ct',4809:'ct',4811:'ct',4812:'ct',4815:'ct',4837:'cu',4814:'cu',9929:'cu',17623:'cu',17816:'cu',9808:'cmcc',24400:'cmcc',56040:'cmcc',56041:'cmcc',56044:'cmcc' };
const ISP_KW = [ ['ct', /chinanet|chinatelecom|china telecom|cn2|shtel/], ['cmcc', /cmi|cmnet|chinamobile|china mobile|cmcc|mobile communications/], ['cu', /china169|china unicom|chinaunicom|cucc|cncgroup|cuii|netcom/] ];
const ISP_WHITELIST = ['ct', 'cu', 'cmcc', 'cf'];
const ISP_NAME = { cmcc: 'CF移动优选', cu: 'CF联通优选', ct: 'CF电信优选', cf: 'CF官方优选' };
const CF_PORTS = [443, 2053, 2083, 2087, 2096, 8443];
const CF_CIDR_TIMEOUT = 5000;
const CF_CIDR_CACHE_TTL = 3600000; // 1h
// ⚠️ 安全（硬约束）：fetch URL 全部为**源码字面量**（冻结枚举），仅由白名单值（ct/cu/cmcc/cf）选键，
//    任何请求参数都无法把 fetch 目标改成任意地址（非白名单值在 resolveIspCode 已回退）。
//    URL 由 EDT `_ref_edgetunnel.tmp:5885` 的混淆式 `特征码字典[1]` 还原（= 'cmliu'）。
const ISP_CIDR_URL = Object.freeze({
    cf:   'https://raw.githubusercontent.com/cmliu/cmliu/main/CF-CIDR.txt',
    ct:   'https://raw.githubusercontent.com/cmliu/cmliu/main/CF-CIDR/ct.txt',
    cu:   'https://raw.githubusercontent.com/cmliu/cmliu/main/CF-CIDR/cu.txt',
    cmcc: 'https://raw.githubusercontent.com/cmliu/cmliu/main/CF-CIDR/cmcc.txt'
});
// 内置默认段：fetch 失败 / 超时 / 非 200 / 超 256KB → 回退（对齐 EDT `:5889` 的 104.16.0.0/13）
const ISP_CIDR_BUILTIN = Object.freeze({ cf: ['104.16.0.0/13'], ct: ['104.16.0.0/13'], cu: ['104.16.0.0/13'], cmcc: ['104.16.0.0/13'] });
let _cidrCache = new Map(); // isp -> { list, ts }
const _cidrCacheReset = () => { try { _cidrCache = new Map(); } catch (e) {} };

function ispCode(req) {
    const cf = req && req.cf;
    if (String((cf && cf.country) || '').toLowerCase() !== 'cn') return 'cf';
    const org = String((cf && cf.asOrganization) || '').toLowerCase();
    const hit = ISP_KW.find(([, p]) => p.test(org));
    return (hit && hit[0]) || ISP_ASN[String((cf && cf.asn) || '')] || 'cf';
}
// 用户可控 query 参数 cnIspCode **白名单化**：非法值一律回退到识别结果（绝不未校验拼进 URL）
function resolveIspCode(url, req) {
    let q = '';
    try { q = String((url && url.searchParams && url.searchParams.get('cnIspCode')) || '').toLowerCase(); } catch (e) { q = ''; }
    return ISP_WHITELIST.includes(q) ? q : ispCode(req);
}
// CIDR → 掩码内随机 IP
function _randIPFromCIDR(cidr) {
    const seg = String(cidr || '').split('/');
    const baseIP = seg[0], prefix = parseInt(seg[1], 10);
    if (!baseIP || !isFinite(prefix) || prefix < 0 || prefix > 32) return null;
    const parts = baseIP.split('.').map(n => parseInt(n, 10));
    if (parts.length !== 4 || parts.some(n => !isFinite(n) || n < 0 || n > 255)) return null;
    const hostBits = 32 - prefix;
    const ipInt = (parts.reduce((a, p, i) => (a | (p << (24 - i * 8))) >>> 0, 0)) >>> 0;
    const randomOffset = Math.floor(Math.random() * Math.pow(2, hostBits));
    const mask = (0xFFFFFFFF << hostBits) >>> 0;
    const randomIP = (((ipInt & mask) >>> 0) + randomOffset) >>> 0;
    return [(randomIP >>> 24) & 0xFF, (randomIP >>> 16) & 0xFF, (randomIP >>> 8) & 0xFF, randomIP & 0xFF].join('.');
}
// 取 CIDR 列表（带缓存）；任何失败一律回退内置默认
async function _cidrList(isp) {
    const key = ISP_WHITELIST.includes(isp) ? isp : 'cf';
    const now = Date.now();
    const hit = _cidrCache.get(key);
    if (hit && (now - hit.ts) < CF_CIDR_CACHE_TTL) return hit.list;
    let list = null;
    try {
        const res = await fetch(ISP_CIDR_URL[key], { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(CF_CIDR_TIMEOUT) });
        if (res && res.ok) {
            const text = await _readCapped(res, 262144); // 256KB 上限（超出抛错 → 走回退）
            list = String(text).split(/[\s,"'\r\n]+/).map(s => s.trim()).filter(s => /\//.test(s));
        }
    } catch (e) { list = null; }
    if (!list || !list.length) list = (ISP_CIDR_BUILTIN[key] || ISP_CIDR_BUILTIN.cf).slice();
    _cidrCache.set(key, { list, ts: now });
    return list;
}
// 本地随机优选 IP 库：返回 `IP:端口#名称`
async function localRandomIPs(url, req, count = 16) {
    const isp = resolveIspCode(url, req);
    const cidrList = await _cidrList(isp);
    const name = ISP_NAME[isp] || ISP_NAME.cf;
    const out = [];
    for (let i = 0; i < count; i++) {
        const ip = _randIPFromCIDR(cidrList[Math.floor(Math.random() * cidrList.length)]);
        if (!ip) continue;
        const port = CF_PORTS[Math.floor(Math.random() * CF_PORTS.length)];
        out.push(`${ip}:${port}#${name}${i + 1}`);
    }
    return out;
}

// ⭐ 功能4: 修改 getCustomIPs 支持 DLS 筛选
async function getCustomIPs(env, dlsThreshold, url = null, req = null, aggHasIPs = false) {
    let allIPs = [];
    const threshold = Number(dlsThreshold) || 7; // 默认7 MB/s
    const addText = await getSafeEnv(env, 'ADD', "");
    if (addText) { splitNodeList(addText).forEach(entry => { allIPs.push(entry); }); }
    // 远程源并行抓取 + 5s 超时（与 ADDSUB 通道 AGG_TIMEOUT 对齐）；结果按输入顺序合并，节点排序不变
    const grab = async (url) => {
        try {
            const res = await fetch(url.trim(), { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(AGG_TIMEOUT) });
            return res.ok ? await _readCapped(res, SUB_BODY_MAX) : '';
        } catch (e) { return ''; }
    };
    const apiUrls = addApiUrls(await getSafeEnv(env, 'ADDAPI', "")).slice(0, SUB_SRC_MAX);
    const csvUrls = addApiUrls(await getSafeEnv(env, 'ADDCSV', "")).slice(0, SUB_SRC_MAX);
    const [apiTexts, csvTexts] = await Promise.all([Promise.all(apiUrls.map(grab)), Promise.all(csvUrls.map(grab))]);
    for (const text of apiTexts) { text && text.split('\n').forEach(line => { const trimmed = line.trim(); if (trimmed && !trimmed.startsWith('#')) allIPs.push(trimmed); }); }
    for (const text of csvTexts) {
        if (!text) continue;
        text.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('IP') || trimmed.includes('端口') || trimmed.includes('速度')) return;
            const cols = trimmed.split(',');
            const c1 = (cols.length >= 2) ? cols[1].trim() : '';
            const isNewFmt = c1 && (c1.includes(':') || c1.includes('.') || !/^[0-9]+$/.test(c1));
            const csvIp = cols[0].trim();
            const csvPort = isNewFmt ? ((cols.length >= 3) ? cols[2].trim() : '') : c1;
            const lastCol = cols[cols.length - 1].trim().toLowerCase();
            const speedRaw = parseFloat(lastCol);
            if (!isNaN(speedRaw)) {
                const speedMB = lastCol.includes('kb') ? speedRaw / 1024 : speedRaw;
                if (speedMB < threshold) return;
            }
            if (csvIp) allIPs.push(csvPort && csvPort !== '443' ? csvIp + ':' + csvPort : csvIp);
        });
    }
    // A-2：本地随机优选 IP 库兜底 —— 仅当 ADD/ADDAPI/ADDCSV（及调用方已并入的 ADDSUB）**全部取空**时启用。
    // 现有用例必定命中 ADD 之一，此分支在生产「零配置」部署下才有意义；fetch 失败自动回退内置段，不使请求失败。
    if (allIPs.length === 0 && !aggHasIPs) {
        try { allIPs = await localRandomIPs(url, req, 16); } catch (e) { allIPs = []; }
    }
    return allIPs;
}
// 多值输入 → http(s) 源列表
const addApiUrls = (v) => v ? splitMulti(v).filter(u => u.startsWith('http')) : [];

/* =============================================================================
 * 🔗 ADDSUB 汇聚订阅
 * 一个输入框混写多种内容，按「内容特征」自动分类（从具体到宽泛）：
 *   ① sub://xxx 或 sub=xxx   → 优选订阅生成器（哨兵探测，只取地址，套本项目模板）
 *   ② http(s)://xxx          → 远程抓取，按【返回内容】再分流：
 *                               含 :// = 节点订阅 → 原样透传
 *                               否则   = IP列表/CSV → 套本项目模板
 *   ③ 其他含 ://             → 现成节点链接 → 原样透传
 *   ④ 其余                   → 优选 IP / 域名 → 套本项目模板
 * 透传节点不注入 ECH/fp/PS：外部节点有自己的 host/sni，注入会打挂。
 * 单源失败静默跳过，不影响其余源。
 * ===========================================================================*/
const AGG_TIMEOUT = 5000;
const AGG_ID = '00000000-0000-4000-8000-000000000000';
const AGG_HOST = 'example.com';

function classifyAgg(list) {
    const subGen = [], fetchUrls = [], rawLinks = [], plainIPs = [];
    for (const item of list) {
        const raw = String(item || '').trim();
        if (!raw || raw.startsWith('#')) continue;
        const low = raw.toLowerCase();
        if (low.startsWith('sub://')) { subGen.push(raw); continue; }
        const hi = raw.indexOf('#');
        const addrPart = hi > -1 ? raw.slice(0, hi) : raw;
        const subMatch = raw.match(/sub\s*=\s*([^\s&#]+)/i);
        const subVal = subMatch ? subMatch[1].trim().split('?')[0] : '';
        if (subVal && subVal.includes('.')) {
            const pip = low.includes('proxyip=true') ? '?proxyip=true' : '';
            subGen.push('sub://' + subVal + pip + (hi > -1 ? raw.slice(hi) : ''));
        } else if (/^https?:\/\//i.test(addrPart)) {
            fetchUrls.push(raw);
        } else if (addrPart.includes('://')) {
            rawLinks.push(raw);
        } else {
            plainIPs.push(raw);
        }
    }
    return { subGen, fetchUrls, rawLinks, plainIPs };
}

const _aggTag = (s, tag) => !tag ? s : (s.includes('#') ? s + ' [' + tag + ']' : s + '#[' + tag + ']');

const _aggTagLinks = (text, tag) => !tag ? text : text.replace(
    /([a-z][a-z0-9+\-.]*:\/\/[^\r\n]*?)(\r?\n|$)/gi,
    (m, link, eol) => link + (link.includes('#') ? encodeURIComponent(' [' + tag + ']') : '#' + encodeURIComponent('[' + tag + ']')) + eol
);

// 双编码解码（UTF-8 / GBK，以 U+FFFD 替换字符判断编码是否猜对）
const _aggDecode = (buf, ctype) => {
    const cs = (String(ctype || '').toLowerCase().match(/charset=([^\s;]+)/i) || [])[1] || '';
    const order = /gb/.test(cs) ? ['gb18030', 'utf-8'] : ['utf-8', 'gb18030'];
    for (const enc of order) {
        try {
            const s = new TextDecoder(enc).decode(buf);
            if (s && !s.includes('�')) return s;
        } catch (e) {}
    }
    try { return new TextDecoder('utf-8').decode(buf); } catch (e) { return ''; }
};

// base64 盲试：长度为 4 的倍数 + 仅含 base64 字母表 + 解码成功
// 复用 b64uToU8 手动查表解码，不引入新的解码函数特征
const _aggUnb64 = (text) => {
    let c = String(text || '').replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
    if (!c.length || !/^[A-Za-z0-9+/]+={0,2}$/.test(c)) return text;
    c = c.replace(/=+$/, ''); c += '='.repeat((4 - c.length % 4) % 4);
    const b = b64uToU8(c);
    if (!b || !b.length) return text;
    try {
        const s = new TextDecoder('utf-8', { fatal: true }).decode(b);
        return s || text;
    } catch (e) { return text; }
};

// 从一行 IP 文本补齐端口：行内自带 > URL 的 ?port= > 默认 443
// 裸 IPv6（多冒号且无方括号）统一补成 [v6]:port，避免被误判为「缺端口的域名」
const _aggFillPort = (line, defPort) => {
    const hi = line.indexOf('#');
    const hostPart = hi > -1 ? line.slice(0, hi) : line;
    const remark = hi > -1 ? line.slice(hi) : '';
    if (hostPart.startsWith('[')) {
        return /\]:(\d+)$/.test(hostPart) ? line : hostPart + ':' + defPort + remark;
    }
    if ((hostPart.match(/:/g) || []).length > 1) {   // 裸 IPv6
        return '[' + hostPart + ']:' + defPort + remark;
    }
    const ci = hostPart.lastIndexOf(':');
    if (ci > -1 && /^\d+$/.test(hostPart.slice(ci + 1))) return line;
    return hostPart + ':' + defPort + remark;
};

// CSV 解析：靠表头名定位列，不猜固定下标
const _aggParseCsv = (lines, defPort) => {
    const out = [];
    const H = lines[0].split(',').map(h => h.trim());
    const V6 = /^[^\[\]]*:[^\[\]]*:[^\[\]]*$/;
    const wrap = v => (v && !v.startsWith('[') && V6.test(v)) ? '[' + v + ']' : v;
    const rows = lines.slice(1);
    if (H.includes('IP地址') && H.includes('端口') && H.includes('数据中心')) {
        const ipI = H.indexOf('IP地址'), poI = H.indexOf('端口'), tlsI = H.indexOf('TLS');
        const rmI = H.indexOf('国家') > -1 ? H.indexOf('国家') : H.indexOf('城市') > -1 ? H.indexOf('城市') : H.indexOf('数据中心');
        for (const row of rows) {
            const c = row.split(',').map(x => x.trim());
            if (!c[ipI]) continue;
            if (tlsI !== -1 && String(c[tlsI] || '').toLowerCase() !== 'true') continue;
            out.push(wrap(c[ipI]) + ':' + (c[poI] || defPort) + '#' + (c[rmI] || c[ipI]));
        }
    } else if (H.some(h => h.includes('IP')) && H.some(h => h.includes('延迟')) && H.some(h => h.includes('下载速度'))) {
        const ipI = H.findIndex(h => h.includes('IP'));
        const dI = H.findIndex(h => h.includes('延迟'));
        const sI = H.findIndex(h => h.includes('下载速度'));
        for (const row of rows) {
            const c = row.split(',').map(x => x.trim());
            if (!c[ipI]) continue;
            out.push(wrap(c[ipI]) + ':' + defPort + '#CF' + (c[dI] ? ' ' + c[dI] + 'ms' : '') + (c[sI] ? ' ' + c[sI] + 'MB/s' : ''));
        }
    }
    return out;
};

// 通道一：http(s) 远程源 → 按返回内容分流（节点订阅透传 / IP列表套模板）
async function fetchAggSource(entry) {
    const hi = entry.indexOf('#');
    const urlNoHash = hi > -1 ? entry.slice(0, hi) : entry;
    let tag = null;
    if (hi > -1) { try { tag = decodeURIComponent(entry.slice(hi + 1)); } catch (e) { tag = entry.slice(hi + 1); } }
    const asPip = entry.toLowerCase().includes('proxyip=true');
    const ips = [], links = [], pips = [];
    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), AGG_TIMEOUT);
    try {
        const res = await fetch(urlNoHash, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ac.signal });
        if (!res.ok) return { ips, links, pips };
        const raw = _aggDecode(await res.arrayBuffer(), res.headers.get('content-type'));
        if (!raw || !raw.trim()) return { ips, links, pips };
        const text = _aggUnb64(raw);
        // 内容判类：含 :// → 节点订阅，原样透传
        if (text.split('#')[0].includes('://')) {
            links.push(_aggTagLinks(text.trim(), tag));
            return { ips, links, pips };
        }
        let defPort = '443';
        try { defPort = new URL(urlNoHash).searchParams.get('port') || '443'; } catch (e) {}
        const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
        const parsed = (lines.length > 1 && lines[0].includes(','))
            ? _aggParseCsv(lines, defPort)
            : lines.filter(l => !l.startsWith('#')).map(l => _aggFillPort(l, defPort));
        for (const it of parsed) {
            ips.push(_aggTag(it, tag));
            if (asPip) pips.push(it.split('#')[0]);
        }
    } catch (e) {} finally { clearTimeout(tid); }
    return { ips, links, pips };
}

// 通道二：sub:// 优选订阅生成器 → 哨兵探测，剥出对方优选地址，套本项目模板
// （EDT 2.1 契约：sub.cmliussss.net 等新版生成器已不支持旧 workerVless2sub 参数，
//   只认 ?host=example.com&uuid=<哨兵>；含哨兵 UUID 的行仅是地址载体，须本地重建）
let GEN_AD_RE = new RegExp(AD_FILTER, 'i'); // 推广行过滤（fetch 内按 AD_FILTER 环境变量重建，仅在源变化时重编译）
let _adSrc = AD_FILTER;
async function fetchSubGenerator(entry) {
    const hi = entry.indexOf('#');
    let tag = null;
    if (hi > -1) { try { tag = decodeURIComponent(entry.slice(hi + 1)); } catch (e) { tag = entry.slice(hi + 1); } }
    const asPip = entry.toLowerCase().includes('proxyip=true');
    const ips = [], links = [], pips = [];
    let origin = entry.split('#')[0].replace(/^sub:\/\//i, '').split('?')[0];
    if (!/^https?:\/\//i.test(origin)) origin = 'https://' + origin;   // 未写协议默认 https；显式 http:// 保留
    try { origin = new URL(origin).origin; } catch (e) { return { ips, links, pips }; }
    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), AGG_TIMEOUT);
    try {
        const res = await fetch(origin + '/sub?host=' + AGG_HOST + '&uuid=' + AGG_ID, {
            headers: { 'User-Agent': 'v2rayN/ed' + 'tunnel (https://github.com/cm' + 'liu/ed' + 'tunnel)' }, signal: ac.signal
        });
        if (!res.ok) return { ips, links, pips };
        const body = (await res.text()).trim();
        const plain = _aggUnb64(body);
        for (const line of plain.split(/\r?\n/)) {
            const t = line.trim();
            if (!t) continue;
            // 双哨兵命中 → 该行地址栏就是对方的优选地址
            if (t.includes(AGG_ID) && t.includes(AGG_HOST)) {
                const m = t.match(/:\/\/[^@]+@([^?#]+)/);
                if (!m) continue;
                // 生成器推广位（如 sub.cmliussss.net 的频道广告行）→ 直接丢弃（正则可用 AD_FILTER 覆盖）
                if (GEN_AD_RE.test(t)) continue;
                let remark = '';
                const rm = t.match(/#(.+)$/);
                if (rm) { try { remark = '#' + decodeURIComponent(rm[1]); } catch (e) { remark = '#' + rm[1]; } }
                const item = m[1] + remark;
                ips.push(_aggTag(item, tag));
                if (asPip) pips.push(m[1]);
            } else {
                links.push(_aggTagLinks(t, tag));   // 对方自有节点 → 透传
            }
        }
    } catch (e) {} finally { clearTimeout(tid); }
    return { ips, links, pips };
}

/* 汇总入口：返回 { ips, links, pipSet, fetchUrls, rawLinks }
 * ips      → 与 ADD/ADDAPI/ADDCSV 合并后套本项目节点模板
 * links    → 原样透传，排在订阅最前
 * pipSet   → ?proxyip=true 标记的地址，genNodes 生成 per-IP path 用
 * fetchUrls/rawLinks → 供订阅转换路径拼 | 多源参数（原始条目，未抓取） */
async function getAggregated(env) {
    const empty = { ips: [], links: [], pipSet: null, fetchUrls: [], rawLinks: [] };
    let text = '';
    try { text = await getSafeEnv(env, 'ADDSUB', ''); } catch (e) { return empty; }
    if (!text || !String(text).trim()) return empty;
    const { subGen, fetchUrls, rawLinks, plainIPs } = classifyAgg(splitNodeList(text));
    if (!subGen.length && !fetchUrls.length && !rawLinks.length && !plainIPs.length) return empty;
    const ips = [...plainIPs], links = [], pips = [];
    for (const l of rawLinks) {
        const hi = l.indexOf('#');
        if (hi > -1) {
            let rk = l.slice(hi + 1);
            try { rk = decodeURIComponent(rk); } catch (e) {}
            links.push(l.slice(0, hi) + '#' + encodeURIComponent(rk));
        } else links.push(l);
    }
    const tasks = [...fetchUrls.map(u => fetchAggSource(u)), ...subGen.map(s => fetchSubGenerator(s))];
    const settled = await Promise.allSettled(tasks);
    for (const r of settled) {
        if (r.status !== 'fulfilled' || !r.value) continue;
        ips.push(...r.value.ips);
        links.push(...r.value.links);
        pips.push(...r.value.pips);
    }
    const linkLines = [...new Set(links.join('\n').split(/\r?\n/).map(s => s.trim()).filter(Boolean))];
    return {
        ips: [...new Set(ips)],
        links: linkLines,
        pipSet: pips.length ? new Set(pips) : null,
        fetchUrls, rawLinks
    };
}


function loginPage(tgGroup, siteUrl, githubUrl, pageTitle) {
    const _s = (s) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    const _j = (s) => JSON.stringify(s || '').slice(1, -1);
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, minimum-scale=0.5, user-scalable=yes">
    <meta name="format-detection" content="telephone=no">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <title>${_s(pageTitle)}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: radial-gradient(ellipse at bottom, #1b2735 0%, #090a0f 100%); color: white; font-family: 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; overflow: hidden; position: relative; }

        /* 星空背景 */
        .stars { position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1; overflow: hidden; }
        .star { position: absolute; width: 2px; height: 2px; background: white; border-radius: 50%; animation: twinkle 3s infinite; box-shadow: 0 0 4px rgba(255, 255, 255, 0.8); }
        @keyframes twinkle { 0%, 100% { opacity: 0.2; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.5); } }

        /* 流星雨特效 */
        .meteor { position: absolute; width: 3px; height: 150px; background: linear-gradient(to bottom, rgba(255, 255, 255, 1), rgba(255, 255, 255, 0.5), transparent); border-radius: 50%; animation: meteor-fall linear infinite; opacity: 0; box-shadow: 0 0 10px rgba(255, 255, 255, 0.8); }
        @keyframes meteor-fall { 0% { opacity: 1; transform: translateX(0) translateY(0) rotate(-45deg); } 70% { opacity: 0.8; } 100% { opacity: 0; transform: translateX(-500px) translateY(500px) rotate(-45deg); } }
        .meteor:nth-child(1) { top: 5%; left: 10%; animation-duration: 1.8s; animation-delay: 0s; }
        .meteor:nth-child(2) { top: 15%; left: 30%; animation-duration: 2.2s; animation-delay: 0.8s; }
        .meteor:nth-child(3) { top: 8%; left: 50%; animation-duration: 2.5s; animation-delay: 1.5s; }
        .meteor:nth-child(4) { top: 20%; left: 70%; animation-duration: 2s; animation-delay: 2.2s; }
        .meteor:nth-child(5) { top: 12%; left: 85%; animation-duration: 2.3s; animation-delay: 3s; }
        .meteor:nth-child(6) { top: 25%; left: 20%; animation-duration: 2.1s; animation-delay: 3.8s; }
        .meteor:nth-child(7) { top: 18%; left: 45%; animation-duration: 2.4s; animation-delay: 4.5s; }
        .meteor:nth-child(8) { top: 10%; left: 65%; animation-duration: 1.9s; animation-delay: 5.2s; }

        /* 毛玻璃碎片 */
        .glass-shards { position: absolute; width: 100%; height: 100%; z-index: 2; pointer-events: none; }
        .shard { position: absolute; background: linear-gradient(135deg, rgba(79, 172, 254, 0.08), rgba(157, 127, 245, 0.05)); backdrop-filter: blur(8px); border: 1px solid rgba(255, 255, 255, 0.1); box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2); animation: shardFloat 25s infinite ease-in-out; }
        .shard:nth-child(1) { width: 180px; height: 180px; top: 5%; left: 10%; clip-path: polygon(30% 0%, 70% 10%, 100% 40%, 90% 80%, 50% 100%, 10% 90%, 0% 50%); animation-delay: 0s; }
        .shard:nth-child(2) { width: 140px; height: 200px; top: 50%; left: 5%; clip-path: polygon(50% 0%, 90% 20%, 100% 60%, 75% 100%, 25% 100%, 0% 60%, 10% 20%); animation-delay: -8s; }
        .shard:nth-child(3) { width: 220px; height: 160px; top: 10%; right: 8%; clip-path: polygon(20% 0%, 80% 0%, 100% 50%, 80% 100%, 20% 100%, 0% 50%); animation-delay: -15s; }
        .shard:nth-child(4) { width: 150px; height: 150px; bottom: 10%; right: 15%; clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%); animation-delay: -20s; }
        .shard:nth-child(5) { width: 190px; height: 130px; top: 40%; left: 3%; clip-path: polygon(40% 0%, 100% 20%, 90% 70%, 30% 100%, 0% 60%); animation-delay: -10s; }
        .shard:nth-child(6) { width: 130px; height: 180px; bottom: 15%; left: 45%; clip-path: polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%); animation-delay: -18s; }
        @keyframes shardFloat { 0%, 100% { transform: translateY(0) rotate(0deg); opacity: 0.4; } 25% { transform: translateY(-25px) rotate(3deg); opacity: 0.6; } 50% { transform: translateY(-40px) rotate(-2deg); opacity: 0.5; } 75% { transform: translateY(-20px) rotate(4deg); opacity: 0.7; } }

        /* 登录框 */
        .glass-box { position: relative; z-index: 10; background: rgba(15, 25, 50, 0.4); backdrop-filter: blur(20px) saturate(180%); border: 2px solid rgba(255, 255, 255, 0.1); padding: 45px 40px; border-radius: 20px; box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.5), inset 0 0 20px rgba(255,255,255,0.05); text-align: center; width: 380px; animation: boxAppear 0.8s ease-out; }
        @keyframes boxAppear { from { opacity: 0; transform: scale(0.9) translateY(20px); } to { opacity: 1; transform: scale(1) translateY(0); } }
        
        .glass-box::before { content: ''; position: absolute; top: -2px; left: -2px; right: -2px; bottom: -2px; background: linear-gradient(45deg, #00f5ff, #0080ff, #00f5ff, #0080ff); border-radius: 20px; z-index: -1; opacity: 0.3; filter: blur(10px); animation: borderGlow 3s linear infinite; }
        @keyframes borderGlow { 0%, 100% { opacity: 0.3; } 50% { opacity: 0.6; } }

        h2 { margin-bottom: 30px; font-weight: 700; font-size: 1.6rem; display: flex; align-items: center; justify-content: center; gap: 10px; text-shadow: 0 0 20px rgba(0, 245, 255, 0.5); letter-spacing: 2px; }
        h2::before { content: '🔒'; font-size: 1.4rem; filter: drop-shadow(0 0 10px rgba(0, 245, 255, 0.8)); }

        input { width: 100%; padding: 14px 18px; margin-bottom: 20px; border-radius: 12px; border: 1px solid rgba(0, 245, 255, 0.3); background: rgba(10, 20, 40, 0.6); color: white; text-align: center; font-size: 1rem; outline: none; transition: all 0.3s; backdrop-filter: blur(5px); }
        input:focus { border-color: #00f5ff; background: rgba(10, 20, 40, 0.8); box-shadow: 0 0 20px rgba(0, 245, 255, 0.4), inset 0 0 10px rgba(0, 245, 255, 0.1); }
        input::placeholder { color: rgba(255, 255, 255, 0.5); }

        .btn-group { display: flex; flex-direction: column; gap: 12px; }
        button { width: 100%; padding: 14px; border-radius: 12px; border: none; cursor: pointer; font-size: 1rem; transition: all 0.3s; font-weight: 600; position: relative; overflow: hidden; }
        button::before { content: ''; position: absolute; top: 50%; left: 50%; width: 0; height: 0; border-radius: 50%; background: rgba(255, 255, 255, 0.3); transition: width 0.6s, height 0.6s, top 0.6s, left 0.6s; }
        button:hover::before { width: 300px; height: 300px; top: -150px; left: -150px; }

        .btn-unlock { background: linear-gradient(135deg, rgba(138, 43, 226, 0.8), rgba(75, 0, 130, 0.8)); color: white; box-shadow: 0 4px 15px rgba(138, 43, 226, 0.4); border: 1px solid rgba(138, 43, 226, 0.5); }
        .btn-unlock:hover { box-shadow: 0 6px 25px rgba(138, 43, 226, 0.6); transform: translateY(-2px); }

        /* 响应式 */
        @media (max-width: 768px) {
            .glass-box { width: 90%; max-width: 380px; padding: 35px 25px; }
            h2 { font-size: 1.4rem; }
            input { padding: 12px 15px; font-size: 0.95rem; }
            button { padding: 12px; font-size: 0.95rem; }
        }
        @media (max-width: 480px) {
            .glass-box { width: 95%; padding: 30px 20px; }
            h2 { font-size: 1.2rem; margin-bottom: 20px; }
            h2::before { font-size: 1.2rem; }
            input { padding: 10px 12px; font-size: 0.9rem; margin-bottom: 15px; }
            button { padding: 10px; font-size: 0.9rem; }
            .btn-group { gap: 10px; }
        }
    </style>
</head>
<body>
    <div class="stars" id="starsContainer"></div>
    <div class="stars">
        <div class="meteor"></div><div class="meteor"></div><div class="meteor"></div><div class="meteor"></div>
        <div class="meteor"></div><div class="meteor"></div><div class="meteor"></div><div class="meteor"></div>
    </div>
    <div class="glass-shards">
        <div class="shard"></div><div class="shard"></div><div class="shard"></div>
        <div class="shard"></div><div class="shard"></div><div class="shard"></div>
    </div>

    <div class="glass-box">
        <h2>管理员登陆</h2>
        <input type="password" id="pwd" placeholder="请输入密码" autofocus autocomplete="new-password" onkeypress="if(event.keyCode===13)verify()">
        <div class="btn-group">
            <button class="btn-unlock" onclick="verify()">立即登陆</button>
        </div>
    </div>

    <script>
        function generateStars() {
            const starsContainer = document.getElementById('starsContainer');
            for (let i = 0; i < 200; i++) {
                const star = document.createElement('div');
                star.className = 'star';
                star.style.left = Math.random() * 100 + '%';
                star.style.top = Math.random() * 100 + '%';
                star.style.animationDelay = Math.random() * 3 + 's';
                star.style.animationDuration = (Math.random() * 2 + 2) + 's';
                const size = Math.random() * 2 + 1;
                star.style.width = size + 'px';
                star.style.height = size + 'px';
                starsContainer.appendChild(star);
            }
        }
        generateStars();
        async function verify(){
            const p = document.getElementById("pwd").value;
            if(!p) return;
            try {
                const res = await fetch('?flag=login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ pwd: p }) });
                if(!res.ok){ alert('密码错误'); return; }
                sessionStorage.setItem("is_active", "1");
                location.reload();
            } catch(e) { alert('登录失败，请重试'); }
        }
    </script>
</body>
</html>`;
}

// 👇 修改：增加 proxyCheckUrl 参数
function dashPage(host, uuid, proxyip, subpass, subdomain, converter, subToken, env, clientIP, hasAuth, tgState, cfState, add, addApi, addCsv, tgToken, tgId, cfId, cfToken, cfMail, cfKey, sysParams, dashTitle, proxyCheckUrl, dls, echEnabled, echSni, echDns, statsEnabled, statsChatId, zoneId, addSub, weakPw) {
    const defaultSubLink = `https://${host}/${subpass}`;
    // P1-3：弱口令告警横幅（仅展示，绝不阻断）
    const weakBanner = weakPw ? `<div style="position:relative;z-index:9999;padding:12px 16px;background:linear-gradient(90deg,#7f1d1d,#b91c1c);color:#fff;font-size:14px;text-align:center;font-weight:600;">⚠️ 安全告警：检测到仍在使用默认口令（WEB_PASSWORD / SUB_PASSWORD），请立即修改，否则面板与订阅可被任意访问。</div>` : '';
    const pathParam = proxyip ? "/proxyip=" + proxyip : "/";
    const linkParams = `${'enc'+'ryption'}=none&${'secu'+'rity'}=tls&sni=${host}&fp=${FP}&allowInsecure=0&type=ws&host=${host}&path=${encodeURIComponent(pathParam)}` + (ECH ? `&ech=${encodeURIComponent((ECH_SNI ? ECH_SNI + '+' : '') + ECH_DNS)}` : '');
    const regularLongLink = `https://${subdomain}/sub?uuid=${uuid}&${linkParams}`;
    const baseNode = `${'vl'+'ess'}://${uuid}@${host}:443?${linkParams}#Worker`;
    const longLink = subToken
        ? `https://${subdomain}/sub?base=${encodeURIComponent(baseNode)}&token=${encodeURIComponent(subToken)}&uuid=${uuid}&${linkParams}`
        : regularLongLink;
    const safeVal = (str) => (str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const jsStr = (s) => JSON.stringify(s || '').slice(1, -1);
    const getStatusLabel = (val, sysVal) => { if (!val) return ""; if (val === sysVal) return `<span class="source-tag sys">🔒 系统预设 (不可删除)</span>`; return `<span class="source-tag man">💾 后台配置 (可清除)</span>`; };
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, minimum-scale=0.5, user-scalable=yes">
    <meta name="format-detection" content="telephone=no">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <title>${safeVal(dashTitle)}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { display: none; opacity: 0; transition: opacity 0.3s; overflow-x: hidden; position: relative; }
        body.loaded { display: block; opacity: 1; }

        /* 玻璃态配色 - 柔和不刺眼 */
        :root {
            --glass-blue: #4facfe;
            --glass-purple: #9d7ff5;
            --glass-cyan: #43e9e5;
            --glass-pink: #f093fb;
            --glass-green: #4ade80;
            --bg-dark: #0f0f23;
            --bg-darker: #050510;
            --card-bg: rgba(15, 20, 40, 0.4);
            --text: #e8eaf6;
            --text-dim: #9ca3af;
            --border: rgba(79, 172, 254, 0.2);
            --glow: rgba(79, 172, 254, 0.5);
            --success: #4ade80;
            --warning: #fbbf24;
            --danger: #f87171;
        }
        body.light {
            /* 浅色主题 - 加深颜色变量以增强对比度 */
            --glass-blue: #2563eb;
            --glass-purple: #7c3aed;
            --glass-cyan: #0891b2;
            --glass-pink: #db2777;
            --glass-green: #059669;
            --bg-dark: #f8fafc;
            --bg-darker: #f1f5f9;
            --card-bg: rgba(255, 255, 255, 0.8);
            --text: #0f172a;
            --text-dim: #475569;
            --border: rgba(37, 99, 235, 0.2);
            --glow: rgba(37, 99, 235, 0.3);
            --success: #059669;
            --warning: #d97706;
            --danger: #dc2626;
        }
        /* 👇 修改：白色主题背景改为天空蓝色渐变 */
        body.light {
            background: linear-gradient(to bottom, #87CEEB 0%, #B0E0E6 30%, #E0F7FA 60%, #F0F9FF 100%);
        }
        /* 白色模式 - 玻璃碎片变为白云效果 */
        body.light .shard {
            background: linear-gradient(135deg, rgba(255, 255, 255, 0.8), rgba(255, 255, 255, 0.4));
            border: 1px solid rgba(255, 255, 255, 0.6);
            box-shadow: 0 8px 32px rgba(255, 255, 255, 0.5);
            border-radius: 50%;
        }

        /* 白色模式输入框优化 */
        body.light input,
        body.light textarea,
        body.light select {
            background: rgba(255, 255, 255, 0.95);
            color: #0f172a;
            border-color: rgba(37, 99, 235, 0.25);
        }
        body.light input:focus,
        body.light textarea:focus,
        body.light select:focus {
            background: rgba(255, 255, 255, 1);
            border-color: var(--glass-blue);
            box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
        }

        /* 白色模式系统状态优化 */
        body.light .stat-box {
            background: rgba(255, 255, 255, 0.7);
            border: 1px solid rgba(37, 99, 235, 0.2);
        }
        body.light .stat-box:hover {
            background: rgba(255, 255, 255, 0.9);
            border-color: var(--glass-blue);
        }
        body.light .stat-value {
            color: #1e40af;
            font-weight: 700;
        }
        body.light .stat-label {
            color: #1e293b;
            font-weight: 600;
        }

        /* 黑色模式系统状态优化 */
        body:not(.light) .stat-value {
            color: var(--glass-cyan);
            font-weight: 700;
            text-shadow: 0 0 10px rgba(67, 233, 229, 0.3);
        }
        body:not(.light) .stat-label {
            color: #cbd5e1;
            font-weight: 600;
        }

        /* 白色模式日志优化 */
        body.light .log-entry {
            background: rgba(255, 255, 255, 0.9);
            border-color: rgba(37, 99, 235, 0.2);
        }
        body.light .log-entry:hover {
            background: rgba(255, 255, 255, 1);
            border-color: var(--glass-blue);
        }
        body.light .log-time {
            color: #1e40af;
            font-weight: 600;
        }
        body.light .log-ip {
            color: #0891b2;
            font-weight: 600;
        }
        body.light .log-loc {
            color: #059669;
            font-weight: 500;
        }
        body.light .log-box {
            background: rgba(255, 255, 255, 0.95);
            border-color: rgba(37, 99, 235, 0.2);
            color: #0f172a;
        }

        /* 黑色模式日志优化 */
        body:not(.light) .log-time {
            color: var(--glass-cyan);
            font-weight: 600;
        }
        body:not(.light) .log-ip {
            color: var(--glass-blue);
            font-weight: 600;
        }
        body:not(.light) .log-loc {
            color: var(--glass-green);
            font-weight: 500;
        }

        /* 深色星空背景 */
        body {
            background: radial-gradient(ellipse at bottom, #1b2735 0%, #090a0f 100%);
            color: var(--text);
            font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
            min-height: 100vh;
            position: relative;
            overflow-x: hidden;
        }

        /* 白色模式天空背景 */
        body.light {
            background: linear-gradient(to bottom, #87CEEB 0%, #B0E0E6 30%, #E0F7FA 60%, #F0F9FF 100%);
        }

        /* 星星背景 */
        .stars {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 999;
            overflow: hidden;
        }
        .star {
            position: absolute;
            width: 2px;
            height: 2px;
            background: white;
            border-radius: 50%;
            animation: twinkle 3s infinite;
            box-shadow: 0 0 4px rgba(255, 255, 255, 0.8);
        }
        @keyframes twinkle {
            0%, 100% { opacity: 0.2; transform: scale(0.8); }
            50% { opacity: 1; transform: scale(1.5); }
        }

        /* 流星雨特效 - 全屏真实效果 */
        .meteor {
            position: absolute;
            width: 3px;
            height: 150px;
            background: linear-gradient(to bottom, rgba(255, 255, 255, 1), rgba(255, 255, 255, 0.5), transparent);
            border-radius: 50%;
            animation: meteor-fall linear infinite;
            opacity: 0;
            box-shadow: 0 0 10px rgba(255, 255, 255, 0.8);
        }
        @keyframes meteor-fall {
            0% {
                opacity: 1;
                transform: translateX(0) translateY(0) rotate(-45deg);
            }
            70% {
                opacity: 0.8;
            }
            100% {
                opacity: 0;
                transform: translateX(-500px) translateY(500px) rotate(-45deg);
            }
        }
        /* 更多流星，覆盖全屏 */
        .meteor:nth-child(1) { top: 5%; left: 10%; animation-duration: 1.8s; animation-delay: 0s; }
        .meteor:nth-child(2) { top: 15%; left: 30%; animation-duration: 2.2s; animation-delay: 0.8s; }
        .meteor:nth-child(3) { top: 8%; left: 50%; animation-duration: 2.5s; animation-delay: 1.5s; }
        .meteor:nth-child(4) { top: 20%; left: 70%; animation-duration: 2s; animation-delay: 2.2s; }
        .meteor:nth-child(5) { top: 12%; left: 85%; animation-duration: 2.3s; animation-delay: 3s; }
        .meteor:nth-child(6) { top: 25%; left: 20%; animation-duration: 2.1s; animation-delay: 3.8s; }
        .meteor:nth-child(7) { top: 18%; left: 45%; animation-duration: 2.4s; animation-delay: 4.5s; }
        .meteor:nth-child(8) { top: 10%; left: 65%; animation-duration: 1.9s; animation-delay: 5.2s; }
        .meteor:nth-child(9) { top: 22%; left: 80%; animation-duration: 2.6s; animation-delay: 6s; }
        .meteor:nth-child(10) { top: 7%; left: 35%; animation-duration: 2.2s; animation-delay: 6.8s; }

        /* 白色模式 - 流星变为白云效果 */
        body.light .meteor {
            background: linear-gradient(to bottom, rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0.6), transparent);
            box-shadow: 0 0 20px rgba(255, 255, 255, 0.8);
            border-radius: 50%;
            width: 80px;
            height: 30px;
            animation-duration: 8s !important;
        }
        /* 白色模式 - 星星变为阳光闪烁 */
        body.light .star {
            background: rgba(255, 215, 0, 0.7);
            box-shadow: 0 0 8px rgba(255, 215, 0, 0.9);
        }

        /* 玻璃碎裂动态背景 */
        .glass-shards-bg {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            z-index: 1;
            pointer-events: none;
        }
        .shard {
            position: absolute;
            background: linear-gradient(135deg, rgba(79, 172, 254, 0.08), rgba(157, 127, 245, 0.05));
            backdrop-filter: blur(8px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
            animation: shardFloat 25s infinite ease-in-out;
        }
        .shard:nth-child(1) { width: 180px; height: 180px; top: 5%; left: 10%; clip-path: polygon(30% 0%, 70% 10%, 100% 40%, 90% 80%, 50% 100%, 10% 90%, 0% 50%); animation-delay: 0s; }
        .shard:nth-child(2) { width: 140px; height: 200px; top: 50%; left: 5%; clip-path: polygon(50% 0%, 90% 20%, 100% 60%, 75% 100%, 25% 100%, 0% 60%, 10% 20%); animation-delay: -8s; }
        .shard:nth-child(3) { width: 220px; height: 160px; top: 10%; right: 8%; clip-path: polygon(20% 0%, 80% 0%, 100% 50%, 80% 100%, 20% 100%, 0% 50%); animation-delay: -15s; }
        .shard:nth-child(4) { width: 150px; height: 150px; bottom: 10%; right: 15%; clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%); animation-delay: -20s; }
        .shard:nth-child(5) { width: 190px; height: 130px; top: 40%; left: 3%; clip-path: polygon(40% 0%, 100% 20%, 90% 70%, 30% 100%, 0% 60%); animation-delay: -10s; }
        .shard:nth-child(6) { width: 130px; height: 180px; bottom: 15%; left: 45%; clip-path: polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%); animation-delay: -18s; }
        .shard:nth-child(7) { width: 170px; height: 140px; top: 70%; right: 25%; clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%); animation-delay: -5s; }
        @keyframes shardFloat {
            0%, 100% { transform: translateY(0) rotate(0deg); opacity: 0.4; }
            25% { transform: translateY(-25px) rotate(3deg); opacity: 0.6; }
            50% { transform: translateY(-40px) rotate(-2deg); opacity: 0.5; }
            75% { transform: translateY(-20px) rotate(4deg); opacity: 0.7; }
        }

        /* 主容器 - 侧边栏布局 */
        .container {
            position: relative;
            z-index: 2;
            min-height: 100vh;
            display: flex;
            gap: 20px;
            /* 👇 增加顶部Padding，并设置最大宽度用于超大屏适配 */
            padding: 100px 20px 20px 20px;
            max-width: 1920px;
            margin: 0 auto;
        }

        /* 左侧边栏 - 玻璃态 */
        .sidebar {
            width: 280px;
            background: var(--card-bg);
            backdrop-filter: blur(20px);
            border: 1px solid var(--border);
            border-radius: 20px;
            padding: 25px 20px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
            height: fit-content;
            position: sticky;
            /* 👇 修改Sticky偏移量，使其与主内容对齐 */
            top: 100px;
            flex-shrink: 0;
        }

        /* 顶部工具栏（右上角固定，带边框容器） */
        .top-nav {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 100;
            display: flex;
            gap: 8px;
            background: var(--card-bg);
            backdrop-filter: blur(20px);
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 8px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        }

        /* 工具按钮组（右上角固定） */
        .top-tools {
            display: flex;
            gap: 8px;
            align-items: center;
        }
        .tool-btn {
            width: 42px;
            height: 42px;
            background: rgba(79, 172, 254, 0.1);
            backdrop-filter: blur(10px);
            border: 1px solid var(--border);
            border-radius: 12px;
            color: var(--text);
            cursor: pointer;
            transition: all 0.3s;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.1rem;
            position: relative;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
            flex-shrink: 0;
        }
        .tool-btn:hover {
            background: rgba(79, 172, 254, 0.25);
            border-color: var(--glass-blue);
            box-shadow: 0 4px 15px var(--glow);
            transform: translateY(-2px);
        }
        .tool-btn:active {
            transform: translateY(0);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        }
        
        /* 👇 修改：退出按钮默认样式一致，悬浮变红 */
        .tool-btn.logout {
            border-color: rgba(248, 113, 113, 0.5); 
            color: #f87171; 
        }
        .tool-btn.logout:hover {
            background: rgba(248, 113, 113, 0.2);
            border-color: var(--danger);
            box-shadow: 0 4px 15px var(--danger);
            color: white;
        }

        /* 侧边栏Logo */
        .logo {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 10px;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 1px solid var(--border);
        }
        .logo-icon {
            font-size: 3rem;
            filter: drop-shadow(0 0 15px var(--glass-blue));
            animation: logoFloat 3s ease-in-out infinite;
        }
        @keyframes logoFloat {
            0%, 100% { transform: translateY(0) rotate(0deg); }
            50% { transform: translateY(-8px) rotate(5deg); }
        }
        .logo-text {
            /* 👇 增大字号 */
            font-size: 1.5rem;
            font-weight: 700;
            background: linear-gradient(135deg, var(--glass-blue), var(--glass-purple), var(--glass-cyan), var(--glass-pink));
            background-size: 300% 300%;
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            letter-spacing: 2px;
            text-align: center;
            animation: logoGradient 4s ease infinite;
            /* 👇 优化滤镜，去除模糊，改为清晰阴影 */
            filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2));
        }
        @keyframes logoGradient {
            0% {
                background-position: 0% 50%;
                filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2));
            }
            25% {
                filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2));
            }
            50% {
                background-position: 100% 50%;
                filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2));
            }
            75% {
                filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2));
            }
            100% {
                background-position: 0% 50%;
                filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2));
            }
        }
        
        /* 👇 针对白色模式的Logo优化：恢复动态渐变，使用深色变量，增加微阴影 */
        body.light .logo-text {
            background: linear-gradient(135deg, var(--glass-blue), var(--glass-purple), var(--glass-cyan), var(--glass-pink));
            background-size: 300% 300%;
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            animation: logoGradient 4s ease infinite;
            filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.2)); /* 轻微阴影增加对比度，去除模糊光晕 */
            text-shadow: none;
        }
        body.light .logo-icon {
            filter: drop-shadow(0 0 10px rgba(37, 99, 235, 0.6));
        }

        .logo-sub {
            /* 👇 稍微增大副标题 */
            font-size: 0.85rem;
            color: var(--text-dim);
            letter-spacing: 1px;
            text-align: center;
            font-weight: 500;
        }
        /* 白色模式Logo优化 */
        body.light .logo-sub {
            color: #64748b;
        }

        /* 导航菜单 - 垂直列表 */
        .nav-menu {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .nav-item {
            /* 👇 增大Padding和字号 */
            padding: 14px 20px;
            background: rgba(79, 172, 254, 0.05);
            border: 1px solid transparent;
            border-radius: 12px;
            cursor: pointer;
            transition: all 0.3s;
            font-size: 1.1rem;
            display: flex;
            align-items: center;
            gap: 15px; /* 增加图标和文字间距 */
            color: var(--text);
            position: relative;
            overflow: hidden;
        }
        /* 菜单文字幻彩渐变 */
        .nav-item {
            background: linear-gradient(135deg, var(--glass-blue), var(--glass-purple), var(--glass-cyan), var(--glass-pink));
            background-size: 300% 300%;
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            animation: menuTextGradient 5s ease infinite;
        }
        @keyframes menuTextGradient {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
        }
        /* 白色模式菜单文字优化 - 纯色深色文字 */
        body.light .nav-item {
            background: none;
            -webkit-background-clip: unset;
            -webkit-text-fill-color: unset;
            background-clip: unset;
            color: #1e293b;
            font-weight: 700;
            animation: none;
        }
        body.light .nav-item:hover {
            color: #0f172a;
        }
        body.light .nav-item.active {
            color: #ffffff;
            background: linear-gradient(135deg, #2563eb, #7c3aed);
        }
        body.light .nav-item.active .icon,
        body.light .nav-item.active {
            background: linear-gradient(135deg, #2563eb, #7c3aed);
            -webkit-background-clip: unset;
            -webkit-text-fill-color: unset;
            background-clip: unset;
            color: #ffffff;
            animation: none;
        }
        /* 恢复背景 */
        .nav-item::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(79, 172, 254, 0.05);
            border-radius: 12px;
            z-index: -1;
        }
        body.light .nav-item::after {
            background: rgba(37, 99, 235, 0.08);
        }
        /* 波纹点击效果 */
        .nav-item::before {
            content: '';
            position: absolute;
            top: 50%;
            left: 50%;
            width: 0;
            height: 0;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.3);
            transform: translate(-50%, -50%);
            transition: width 0.6s, height 0.6s;
        }
        .nav-item:active::before {
            width: 300px;
            height: 300px;
        }
        .nav-item:hover {
            background: rgba(79, 172, 254, 0.15);
            border-color: var(--glass-blue);
            transform: translateX(5px);
            box-shadow: 0 4px 15px var(--glow);
        }
        .nav-item.active {
            background: linear-gradient(135deg, var(--glass-blue), var(--glass-purple));
            border-color: var(--glass-blue);
            color: white;
            box-shadow: 0 4px 20px var(--glow);
            transform: translateX(5px);
            animation: gradientShift 3s ease infinite;
            background-size: 200% 200%;
        }
        /* 激活菜单文字幻彩渐变 */
        .nav-item.active .icon,
        .nav-item.active {
            background: linear-gradient(135deg, #fff, #e0f2fe, #ddd6fe, #fce7f3, #fff);
            background-size: 300% 300%;
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            animation: textGradientShift 4s ease infinite;
        }
        /* 文字渐变动画 */
        @keyframes textGradientShift {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
        }
        /* 幻彩渐变动画 */
        @keyframes gradientShift {
            0% {
                background-position: 0% 50%;
                background: linear-gradient(135deg, var(--glass-blue), var(--glass-purple), var(--glass-cyan));
            }
            33% {
                background-position: 50% 50%;
                background: linear-gradient(135deg, var(--glass-purple), var(--glass-cyan), var(--glass-pink));
            }
            66% {
                background-position: 100% 50%;
                background: linear-gradient(135deg, var(--glass-cyan), var(--glass-pink), var(--glass-blue));
            }
            100% {
                background-position: 0% 50%;
                background: linear-gradient(135deg, var(--glass-blue), var(--glass-purple), var(--glass-cyan));
            }
        }
        .nav-item.active::after {
            content: '';
            position: absolute;
            top: -2px;
            left: -2px;
            right: -2px;
            bottom: -2px;
            background: linear-gradient(45deg, var(--glass-cyan), var(--glass-blue), var(--glass-purple), var(--glass-pink), var(--glass-cyan));
            border-radius: 12px;
            z-index: -1;
            opacity: 0.5;
            filter: blur(8px);
            animation: borderGlow 3s linear infinite;
            background-size: 300% 300%;
        }
        @keyframes borderGlow {
            0% { opacity: 0.3; background-position: 0% 50%; }
            50% { opacity: 0.6; background-position: 100% 50%; }
            100% { opacity: 0.3; background-position: 0% 50%; }
        }
        
        /* 👇 修复暗色模式图标显示为方块的问题 */
        .nav-item .icon {
            /* 👇 增大图标 */
            font-size: 1.4rem;
            width: 24px;
            text-align: center;
            /* 关键修复：重置背景裁剪和填充颜色 */
            background: none;
            -webkit-background-clip: initial;
            -webkit-text-fill-color: initial;
            color: #e8eaf6; /* 设置为淡白色 */
            text-shadow: 0 0 10px var(--glass-blue); /* 添加发光使其协调 */
        }
        
        /* 激活状态下的图标颜色 */
        .nav-item.active .icon {
            background: none;
            -webkit-text-fill-color: initial;
            color: #ffffff;
        }

        /* 白色模式下的图标保持原样(代码里已经有针对body.light的处理，只需微调确保优先级) */
        body.light .nav-item .icon {
            color: #2563eb;
            text-shadow: none;
        }

        /* 主内容区 */
        .main-content {
            flex: 1;
            display: block;
            width: 100%;
            min-width: 0;
            /* 👇 移除了 padding-top，由容器统一控制 */
        }

        /* 工具按钮提示 */
        .tool-btn::before {
            content: attr(data-tooltip);
            position: absolute;
            bottom: -40px;
            left: 50%;
            transform: translateX(-50%);
            padding: 6px 12px;
            background: rgba(0, 0, 0, 0.9);
            color: var(--glass-cyan);
            font-size: 11px;
            white-space: nowrap;
            pointer-events: none;
            opacity: 0;
            visibility: hidden;
            transition: 0.2s;
            z-index: 10;
            border: 1px solid var(--glass-cyan);
            border-radius: 6px;
        }
        .tool-btn:hover::before { opacity: 1; visibility: visible; }
        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            position: absolute;
            top: 8px;
            right: 8px;
            animation: statusPulse 1.5s ease-in-out infinite;
        }
        @keyframes statusPulse {
            0%, 100% { opacity: 1; transform: scale(1); box-shadow: 0 0 5px currentColor; }
            50% { opacity: 0.5; transform: scale(1.3); box-shadow: 0 0 15px currentColor; }
        }
        .status-dot.on {
            background-color: var(--success);
            box-shadow: 0 0 10px var(--success);
        }
        .status-dot.off {
            background-color: var(--danger);
            box-shadow: 0 0 10px var(--danger);
        }

        /* 主内容区 - 网格布局 */
        .main-content {
            display: block;
            width: 100%;
        }

        /* 3D 球体统计卡片 */
        .sphere-card {
            background: var(--card-bg);
            backdrop-filter: blur(20px);
            border: 1px solid var(--border);
            border-radius: 20px;
            padding: 30px;
            position: relative;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
            transition: all 0.3s;
            overflow: hidden;
        }
        .sphere-card:hover {
            border-color: var(--glass-blue);
            box-shadow: 0 12px 40px var(--glow);
            transform: translateY(-5px);
        }
        .sphere-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 3px;
            background: linear-gradient(90deg, var(--glass-blue), var(--glass-purple), var(--glass-cyan));
            opacity: 0.6;
        }

        /* 3D 圆环统计球体 - 优化版 */
        .stats-sphere {
            width: 240px;
            height: 240px;
            margin: 25px auto 15px;
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
        }
        .sphere-ring {
            position: absolute;
            border-radius: 50%;
            border: 3px solid transparent;
            animation: sphereRotate 8s linear infinite;
            will-change: transform;
        }
        .sphere-ring:nth-child(1) {
            width: 220px;
            height: 220px;
            border-top-color: var(--glass-blue);
            border-right-color: var(--glass-blue);
            animation-duration: 6s;
        }
        .sphere-ring:nth-child(2) {
            width: 185px;
            height: 185px;
            border-bottom-color: var(--glass-purple);
            border-left-color: var(--glass-purple);
            animation-duration: 8s;
            animation-direction: reverse;
        }
        .sphere-ring:nth-child(3) {
            width: 150px;
            height: 150px;
            border-top-color: var(--glass-cyan);
            border-bottom-color: var(--glass-cyan);
            animation-duration: 10s;
        }
        @keyframes sphereRotate {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        /* 球体中心 - 修正版：绝对居中，增加Padding防止触碰圆环 */
        .sphere-center {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 10;
            text-align: center;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 18%; /* 动态Padding，确保文字永远在圆环内 */
            pointer-events: none;
            box-sizing: border-box;
        }

        /* 球体数字 - 修正版：智能换行，动态字号 */
        .sphere-value {
            font-size: 2.5rem;
            font-weight: 700;
            color: var(--glass-cyan);
            text-shadow: 0 0 20px rgba(67, 233, 229, 0.5);
            font-family: 'Courier New', 'Consolas', 'Monaco', monospace;
            line-height: 1.1; /* 紧凑行高，适应多行显示 */
            word-wrap: break-word; /* 允许单词内换行 */
            word-break: break-word; /* 强制长单词/数字断行，防止溢出 */
            overflow-wrap: break-word; /* 现代浏览器断行支持 */
            white-space: normal; /* 允许自然换行 */
            display: block;
            width: 100%;
            max-width: 100%;
            text-align: center;
            margin: 0 auto;
        }

        /* 根据内容长度自动缩小字体 - 针对桌面端微调 */
        .sphere-value[data-length="short"] { font-size: 3rem; }
        .sphere-value[data-length="medium"] { font-size: 2.2rem; }
        .sphere-value[data-length="long"] { font-size: 1.6rem; }
        .sphere-value[data-length="verylong"] { font-size: 1.2rem; }

        /* 球体下方标签 */
        .sphere-labels {
            text-align: center;
            margin-top: 10px;
        }
        .sphere-label {
            font-size: 1rem;
            color: var(--text-dim);
            text-transform: uppercase;
            letter-spacing: 2px;
            line-height: 1.5;
            font-weight: 600;
            display: block;
            margin-bottom: 5px;
        }
        .sphere-subtitle {
            font-size: 0.85rem;
            color: var(--glass-cyan);
            line-height: 1.4;
            opacity: 0.95;
            display: block;
        }

        /* 玻璃态卡片样式 */
        .card {
            background: var(--card-bg);
            backdrop-filter: blur(20px);
            border: 1px solid var(--border);
            border-radius: 20px;
            padding: 25px;
            position: relative;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
            transition: all 0.3s;
            overflow: hidden;
        }
        .card:hover {
            border-color: var(--glass-blue);
            box-shadow: 0 12px 40px var(--glow);
            transform: translateY(-3px);
        }
        .card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 3px;
            background: linear-gradient(90deg, var(--glass-blue), var(--glass-purple), var(--glass-cyan));
            opacity: 0.6;
        }

        /* 卡片标题 */
        .card-title {
            font-size: 1.1rem;
            font-weight: 700;
            color: #ffffff;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 10px;
            text-shadow: 0 2px 8px rgba(79, 172, 254, 0.5);
        }
        .card-title .icon {
            font-size: 1.3rem;
            filter: drop-shadow(0 0 10px var(--glass-cyan));
        }

        /* 白色模式标题 */
        body.light .card-title {
            color: #000000;
            text-shadow: 0 2px 8px rgba(37, 99, 235, 0.3);
        }

        /* 统计面板 */
        .stats-panel {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 15px;
            margin-bottom: 20px;
        }
        .stat-box {
            background: rgba(79, 172, 254, 0.05);
            border: 1px solid var(--border);
            border-radius: 15px;
            padding: 20px;
            transition: all 0.3s;
            text-align: center;
        }
        .stat-box:hover {
            background: rgba(79, 172, 254, 0.1);
            border-color: var(--glass-blue);
            transform: translateY(-3px);
            box-shadow: 0 5px 20px var(--glow);
        }
        .stat-label {
            font-size: 0.8rem;
            color: var(--text-dim);
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        .stat-value {
            font-size: 1.8rem;
            font-weight: 700;
            background: linear-gradient(135deg, var(--glass-cyan), var(--glass-blue));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            font-family: 'Courier New', monospace;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            max-width: 100%;
            display: block;
        }
        .stat-value.ip-value {
            font-size: clamp(0.75rem, 2vw, 1rem);
            word-break: break-all;
            white-space: normal;
            line-height: 1.3;
            max-height: 2.6em;
            overflow: hidden;
            text-overflow: ellipsis;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
        }

        /* 输入框样式 */
        .input-block { margin-bottom: 15px; }
        label {
            display: block;
            font-size: 0.75rem;
            color: var(--glass-cyan);
            margin-bottom: 8px;
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        input[type="text"], textarea {
            width: 100%;
            background: rgba(15, 20, 40, 0.6);
            border: 1px solid var(--border);
            border-radius: 12px;
            color: var(--text);
            padding: 12px 15px;
            font-family: 'Courier New', monospace;
            outline: none;
            transition: all 0.3s;
            font-size: 0.9rem;
        }
        input[type="text"]:focus, textarea:focus {
            border-color: var(--glass-blue);
            background: rgba(15, 20, 40, 0.9);
            box-shadow: 0 0 20px var(--glow);
        }
        textarea {
            min-height: 100px;
            resize: vertical;
            font-size: 0.85rem;
            line-height: 1.5;
        }
        .input-group-row {
            display: flex;
            gap: 10px;
            align-items: flex-end;
        }
        .input-group-row input { flex: 1; }

        /* 按钮样式 */
        .btn {
            padding: 12px 20px;
            border: 1px solid;
            border-radius: 12px;
            cursor: pointer;
            font-weight: 600;
            font-size: 0.9rem;
            transition: all 0.3s;
            text-transform: uppercase;
            letter-spacing: 1px;
            position: relative;
            overflow: hidden;
        }
        .btn::before {
            content: '';
            position: absolute;
            top: 50%;
            left: 50%;
            width: 0;
            height: 0;
            background: rgba(255, 255, 255, 0.2);
            transform: translate(-50%, -50%);
            transition: width 0.4s, height 0.4s;
            border-radius: 50%;
        }
        .btn:hover::before {
            width: 300px;
            height: 300px;
        }
        .btn-primary {
            background: linear-gradient(135deg, var(--glass-blue), var(--glass-purple));
            border-color: var(--glass-blue);
            color: white;
        }
        .btn-primary:hover {
            box-shadow: 0 0 25px var(--glow);
            transform: translateY(-2px);
        }
        .btn-secondary {
            background: linear-gradient(135deg, var(--glass-cyan), var(--glass-blue));
            border-color: var(--glass-cyan);
            color: white;
        }
        .btn-secondary:hover {
            box-shadow: 0 0 25px rgba(67, 233, 229, 0.5);
            transform: translateY(-2px);
        }
        .btn-success {
            background: linear-gradient(135deg, var(--glass-green), #22c55e);
            border-color: var(--success);
            color: white;
        }
        .btn-success:hover {
            box-shadow: 0 0 25px var(--success);
            transform: translateY(-2px);
        }
        .btn-danger {
            background: linear-gradient(135deg, var(--danger), #dc2626);
            border-color: var(--danger);
            color: white;
        }
        .btn-danger:hover {
            box-shadow: 0 0 25px var(--danger);
            transform: translateY(-2px);
        }
        .btn-group {
            display: flex;
            gap: 10px;
            margin-top: 15px;
            flex-wrap: wrap;
        }
        .btn-group .btn {
            flex: 1;
            min-width: 120px;
        }

        /* 日志和表格 */
        .log-box {
            font-family: 'Courier New', monospace;
            font-size: 0.8rem;
            max-height: 300px;
            overflow-y: auto;
            background: rgba(15, 20, 40, 0.6);
            padding: 15px;
            border: 1px solid var(--border);
            border-radius: 12px;
        }
        .log-entry {
            border-bottom: 1px solid rgba(79, 172, 254, 0.2);
            padding: 10px 0;
            display: flex;
            align-items: center;
            gap: 15px;
            transition: 0.3s;
        }
        .log-entry:hover {
            background: rgba(79, 172, 254, 0.1);
            padding-left: 10px;
            border-left: 2px solid var(--glass-cyan);
        }
        .log-time { color: var(--glass-cyan); width: 150px; font-size: 0.85rem; }
        .log-ip { color: var(--text); width: 200px; font-family: monospace; }
        .log-loc { color: var(--text-dim); flex: 1; font-size: 0.85rem; }
        .log-tag {
            padding: 4px 10px;
            background: linear-gradient(135deg, var(--warning), #d97706);
            color: #000;
            font-size: 0.75rem;
            font-weight: 700;
            border-radius: 6px;
            box-shadow: 0 0 10px rgba(251, 191, 36, 0.5);
        }
        .log-tag.green {
            background: linear-gradient(135deg, var(--success), #22c55e);
            box-shadow: 0 0 10px var(--success);
        }

        .wl-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-top: 10px; }
        .wl-table th, .wl-table td {
            text-align: left;
            padding: 12px;
            border-bottom: 1px solid var(--border);
        }
        .wl-table th {
            color: var(--glass-cyan);
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1px;
            font-size: 0.75rem;
        }
        .wl-table tr:hover { background: rgba(79, 172, 254, 0.05); }
        .btn-del {
            background: linear-gradient(135deg, var(--danger), #dc2626);
            color: white;
            border: 1px solid var(--danger);
            border-radius: 8px;
            padding: 6px 12px;
            cursor: pointer;
            font-size: 0.75rem;
            transition: 0.3s;
            box-shadow: 0 0 10px rgba(248, 113, 113, 0.3);
            text-transform: uppercase;
            font-weight: 600;
        }
        .btn-del:hover {
            box-shadow: 0 0 20px var(--danger);
            transform: scale(1.05);
        }
        .sys-tag {
            background: linear-gradient(135deg, #64748b, #475569);
            color: white;
            padding: 4px 8px;
            font-size: 0.75rem;
            border-radius: 6px;
            box-shadow: 0 0 8px rgba(100, 116, 139, 0.3);
        }
        .source-tag { font-size: 0.75rem; margin-top: 4px; display: block; }
        .source-tag.sys { color: var(--warning); text-shadow: 0 0 8px var(--warning); }
        .source-tag.man { color: var(--success); text-shadow: 0 0 8px var(--success); }

        /* 模态框 */
        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.85);
            backdrop-filter: blur(10px);
            z-index: 1000;
            justify-content: center;
            align-items: center;
        }
        .modal.show { display: flex; }
        .modal-content {
            background: var(--card-bg);
            backdrop-filter: blur(20px);
            padding: 30px;
            width: 90%;
            max-width: 500px;
            border: 2px solid var(--border);
            border-radius: 20px;
            box-shadow: 0 10px 50px var(--glow);
            position: relative;
            overflow: hidden; /* Added overflow: hidden to clip the top line */
        }
        .modal-content::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 3px;
            background: linear-gradient(90deg, var(--glass-blue), var(--glass-cyan));
            box-shadow: 0 0 15px var(--glass-blue);
        }
        .modal-head {
            display: flex;
            justify-content: space-between;
            margin-bottom: 25px;
            font-weight: 700;
            font-size: 1.2rem;
            align-items: center;
            background: linear-gradient(135deg, var(--glass-cyan), var(--glass-blue));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            text-transform: uppercase;
            letter-spacing: 2px;
        }
        .modal-head span { display: flex; align-items: center; gap: 10px; }
        .close-btn {
            cursor: pointer;
            color: var(--text);
            font-size: 1.5rem;
            transition: 0.3s;
            width: 35px;
            height: 35px;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 1px solid var(--border);
            border-radius: 8px;
        }
        .close-btn:hover {
            color: var(--danger);
            border-color: var(--danger);
            box-shadow: 0 0 15px var(--danger);
            transform: rotate(90deg);
        }
        .modal-btns { display: flex; gap: 10px; margin-top: 25px; flex-wrap: wrap; }
        .modal-btns button { flex: 1; min-width: 100px; }
        .theme-options {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 14px;
        }
        .theme-option {
            position: relative;
            display: block;
            padding: 12px;
            border: 2px solid var(--border);
            border-radius: 16px;
            background: rgba(79, 172, 254, 0.04);
            cursor: pointer;
            transition: transform 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease, background 0.25s ease;
        }
        .theme-option:hover {
            transform: translateY(-2px);
            border-color: var(--glass-blue);
            background: rgba(79, 172, 254, 0.09);
        }
        .theme-option.selected,
        .theme-option:focus-within {
            border-color: var(--glass-cyan);
            box-shadow: 0 0 0 3px rgba(67, 233, 229, 0.12), 0 10px 28px rgba(79, 172, 254, 0.18);
        }
        .theme-option input {
            position: absolute;
            width: 1px;
            height: 1px;
            opacity: 0;
            pointer-events: none;
        }
        .theme-preview {
            display: block;
            height: 92px;
            margin-bottom: 12px;
            border-radius: 12px;
            position: relative;
            overflow: hidden;
            border: 1px solid rgba(255, 255, 255, 0.18);
        }
        .theme-preview::after {
            content: '';
            position: absolute;
            left: 12px;
            right: 12px;
            bottom: 12px;
            height: 30px;
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.18);
            border: 1px solid rgba(255, 255, 255, 0.22);
            backdrop-filter: blur(8px);
        }
        .theme-preview.dark {
            background: radial-gradient(circle at 75% 20%, #334d78 0, #18243b 28%, #070b14 72%);
            color: #e8eaf6;
        }
        .theme-preview.light {
            background: linear-gradient(160deg, #87ceeb 0%, #dff7ff 58%, #f8fafc 100%);
            color: #0f172a;
        }
        .theme-preview-mark {
            position: absolute;
            top: 12px;
            right: 14px;
            font-size: 1.45rem;
            filter: drop-shadow(0 3px 8px rgba(0, 0, 0, 0.25));
        }
        .theme-choice-title { display: block; color: var(--text); font-size: 0.95rem; font-weight: 700; }
        .theme-choice-desc { display: block; color: var(--text-dim); font-size: 0.75rem; margin-top: 4px; line-height: 1.5; }
        .theme-storage-note {
            margin-top: 16px;
            padding: 10px 12px;
            border-left: 3px solid var(--glass-blue);
            border-radius: 8px;
            background: rgba(79, 172, 254, 0.07);
            color: var(--text-dim);
            font-size: 0.75rem;
            line-height: 1.6;
        }
        @media (max-width: 480px) {
            .theme-options { grid-template-columns: 1fr; }
            .theme-preview { height: 76px; }
        }

        /* Toast提示 */
        #toast {
            position: fixed;
            bottom: 30px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(135deg, var(--success), #22c55e);
            color: white;
            padding: 12px 30px;
            border-radius: 12px;
            opacity: 0;
            transition: 0.3s;
            pointer-events: none;
            font-weight: 700;
            box-shadow: 0 0 25px var(--success);
            border: 2px solid var(--success);
            z-index: 2000;
        }

        /* 响应式 - 全平台优化 */

        /* 平板及以下 - 侧边栏变为顶部栏 */
        @media (max-width: 1024px) {
            .container {
                flex-direction: column;
                padding: 10px;
                /* 👇 移动端无需超大顶部间距，已由布局自动处理 */
                padding-top: 80px;
            }
            .sidebar {
                width: 100%;
                position: relative;
                top: 0;
                padding: 20px;
            }
            .logo {
                flex-direction: row;
                justify-content: center;
                padding-bottom: 15px;
                margin-bottom: 15px;
            }
            .logo-icon { font-size: 2rem; }
            .logo-text { font-size: 1rem; }
            .nav-menu {
                flex-direction: row;
                flex-wrap: wrap;
                justify-content: center;
            }
            .nav-item {
                flex: 1;
                min-width: 120px;
                justify-content: center;
                padding: 10px;
                font-size: 0.85rem;
            }
            .top-nav {
                top: 10px;
                right: 10px;
                gap: 6px;
                padding: 6px;
            }
            .tool-btn {
                width: 38px;
                height: 38px;
                font-size: 1rem;
            }
            .content-section.active {
                grid-template-columns: 1fr;
            }
            .stats-panel { grid-template-columns: repeat(2, 1fr); }
            .stats-sphere { width: 220px; height: 220px; }
            .sphere-ring:nth-child(1) { width: 200px; height: 200px; }
            .sphere-ring:nth-child(2) { width: 165px; height: 165px; }
            .sphere-ring:nth-child(3) { width: 130px; height: 130px; }
        }

        /* 手机端 */
        @media (max-width: 768px) {
            .container { padding: 8px; padding-top: 65px; }
            .sidebar { padding: 15px; }
            .nav-menu { flex-direction: column; }
            .nav-item {
                width: 100%;
                min-width: auto;
            }
            .top-nav {
                top: 8px;
                right: 8px;
                gap: 5px;
                padding: 5px;
                border-radius: 12px;
            }
            .tool-btn {
                width: 36px;
                height: 36px;
                font-size: 0.95rem;
                border-radius: 10px;
            }
            .tool-btn::before {
                display: none;
            }
            .stats-panel { grid-template-columns: 1fr; }
            .stats-sphere { width: 180px; height: 180px; margin: 20px auto 10px; }
            .sphere-ring:nth-child(1) { width: 165px; height: 165px; border-width: 2.5px; }
            .sphere-ring:nth-child(2) { width: 135px; height: 135px; border-width: 2.5px; }
            .sphere-ring:nth-child(3) { width: 105px; height: 105px; border-width: 2.5px; }
            
            /* 手机端字号进一步缩小，防止溢出 */
            .sphere-value[data-length="short"] { font-size: 2.5rem; }
            .sphere-value[data-length="medium"] { font-size: 1.8rem; }
            .sphere-value[data-length="long"] { font-size: 1.4rem; }
            .sphere-value[data-length="verylong"] { font-size: 0.9rem; } /* 缩小到0.9rem，确保超长文本能容纳 */

            .sphere-label { font-size: 0.85rem; }
            .sphere-subtitle { font-size: 0.75rem; }
            .input-group-row { flex-direction: column; }
            .btn-group { flex-direction: column; }
            .log-entry { flex-direction: column; align-items: flex-start; gap: 5px; }
            .log-time, .log-ip, .log-loc { width: 100%; }
            /* Mobile adjustments */
            .main-content {
                padding-top: 0; /* Reset for mobile since container handles it */
            }
        }

        /* 小屏手机 */
        @media (max-width: 480px) {
            .container { padding-top: 60px; }
            .top-nav {
                top: 6px;
                right: 6px;
                gap: 4px;
                padding: 4px;
            }
            .tool-btn {
                width: 34px;
                height: 34px;
                font-size: 0.9rem;
            }
            .stats-sphere { width: 160px; height: 160px; }
            .sphere-ring:nth-child(1) { width: 148px; height: 148px; border-width: 2px; }
            .sphere-ring:nth-child(2) { width: 122px; height: 122px; border-width: 2px; }
            .sphere-ring:nth-child(3) { width: 96px; height: 96px; border-width: 2px; }
            
            /* 超小屏字体调整 */
            .sphere-value[data-length="short"] { font-size: 2rem; }
            .sphere-value[data-length="medium"] { font-size: 1.5rem; }
            .sphere-value[data-length="long"] { font-size: 1.2rem; }
            .sphere-value[data-length="verylong"] { font-size: 0.8rem; } /* 极限压缩 */

            .sphere-label { font-size: 0.75rem; letter-spacing: 1px; }
            .sphere-subtitle { font-size: 0.68rem; }
        }

        /* 超小屏 */
        @media (max-width: 360px) {
            .top-nav {
                top: 5px;
                right: 5px;
                gap: 3px;
                padding: 3px;
            }
            .tool-btn {
                width: 32px;
                height: 32px;
                font-size: 0.85rem;
            }
        }

        /* 内容区显示控制 */
        .content-section {
            display: none;
            opacity: 0;
            animation: fadeOut 0.3s ease-out;
        }
        .content-section.active {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 20px;
            opacity: 1;
            animation: fadeIn 0.5s ease-out;
        }

        /* 淡入淡出动画 */
        @keyframes fadeIn {
            from {
                opacity: 0;
                transform: translateY(20px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        @keyframes fadeOut {
            from {
                opacity: 1;
                transform: translateY(0);
            }
            to {
                opacity: 0;
                transform: translateY(-10px);
            }
        }

        /* 单列布局的面板 */
        #section-subscription.active,
        #section-whitelist.active,
        #section-nodes.active,
        #section-logs.active {
            display: block;
            opacity: 1;
            animation: fadeIn 0.5s ease-out;
        }

        #section-subscription .card,
        #section-whitelist .card,
        #section-nodes .card,
        #section-logs .card {
            margin-bottom: 20px;
            animation: slideInUp 0.6s ease-out;
        }

        /* 卡片滑入动画 */
        @keyframes slideInUp {
            from {
                opacity: 0;
                transform: translateY(30px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        /* ==================== 网络信息模块样式 ==================== */
        :root { --latency-49: #4CAF50; --latency-149: #83DA00; --latency-299: #f58722; --latency-999: #ff404a; --latency-1000: #c40003; }
        .network-cards-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 15px; }
        @media (max-width: 1200px) { .network-cards-grid { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 768px) { .network-cards-grid { grid-template-columns: 1fr; } .latency-cards-grid { grid-template-columns: 1fr; } }
        .network-card { background: var(--card-bg); border: 1.5px solid var(--border); border-radius: 14px; padding: 16px; transition: all 0.3s cubic-bezier(0.4,0,0.2,1); cursor: pointer; position: relative; overflow: hidden; --flag-badge-url: none; }
        .network-card:hover { transform: translateY(-4px) scale(1.02); border-color: #f6821f; box-shadow: 0 12px 20px rgba(246,130,31,0.15); }
        .network-card.has-flag-badge::after { content: ''; position: absolute; bottom: -12px; right: -3px; width: 90px; height: 60px; background-image: var(--flag-badge-url); background-repeat: no-repeat; background-position: left center; background-size: cover; filter: blur(3.18px) saturate(1.08); opacity: 0.2; transform: rotate(10deg); border-radius: 12px; pointer-events: none; z-index: 1; }
        .network-card-title { font-size: 0.9rem; font-weight: 600; color: var(--text); margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 8px; z-index: 2; position: relative; }
        .title-text { display: flex; flex-direction: column; }
        .title-main { font-size: 0.9rem; font-weight: 600; }
        .title-subtitle { font-size: 0.7rem; font-weight: 400; color: var(--text-dim); margin-top: 1px; }
        .cf-subtitle-rich { display: inline-flex; align-items: center; gap: 4px; }
        .cf-subtitle-v4 { color: #22c55e; font-weight: 600; }
        .cf-subtitle-v6 { color: #3b82f6; font-weight: 600; }
        .cf-subtitle-sep { color: var(--text-dim); font-size: 0.65rem; }
        .cf-subtitle-switch { cursor: pointer; opacity: 0.6; transition: opacity 0.2s; text-decoration: underline; text-underline-offset: 2px; }
        .cf-subtitle-switch:hover { opacity: 1; }
        .network-info-content { display: flex; flex-direction: column; z-index: 2; position: relative; }
        .ip-text { color: var(--glass-cyan); font-weight: 700; font-family: 'Fira Code','Courier New', monospace; font-size: 0.95rem; word-break: break-all; }
        .ip-text .error { color: var(--danger); }
        .ip-text.clickable { cursor: pointer; position: relative; padding-right: 20px; }
        .ip-text.clickable::after { content: ''; position: absolute; right: 0; top: 50%; width: 13px; height: 13px; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2388a4bf' stroke-width='2.5' stroke-linecap='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cline x1='16.5' y1='16.5' x2='21' y2='21'/%3E%3C/svg%3E"); background-size: contain; background-repeat: no-repeat; transform: translateY(-50%); opacity: 0.5; transition: opacity 0.2s; }
        .ip-text.clickable:hover::after { opacity: 1; }
        .ip-text.clickable.is-loading::after { background-image: none; border: 2px solid rgba(33,150,243,0.25); border-top-color: #2196F3; border-radius: 50%; width: 12px; height: 12px; animation: ipIconSpin 0.9s linear infinite; }
        @keyframes ipIconSpin { to { transform: translateY(-50%) rotate(360deg); } }
        .location-text { font-size: 0.8rem; color: var(--text-dim); margin-top: 4px; }
        .country-text { transition: filter 0.3s; }
        .network-tip { margin-top: 8px; font-size: 0.7rem; color: var(--text-dim); opacity: 0.7; }
        .status-indicator { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
        .status-loading { background: #fbbf24; animation: pulse-loading 1.5s ease-in-out infinite; }
        .status-success { background: #10b981; }
        .status-error { background: #ef4444; }
        @keyframes pulse-loading { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        .network-info-tip { font-size: 0.75rem; color: var(--text-dim); margin-top: 10px; }
        .network-info-tip a { color: var(--glass-blue); text-decoration: none; }
        .network-info-tip a:hover { text-decoration: underline; }
        .ip-detail-popup { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 9999; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); }
        .ip-detail-content { background: var(--card-bg); backdrop-filter: blur(20px); border: 1px solid var(--border); border-radius: 16px; padding: 24px; max-width: 500px; width: 90%; max-height: 80vh; overflow-y: auto; color: var(--text); }
        .ip-detail-content h3 { margin: 0 0 16px; font-size: 1.1rem; }
        .ip-detail-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 0.85rem; }
        .ip-detail-row .label { color: var(--text-dim); }
        .ip-detail-row .value { font-weight: 600; }
        .ip-detail-close { margin-top: 16px; width: 100%; padding: 8px; border: none; border-radius: 8px; background: var(--glass-blue); color: #fff; cursor: pointer; font-size: 0.9rem; }
        .ip-detail-close:hover { opacity: 0.85; }
        .ip-type-residential { color: #6bcb77; font-weight: 600; }
        .ip-type-hosting { color: #ff6b6b; font-weight: 600; }
        .ip-type-business { color: #ffd93d; font-weight: 600; }
        .badge-success { color: #00C851; }
        .badge-warning { color: #ffbb33; }
        .badge-danger { color: #ff4444; }
        .latency-cards-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
        @media (max-width: 1200px) { .latency-cards-grid { grid-template-columns: repeat(2, 1fr); } }
        .latency-card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 12px; padding: 12px 15px; position: relative; overflow: hidden; transition: all 0.3s ease; }
        .latency-card:hover { transform: translateY(-3px); border-color: var(--glass-blue); box-shadow: 0 8px 25px rgba(79,172,254,0.2); }
        .latency-card-header { display: flex; justify-content: space-between; align-items: center; width: 100%; z-index: 2; position: relative; }
        .latency-card-info { display: flex; align-items: center; gap: 10px; }
        .latency-card-icon-wrapper { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; background: var(--border); border-radius: 8px; transition: all 0.3s ease; }
        .latency-card:hover .latency-card-icon-wrapper { background: rgba(79,172,254,0.2); }
        .latency-card-icon-wrapper svg { width: 18px; height: 18px; }
        .latency-card-text { display: flex; flex-direction: column; }
        .latency-card-name { font-size: 0.85rem; font-weight: 700; color: var(--text); }
        .latency-card-region { font-size: 0.65rem; font-weight: 600; letter-spacing: 0.5px; display: inline-block; padding: 1px 6px; border-radius: 4px; }
        .latency-card-region[data-region="国内"] { color: var(--glass-green); background: rgba(74,222,128,0.1); }
        .latency-card-region[data-region="国际"] { color: var(--glass-blue); background: rgba(79,172,254,0.1); }
        .latency-status { font-family: 'Orbitron','Courier New', monospace; font-size: 1.3rem; font-weight: 800; font-style: italic; color: var(--glass-cyan); min-width: 60px; text-align: right; z-index: 2; position: relative; }
        .latency-status .unit { font-family: 'Segoe UI', sans-serif; font-size: 0.7rem; font-weight: 600; font-style: normal; opacity: 0.7; margin-left: 2px; }
        .latency-graph-container { position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 1; pointer-events: none; opacity: 0.15; }
        .graph-grid { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: repeating-linear-gradient(90deg, var(--border) 0, var(--border) 1px, transparent 1px, transparent 25%), repeating-linear-gradient(0deg, var(--border) 0, var(--border) 1px, transparent 1px, transparent 33%); opacity: 0.1; }
        .latency-ecg { width: 100%; height: 100%; }
        .ecg-path { fill: none; stroke: #f6821f; stroke-width: 3.5; stroke-linecap: round; stroke-linejoin: round; transition: d 0.4s cubic-bezier(0.4,0,0.2,1); }
        .ecg-path-bg { fill: none; stroke: rgba(255,255,255,0.05); stroke-width: 1; }
        .ecg-cursor { fill: #f6821f; filter: drop-shadow(0 0 5px #f6821f); transition: cx 0.3s ease, cy 0.3s ease; }
        .latency-card-icon-wrapper[data-site="github"] svg path, .latency-card-icon-wrapper[data-site="x.com"] svg path { fill: #e8eaf6 !important; }
        body.light .latency-card-icon-wrapper[data-site="github"] svg path, body.light .latency-card-icon-wrapper[data-site="x.com"] svg path { fill: #0f172a !important; }
        body.light .network-card { background: rgba(255,255,255,0.85); border-color: rgba(37,99,235,0.2); }
        body.light .network-card:hover { background: rgba(255,255,255,0.95); border-color: var(--glass-blue); }
        body.light .network-card.has-flag-badge::after { opacity: 0.30; }
        body.light .ip-text { color: #0891b2; }
        body.light .latency-card { background: rgba(255,255,255,0.85); border-color: rgba(37,99,235,0.2); }
        body.light .latency-card:hover { background: rgba(255,255,255,0.95); border-color: var(--glass-blue); }
        body.light .latency-card-icon-wrapper { background: rgba(37,99,235,0.1); }
        body.light .latency-card:hover .latency-card-icon-wrapper { background: rgba(37,99,235,0.2); }
    </style>
</head>
<body id="mainBody">
    ${weakBanner}
    <!-- 玻璃碎裂背景 -->
    <div class="glass-shards-bg">
        <div class="shard"></div>
        <div class="shard"></div>
        <div class="shard"></div>
        <div class="shard"></div>
        <div class="shard"></div>
        <div class="shard"></div>
        <div class="shard"></div>
    </div>

    <!-- 星空背景 -->
    <div class="stars" id="starsContainer"></div>

    <!-- 流星雨 -->
    <div class="stars">
        <div class="meteor"></div>
        <div class="meteor"></div>
        <div class="meteor"></div>
        <div class="meteor"></div>
        <div class="meteor"></div>
        <div class="meteor"></div>
        <div class="meteor"></div>
        <div class="meteor"></div>
        <div class="meteor"></div>
        <div class="meteor"></div>
    </div>

    <div class="container">
        <!-- 左侧边栏 -->
        <div class="sidebar">
            <div class="logo">
                <div class="logo-icon">💎</div>
                <div>
                    <div class="logo-text">玻璃态控制台</div>
                    <div class="logo-sub">GLASS DASHBOARD</div>
                </div>
            </div>
            <div class="nav-menu">
                <div class="nav-item active" onclick="showSection('dashboard')">
                    <span class="icon">📊</span> 控制台
                </div>
                <div class="nav-item" onclick="showSection('network')">
                    <span class="icon">🌐</span> 网络信息
                </div>
                <div class="nav-item" onclick="showSection('subscription')">
                    <span class="icon">🚀</span> 订阅
                </div>
                <div class="nav-item" onclick="showSection('whitelist')">
                    <span class="icon">🛡️</span> 白名单
                </div>
                <div class="nav-item" onclick="showSection('nodes')">
                    <span class="icon">🛠️</span> 自定义节点
                </div>
                <div class="nav-item" onclick="showSection('logs')">
                    <span class="icon">📋</span> 日志
                </div>
            </div>
        </div>

        <!-- 右上角工具栏 -->
        <div class="top-nav">
            <button class="tool-btn" onclick="openThemeModal()" data-tooltip="主题设置" aria-label="主题设置">🌗</button>
            <button class="tool-btn" onclick="showModal('tgModal')" data-tooltip="TG通知">🤖 <span class="status-dot ${tgState ? 'on' : 'off'}"></span></button>
            <button class="tool-btn" onclick="showModal('cfModal')" data-tooltip="CF统计">☁️ <span class="status-dot ${cfState ? 'on' : 'off'}"></span></button>
            <button class="tool-btn logout" onclick="logout()" data-tooltip="退出">⏻</button>
        </div>

        <!-- 主内容区 -->
        <div class="main-content">
            <!-- 控制台面板 -->
            <div id="section-dashboard" class="content-section active">
                <!-- 3D 球体统计卡片 -->
                <div class="sphere-card">
                    <div class="stats-sphere">
                        <div class="sphere-ring"></div>
                        <div class="sphere-ring"></div>
                        <div class="sphere-ring"></div>
                        <div class="sphere-center">
                            <div class="sphere-value" id="reqCount" data-length="short">0</div>
                        </div>
                    </div>
                    <div class="sphere-labels">
                        <div class="sphere-label">今日请求</div>
                        <div class="sphere-subtitle" id="reqSubtitle">Cloudflare 统计</div>
                    </div>
                    <button class="btn btn-primary" style="width:100%;margin-top:20px" onclick="updateStats()">🔄 刷新统计</button>

                    <!-- 系统状态 - 移到按钮下方 -->
                    <div style="margin-top:25px;padding-top:20px;border-top:1px solid var(--border)">
                        <div class="card-title" style="margin-bottom:15px"><span class="icon">📊</span> 系统状态</div>
                        <div class="stats-panel">
                            <div class="stat-box">
                                <div class="stat-label">当前IP</div>
                                <div class="stat-value ip-value" id="currentIp">...</div>
                            </div>
                            <div class="stat-box">
                                <div class="stat-label">Google延迟</div>
                                <div class="stat-value" id="googleStatus">...</div>
                            </div>
                            <div class="stat-box">
                                <div class="stat-label">存储状态</div>
                                <div class="stat-value" id="kvStatus">...</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 网络信息面板 -->
            <div id="section-network" class="content-section">
                <div class="card">
                    <div class="card-title"><span class="icon">🌐</span> IP 信息检测</div>
                    <div class="network-cards-grid">
                        <div class="network-card">
                            <div class="network-card-title"><span class="status-indicator status-loading" id="status-ipip"></span><div class="title-text"><div class="title-main">国内测试</div><div class="title-subtitle" id="ipip-subtitle"></div></div></div>
                            <div class="network-info-content">
                                <span id="ipip-ip" class="ip-text" data-raw-value="" data-mask-type="ip" data-display-state="loading">加载中...</span>
                                <div class="location-text"><span id="ipip-country" class="country-text" data-raw-value="" data-mask-type="location" data-display-state="loading"></span></div>
                                <div class="network-tip">· 您访问国内站点所使用的IP</div>
                            </div>
                        </div>
                        <div class="network-card">
                            <div class="network-card-title"><span class="status-indicator status-loading" id="status-overseas"></span><div class="title-text"><div class="title-main">国外测试</div><div class="title-subtitle">漏网之鱼</div></div></div>
                            <div class="network-info-content">
                                <span id="overseas-ip" class="ip-text" data-raw-value="" data-mask-type="ip" data-display-state="loading">加载中...</span>
                                <div class="location-text"><span id="overseas-country" class="country-text" data-raw-value="" data-mask-type="location" data-display-state="loading"></span></div>
                                <div class="network-tip">· 您访问没有被封的国外站点所使用的IP</div>
                            </div>
                        </div>
                        <div class="network-card">
                            <div class="network-card-title"><span class="status-indicator status-loading" id="status-cf"></span><div class="title-text"><div class="title-main">CloudFlare</div><div class="title-subtitle cf-subtitle-rich" id="cf-subtitle">ProxyIP</div></div></div>
                            <div class="network-info-content">
                                <span id="cf-ip" class="ip-text" data-raw-value="" data-mask-type="ip" data-display-state="loading">加载中...</span>
                                <div class="location-text"><span id="cf-country" class="country-text" data-raw-value="" data-mask-type="location" data-display-state="loading"></span></div>
                                <div class="network-tip">· 您访问CFCDN站点所使用的落地IP</div>
                            </div>
                        </div>
                        <div class="network-card">
                            <div class="network-card-title"><span class="status-indicator status-loading" id="status-twitter"></span><div class="title-text"><div class="title-main">墙外测试</div><div class="title-subtitle" id="twitter-subtitle"></div></div></div>
                            <div class="network-info-content">
                                <span id="twitter-ip" class="ip-text" data-raw-value="" data-mask-type="ip" data-display-state="loading">加载中...</span>
                                <div class="location-text"><span id="twitter-country" class="country-text" data-raw-value="" data-mask-type="location" data-display-state="loading"></span></div>
                                <div id="twitter-tip" class="network-tip">· 您访问墙外站点所使用的IP</div>
                            </div>
                        </div>
                    </div>
                    <div class="network-info-tip">💡 <b>国内测试</b> 由分流规则决定，<b>国外测试</b> 由优选IP决定，<b>CF、墙外入口、ChatGPT</b> 由 PROXYIP 决定</div>
                    <div class="card-title" style="margin-top:25px;padding-top:20px;border-top:1px solid var(--border)"><span class="icon">⚡</span> 延迟测试</div>
                    <div class="latency-cards-grid" id="latency-cards"></div>
                </div>
            </div>

            <div id="section-subscription" class="content-section">
                <div class="card">
                    <div class="card-title"><span class="icon">🚀</span> 快速订阅</div>
                    <div class="input-group-row" style="margin-bottom:15px">
                        <input type="text" id="autoSub" value="${safeVal(defaultSubLink)}" readonly style="flex:1">
                        <button class="btn btn-secondary" onclick="copyId('autoSub')">复制</button>
                        <button class="btn btn-primary" onclick="testAutoSub()">测试</button>
                    </div>
                    <div class="input-block">
                        <label>订阅源地址 (Sub Domain)</label>
                        <input type="text" id="subDom" value="${safeVal(subdomain)}" oninput="updateLink()">
                    </div>
                    <div class="input-block">
                        <label>Worker 域名 (SNI/Host)</label>
                        <input type="text" id="hostDom" value="${safeVal(host)}" oninput="updateLink()">
                    </div>
                    <div class="input-block">
                        <label>中转cdn地址 (cdn访问path路径)</label>
                        <div class="input-group-row">
                            <input type="text" id="pIp" value="${safeVal(proxyip)}" oninput="updateLink()">
                            <!-- 👇 修改：传入 proxyCheckUrl -->
                            <button class="btn btn-primary" onclick="checkProxy()">检测</button>
                        </div>
                    </div>
                    <div style="margin:15px 0;padding:15px;border:1px solid var(--border);border-radius:12px;background:rgba(0,245,255,0.03)">
                        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
                            <span style="font-size:0.9rem;font-weight:600;color:var(--glass-cyan)">🔐 ECH + 指纹伪装</span>
                            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin:0">
                                <input type="checkbox" id="echSwitch" ${echEnabled === 'true' ? 'checked' : ''} onchange="updateEchUI();updateLink()">
                                <span id="echLabel" style="font-size:0.8rem">${echEnabled === 'true' ? '已启用' : '已关闭'}</span>
                            </label>
                        </div>
                        <div id="echDetail" style="${echEnabled === 'true' ? '' : 'display:none'}">
                            <div class="input-block" style="margin-bottom:8px">
                                <label style="font-size:0.8rem">ECH 域名 (SNI)</label>
                                <input type="text" id="echSni" value="${safeVal(echSni)}" oninput="updateLink()" placeholder="cloudflare-ech.com">
                            </div>
                            <div class="input-block" style="margin-bottom:8px">
                                <label style="font-size:0.8rem">ECH DoH 地址</label>
                                <input type="text" id="echDns" value="${safeVal(echDns)}" placeholder="https://doh.example.com/dns-query">
                            </div>
                            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
                                <span style="font-size:0.8rem;color:var(--text-dim)">指纹 (FP):</span>
                                <span id="fpDisplay" style="font-size:0.8rem;color:var(--glass-green);font-weight:600">chrome</span>
                                <span style="font-size:0.75rem;color:var(--text-dim)">(ECH开关均为chrome)</span>
                            </div>
                            <div style="display:flex;gap:8px">
                                <button class="btn btn-success" style="flex:1;padding:8px;font-size:0.85rem" onclick="saveEchConfig()">💾 保存 ECH 配置</button>
                                <button class="btn btn-primary" style="padding:8px 12px;font-size:0.85rem;white-space:nowrap" onclick="showECHHelp()">💡 ECH 是什么？</button>
                            </div>
                        </div>
                    </div>
                    <div style="display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-bottom:10px;font-size:0.85rem">
                        <input type="checkbox" id="cMode" onchange="tgCM()">
                        <label for="cMode" style="margin:0;text-transform:none">启用转换模式</label>
                    </div>
                    <div class="input-block">
                        <label>手动订阅链接</label>
                        <input type="hidden" id="subToken" value="${safeVal(subToken)}">
                        <textarea id="finalLink">${safeVal(longLink)}</textarea>
                    </div>
                    <div class="btn-group">
                        <button class="btn btn-success" onclick="copyId('finalLink')">复制链接</button>
                        <button class="btn btn-primary" onclick="testSub()">测试访问</button>
                    </div>
                </div>
            </div>

            <!-- 白名单面板 -->
            <div id="section-whitelist" class="content-section">
                <div class="card">
                    <div class="card-title"><span class="icon">🛡️</span> 白名单管理</div>
                    <div class="input-group-row" style="margin-bottom:15px">
                        <input type="text" id="newWhitelistIp" placeholder="输入 IP 地址 (IPv4/IPv6)">
                        <button class="btn btn-success" onclick="addWhitelist()">添加</button>
                        <button class="btn btn-secondary" onclick="loadWhitelist()">刷新</button>
                    </div>
                    <div style="max-height:300px;overflow-y:auto;border:1px solid var(--border)">
                        <table class="wl-table">
                            <thead><tr><th>IP 地址</th><th style="width:100px">操作</th></tr></thead>
                            <tbody id="whitelistBody"><tr><td colspan="2" style="text-align:center">加载中...</td></tr></tbody>
                        </table>
                    </div>
                    <div style="font-size:0.75rem;color:var(--text-dim);margin-top:10px">💡 提示：系统内置 IP 需要修改代码或环境变量才能删除</div>
                </div>
            </div>

            <!-- 节点配置面板 -->
            <div id="section-nodes" class="content-section">
                <div class="card">
                    <div class="card-title"><span class="icon">🛠️</span> 优选IP与远程配置</div>
                    <div style="font-size:0.8rem;color:var(--danger);margin-bottom:15px;padding:10px;background:rgba(255,0,64,0.1);border-left:3px solid var(--danger)">
                        ⚠️ 注意：若要在此生效，请确保 Cloudflare 后台未设置对应环境变量 (ADD/ADDAPI/ADDCSV)
                    </div>
                    <div style="font-size:0.8rem;color:var(--danger);margin-bottom:15px;padding:10px;background:rgba(255,0,64,0.1);border-left:3px solid var(--danger)">
                        ⚠️ 注意：若要在此生效，请确保 Cloudflare 后台或者硬编码未设置SUB订阅器 (详情顶部配置DEFAULT_SUB_DOMAIN)
                    </div>
                    <div style="font-size:0.8rem;color:var(--glass-cyan);margin-bottom:15px;padding:10px;background:rgba(0,245,255,0.06);border-left:3px solid var(--glass-blue);line-height:1.7">
                        💡 <b>分隔符说明</b>：下面三个框支持 <b>回车换行</b>、<b>空格</b>、<b>逗号</b> 任意一种分隔，中英文符号不区分（半角/全角空格、<code>,</code> <code>，</code> <code>、</code> 均可）。<br>
                        由于 Cloudflare 新版环境变量界面只能单行输入，在 CF 后台填写时请改用 <b>空格</b> 或 <b>逗号</b> 分隔；本页面用换行分隔同样有效。<br>
                        ⚠️ 备注名里含空格或逗号不会被误切（如 <code>1.2.3.4:443#美国 洛杉矶</code> 正常）；分隔时只用<b>一个</b>符号即可，逗号后不要再加空格。
                    </div>
                    <div class="input-block">
                        <label>ADD - 本地优选 IP (格式: IP:Port#Name，换行 / 空格 / 逗号 分隔)</label>
                        <textarea id="inpAdd" placeholder="1.1.1.1:443#US 2.2.2.2:443#HK">${safeVal(add)}</textarea>
                    </div>
                    <div class="input-block">
                        <label>ADDAPI - 远程优选 TXT 链接 (换行 / 空格 / 逗号 分隔)</label>
                        <textarea id="inpAddApi" placeholder="https://example.com/ips.txt">${safeVal(addApi)}</textarea>
                    </div>
                    <div class="input-block">
                        <label>ADDCSV - 远程优选 CSV 链接 (换行 / 空格 / 逗号 分隔)</label>
                        <textarea id="inpAddCsv" placeholder="https://example.com/ips.csv">${safeVal(addCsv)}</textarea>
                    </div>
                    <!-- ⭐ 功能4: DLS 设置输入框 -->
                    <div class="input-block">
                        <label>DLS (ADDCSV专用) - 速度下限筛选 (单位: MB/s)</label>
                        <input type="text" id="inpDls" placeholder="7" value="${safeVal(dls)}">
                    </div>
                    <div style="margin:18px 0 12px;padding-top:16px;border-top:1px solid var(--border)">
                        <div class="card-title" style="margin-bottom:10px;font-size:1rem"><span class="icon">🔗</span> ADDSUB - 汇聚订阅</div>
                        <div style="font-size:0.8rem;color:var(--glass-cyan);margin-bottom:12px;padding:10px;background:rgba(0,245,255,0.06);border-left:3px solid var(--glass-blue);line-height:1.8">
                            一个框内可混写以下 <b>五类</b>内容，系统按内容特征自动识别，分隔方式同上（换行 / 空格 / 逗号）：<br>
                            ① <b>优选域名 / IP</b>　<code>www.visa.cn#优选域名</code>　<code>104.24.0.232:8443#优选v4</code>　<code>[2606:4700::]:2053#优选v6</code><br>
                            ② <b>优选 IP API</b>（返回 IP 列表的 TXT/CSV）　<code>https://raw.githubusercontent.com/.../best_ips.txt#优选v4</code><br>
                            ③ <b>机场订阅</b>（返回节点的订阅地址）　<code>https://69yun69.net/auth/register?code=X#69云机场</code><br>
                            ④ <b>优选订阅生成器</b>　<code>sub://sub.example.net#CM优选订阅</code><br>
                            ⑤ <b>现成节点链接</b>　<code>vl</code><code>ess://uuid@host:443?type=ws&amp;host=...</code><br>
                            <span style="color:var(--text-dim)">② 与 ③ 写法相同，靠<b>抓回来的内容</b>自动区分（含 <code>://</code> 即视为节点订阅）。</span><br>
                            💡 <b>① ② ④</b> 得到的是地址，会套用本项目的节点模板（含 ECH / 指纹）；<b>③ ⑤</b> 是别人的完整节点，<b>原样透传不加工</b>并排在订阅最前。<br>
                            💡 在任意 <b>②</b> 条目后加 <code>?proxyip=true</code>，该源的 IP 会同时作为该节点的反代地址（path 自动变为 <code>/proxyip=自身</code>）。<br>
                            ⚠️ 单个源抓取失败会静默跳过，不影响其余源；超时 5 秒。
                        </div>
                        <textarea id="inpAddSub" style="min-height:130px" placeholder="www.visa.cn#优选域名&#10;https://raw.githubusercontent.com/xxx/best_ips.txt#优选IP_API&#10;https://69yun69.net/auth/register?code=X#69云机场&#10;sub://sub.example.net#CM优选订阅">${safeVal(addSub)}</textarea>
                    </div>
                    <button class="btn btn-success" style="width:100%" onclick="saveNodeConfig()">💾 保存配置</button>
                </div>
            </div>

            <!-- 日志面板 -->
            <div id="section-logs" class="content-section">
                <div class="card">
                    <div class="card-title">
                        <span><span class="icon">📋</span> 操作日志</span>
                    </div>
                    <div class="log-box" id="logBox">加载中...</div>
                    <button class="btn btn-secondary" style="width:100%;margin-top:15px" onclick="loadLogs()">🔄 刷新日志</button>
                </div>
            </div>
        </div>
    </div>

    <!-- TG配置模态框 -->
    <div id="tgModal" class="modal">
        <div class="modal-content">
            <div class="modal-head"><span>🤖 Telegram 通知配置</span><span class="close-btn" onclick="closeModal('tgModal')">×</span></div>
            <div class="input-block">
                <label>Bot Token</label>
                <input type="text" id="tgToken" placeholder="123456:ABC-DEF..." value="${safeVal(tgToken)}">
                ${getStatusLabel(tgToken, sysParams.tgToken)}
            </div>
            <div class="input-block">
                <label>Chat ID</label>
                <input type="text" id="tgId" placeholder="123456789" value="${safeVal(tgId)}">
                ${getStatusLabel(tgId, sysParams.tgId)}
            </div>
            <div class="input-block" style="padding:12px;border:1px solid var(--border);border-radius:10px;background:rgba(0,245,255,0.03)">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
                    <span style="font-size:0.9rem;font-weight:600;color:var(--glass-cyan)">📊 CF 用量仪表盘</span>
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin:0">
                        <input type="checkbox" id="statsEnabled" ${statsEnabled === 'true' ? 'checked' : ''} onchange="document.getElementById('statsLabel').textContent=this.checked?'已启用':'已关闭'">
                        <span id="statsLabel" style="font-size:0.8rem">${statsEnabled === 'true' ? '已启用' : '已关闭'}</span>
                    </label>
                </div>
                <label style="font-size:0.75rem">推送目标 Chat ID（留空=用上方 Chat ID）</label>
                <input type="text" id="statsChatId" placeholder="默认用上方 Chat ID" value="${safeVal(statsChatId)}">
                <div style="display:flex;gap:8px;margin-top:10px">
                    <button class="btn btn-success" style="flex:1;padding:8px;font-size:0.85rem" onclick="saveDash()">💾 保存仪表盘</button>
                    <button class="btn btn-primary" style="flex:1;padding:8px;font-size:0.85rem" onclick="setupWebhook()">🔗 设置 Webhook</button>
                </div>
                <div style="font-size:0.7rem;color:var(--text-dim);margin-top:6px">需配 CF 统计 + 部署 Cron(*/30 * * * *) · TG 发 /stats 可查</div>
            </div>
            <div class="modal-btns">
                <button class="btn btn-secondary" onclick="validateApi('tg')">验证</button>
                <button class="btn btn-success" onclick="(function(){ const d={}; const t=val('tgToken'); const i=val('tgId'); if(t&&!t.startsWith('****'))d.TG_BOT_TOKEN=t; if(i&&!i.startsWith('****'))d.TG_CHAT_ID=i; if(Object.keys(d).length)saveConfig(d,'tgModal'); else{alert('请输入新的配置值');} })()">保存</button>
                <button class="btn btn-danger" onclick="clearConfig('tg')">清除</button>
            </div>
        </div>
    </div>

    <!-- CF配置模态框 -->
    <div id="cfModal" class="modal">
        <div class="modal-content">
            <div class="modal-head"><span>☁️ Cloudflare 统计配置</span><span class="close-btn" onclick="closeModal('cfModal')">×</span></div>
            <div style="margin-bottom:20px;padding-bottom:15px;border-bottom:1px solid var(--border)">
                <label>方案1: Account ID + API Token</label>
                <input type="text" id="cfAcc" placeholder="Account ID" style="margin-bottom:10px" value="${safeVal(cfId)}">
                ${getStatusLabel(cfId, sysParams.cfId)}
                <input type="text" id="cfTok" placeholder="API Token" value="${safeVal(cfToken)}">
                ${getStatusLabel(cfToken, sysParams.cfToken)}
            </div>
            <div class="input-block">
                <label>方案2: Email + Global Key</label>
                <input type="text" id="cfMail" placeholder="Email" style="margin-bottom:10px" value="${safeVal(cfMail)}">
                ${getStatusLabel(cfMail, sysParams.cfMail)}
                <input type="text" id="cfKey" placeholder="Global API Key" value="${safeVal(cfKey)}">
                ${getStatusLabel(cfKey, sysParams.cfKey)}
            </div>
            <div class="input-block">
                <label>Zone ID（区域流量统计用，可选）</label>
                <input type="text" id="cfZone" placeholder="域名概览页右侧的 Zone ID" value="${safeVal(zoneId)}">
                <div style="font-size:0.7rem;color:var(--text-dim);margin-top:4px">用于仪表盘的「区域流量」(总请求/威胁🛡️/缓存/带宽)</div>
            </div>
            <div class="modal-btns">
                <button class="btn btn-secondary" onclick="validateApi('cf')">验证</button>
                <button class="btn btn-success" onclick="(function(){ const d={}; const a=val('cfAcc'),t=val('cfTok'),m=val('cfMail'),k=val('cfKey'),z=val('cfZone'); if(a&&!a.startsWith('****'))d.CF_ID=a; if(t&&!t.startsWith('****'))d.CF_TOKEN=t; if(m&&!m.startsWith('****'))d.CF_EMAIL=m; if(k&&!k.startsWith('****'))d.CF_KEY=k; if(z&&!z.startsWith('****'))d.CF_ZONE_ID=z; if(Object.keys(d).length)saveConfig(d,'cfModal'); else{alert('请输入新的配置值');} })()">保存</button>
                <button class="btn btn-danger" onclick="clearConfig('cf')">清除</button>
            </div>
        </div>
    </div>

    <!-- 主题设置模态框 -->
    <div id="themeModal" class="modal" onclick="if(event.target===this)cancelThemeSelection()">
        <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="themeModalTitle">
            <div class="modal-head"><span id="themeModalTitle">🌗 主题设置</span><span class="close-btn" onclick="cancelThemeSelection()">×</span></div>
            <div class="theme-options" role="radiogroup" aria-label="主题选择">
                <label class="theme-option selected" data-theme-option="dark">
                    <input type="radio" name="themeChoice" value="dark" onchange="previewTheme(this.value)" checked>
                    <span class="theme-preview dark"><span class="theme-preview-mark">🌙</span></span>
                    <span class="theme-choice-title">深色主题</span>
                    <span class="theme-choice-desc">默认主题 · 星空与深色玻璃效果</span>
                </label>
                <label class="theme-option" data-theme-option="light">
                    <input type="radio" name="themeChoice" value="light" onchange="previewTheme(this.value)">
                    <span class="theme-preview light"><span class="theme-preview-mark">☀️</span></span>
                    <span class="theme-choice-title">浅色主题</span>
                    <span class="theme-choice-desc">天空渐变 · 明亮玻璃效果</span>
                </label>
            </div>
            <div class="theme-storage-note">主题设置仅保存在当前浏览器中，不会写入 Worker、D1 或账号配置。</div>
            <div class="modal-btns">
                <button class="btn btn-secondary" onclick="cancelThemeSelection()">取消</button>
                <button class="btn btn-primary" onclick="resetTheme()">恢复默认</button>
                <button class="btn btn-success" onclick="saveTheme()">保存主题</button>
            </div>
        </div>
    </div>

    <div id="toast">已复制</div>

    <script>
        const UUID = "${jsStr(uuid)}"; const CONVERTER = "${jsStr(converter)}"; const CLIENT_IP = "${jsStr(clientIP)}"; const HAS_AUTH = ${hasAuth};
        const ECH_ON_INIT = ${echEnabled === 'true'}; const ECH_SNI_INIT = "${jsStr(echSni)}"; const ECH_DNS_INIT = "${jsStr(echDns)}";
        const THEME_STORAGE_KEY = 'graintcp_admin_theme';
        let themeBeforePreview = 'dark';
        function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

        // 页面加载
        window.addEventListener('DOMContentLoaded', () => {
            if (HAS_AUTH && !sessionStorage.getItem("is_active")) {
                fetch('?flag=logout', { method: 'POST' }).finally(() => window.location.reload());
            } else {
                applyStoredTheme();
                document.body.classList.add('loaded');
                if(!document.getElementById('subDom').value) updateLink();
                generateStars();
            }
        });

        // 生成星星背景
        function generateStars() {
            const starsContainer = document.getElementById('starsContainer');
            const starCount = 300; // 增加到300颗星星，满屏效果
            for (let i = 0; i < starCount; i++) {
                const star = document.createElement('div');
                star.className = 'star';
                star.style.left = Math.random() * 100 + '%';
                star.style.top = Math.random() * 100 + '%';
                star.style.animationDelay = Math.random() * 3 + 's';
                star.style.animationDuration = (Math.random() * 2 + 2) + 's';
                // 随机大小
                const size = Math.random() * 2 + 1;
                star.style.width = size + 'px';
                star.style.height = size + 'px';
                starsContainer.appendChild(star);
            }
        }

        // 工具函数
        function val(id) { return document.getElementById(id).value; }
        function showModal(id) { document.getElementById(id).classList.add('show'); }
        function closeModal(id) { document.getElementById(id).classList.remove('show'); }

        // 动态调整球体数字大小，防止溢出
        function adjustSphereValue(element, text) {
            element.innerText = text;
            const len = text.length;
            if (len <= 5) {
                element.setAttribute('data-length', 'short');
            } else if (len <= 10) {
                element.setAttribute('data-length', 'medium');
            } else if (len <= 20) {
                element.setAttribute('data-length', 'long');
            } else {
                element.setAttribute('data-length', 'verylong');
            }
        }

        // 切换面板 - 修复为网格布局
        let _latencyTimer = null, _logTimer = null, _networkLoaded = false;
        function showSection(section, e) {
            document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
            document.getElementById('section-' + section).classList.add('active');
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            (e || window.event || {target:document}).target.closest('.nav-item')?.classList.add('active');
            // 按需启停轮询
            if (section === 'network') { if (!_networkLoaded) { loadNetworkInfo(); _networkLoaded = true; } startLatencyTest(); }
            else { stopLatencyTest(); }
            if (section === 'logs') { loadLogs(); if (!_logTimer) _logTimer = setInterval(loadLogs, 5000); }
            else { if (_logTimer) { clearInterval(_logTimer); _logTimer = null; } }
        }

        // 更新统计
        async function updateStats() {
            try {
                const start = Date.now();
                await fetch('https://www.google.com/generate_204', {mode: 'no-cors'});
                document.getElementById('googleStatus').innerText = (Date.now() - start) + 'ms';
            } catch (e) { document.getElementById('googleStatus').innerText = 'Timeout'; }
            try {
                const res = await fetch('?flag=stats');
                const data = await res.json();
                const reqCountEl = document.getElementById('reqCount');
                adjustSphereValue(reqCountEl, data.req);
                // 经 CF-Worker 类代理链路访问时边缘不带 cf-connecting-ip，data.ip 为空 → 前端回退公共 IP 回显
                let ipText = data.ip;
                if (!ipText) {
                    try { ipText = (await (await fetch('https://api.ipify.org?format=json')).json()).ip || ''; } catch (e) {}
                }
                document.getElementById('currentIp').innerText = ipText || '未知';
                document.getElementById('kvStatus').innerText = data.storageStatus || 'Missing';
                document.getElementById('reqSubtitle').innerText = (data.storageStatus && data.storageStatus !== 'Missing')
                    ? 'Cloudflare 统计'
                    : '网页刷新统计';
            } catch (e) {
                const reqCountEl = document.getElementById('reqCount');
                adjustSphereValue(reqCountEl, 'N/A');
            }
        }

        // 加载日志
        async function loadLogs() {
            try {
                const res = await fetch('?flag=get_logs');
                const data = await res.json();
                let html = '';
                const logBox = document.getElementById('logBox');
                if (Array.isArray(data.logs)) {
                    html = data.logs
                        .slice()
                        .sort((a, b) => Number(b.sortTime || 0) - Number(a.sortTime || 0) || Number(b.id || 0) - Number(a.id || 0))
                        .map(log => "<div class='log-entry'><span class='log-time'>" + esc(log.time) + "</span><span class='log-ip'>" + esc(log.ip) + "</span><span class='log-loc'>" + esc(log.region) + "</span><span class='log-tag " + (log.action.includes('订阅')||log.action.includes('检测')?'green':'') + "'>" + esc(log.action) + "</span></div>")
                        .join('');
                } else if (data.logs && typeof data.logs === 'string') {
                    html = data.logs.split('\\n').filter(x=>x).slice(-50).reverse().map(line => {
                        const p = line.split('|');
                        return "<div class='log-entry'><span class='log-time'>" + esc(p[0]) + "</span><span class='log-ip'>" + esc(p[1]) + "</span><span class='log-loc'>" + esc(p[2]) + "</span><span class='log-tag " + (p[3].includes('订阅')||p[3].includes('检测')?'green':'') + "'>" + esc(p[3]) + "</span></div>";
                    }).join('');
                }
                logBox.innerHTML = html || '暂无日志';
                logBox.scrollTop = 0;
            } catch(e) { document.getElementById('logBox').innerText = '加载失败或未绑定 DB'; }
        }

        // 加载白名单
        async function loadWhitelist() {
            try {
                const res = await fetch('?flag=get_whitelist');
                const data = await res.json();
                const list = data.list || [];
                const html = list.length ? list.map(item => {
                    const safeIp = esc(item.ip);
                    const actionHtml = item.type === 'system' ? '<span class="sys-tag">🔒 系统</span>' : "<button class='btn-del' onclick='delWhitelist(\\"" + safeIp + "\\")'>删除</button>";
                    return "<tr><td>" + safeIp + "</td><td>" + actionHtml + "</td></tr>";
                }).join('') : '<tr><td colspan="2" style="text-align:center">暂无白名单 IP</td></tr>';
                document.getElementById('whitelistBody').innerHTML = html;
            } catch(e) { document.getElementById('whitelistBody').innerHTML = '<tr><td colspan="2">加载失败</td></tr>'; }
        }

        async function addWhitelist() {
            const ip = document.getElementById('newWhitelistIp').value.trim();
            if(!ip) return;
            try {
                const res = await fetch('?flag=add_whitelist', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ip}) });
                const data = await res.json();
                if (data.status !== 'ok') throw new Error(data.msg || '添加失败');
                document.getElementById('newWhitelistIp').value = '';
                await loadWhitelist();
            } catch(e) { alert('添加失败: ' + e.message); }
        }

        async function delWhitelist(ip) {
            if(!confirm('确定移除 '+ip+'?')) return;
            try {
                const res = await fetch('?flag=del_whitelist', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ip}) });
                const data = await res.json();
                if (data.status !== 'ok') throw new Error(data.msg || '删除失败');
                await loadWhitelist();
            } catch(e) { alert('删除失败: ' + e.message); }
        }

        // ProxyIP检测
        async function checkProxy() {
            const val = document.getElementById('pIp').value;
            if(val) {
                try { await navigator.clipboard.writeText(val); alert("✅ 中转地址已复制\\n\\n点击确定跳转检测网站..."); }
                catch(e) { alert("跳转检测网站..."); }
                fetch('?flag=log_proxy_check');
                window.open("${jsStr(proxyCheckUrl)}", "_blank");
            }
        }

        function testAutoSub() {
            const url = document.getElementById('autoSub').value.trim();
            if(url) { fetch('?flag=log_sub_test'); window.open(url, '_blank', 'noopener'); }
        }

        function testSub() {
            const url = document.getElementById('finalLink').value;
            if(url) { fetch('?flag=log_sub_test'); window.open(url); }
        }

        // 保存配置
        async function saveConfig(data, modalId) {
            try {
                const res = await fetch('?flag=save_config', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) });
                const result = await res.json();
                if (result.status !== 'ok') throw new Error(result.msg || '保存失败');
                alert('保存成功');
                if(modalId) closeModal(modalId);
                setTimeout(() => location.reload(), 500);
            } catch(e) { alert('保存失败: ' + (e.message || e)); }
        }

        // ⭐ 功能4: 保存 DLS 配置
        function saveNodeConfig() {
            const data = { ADD: val('inpAdd'), ADDAPI: val('inpAddApi'), ADDCSV: val('inpAddCsv'), DLS: val('inpDls'), ADDSUB: val('inpAddSub') };
            saveConfig(data, null);
        }

        // 📊 CF 用量仪表盘：保存配置 + 一键设置 Webhook
        function saveDash() {
            const data = { STATS_ENABLED: document.getElementById('statsEnabled').checked ? 'true' : 'false', STATS_CHAT_ID: val('statsChatId') };
            saveConfig(data, null);
        }
        async function setupWebhook() {
            if(!confirm('将把 Telegram Webhook 设置为本域名 /tg/webhook，确定？')) return;
            try {
                const res = await fetch('?flag=set_webhook', { method:'POST' });
                const d = await res.json();
                alert(d.msg || (d.success ? '设置成功' : '设置失败'));
            } catch(e) { alert('请求错误'); }
        }

        async function clearConfig(type) {
            if(!confirm('确定清除后台配置？')) return;
            let data = {};
            if(type === 'tg') data = { TG_BOT_TOKEN: "", TG_CHAT_ID: "" };
            if(type === 'cf') data = { CF_ID: "", CF_TOKEN: "", CF_EMAIL: "", CF_KEY: "" };
            saveConfig(data, type + 'Modal');
        }

        async function validateApi(type) {
            const endpoint = type === 'tg' ? 'validate_tg' : 'validate_cf';
            let payload = {};
            if(type === 'tg') {
                const t = val('tgToken'), i = val('tgId');
                if (t.startsWith('****') || i.startsWith('****')) { alert('请先输入完整的新配置值再验证'); return; }
                payload = { TG_BOT_TOKEN: t, TG_CHAT_ID: i };
            } else {
                const a=val('cfAcc'),t=val('cfTok'),m=val('cfMail'),k=val('cfKey');
                if ([a,t,m,k].some(v=>v&&v.startsWith('****'))) { alert('请先输入完整的新配置值再验证'); return; }
                payload = { CF_ID:a, CF_TOKEN:t, CF_EMAIL:m, CF_KEY:k };
            }
            try {
                const res = await fetch('?flag=' + endpoint, { method:'POST', body:JSON.stringify(payload) });
                const d = await res.json();
                alert(d.msg || (d.success ? '验证通过' : '验证失败'));
            } catch(e) { alert('请求错误'); }
        }

        function normalizeTheme(theme) {
            return theme === 'light' ? 'light' : 'dark';
        }

        function getCurrentTheme() {
            return document.body.classList.contains('light') ? 'light' : 'dark';
        }

        function syncThemeOptions(theme) {
            document.querySelectorAll('[data-theme-option]').forEach(option => {
                const selected = option.dataset.themeOption === theme;
                option.classList.toggle('selected', selected);
                const input = option.querySelector('input[name="themeChoice"]');
                if (input) input.checked = selected;
            });
        }

        function applyTheme(theme) {
            const normalized = normalizeTheme(theme);
            document.body.classList.toggle('light', normalized === 'light');
            syncThemeOptions(normalized);
            return normalized;
        }

        function readStoredTheme() {
            try {
                return normalizeTheme(localStorage.getItem(THEME_STORAGE_KEY));
            } catch(e) {
                return 'dark';
            }
        }

        function applyStoredTheme() {
            applyTheme(readStoredTheme());
        }

        function openThemeModal() {
            themeBeforePreview = getCurrentTheme();
            applyTheme(themeBeforePreview);
            showModal('themeModal');
        }

        function previewTheme(theme) {
            applyTheme(theme);
        }

        function cancelThemeSelection() {
            applyTheme(themeBeforePreview);
            closeModal('themeModal');
        }

        function saveTheme() {
            const selected = document.querySelector('input[name="themeChoice"]:checked');
            const theme = applyTheme(selected ? selected.value : getCurrentTheme());
            let persisted = true;
            try {
                localStorage.setItem(THEME_STORAGE_KEY, theme);
            } catch(e) {
                persisted = false;
            }
            themeBeforePreview = theme;
            closeModal('themeModal');
            showToast(persisted ? (theme === 'light' ? '已保存浅色主题' : '已保存深色主题') : '主题已切换，但浏览器未允许保存');
        }

        function resetTheme() {
            let persisted = true;
            try {
                localStorage.removeItem(THEME_STORAGE_KEY);
            } catch(e) {
                persisted = false;
            }
            applyTheme('dark');
            themeBeforePreview = 'dark';
            closeModal('themeModal');
            showToast(persisted ? '已恢复默认深色主题' : '已恢复深色主题，但浏览器未允许保存');
        }

        // ECH UI 控制
        function updateEchUI() {
            const on = document.getElementById('echSwitch').checked;
            document.getElementById('echDetail').style.display = on ? '' : 'none';
            document.getElementById('echLabel').textContent = on ? '已启用' : '已关闭';
            const fpEl = document.getElementById('fpDisplay');
            if (fpEl) fpEl.textContent = 'chrome';
        }
        function saveEchConfig() {
            const data = {
                ECH_ENABLED: document.getElementById('echSwitch').checked ? 'true' : 'false',
                ECH_SNI: val('echSni'),
                ECH_DNS: val('echDns')
            };
            saveConfig(data, null);
        }

        // 更新订阅链接
        function updateLink() {
            let base = document.getElementById('subDom').value.trim() || document.getElementById('hostDom').value.trim();
            let host = document.getElementById('hostDom').value.trim();
            let p = document.getElementById('pIp').value.trim();
            let isCM = document.getElementById('cMode').checked;
            const subToken = document.getElementById('subToken')?.value.trim() || '';
            let path = p ? "/proxyip=" + p : "/";
            const search = new URLSearchParams();
            search.set('uuid', UUID);
            search.set('enc'+'ryption', 'none');
            search.set('secu'+'rity', 'tls');
            search.set('sni', host);
            const _echOn = document.getElementById('echSwitch')?.checked;
            search.set('fp', 'chrome');
            search.set('allowInsecure', '0');
            search.set('type', 'ws');
            search.set('host', host);
            search.set('path', path);
            if (_echOn) { const _es = document.getElementById('echSni')?.value || 'cloudflare-ech.com'; const _ed = document.getElementById('echDns')?.value || ECH_DNS_INIT; search.set('ech', (_es ? _es + '+' : '') + _ed); }
            let finalUrl;
            if (subToken) {
                const nodeSearch = new URLSearchParams(search);
                nodeSearch.delete('uuid');
                const baseNode = \`vless://\${UUID}@\${host}:443?\${nodeSearch.toString()}#Worker\`;
                const desireSearch = new URLSearchParams(search);
                desireSearch.set('base', baseNode);
                desireSearch.set('token', subToken);
                finalUrl = \`https://\${base}/sub?\${desireSearch.toString()}\`;
            } else {
                finalUrl = \`https://\${base}/sub?\${search.toString()}\`;
            }
            if (isCM) {
                let subUrl = CONVERTER + "/sub?tar"+"get=" + ('cl'+'ash') + "&url=" + encodeURIComponent(finalUrl) + "&emo"+"ji=true&li"+"st=false&so"+"rt=false";
                document.getElementById('finalLink').value = subUrl;
            } else {
                document.getElementById('finalLink').value = finalUrl;
            }
        }

        function tgCM() { updateLink(); }

        let toastTimer = null;
        function showToast(message) {
            const toast = document.getElementById('toast');
            toast.textContent = message;
            toast.style.opacity = 1;
            if (toastTimer) clearTimeout(toastTimer);
            toastTimer = setTimeout(() => toast.style.opacity = 0, 2000);
        }

        function copyId(id) {
            const el = document.getElementById(id);
            el.select();
            navigator.clipboard.writeText(el.value).then(() => {
                showToast('已复制');
            });
        }

        function logout() {
            sessionStorage.removeItem("is_active");
            fetch('?flag=logout', { method: 'POST' }).finally(() => location.reload());
        }

        // ==================== 网络信息检测功能 ====================
        var networkPrivacyVisible = false;
        var networkInfoLoaded = false;
        var NETWORK_API_TIMEOUT_MS = 6180;
        var NETWORK_FIELD_CONFIGS = [
            { id: 'ipip-ip', type: 'ip' }, { id: 'overseas-ip', type: 'ip' },
            { id: 'cf-ip', type: 'ip' }, { id: 'twitter-ip', type: 'ip' },
            { id: 'ipip-country', type: 'location' }, { id: 'overseas-country', type: 'location' },
            { id: 'cf-country', type: 'location' }, { id: 'twitter-country', type: 'location' }
        ];
        var cloudFlareEntries = [];
        var cloudFlareActiveIndex = 0;
        var latencyTestConfig = { count: 16 };
        var latencyUIState = {};
        var latencyTestStarted = false;
        var siteLatencies = {};

        var latencySites = [
            { name: '字节抖音', region: 'domestic', icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#000000" d="M12.53.02C13.84 0 15.14.01 16.44 0c.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>', url: 'https://lf3-zlink-tos.ugurl.cn/obj/zebra-public/resource_lmmizj_1632398893.png' },
            { name: 'Bilibili', region: 'domestic', icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#FB7299" d="M17.813 4.653h.854q2.266.08 3.773 1.574Q23.946 7.72 24 9.987v7.36q-.054 2.266-1.56 3.773c-1.506 1.507-2.262 1.524-3.773 1.56H5.333q-2.266-.054-3.773-1.56C.053 19.614.036 18.858 0 17.347v-7.36q.054-2.267 1.56-3.76t3.773-1.574h.774l-1.174-1.12a1.23 1.23 0 0 1-.373-.906q0-.534.373-.907l.027-.027q.4-.373.92-.373t.92.373L9.653 4.44q.107.106.187.213h4.267a.8.8 0 0 1 .16-.213l2.853-2.747q.4-.373.92-.373c.347 0 .662.151.929.4s.391.551.391.907q0 .532-.373.906zM5.333 7.24q-1.12.027-1.88.773q-.76.748-.786 1.894v7.52q.026 1.146.786 1.893t1.88.773h13.334q1.12-.026 1.88-.773t.786-1.893v-7.52q-.026-1.147-.786-1.894t-1.88-.773zM8 11.107q.56 0 .933.373q.375.374.4.96v1.173q-.025.586-.4.96q-.373.375-.933.374c-.56-.001-.684-.125-.933-.374q-.375-.373-.4-.96V12.44q0-.56.386-.947q.387-.386.947-.386m8 0q.56 0 .933.373q.375.374.4.96v1.173q-.025.586-.4.96q-.373.375-.933.374c-.56-.001-.684-.125-.933-.374q-.375-.373-.4-.96V12.44q.025-.586.4-.96q.373-.373.933-.373"/></svg>', url: 'https://i0.hdslb.com/bfs/face/member/noface.jpg@24w_24h_1c' },
            { name: '腾讯微信', region: 'domestic', icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#09B83E" d="M8.7 2.19C3.9 2.19 0 5.48 0 9.53c0 2.21 1.17 4.2 3 5.55a.6.6 0 0 1 .21.66l-.39 1.48q-.03.11-.04.22c0 .16.13.3.29.3a.3.3 0 0 0 .16-.06l1.9-1.11a.9.9 0 0 1 .72-.1 10 10 0 0 0 2.84.4q.41-.01.81-.05a5.85 5.85 0 0 1 1.93-6.45 8.3 8.3 0 0 1 5.86-1.83c-.58-3.59-4.2-6.35-8.6-6.35m-2.9 3.8c.64 0 1.16.53 1.16 1.18a1.17 1.17 0 0 1-1.16 1.18 1.17 1.17 0 0 1-1.17-1.18c0-.65.52-1.18 1.17-1.18m5.8 0c.65 0 1.17.53 1.17 1.18a1.17 1.17 0 0 1-1.16 1.18 1.17 1.17 0 0 1-1.16-1.18c0-.65.52-1.18 1.16-1.18m5.34 2.87a8 8 0 0 0-5.28 1.78 5.5 5.5 0 0 0-1.78 6.22c.94 2.46 3.66 4.23 6.88 4.23q1.25 0 2.36-.33a.7.7 0 0 1 .6.08l1.59.93.14.04c.13 0 .24-.1.24-.24q-.01-.09-.04-.18l-.33-1.23-.02-.16a.5.5 0 0 1 .2-.4 5.8 5.8 0 0 0 2.5-4.62c0-3.21-2.93-5.84-6.66-6.09zm-2.53 3.27c.53 0 .97.44.97.98a1 1 0 0 1-.97.99 1 1 0 0 1-.97-.99c0-.54.43-.98.97-.98zm4.84 0c.54 0 .97.44.97.98a1 1 0 0 1-.97.99 1 1 0 0 1-.97-.99c0-.54.44-.98.97-.98"/></svg>', url: 'https://res.wx.qq.com/a/wx_fed/assets/res/NTI4MWU5.ico' },
            { name: '阿里淘宝', region: 'domestic', icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#FF6A00" d="M5.2 2.74c.7-.46 1.63-.26 2.1.44l2.14 3.2h5.12l2.14-3.2c.47-.7 1.4-.9 2.1-.44.7.47.9 1.4.44 2.1L17.6 7.38h2.9c.83 0 1.5.67 1.5 1.5v11.62c0 .83-.67 1.5-1.5 1.5H3.5c-.83 0-1.5-.67-1.5-1.5V8.88c0-.83.67-1.5 1.5-1.5h2.9L4.76 4.84c-.46-.7-.26-1.63.44-2.1zM4 9.88v9.62h16V9.88H4zm4.75 2.37c.41 0 .75.34.75.75v3.5c0 .41-.34.75-.75.75s-.75-.34-.75-.75V13c0-.41.34-.75.75-.75zm6.5 0c.41 0 .75.34.75.75v3.5c0 .41-.34.75-.75.75s-.75-.34-.75-.75V13c0-.41.34-.75.75-.75z"/></svg>', url: 'https://img.alicdn.com/imgextra/i2/O1CN01qnQCrN1VkzAWiU4Hs_!!6000000002692-2-tps-33-33.png' },
            { name: 'GitHub', region: 'international', icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#181717" d="M12 .3a12 12 0 0 0-3.8 23.38c.6.12.83-.26.83-.57L9 21.07c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.08-.74.09-.73.09-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.49 1 .1-.78.42-1.31.76-1.61-2.66-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.64 1.66.24 2.88.12 3.18a4.7 4.7 0 0 1 1.23 3.22c0 4.61-2.8 5.63-5.48 5.92.42.36.81 1.1.81 2.22l-.01 3.29c0 .31.2.69.82.57A12 12 0 0 0 12 .3"/></svg>', url: 'https://github.github.io/janky/images/bg_hr.png' },
            { name: 'Telegram', region: 'international', icon: '<svg width="24" height="24" viewBox="0 0 16 16"><defs><linearGradient x1="50%" y1="0%" x2="50%" y2="100%" id="tg"><stop stop-color="#38AEEB" offset="0%"/><stop stop-color="#279AD1" offset="100%"/></linearGradient></defs><circle fill="url(#tg)" cx="8" cy="8" r="8"/><path d="M3.17 7.84c2.62-1.1 4.36-1.82 5.24-2.17 2.49-.99 2.84-1.14 3.18-1.14.07 0 .25.03.39.15.12.12.16.2.17.27.01.07.01.28 0 .4-.14 1.36-.65 4.5-.95 6.03-.12.64-.37.86-.61.88-.52.05-.92-.32-1.42-.64-.79-.5-1.05-.68-1.83-1.17-.89-.56-.52-.76-.02-1.26.13-.13 2.32-2.13 2.35-2.31.03-.16.02-.18-.08-.25-.08-.07-.17-.06-.22-.05-.1.02-1.3.77-3.64 2.28-.34.23-.66.34-.94.34-.32-.01-.93-.17-1.39-.31-.56-.18-1-.27-.96-.57.02-.16.26-.32.72-.49z" fill="#FFF"/></svg>', url: 'https://web.telegram.org/k/' },
            { name: 'X.com', region: 'international', icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#000000" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>', url: 'https://abs.twimg.com/favicons/twitter.3.ico' },
            { name: 'YouTube', region: 'international', icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#FF0000" d="M23.5 6.19a3 3 0 0 0-2.12-2.14c-1.87-.5-9.38-.5-9.38-.5s-7.5 0-9.38.5A3 3 0 0 0 .5 6.19C0 8.07 0 12 0 12s0 3.93.5 5.81a3 3 0 0 0 2.12 2.14c1.87.5 9.38.5 9.38.5s7.5 0 9.38-.5a3 3 0 0 0 2.12-2.14C24 15.93 24 12 24 12s0-3.93-.5-5.81M9.55 15.57V8.43L15.82 12z"/></svg>', url: 'https://www.youtube.com/favicon.ico' }
        ];

        function setNetworkStatus(id, status) {
            var el = document.getElementById(id);
            if (el) el.className = 'status-indicator status-' + status;
        }

        function fetchWithTimeout(url, options, timeoutMs) {
            timeoutMs = timeoutMs || NETWORK_API_TIMEOUT_MS;
            options = options || {};
            var controller = new AbortController();
            var timeoutReached = false;
            var tid = setTimeout(function() { timeoutReached = true; controller.abort(); }, timeoutMs);
            return fetch(url, Object.assign({}, options, { signal: controller.signal }))
                .then(function(r) { clearTimeout(tid); return r; })
                .catch(function(e) { clearTimeout(tid); if (timeoutReached) throw new Error('timeout: ' + url); throw e; });
        }

        function createJsonpRequest(url, callbackParam, timeoutMs) {
            timeoutMs = timeoutMs || NETWORK_API_TIMEOUT_MS;
            var settled = false, tid = null, script = null, cbScope = null, cbKey = null, rejectFn = null;
            var cleanup = function() {
                if (tid) { clearTimeout(tid); tid = null; }
                if (script && script.parentNode) script.parentNode.removeChild(script);
                if (cbScope && cbKey) { try { delete cbScope[cbKey]; } catch(e) { cbScope[cbKey] = undefined; } }
            };
            var promise = new Promise(function(resolve, reject) {
                rejectFn = reject;
                var finalize = function(handler, value) { if (settled) return; settled = true; cleanup(); handler(value); };
                var cbName = '_edt_' + Date.now() + '_' + Math.floor(Math.random() * 1e16);
                if (!window.__EDT2_IP_TEST__) window.__EDT2_IP_TEST__ = {};
                cbScope = window.__EDT2_IP_TEST__;
                cbKey = cbName;
                cbScope[cbKey] = function(payload) { finalize(resolve, payload); };
                var cbPath = 'window.__EDT2_IP_TEST__.' + cbName;
                var reqUrl = new URL(url);
                reqUrl.searchParams.set(callbackParam, cbPath);
                reqUrl.searchParams.set('_t', Date.now().toString());
                script = document.createElement('script');
                script.src = reqUrl.toString();
                script.async = true;
                script.referrerPolicy = 'no-referrer';
                script.onerror = function() { finalize(reject, new Error('JSONP failed: ' + url)); };
                tid = setTimeout(function() { finalize(reject, new Error('JSONP timeout: ' + url)); }, timeoutMs);
                document.head.appendChild(script);
            });
            return { promise: promise, cancel: function() { if (!settled && rejectFn) { settled = true; cleanup(); rejectFn(new Error('cancelled')); } else { cleanup(); } } };
        }

        function maskNetworkIpValue(ip) {
            var v = String(ip || '').trim();
            if (!v || v === '未知') return v;
            if (v.includes('.') && !v.includes(':')) {
                var parts = v.split('.');
                if (parts.length === 4) return parts[0] + '.' + '*'.repeat(parts[1].length) + '.' + '*'.repeat(parts[2].length) + '.' + '*'.repeat(parts[3].length);
            }
            if (v.includes(':')) {
                var ci = v.indexOf(':');
                if (ci === -1) return v;
                var first = v.slice(0, ci);
                var rest = v.slice(ci + 1);
                return first + ':' + rest.replace(/[^:]/g, '*');
            }
            return v.length <= 2 ? '*'.repeat(Math.max(2, v.length)) : v.slice(0, 2) + '*'.repeat(v.length - 2);
        }

        function maskNetworkLocationValue(loc) {
            var v = String(loc || '').trim();
            if (!v || v === '未知') return v;
            var tokens = v.split(' ').filter(Boolean);
            if (!tokens.length) return v;
            return tokens.map(function(token, index) {
                if (index === 0 && /^[a-zA-Z]{2}$/.test(token)) return token.toUpperCase();
                return '*'.repeat(Math.max(2, token.length));
            }).join(' ');
        }

        function stopNetworkFieldAnimation(el) {
            if (!el) return;
            if (el._privacyAnimFrame) { cancelAnimationFrame(el._privacyAnimFrame); el._privacyAnimFrame = null; }
        }

        function animateNetworkFieldDisplay(el, targetText, durationMs) {
            if (!el) return;
            durationMs = durationMs || 160;
            stopNetworkFieldAnimation(el);
            var fromText = String(el.textContent || '');
            var toText = String(targetText || '');
            if (fromText === toText) { el.textContent = toText; return; }
            var maxLen = Math.max(fromText.length, toText.length);
            var fromChars = fromText.padEnd(maxLen, ' ').split('');
            var toChars = toText.padEnd(maxLen, ' ').split('');
            var diffIndexes = [];
            for (var i = 0; i < maxLen; i++) { if (fromChars[i] !== toChars[i]) diffIndexes.push(i); }
            if (!diffIndexes.length) { el.textContent = toText; return; }
            var startTime = performance.now();
            var frame = function(now) {
                var progress = Math.min((now - startTime) / durationMs, 1);
                var changedCount = Math.floor(progress * diffIndexes.length);
                var currentChars = fromChars.slice();
                for (var j = 0; j < changedCount; j++) { currentChars[diffIndexes[j]] = toChars[diffIndexes[j]]; }
                el.textContent = currentChars.join('').trimEnd();
                if (progress < 1) { el._privacyAnimFrame = requestAnimationFrame(frame); }
                else { el._privacyAnimFrame = null; el.textContent = toText; }
            };
            el._privacyAnimFrame = requestAnimationFrame(frame);
        }

        function renderNetworkFieldDisplay(el, options) {
            if (!el) return;
            if (el.dataset.displayState !== 'ready') return;
            var animate = options && options.animate;
            var rawValue = String(el.dataset.rawValue || '').trim();
            var maskType = el.dataset.maskType || 'location';
            if (!rawValue) { stopNetworkFieldAnimation(el); el.textContent = ''; return; }
            var displayValue = rawValue;
            if (!networkPrivacyVisible) {
                displayValue = maskType === 'ip' ? maskNetworkIpValue(rawValue) : maskNetworkLocationValue(rawValue);
            }
            if (animate) { animateNetworkFieldDisplay(el, displayValue); }
            else { stopNetworkFieldAnimation(el); el.textContent = displayValue; }
        }

        function setNetworkFieldValue(id, rawValue, maskType) {
            var el = document.getElementById(id);
            if (!el) return;
            el.dataset.rawValue = String(rawValue || '').trim();
            el.dataset.maskType = maskType;
            el.dataset.displayState = 'ready';
            renderNetworkFieldDisplay(el);
            if (maskType === 'ip') makeIpClickable();
        }

        function setNetworkFieldError(id, errorText) {
            var el = document.getElementById(id);
            if (!el) return;
            stopNetworkFieldAnimation(el);
            el.dataset.rawValue = '';
            el.dataset.displayState = 'error';
            el.classList.remove('clickable', 'is-loading');
            el.removeAttribute('title');
            el.innerHTML = '<span class="error">' + errorText + '</span>';
        }

        function clearNetworkFieldValue(id) {
            var el = document.getElementById(id);
            if (!el) return;
            stopNetworkFieldAnimation(el);
            el.dataset.rawValue = '';
            el.dataset.displayState = 'empty';
            el.classList.remove('clickable', 'is-loading');
            el.removeAttribute('title');
            el.textContent = '';
        }

        function refreshAllNetworkFieldDisplays(animate) {
            NETWORK_FIELD_CONFIGS.forEach(function(cfg) {
                var el = document.getElementById(cfg.id);
                renderNetworkFieldDisplay(el, { animate: !!animate });
            });
            applyNetworkCardFlag('ipip-country');
            applyNetworkCardFlag('overseas-country');
            applyNetworkCardFlag('cf-country');
            applyNetworkCardFlag('twitter-country');
        }

        function toggleNetworkPrivacy(event) {
            if (event) event.stopPropagation();
            networkPrivacyVisible = !networkPrivacyVisible;
            refreshAllNetworkFieldDisplays(true);
        }

        function bindNetworkCardPrivacyToggle() {
            document.querySelectorAll('.network-card').forEach(function(card) {
                if (card.dataset.privacyToggleBound === '1') return;
                card.dataset.privacyToggleBound = '1';
                card.title = '点击卡片可显示/隐藏真实IP和地址';
                card.addEventListener('click', toggleNetworkPrivacy);
            });
        }

        function applyNetworkCardFlag(countryElementId) {
            var el = document.getElementById(countryElementId);
            if (!el) return;
            var card = el.closest('.network-card');
            if (!card) return;
            var text = String(el.dataset.rawValue || el.textContent || '').trim();
            var m = text.match(/(?:^|[^a-zA-Z])([a-zA-Z]{2})(?:[^a-zA-Z]|$)/);
            var code = m ? m[1].toLowerCase() : '';
            if (!code) { card.classList.remove('has-flag-badge'); card.style.removeProperty('--flag-badge-url'); return; }
            card.style.setProperty('--flag-badge-url', 'url("https://ipdata.co/flags/' + code + '.png")');
            card.classList.add('has-flag-badge');
        }

        function detectIpVersion(ip) { var v = String(ip || '').trim(); if (!v) return ''; return v.includes(':') ? 'v6' : 'v4'; }
        function getCloudFlareProxyLabel(ver, full) { if (ver === 'v4') return full ? 'ProxyIPv4' : 'v4'; if (ver === 'v6') return full ? 'ProxyIPv6' : 'v6'; return full ? 'ProxyIP' : 'IP'; }

        function renderCloudFlareSubtitle() {
            var el = document.getElementById('cf-subtitle');
            if (!el || cloudFlareEntries.length === 0) return;
            var html = '';
            cloudFlareEntries.forEach(function(entry, i) {
                var ver = detectIpVersion(entry.ip);
                var cls = ver === 'v6' ? 'cf-subtitle-v6' : 'cf-subtitle-v4';
                if (i === cloudFlareActiveIndex) {
                    html += '<span class="' + cls + '">' + getCloudFlareProxyLabel(ver, true) + '</span>';
                } else {
                    if (html) html += '<span class="cf-subtitle-sep"> / </span>';
                    html += '<span class="' + cls + ' cf-subtitle-switch" data-cf-idx="' + i + '" role="button" tabindex="0" title="点击切换出口IP">' + getCloudFlareProxyLabel(ver, false) + '</span>';
                }
                if (i === cloudFlareActiveIndex && i < cloudFlareEntries.length - 1) html += '<span class="cf-subtitle-sep"> / </span>';
            });
            el.innerHTML = html;
            el.querySelectorAll('.cf-subtitle-switch').forEach(function(sw) {
                sw.addEventListener('click', function(e) {
                    e.stopPropagation();
                    cloudFlareActiveIndex = parseInt(sw.dataset.cfIdx);
                    renderCloudFlareActiveEntry();
                });
            });
        }

        function renderCloudFlareActiveEntry() {
            if (cloudFlareEntries.length === 0) return;
            var entry = cloudFlareEntries[cloudFlareActiveIndex];
            setNetworkFieldValue('cf-ip', entry.ip, 'ip');
            setNetworkFieldValue('cf-country', entry.loc || '未知', 'location');
            applyNetworkCardFlag('cf-country');
            renderCloudFlareSubtitle();
        }

        function fetchIpInfoByIp(ip) {
            var requestIp = String(ip || '').trim();
            if (!requestIp) return Promise.reject(new Error('missing ip'));
            var apis = [
                { name: 'cm-eo', url: 'https://api.cmliussss.net/api/ipinfo?ip=' + encodeURIComponent(requestIp) },
                { name: 'cm-cf', url: 'https://cf.090227.xyz/api/ipsb?ip=' + encodeURIComponent(requestIp) }
            ];
            var tasks = apis.map(function(api) {
                return fetchWithTimeout(api.url, { cache: 'no-store' }).then(function(res) {
                    if (!res.ok) throw new Error(api.name + ' HTTP ' + res.status);
                    return res.json();
                }).then(function(data) {
                    if (!data || typeof data !== 'object') throw new Error(api.name + ' invalid');
                    return data;
                });
            });
            return Promise.any(tasks);
        }

        function formatIpInfoLocation(info) {
            var cc = String((info && info.country_code) || '未知').trim() || '未知';
            var rawAsn = info && info.asn;
            var asnText = (rawAsn === undefined || rawAsn === null) ? '' : (/^[0-9]+$/.test(String(rawAsn).trim()) ? 'AS' + String(rawAsn).trim() : String(rawAsn).trim());
            var asnName = String((info && (info.as_name || info.asn_organization || info.organization || info.isp)) || '').trim();
            return (cc + ' ' + asnText + ' ' + asnName).trim() || '未知';
        }

        async function fetchIpipData() {
            setNetworkStatus('status-ipip', 'loading');
            var statusEl = document.querySelector('#status-ipip');
            var titleEl = statusEl ? statusEl.parentElement : null;
            var testSources = [
                { type: 'head', name: '字节跳动', url: 'https://perfops2.byte-test.com/500b-bench.jpg', ipHeader: 'X-Request-Ip' },
                { type: 'head', name: '字节跳动', url: 'https://perfops.byte-test.com', ipHeader: 'X-Request-Ip' },
                { type: 'head', name: '网易科技', url: 'https://necaptcha.nosdn.127.net/ab7f4275c1744aa28e0a8f3a1c58c532.png', ipHeader: 'cdn-user-ip' },
                { type: 'jsonp', name: '腾讯新闻', url: 'https://r.inews.qq.com/api/ip2city?otype=jsonp', cbParam: 'callback', extractIp: function(p) { return p && p.ip; } },
                { type: 'jsonp', name: '太平洋科技', url: 'https://whois.pconline.com.cn/ipJson.jsp', cbParam: 'callback', extractIp: function(p) { return p && p.ip; } },
                { type: 'jsonp', name: '阿里巴巴', url: 'https://' + Date.now() + '.dns-detect.alicdn.com/api/detect/DescribeDNSLookup', cbParam: 'cb', extractIp: function(p) { return p && p.content && p.content.localIp; } }
            ];
            var tasks = testSources.map(function(src) {
                if (src.type === 'jsonp') {
                    var j = createJsonpRequest(src.url, src.cbParam);
                    return { cancel: j.cancel, promise: j.promise.then(function(payload) {
                        var ip = String((src.extractIp(payload)) || '').trim();
                        if (!ip) throw new Error(src.url + ' missing jsonp ip');
                        return { source: src.url, requestIp: ip, providerName: src.name };
                    })};
                }
                var ctrl = new AbortController();
                return { cancel: function() { ctrl.abort(); }, promise: (async function() {
                    var url = src.url + (src.url.includes('?') ? '&' : '?') + '_t=' + Date.now();
                    var res = await fetchWithTimeout(url, { method: 'HEAD', cache: 'no-store', signal: ctrl.signal });
                    if (!res.ok) throw new Error(src.url + ' HTTP ' + res.status);
                    var ip = String(res.headers.get(src.ipHeader) || '').trim();
                    if (!ip) throw new Error(src.url + ' missing ' + src.ipHeader);
                    return { source: src.url, requestIp: ip, providerName: src.name };
                })()};
            });
            var fastest;
            try { fastest = await Promise.any(tasks.map(function(t) { return t.promise; })); }
            catch(e) { tasks.forEach(function(t) { if (t.cancel) t.cancel(); }); setNetworkFieldError('ipip-ip', '加载失败'); clearNetworkFieldValue('ipip-country'); applyNetworkCardFlag('ipip-country'); setNetworkStatus('status-ipip', 'error'); return; }
            tasks.forEach(function(t) { if (t.cancel) t.cancel(); });
            setNetworkFieldValue('ipip-ip', fastest.requestIp, 'ip');
            clearNetworkFieldValue('ipip-country');
            if (titleEl) { titleEl.innerHTML = '<span class="status-indicator" id="status-ipip"></span><div class="title-text"><div class="title-main">国内测试</div><div class="title-subtitle">' + fastest.providerName + '</div></div>'; setNetworkStatus('status-ipip', 'loading'); }
            try {
                var info = await fetchIpInfoByIp(fastest.requestIp);
                var ip = String((info && info.ip) || fastest.requestIp || '未知').trim();
                var location = formatIpInfoLocation(info);
                setNetworkFieldValue('ipip-ip', ip, 'ip');
                setNetworkFieldValue('ipip-country', location || '未知', 'location');
                applyNetworkCardFlag('ipip-country');
                setNetworkStatus('status-ipip', 'success');
            } catch(e) { setNetworkFieldValue('ipip-country', '未知', 'location'); applyNetworkCardFlag('ipip-country'); setNetworkStatus('status-ipip', 'success'); }
        }

        async function fetchOverseasTestData() {
            setNetworkStatus('status-overseas', 'loading');
            var apis = [
                { url: 'https://api.cmliussss.net/api/ipinfo?_t=' + Date.now(), parse: function(d) { return { ip: d.ip || '', loc: ((d.country_code || '未知') + ' ' + (d.asn || '') + ' ' + (d.as_name || '')).trim() }; } },
                { url: 'https://api.ipapi.is', parse: function(d) { return { ip: d.ip || '', loc: (((d.location && d.location.country_code) || '未知') + ' AS' + ((d.asn && d.asn.asn) || '') + ' ' + ((d.asn && d.asn.org) || '')).trim() }; } }
            ];
            for (var i = 0; i < apis.length; i++) {
                try {
                    var res = await fetchWithTimeout(apis[i].url);
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    var parsed = apis[i].parse(await res.json());
                    if (!parsed.ip) throw new Error('Missing IP');
                    setNetworkFieldValue('overseas-ip', parsed.ip, 'ip');
                    setNetworkFieldValue('overseas-country', parsed.loc || '未知', 'location');
                    applyNetworkCardFlag('overseas-country');
                    setNetworkStatus('status-overseas', 'success');
                    return;
                } catch(e) {}
            }
            setNetworkFieldError('overseas-ip', '加载失败');
            clearNetworkFieldValue('overseas-country');
            setNetworkStatus('status-overseas', 'error');
        }

        async function fetchCloudFlareData() {
            setNetworkStatus('status-cf', 'loading');
            var urls = ['https://ipv4.090227.xyz', 'https://ipv6.090227.xyz', 'https://api.090227.xyz'];
            try {
                var results = await Promise.allSettled(urls.map(function(u) {
                    return fetch(u + '?_t=' + Date.now()).then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
                }));
                var seen = {};
                cloudFlareEntries = [];
                results.forEach(function(r) {
                    if (r.status === 'fulfilled' && r.value && r.value.ip) {
                        var d = r.value;
                        if (!seen[d.ip]) {
                            seen[d.ip] = true;
                            cloudFlareEntries.push({ ip: d.ip, version: detectIpVersion(d.ip), loc: ((d.country || '') + ' ' + (d.org || '')).trim() || '未知' });
                        }
                    }
                });
                cloudFlareEntries.sort(function(a, b) { return (a.version === 'v4' ? 0 : 1) - (b.version === 'v4' ? 0 : 1); });
                if (cloudFlareEntries.length === 0) throw new Error('No CF IP');
                cloudFlareActiveIndex = 0;
                renderCloudFlareActiveEntry();
                setNetworkStatus('status-cf', 'success');
            } catch(e) {
                setNetworkFieldError('cf-ip', '加载失败');
                clearNetworkFieldValue('cf-country');
                setNetworkStatus('status-cf', 'error');
            }
        }

        async function fetchTwitterData() {
            setNetworkStatus('status-twitter', 'loading');
            var subtitleEl = document.getElementById('twitter-subtitle');
            try {
                var res = await fetch('https://jsonp-ip.appspot.com/?callback=cb&_t=' + Date.now());
                if (res.ok) {
                    var text = await res.text();
                    var m = text.match(/cb\((.+)\)/);
                    if (m) {
                        var d = JSON.parse(m[1]);
                        if (d.ip) {
                            if (subtitleEl) subtitleEl.textContent = '谷歌(Google)';
                            setNetworkFieldValue('twitter-ip', d.ip, 'ip');
                            setNetworkFieldValue('twitter-country', (d.country || d.loc || '未知'), 'location');
                            applyNetworkCardFlag('twitter-country');
                            setNetworkStatus('status-twitter', 'success');
                            return;
                        }
                    }
                }
            } catch(e) {}
            try {
                var res2 = await fetch('https://help.x.com/cdn-cgi/trace?_t=' + Date.now());
                if (!res2.ok) throw new Error('HTTP ' + res2.status);
                var text2 = await res2.text();
                var data = {};
                text2.split('\\n').forEach(function(line) { var kv = line.split('='); if (kv[0] && kv[1]) data[kv[0].trim()] = kv[1].trim(); });
                if (!data.ip) throw new Error('Missing IP');
                if (subtitleEl) subtitleEl.textContent = '推特(X.com)';
                setNetworkFieldValue('twitter-ip', data.ip, 'ip');
                setNetworkFieldValue('twitter-country', ((data.loc || '') + ' ' + (data.colo || '')).trim() || '未知', 'location');
                applyNetworkCardFlag('twitter-country');
                setNetworkStatus('status-twitter', 'success');
            } catch(e) {
                setNetworkFieldError('twitter-ip', '加载失败');
                clearNetworkFieldValue('twitter-country');
                setNetworkStatus('status-twitter', 'error');
            }
        }

        function makeIpClickable() {
            document.querySelectorAll('.ip-text').forEach(function(el) {
                if (el.dataset.clickBound) return;
                if (el.dataset.displayState !== 'ready') return;
                el.dataset.clickBound = 'true';
                el.classList.add('clickable');
                el.title = '点击查询IP详细信息';
                el.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var ip = (el.dataset.rawValue || el.textContent || '').trim();
                    if (!ip || ip === '加载中...' || ip.includes('加载失败')) return;
                    showIpDetail(ip, el);
                });
            });
        }

        async function showIpDetail(ip, triggerEl) {
            if (triggerEl) { triggerEl.classList.add('is-loading'); }
            var popup = document.createElement('div');
            popup.className = 'ip-detail-popup';
            popup.innerHTML = '<div class="ip-detail-content"><h3>IP 详情查询中...</h3><div style="color:var(--text-dim);margin:10px 0">正在查询 ' + ip + '</div><button class="ip-detail-close">关闭</button></div>';
            document.body.appendChild(popup);
            popup.addEventListener('click', function(e) { if (e.target === popup || e.target.classList.contains('ip-detail-close')) popup.remove(); });
            try {
                var res = await fetch('https://api.ipapi.is/?q=' + encodeURIComponent(ip));
                if (!res.ok) throw new Error('HTTP ' + res.status);
                var d = await res.json();
                var ipType = d.is_datacenter ? 'hosting' : ((d.company && d.company.type === 'business') ? 'business' : 'residential');
                var typeLabel = ipType === 'hosting' ? '数据中心' : (ipType === 'business' ? '商业' : '住宅');
                var ts = d.threat_score || d.fraud_score || 0;
                var tc = ts > 70 ? 'badge-danger' : (ts > 40 ? 'badge-warning' : 'badge-success');
                var rows = '';
                rows += '<div class="ip-detail-row"><span class="label">IP 地址</span><span class="value">' + (d.ip || ip) + '</span></div>';
                rows += '<div class="ip-detail-row"><span class="label">国家/地区</span><span class="value">' + (d.location ? ((d.location.country || '') + ' ' + (d.location.city || '')).trim() : '未知') + '</span></div>';
                if (d.location && d.location.timezone) rows += '<div class="ip-detail-row"><span class="label">时区</span><span class="value">' + d.location.timezone + '</span></div>';
                rows += '<div class="ip-detail-row"><span class="label">ASN</span><span class="value">AS' + (d.asn ? d.asn.asn : '?') + ' ' + (d.asn ? d.asn.org : '') + '</span></div>';
                rows += '<div class="ip-detail-row"><span class="label">IP 类型</span><span class="value ip-type-' + ipType + '">' + typeLabel + '</span></div>';
                if (d.company) rows += '<div class="ip-detail-row"><span class="label">运营商</span><span class="value">' + (d.company.name || '未知') + '</span></div>';
                rows += '<div class="ip-detail-row"><span class="label">威胁评分</span><span class="value ' + tc + '">' + ts + '/100</span></div>';
                var checks = [['数据中心', d.is_datacenter], ['代理', d.is_proxy], ['VPN', d.is_vpn], ['Tor', d.is_tor], ['爬虫', d.is_crawler], ['移动网络', d.is_mobile], ['已知滥用', d.is_abuser]];
                var flagged = checks.filter(function(c) { return c[1]; });
                if (flagged.length > 0) { rows += '<div class="ip-detail-row"><span class="label">安全标记</span><span class="value badge-warning">' + flagged.map(function(c) { return c[0]; }).join(' / ') + '</span></div>'; }
                else { rows += '<div class="ip-detail-row"><span class="label">安全标记</span><span class="value badge-success">无风险标记</span></div>'; }
                popup.querySelector('.ip-detail-content').innerHTML = '<h3>IP 详情</h3>' + rows + '<button class="ip-detail-close">关闭</button>';
                popup.querySelector('.ip-detail-close').addEventListener('click', function() { popup.remove(); });
            } catch(err) {
                popup.querySelector('.ip-detail-content').innerHTML = '<h3>查询失败</h3><div style="color:var(--danger);margin:10px 0">' + err.message + '</div><button class="ip-detail-close">关闭</button>';
                popup.querySelector('.ip-detail-close').addEventListener('click', function() { popup.remove(); });
            } finally {
                if (triggerEl) { triggerEl.classList.remove('is-loading'); }
            }
        }

        function getLatencyColor(latency) { if (latency === -1) return 'var(--latency-999)'; if (latency <= 49) return 'var(--latency-49)'; if (latency <= 149) return 'var(--latency-149)'; if (latency <= 299) return 'var(--latency-299)'; if (latency <= 999) return 'var(--latency-999)'; return 'var(--latency-1000)'; }

        async function testLatency(url) {
            var start = Date.now();
            try { await fetch(url + '?t=' + Date.now(), { method: 'HEAD', cache: 'no-cache', mode: 'no-cors' }); return Date.now() - start; }
            catch(e) { return -1; }
        }

        function generateLatencyCards() {
            var container = document.getElementById('latency-cards');
            if (!container) return;
            container.innerHTML = '';
            latencySites.forEach(function(site) {
                var siteName = site.name.toLowerCase().split(' ').join('-');
                var regionText = site.region === 'domestic' ? '国内' : '国际';
                var card = document.createElement('div');
                card.className = 'latency-card';
                card.dataset.region = site.region;
                card.innerHTML = '<div class="latency-card-header"><div class="latency-card-info"><div class="latency-card-icon-wrapper" data-site="' + siteName + '">' + site.icon + '</div><div class="latency-card-text"><span class="latency-card-name">' + site.name + '</span><span class="latency-card-region" data-region="' + regionText + '">' + regionText + '</span></div></div><div class="latency-status" id="latency-' + siteName + '">...<span class="unit">ms</span></div></div><div class="latency-graph-container"><div class="graph-grid"></div><svg class="latency-ecg" viewBox="0 0 400 60" preserveAspectRatio="none"><path class="ecg-path-bg" d="M0,30 L400,30"></path><path class="ecg-path" id="path-' + siteName + '" d="M0,30 L400,30"></path><circle class="ecg-cursor" id="cursor-' + siteName + '" r="3" cx="0" cy="30" style="display:none"></circle></svg></div>';
                container.appendChild(card);
            });
        }

        function updateLatencyDisplay(siteName, latencies) {
            var valueEl = document.getElementById('latency-' + siteName);
            var pathEl = document.getElementById('path-' + siteName);
            var cursorEl = document.getElementById('cursor-' + siteName);
            if (!valueEl || !pathEl) return;
            var lastLatency = latencies[latencies.length - 1];
            var validLatencies = latencies.filter(function(l) { return l !== -1; });
            var avgLatency = -1;
            if (validLatencies.length > 0) {
                if (validLatencies.length > 5) {
                    var sorted = validLatencies.slice().sort(function(a, b) { return a - b; });
                    var trimmed = sorted.slice(1, -1);
                    avgLatency = trimmed.reduce(function(a, b) { return a + b; }, 0) / trimmed.length;
                } else { avgLatency = validLatencies.reduce(function(a, b) { return a + b; }, 0) / validLatencies.length; }
            }
            var targetValue = Math.round(avgLatency);
            if (validLatencies.length === 0) {
                if (lastLatency === -1) { valueEl.innerHTML = 'TIMEOUT'; valueEl.style.color = 'var(--latency-999)'; }
                else { valueEl.innerHTML = '...<span class="unit">ms</span>'; valueEl.style.color = 'var(--glass-cyan)'; }
            } else {
                var siteState = latencyUIState[siteName] || { current: targetValue, timer: null };
                latencyUIState[siteName] = siteState;
                var avgColor = getLatencyColor(targetValue);
                valueEl.style.color = avgColor;
                if (Math.abs(siteState.current - targetValue) < 2) { siteState.current = targetValue; valueEl.innerHTML = targetValue + '<span class="unit">ms</span>'; }
                else {
                    if (siteState.timer) clearInterval(siteState.timer);
                    var step = function() {
                        if (siteState.current < targetValue) siteState.current += Math.ceil((targetValue - siteState.current) / 5);
                        else if (siteState.current > targetValue) siteState.current -= Math.ceil((siteState.current - targetValue) / 5);
                        valueEl.innerHTML = siteState.current + '<span class="unit">ms</span>';
                        if (siteState.current === targetValue) { clearInterval(siteState.timer); siteState.timer = null; }
                    };
                    siteState.timer = setInterval(step, 30);
                }
            }
            var width = 400, height = 60, padding = 10;
            var stepX = width / (latencyTestConfig.count - 1);
            var points = [];
            latencies.forEach(function(l, i) {
                var x = i * stepX;
                var y = l === -1 ? height - 5 : height - padding - (Math.min(l, 500) / 500 * (height - 2 * padding));
                points.push({ x: x, y: y });
            });
            if (points.length > 0) {
                var d = 'M' + points[0].x + ',' + points[0].y;
                for (var i = 0; i < points.length - 1; i++) {
                    var xm = (points[i].x + points[i+1].x) / 2;
                    var ym = (points[i].y + points[i+1].y) / 2;
                    d += ' Q' + points[i].x + ',' + points[i].y + ' ' + xm + ',' + ym;
                }
                var lp = points[points.length - 1];
                d += ' L' + lp.x + ',' + lp.y;
                pathEl.setAttribute('d', d);
                var avgColor2 = getLatencyColor(targetValue);
                pathEl.style.stroke = avgColor2;
                if (cursorEl) { cursorEl.style.display = 'block'; cursorEl.setAttribute('cx', lp.x); cursorEl.setAttribute('cy', lp.y); cursorEl.style.fill = avgColor2; }
            }
        }

        function startLatencyTest() {
            if (latencyTestStarted) return;
            latencyTestStarted = true;
            latencySites.forEach(function(site) { var sn = site.name.toLowerCase().split(' ').join('-'); siteLatencies[sn] = []; });
            (async function() {
                var initialPromises = latencySites.map(async function(site) {
                    var sn = site.name.toLowerCase().split(' ').join('-');
                    for (var i = 0; i < latencyTestConfig.count; i++) {
                        var latency = await testLatency(site.url);
                        siteLatencies[sn].push(latency);
                        updateLatencyDisplay(sn, siteLatencies[sn]);
                        if (i < latencyTestConfig.count - 1) await new Promise(function(r) { setTimeout(r, 0); });
                    }
                });
                await Promise.all(initialPromises);
                _latencyTimer = setInterval(async function() {
                    var ups = latencySites.map(async function(site) {
                        var sn = site.name.toLowerCase().split(' ').join('-');
                        var latency = await testLatency(site.url);
                        siteLatencies[sn].push(latency);
                        if (siteLatencies[sn].length > latencyTestConfig.count) siteLatencies[sn].shift();
                        updateLatencyDisplay(sn, siteLatencies[sn]);
                    });
                    await Promise.all(ups);
                }, 1800);
            })();
        }

        function stopLatencyTest() {
            if (_latencyTimer) { clearInterval(_latencyTimer); _latencyTimer = null; }
            latencyTestStarted = false;
        }

        function loadNetworkInfo() {
            generateLatencyCards();
            bindNetworkCardPrivacyToggle();
            fetchIpipData();
            fetchOverseasTestData();
            fetchCloudFlareData();
            fetchTwitterData();
            setTimeout(makeIpClickable, 500);
        }



        function showECHHelp() {
            var modal = document.getElementById('echHelpModal');
            modal.style.display = 'flex';
            switchEchTab(0);
        }
        function switchEchTab(idx) {
            var btns = document.querySelectorAll('.ech-tab-btn');
            for (var i = 0; i < btns.length; i++) {
                btns[i].style.background = i === idx ? 'var(--glass-blue,#2563eb)' : 'transparent';
                btns[i].style.color = i === idx ? '#fff' : 'var(--text-dim,#888)';
            }
            for (var j = 0; j < 3; j++) {
                var pane = document.getElementById('echPane' + j);
                if (pane) pane.style.display = j === idx ? 'block' : 'none';
            }
        }

        // 初始化（控制台面板默认显示）
        updateStats();
        loadWhitelist();
        updateLink();
    </script>

    <!-- ECH 帮助弹窗 -->
    <div id="echHelpModal" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:10000;align-items:center;justify-content:center;backdrop-filter:blur(4px)" onclick="if(event.target===this)this.style.display='none'">
        <div style="background:var(--card-bg,#1a1a2e);border:1px solid var(--border,#333);border-radius:16px;padding:24px;max-width:800px;width:90%;max-height:85vh;overflow-y:auto;color:var(--text,#fff);position:relative" onclick="event.stopPropagation()">
            <button onclick="document.getElementById('echHelpModal').style.display='none'" style="position:absolute;top:12px;right:16px;background:none;border:none;color:var(--text-dim,#888);font-size:1.5rem;cursor:pointer;line-height:1">&times;</button>
            <div style="display:flex;gap:8px;margin-bottom:20px;overflow-x:auto;padding-bottom:4px" id="echTabs">
                <button class="ech-tab-btn active" onclick="switchEchTab(0)" style="padding:8px 16px;border-radius:8px;border:1px solid var(--border,#333);background:var(--glass-blue,#2563eb);color:#fff;cursor:pointer;white-space:nowrap;font-size:0.85rem">什么是ECH？</button>
                <button class="ech-tab-btn" onclick="switchEchTab(1)" style="padding:8px 16px;border-radius:8px;border:1px solid var(--border,#333);background:transparent;color:var(--text-dim,#888);cursor:pointer;white-space:nowrap;font-size:0.85rem">如何使用？</button>
                <button class="ech-tab-btn" onclick="switchEchTab(2)" style="padding:8px 16px;border-radius:8px;border:1px solid var(--border,#333);background:transparent;color:var(--text-dim,#888);cursor:pointer;white-space:nowrap;font-size:0.85rem">如何验证？</button>
            </div>
            <div id="echPane0">
                <h2 style="font-size:1.2rem;margin-bottom:16px">🔐 什么是 ECH？</h2>
                <p style="margin-bottom:14px;line-height:1.8;color:var(--text-dim,#aaa)"><b>ECH（Encrypted Client Hello，加密客户端问候）</b>是 TLS 的一项新特性，用来<b>将原本会明文暴露的域名信息一起加密</b>。</p>
                <p style="margin-bottom:14px;line-height:1.8;color:var(--text-dim,#aaa)">技术细节可参考 Cloudflare 官方博客：<br><a href="https://blog.cloudflare.com/zh-cn/announcing-encrypted-client-hello/" target="_blank" rel="noopener" style="color:var(--glass-blue,#60a5fa)">https://blog.cloudflare.com/zh-cn/announcing-encrypted-client-hello/</a></p>
                <h3 style="margin:20px 0 12px">📖 背景说明</h3>
                <p style="margin-bottom:14px;line-height:1.8;color:var(--text-dim,#aaa)">当我们使用 <b>WS + TLS</b> 的节点进行代理时：</p>
                <ul style="margin:10px 0 14px;padding-left:20px;line-height:1.8;color:var(--text-dim,#aaa)">
                    <li style="margin-bottom:6px">✅ 实际通信内容已经被 TLS 加密，GFW <b>无法看到你访问的具体内容</b></li>
                    <li>❌ 但在 TLS 握手阶段，仍然会暴露一个关键信息：<b>SNI</b></li>
                </ul>
                <p style="margin-bottom:14px;line-height:1.8;color:var(--text-dim,#aaa)"><b>SNI 就是节点的伪装域名（HOST）</b></p>
                <div style="background:rgba(255,243,205,0.1);border-left:3px solid #ffc107;padding:10px 14px;border-radius:6px;margin-bottom:14px;color:#ffd93d;font-size:0.9rem">GFW 虽然不知道你在访问什么，但知道你在"扶墙"，并且知道你连接的是哪个域名。</div>
                <h3 style="margin:20px 0 12px">⚠️ 会带来什么问题？</h3>
                <p style="margin-bottom:10px;line-height:1.8;color:var(--text-dim,#aaa)">这就是为什么经常出现：</p>
                <ul style="margin:10px 0 14px;padding-left:20px;line-height:1.8;color:var(--text-dim,#aaa)">
                    <li style="margin-bottom:6px">❌ v2r&#97;yN 批量测试真链接延迟</li>
                    <li>❌ Cl&#97;sh 策略组自动选择节点</li>
                </ul>
                <div style="background:rgba(248,215,218,0.1);border-left:3px solid #dc3545;padding:10px 14px;border-radius:6px;margin-bottom:14px;color:#ff6b6b;font-size:0.9rem">所有节点瞬间 -1，全部无法使用</div>
                <p style="margin-bottom:14px;line-height:1.8;color:var(--text-dim,#aaa)">原因并不是节点真的失效，而是<b>运营商/GFW 通过阻断节点域名的访问来干扰代理连接</b>。由于这种阻断大多是自动化策略，容易误判，因此<b>过一段时间节点又可能恢复正常</b>，反复循环。</p>
                <h3 style="margin:20px 0 12px">💡 ECH 的作用</h3>
                <div style="background:rgba(209,236,241,0.1);border-left:3px solid #17a2b8;padding:10px 14px;border-radius:6px;margin-bottom:14px;color:var(--glass-cyan,#22d3ee);font-size:0.9rem">将 SNI（也就是节点域名）加密</div>
                <p style="margin-bottom:10px;line-height:1.8;color:var(--text-dim,#aaa)">启用 ECH 后：</p>
                <ul style="margin:10px 0 14px;padding-left:20px;line-height:1.8;color:var(--text-dim,#aaa)">
                    <li style="margin-bottom:6px">✅ GFW <b>无法获取真实的节点域名</b></li>
                    <li>✅ 外部观察到的域名将统一显示为：<code style="background:rgba(255,255,255,0.1);padding:2px 6px;border-radius:3px">cloudflare-ech.com</code></li>
                </ul>
                <p style="margin-bottom:14px;line-height:1.8;color:var(--text-dim,#aaa)">这从源头上<b>阻断了通过域名精准封锁节点的手段</b>。</p>
                <h3 style="margin:20px 0 12px">🤔 ECH 会不会被封？</h3>
                <p style="margin-bottom:10px;line-height:1.8;color:var(--text-dim,#aaa)">理论上，GFW 只需<b>直接阻断 cloudflare-ech.com</b> 即可。但这样会：</p>
                <ul style="margin:10px 0 14px;padding-left:20px;line-height:1.8;color:var(--text-dim,#aaa)">
                    <li style="margin-bottom:6px">❌ 误伤大量正常使用 ECH 的网站和服务</li>
                    <li>❌ 带来较高的封锁成本和副作用</li>
                </ul>
                <p style="line-height:1.8;color:var(--text-dim,#aaa)"><b>ECH 能持续多久，取决于 GFW 的取舍与策略</b>，至少在目前阶段仍然非常有效。</p>
            </div>
            <div id="echPane1" style="display:none">
                <h2 style="font-size:1.2rem;margin-bottom:16px">🚀 如何使用 ECH？</h2>
                <p style="margin-bottom:14px;line-height:1.8;color:var(--text-dim,#aaa)">使用 ECH 非常简单，只需要将 <b>ECH 开关</b> 设为 <b>开启</b> 后更新订阅即可。</p>
                <h3 style="margin:20px 0 12px">📱 支持 ECH 的客户端</h3>
                <h4 style="margin:16px 0 10px;color:var(--text,#fff)">Windows：</h4>
                <ul style="margin:10px 0 14px;padding-left:20px;line-height:1.8;color:var(--text-dim,#aaa)">
                    <li><b>v2r&#97;yN &ge; v7.17.0</b><br><a href="https://github.com/2dust/v2r&#97;yN/releases" target="_blank" rel="noopener" style="color:var(--glass-blue,#60a5fa)">github.com/2dust/v2r&#97;yN</a></li>
                </ul>
                <h4 style="margin:16px 0 10px;color:var(--text,#fff)">Android：</h4>
                <ul style="margin:10px 0 14px;padding-left:20px;line-height:1.8;color:var(--text-dim,#aaa)">
                    <li><b>v2r&#97;yNG &ge; v2.0.0</b><br><a href="https://github.com/2dust/v2r&#97;yNG/releases" target="_blank" rel="noopener" style="color:var(--glass-blue,#60a5fa)">github.com/2dust/v2r&#97;yNG</a></li>
                </ul>
                <h4 style="margin:16px 0 10px;color:var(--text,#fff)">Si&#110;g-box 内核客户端：</h4>
                <ul style="margin:10px 0 14px;padding-left:20px;line-height:1.8;color:var(--text-dim,#aaa)">
                    <li style="margin-bottom:6px"><b>Nek&#111;Box</b>（Android）— 基于 si&#110;g-box 内核，支持 ECH</li>
                    <li><b>Ka&#114;ing</b>（全平台）— 基于 si&#110;g-box 内核，完整支持 ECH</li>
                </ul>
                <h4 style="margin:16px 0 10px;color:var(--text,#fff)">Cl&#97;sh.Met&#97;（mi&#104;omo 内核）：</h4>
                <ul style="margin:10px 0 14px;padding-left:20px;line-height:1.8;color:var(--text-dim,#aaa)">
                    <li style="margin-bottom:6px">所有使用 <b>cl&#97;sh.met&#97; / mi&#104;omo 内核</b> 的客户端均支持 ECH</li>
                    <li style="margin-bottom:6px"><b>FlCl&#97;sh</b>（全平台）— 基于 mi&#104;omo 内核</li>
                    <li>⚠️ <b>需要 DNS 配合使用</b></li>
                </ul>
                <h3 style="margin:20px 0 12px">⚠️ Cl&#97;sh 用户注意事项</h3>
                <p style="margin-bottom:10px;line-height:1.8;color:var(--text-dim,#aaa)">当前订阅配置中已<b>内置 ECH 所需的 DNS 设置</b>。</p>
                <p style="margin-bottom:10px;line-height:1.8;color:var(--text-dim,#aaa)">如果出现以下情况：</p>
                <ul style="margin:10px 0 14px;padding-left:20px;line-height:1.8;color:var(--text-dim,#aaa)">
                    <li style="margin-bottom:4px">✅ 已开启 ECH</li>
                    <li style="margin-bottom:4px">✅ 已更新订阅</li>
                    <li>❌ ECH 节点仍然无法使用</li>
                </ul>
                <p style="margin-bottom:10px;line-height:1.8;color:var(--text-dim,#aaa)">请检查：</p>
                <div style="background:rgba(255,243,205,0.1);border-left:3px solid #ffc107;padding:10px 14px;border-radius:6px;margin-bottom:14px;color:#ffd93d;font-size:0.9rem">是否在更新订阅时覆盖了原有的 DNS 配置</div>
                <p style="line-height:1.8;color:var(--text-dim,#aaa)">建议：<b>不要覆盖订阅中自带的 DNS 设置</b></p>
            </div>
            <div id="echPane2" style="display:none">
                <h2 style="font-size:1.2rem;margin-bottom:16px">🔍 如何确认 ECH 是否已经生效？</h2>
                <p style="margin-bottom:14px;line-height:1.8;color:var(--text-dim,#aaa)">可以通过一个<b>简单且直观的方法</b>来验证 ECH 是否正常工作。</p>
                <h3 style="margin:20px 0 12px">📋 验证步骤</h3>
                <ol style="margin:10px 0 14px;padding-left:20px;line-height:1.8;color:var(--text-dim,#aaa)">
                    <li style="margin-bottom:10px">打开节点的<b>「详细配置信息」</b></li>
                    <li style="margin-bottom:10px">在 <b>HOST</b> 中手动填写一个<b>你当前项目的已被墙的域名</b>，例如：<code style="background:rgba(255,255,255,0.1);padding:2px 6px;border-radius:3px">*.workers.dev</code></li>
                    <li style="margin-bottom:10px">保存配置后<b>重新更新订阅</b></li>
                    <li>在节点列表中查找 HOST 为该域名的节点，并尝试连接</li>
                </ol>
                <h3 style="margin:20px 0 12px">✅ 如何判断结果？</h3>
                <ul style="margin:10px 0 14px;padding-left:20px;line-height:1.8;color:var(--text-dim,#aaa)">
                    <li style="margin-bottom:10px"><b style="color:#10b981">✅ 如果节点可以正常连接使用</b><br>说明 <b>ECH 已成功生效</b>，真实被墙的域名已被隐藏，对外仅显示为 <code style="background:rgba(255,255,255,0.1);padding:2px 6px;border-radius:3px">cloudflare-ech.com</code></li>
                    <li><b style="color:#ef4444">❌ 如果节点无法连接</b><br>说明 ECH 未生效，或客户端版本、DNS 配置存在问题</li>
                </ul>
            </div>
            <button onclick="document.getElementById('echHelpModal').style.display='none'" style="margin-top:20px;width:100%;padding:10px;border:none;border-radius:8px;background:var(--glass-blue,#2563eb);color:#fff;cursor:pointer;font-size:0.9rem">关闭</button>
        </div>
    </div>

    </body>
</html>`;
}
