// 文档数据自查（doc-check）—— 把「文档里声明的可验证数据」与仓库实际状态做机械比对
// 设计稿见 _verify/doc_check_design.md；本文件是它的实现。
//
// 为什么需要：本轮人工修了 70+ 处文档陈旧数据（测试项数 / 产物字节数 / sha256 / 旧项目路径 /
// 死命令 / 行号 …）。这些本可机械判定，不应依赖人眼巡检。
//
// 检查项（FAIL 阻断 → exit≠0；WARN 仅提示）：
//   [0] 陈旧值黑名单    STALE 命中即 FAIL —— 修掉一个旧值就入列一个，同类问题永久不可回归
//   [1] 测试项数        基准块 harness_total vs 实际（临时目录跑 test_harness.mjs）；失败数必须为 0
//   [2] 产物字节数      基准块 file.<name>.bytes vs 实际
//   [3] sha256          基准块 file.<name>.sha256_12 vs 实际
//   [4] 引用存在性      文档里的绝对路径 / `node|bash|python <script>` 引用必须真实存在
//   [5] 内联副本一致性  基准块是权威值；散文里带文件名上下文的同形状副本必须一致
//   [6] 行号引用(WARN)  `file.js:NNNN` 不得超过该文件实际行数
//
// 基准块（文档内 HTML 注释，渲染不可见）：
//   <!-- doccheck:baseline
//   harness_total=180
//   file.worker.js.bytes=355249
//   file.worker.js.sha256_12=513e011d6de9
//   file.snippets.js.bytes=31286
//   file.snippets.js.sha256_12=fc557e2d7fbc
//   file.worker.obf.js.bytes=850949
//   file.worker.obf.js.sha256_12=62be6c787840
//   -->
//
// 豁免：<!-- doccheck:allow: 原因 -->（同行或紧邻上一行）—— 该行对「黑名单 / 内联副本」免疫；原因必填。
//
// 用法：
//   node _doccheck.mjs            # 自查（exit≠0 当且仅当有 FAIL）
//   node _doccheck.mjs --update   # 用当前实际值重写文档里的基准块 + 同源散文副本（不碰豁免行）
// 逃生阀：DOCCHECK=off —— 由调用方 _predeploy_check.mjs 跳过；本脚本自身不读取该变量。
//
// ── `--update` 的作用域（规则定义 · 曾三次被误解，故写死在这里）──────────────────
//   允许：刷新「基准块」+「由基准块**机械派生**的数字/哈希副本」（即 [5] 内联副本）。
//   禁止：改动任何**措辞** —— 文字表述、单位、语义、结构。
//
//   为什么必须允许改副本：文档里本来就存在大量由基准块派生的同形状副本（`959689B`、
//   `≈937KB`、`59a91ede4153`…）。基准块一变，它们必须跟着变，否则 [5] 必然红 ——
//   所以「--update 只许刷基准块」这条规则本身是不成立的（不是工具做错了）。
//
//   守卫（机器强制，不靠人眼）：`--update` 对**每一行改写**做断言 ——
//     把改写前后的该行都做「数字/哈希归一化」后必须**逐字符完全相同**。
//     归一化 = 先抹 ≥8 位 hex 串 → `#H`，再把数字串 → `#`。
//     断言失败 ⇒ 判定为「措辞被改」⇒ **该文件整体不写入（即回滚）**、打印差异、退出码 2。
//   自测：在文档里故意改一处措辞再跑 `--update`，应被拦下（证据见 _verify/update_guard_*.txt）。
import { readFileSync, writeFileSync, existsSync, mkdtempSync, copyFileSync, rmSync } from 'fs';
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const DOCS = ['docs/DEPLOY_VERIFY.md', 'README.md'];
const FILE_NAMES = ['worker.obf.js', 'worker.js', 'snippets.js', 'test_harness.mjs'];
const BASELINE_FILES = ['worker.js', 'snippets.js', 'worker.obf.js'];
const BASELINE_OPEN = '<!-- doccheck:baseline';
const BASELINE_CLOSE = '-->';
const ALLOW_RE = /<!--\s*doccheck:allow\s*:\s*([^>]*?)\s*-->/;
const ROOT_LITERAL = 'C:/Users/snove/workbuddy-ai/GitHub Project/graintcp';
const SNIPPETS_LIMIT = 32768;

// ── 陈旧值黑名单：修掉一个旧值就追加一行 → 同类问题永久不可回归 ──────────────
const STALE = [
  { v: '818121', why: '旧 worker.obf.js 字节数' },
  { v: '30433', why: '旧 snippets.js 字节数' },
  { v: '341334', why: '旧 worker.js 字节数' },
  { v: '9ab1e855a293', why: '旧 worker.js sha256 前缀' },
  { v: 'a1731f2f3dba', why: '旧 snippets.js sha256 前缀' },
  { v: '862b69e37b40', why: '旧 worker.obf.js sha256 前缀' },
  { v: '.zcode/workspace/default', why: '旧项目路径（已迁移到 workbuddy-ai/GitHub Project/graintcp）' },
  { v: '_probe_downlink.mjs', why: '死命令（仓库无此文件）' },
  { v: '48 行', why: '旧 snippets.js 行数基准' },
  { v: '11998', why: '旧 snippets.js 最长行基准' },
  { v: '79 万', why: '旧 worker.obf.js 字符数量级' },
  { v: 'ProxyIP.US.', why: '旧 PIP 默认值' },
  { v: '151', why: '旧回归项数' },
  { v: '152', why: '旧回归项数（历史口径，需 doccheck:allow 豁免）' },
  { v: '只允许 1 项红', why: '旧门禁口径（现为 0 容忍）' },
  { v: '355249', why: '旧 worker.js 字节数' },
  { v: '31286', why: '旧 snippets.js 字节数' },
  { v: '513e011d6de9', why: '旧 worker.js sha256 前缀' },
  { v: 'fc557e2d7fbc', why: '旧 snippets.js sha256 前缀' },
  { v: '60 行', why: '旧 snippets.js 行数基准' },
  { v: '31463', why: '旧 snippets.js 字节数（Snippets 平台适配前）' },
  { v: '312c664da700', why: '旧 snippets.js sha256 前缀' },
  { v: '93153be9504d', why: '更旧的 snippets.js sha256 前缀（曾漏在 §3.2.1 表内）' },
  { v: 'cef32273a828', why: '更旧的 worker.js sha256 前缀（曾漏在 §1.2 判定标准内）' },
  { v: '61 行', why: '旧 snippets.js 行数基准' },
  { v: '11627', why: '旧 snippets.js 最长行基准' },
  { v: '347', why: '旧回归项数（Snippets 平台适配前）' },
  { v: '32463', why: '旧 snippets.js 字节数（NET/TS 诊断修复前）' },
  { v: 'bc0b35ba5d7f', why: '旧 snippets.js sha256 前缀' },
  { v: '370', why: '旧回归项数（NET/TS 诊断修复前）' },
  { v: '32711', why: '旧 snippets.js 字节数（404 文案统一前）' },
  { v: 'd34ed45edfb4', why: '旧 snippets.js sha256 前缀' },
  { v: '68 行', why: '旧 snippets.js 行数基准' },
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function staleRe(v) {
  if (/^\d+$/.test(v)) return new RegExp(`(?<!\\d)${esc(v)}(?!\\d)`);
  if (/^[0-9a-f]{8,}$/i.test(v)) return new RegExp(`(?<![0-9a-f])${esc(v)}(?![0-9a-f])`, 'i');
  return new RegExp(esc(v));
}
for (const s of STALE) s.re = staleRe(s.v);

// ── 工具 ─────────────────────────────────────────────────────────────────
const readText = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const sha12 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12);
function fileInfo(rel) {
  try { const b = readFileSync(join(ROOT, rel)); return { bytes: b.length, sha256_12: sha12(b) }; }
  catch { return null; }
}
function lineCount(rel) { try { return readText(rel).split('\n').length; } catch { return -1; } }

// 行级豁免：本行或紧邻上一行带 <!-- doccheck:allow: 原因 -->
function allowMap(lines) {
  const m = new Array(lines.length).fill(null);
  for (let i = 0; i < lines.length; i++) {
    const here = ALLOW_RE.exec(lines[i]);
    if (here) { m[i] = here[1].trim() || '(空原因)'; continue; }
    const prev = i > 0 ? ALLOW_RE.exec(lines[i - 1]) : null;
    m[i] = prev ? (prev[1].trim() || '(空原因)') : null;
  }
  return m;
}

// ── 实际值 ───────────────────────────────────────────────────────────────
let _harness = null;
function runHarness() {
  if (_harness) return _harness;
  const tmp = mkdtempSync(join(tmpdir(), 'graintcp-doccheck-'));
  try {
    copyFileSync(join(ROOT, 'test_harness.mjs'), join(tmp, 'test_harness.mjs'));
    copyFileSync(join(ROOT, 'worker.obf.js'), join(tmp, 'worker.js'));   // 产物 → 当 worker.js 用
    copyFileSync(join(ROOT, 'snippets.js'), join(tmp, 'snippets.js'));   // 明文部署件 → harness 依赖
    const r = spawnSync(process.execPath, ['test_harness.mjs'], { cwd: tmp, encoding: 'utf8', env: process.env });
    const raw = `${r.stdout || ''}${r.stderr || ''}`;
    const line = raw.split(/\r?\n/).find((l) => /^共 \d+ 项，失败 \d+ 项/.test(l)) || '';
    const m = /^共 (\d+) 项，失败 (\d+) 项/.exec(line);
    _harness = { total: m ? Number(m[1]) : 0, failed: m ? Number(m[2]) : -1, exit: r.status };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return _harness;
}
function actuals() {
  const files = {};
  for (const f of FILE_NAMES) files[f] = fileInfo(f);
  return { files, harness: runHarness() };
}

// ── 基准块：解析 / 渲染 / 重写 ────────────────────────────────────────────
function parseBaseline(text) {
  const start = text.indexOf(BASELINE_OPEN);
  if (start < 0) return null;
  const end = text.indexOf(BASELINE_CLOSE, start + BASELINE_OPEN.length);
  if (end < 0) return null;
  const body = text.slice(start + BASELINE_OPEN.length, end);
  const map = new Map();
  for (const raw of body.split(/\r?\n/)) {
    const s = raw.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq < 0) continue;
    map.set(s.slice(0, eq).trim(), s.slice(eq + 1).trim());
  }
  return { map, start, end: end + BASELINE_CLOSE.length };
}
function renderBaseline(a) {
  const L = [BASELINE_OPEN];
  L.push(`harness_total=${a.harness.total}`);
  for (const f of BASELINE_FILES) {
    const x = a.files[f];
    if (!x) continue;
    L.push(`file.${f}.bytes=${x.bytes}`);
    L.push(`file.${f}.sha256_12=${x.sha256_12}`);
  }
  L.push(BASELINE_CLOSE);
  return L.join('\n');
}

// ── 数值提取（带「非测量」排除：不等式阈值 / 区间端点）─────────────────────
const VALUE_PATTERNS = [
  { kind: 'bytes', re: /([≤<>=≥]?\s*)(\d{4,7})\s*B(?![\dA-Za-z])/g, digits: 2, prefix: 1 },
  { kind: 'bytes', re: /([≤<>=≥]?\s*)(\d{4,7})\s*字节/g, digits: 2, prefix: 1 },
  // KB 只在带「≈」前缀时视为测量值：`≈831KB` / `≈30.6KB`。
  // 不带 ≈ 的（`32KB 限额` / `300KB~1.5MB 区间` / `~30KB`）是限额或区间，不是测量值 → 不匹配。
  { kind: 'kb', re: /(≈\s*)(\d+(?:\.\d+)?)\s*KB/gi, digits: 2, prefix: 1 },
];
const SHA_RE = /(?<![-0-9a-fA-F])([0-9a-f]{12})(?![-0-9a-fA-F])/g;

function extractValues(line) {
  const out = [];
  for (const p of VALUE_PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(line)) !== null) {
      if (/[≤<>=≥~]/.test(m[p.prefix])) continue;          // 阈值 / 区间端点，不是测量值
      // end 只覆盖「数字」本身，单位（B / 字节 / KB）必须保留
      const dStart = m.index + m[p.prefix].length;
      out.push({ kind: p.kind, raw: m[p.digits], value: Number(m[p.digits]), start: dStart, end: dStart + m[p.digits].length });
    }
  }
  return out;
}
function extractShas(line) {
  const out = [];
  SHA_RE.lastIndex = 0;
  let m;
  while ((m = SHA_RE.exec(line)) !== null) out.push({ raw: m[1], value: m[1], start: m.index, end: m.index + 12 });
  return out;
}
// 关联：本行文件名（出现位置）。同种值个数 == 文件名个数且各出现一次 → 按序；否则就近。
function associate(line, values, files) {
  const occ = [];
  for (const f of files) { let i = -1; while ((i = line.indexOf(f, i + 1)) >= 0) occ.push({ f, i }); }
  if (!occ.length) return values.map(() => ({ file: null, reason: 'no-file' }));
  const uniq = new Set(occ.map((o) => o.f));
  if (occ.length === values.length && uniq.size === occ.length) {
    const of = [...occ].sort((a, b) => a.i - b.i);
    const ov = [...values].sort((a, b) => a.start - b.start);
    return ov.map((v, k) => ({ file: of[k].f, dist: 0 }));
  }
  return values.map((v) => {
    let best = null;
    for (const o of occ) { const d = Math.abs(o.i - v.start); if (!best || d < best.d) best = { f: o.f, d }; }
    const tied = occ.filter((o) => Math.abs(o.i - v.start) === best.d && o.f !== best.f);
    if (tied.length) return { file: null, reason: 'ambiguous' };
    return { file: best.f, dist: best.d };
  });
}

// ── 主检查 ───────────────────────────────────────────────────────────────
export function runDocCheck({ log = console.log } = {}) {
  const out = [];
  const fails = [];
  const warns = [];
  const F = (msg) => { fails.push(msg); };
  const W = (msg) => { warns.push(msg); };

  const a = actuals();
  const docs = DOCS.map((rel) => {
    const text = readText(rel);
    const lines = text.split('\n');
    return { rel, text, lines, allow: allowMap(lines), baseline: parseBaseline(text) };
  });

  out.push('================= 文档数据自查（doc-check） =================');
  out.push(`根目录：${ROOT}`);
  out.push(`基准块：${docs.map((d) => `${d.rel} ${d.baseline ? '✓' : '✗'}`).join('  ')}`);
  out.push(`实际值：harness ${a.harness.total} 项/失败 ${a.harness.failed} 项 · ` +
    BASELINE_FILES.map((f) => `${f} ${a.files[f] ? a.files[f].bytes + 'B' : 'MISSING'}`).join(' · '));
  out.push('');

  // 基准块缺失 → FAIL
  for (const d of docs) if (!d.baseline) F(`${d.rel}  缺少 <!-- doccheck:baseline ... --> 基准块`);
  const base = new Map();
  for (const d of docs) if (d.baseline) for (const [k, v] of d.baseline.map) if (!base.has(k)) base.set(k, v);

  // [0] 陈旧值黑名单
  {
    const hits = [];
    for (const d of docs) d.lines.forEach((ln, i) => {
      if (d.allow[i]) return;
      for (const s of STALE) if (s.re.test(ln)) hits.push({ rel: d.rel, line: i + 1, v: s.v, why: s.why });
    });
    out.push(`[0/6] 陈旧值黑名单 ...... ${hits.length ? 'FAIL' : 'PASS'}  （${STALE.length} 条守卫）`);
    for (const h of hits) { out.push(`      ${h.rel}:${h.line}  命中「${h.v}」  ← ${h.why}`); out.push(`      → 若为刻意保留的历史数据，请在该行加 <!-- doccheck:allow: 原因 -->`); }
    for (const h of hits) F(`${h.rel}:${h.line} 命中陈旧值「${h.v}」（${h.why}）`);
  }

  // [1] 测试项数
  {
    const bt = base.has('harness_total') ? Number(base.get('harness_total')) : null;
    const ok = bt !== null && a.harness.total > 0 && bt === a.harness.total && a.harness.failed === 0;
    out.push(`[1/6] 测试项数 .......... ${ok ? 'PASS' : 'FAIL'}`);
    if (bt === null) { out.push('      基准块缺 harness_total'); F('基准块缺 harness_total'); }
    else if (a.harness.total === 0) { out.push('      harness 未产出汇总行（构建/导入可能失败）'); F('harness 未产出汇总行'); }
    else {
      out.push(`      基准块 ${bt} 项 / 实际 ${a.harness.total} 项 / 失败 ${a.harness.failed} 项`);
      if (bt !== a.harness.total) F(`测试项数不一致：基准块 ${bt} ≠ 实际 ${a.harness.total}`);
      if (a.harness.failed !== 0) F(`harness 失败 ${a.harness.failed} 项（文档声称 0 失败）`);
    }
  }

  // [2][3] 基准块 vs 实际（字节 / sha）
  {
    const problems = [];
    for (const f of BASELINE_FILES) {
      const act = a.files[f];
      const bk = `file.${f}.bytes`, sk = `file.${f}.sha256_12`;
      if (act === null) { problems.push(`基准块声明了 ${f}，但该文件不存在`); continue; }
      if (base.has(bk) && Number(base.get(bk)) !== act.bytes) problems.push(`${f} 字节：基准块 ${base.get(bk)} ≠ 实际 ${act.bytes}`);
      if (base.has(sk) && base.get(sk) !== act.sha256_12) problems.push(`${f} sha256：基准块 ${base.get(sk)} ≠ 实际 ${act.sha256_12}`);
    }
    out.push(`[2/6] 产物字节数 ........ ${problems.some((p) => p.includes('字节')) ? 'FAIL' : 'PASS'}`);
    out.push(`[3/6] sha256 ............ ${problems.some((p) => p.includes('sha256')) ? 'FAIL' : 'PASS'}`);
    for (const p of problems) { out.push(`      ${p}`); F(`基准块与实况不符：${p}`); }
  }

  // [4] 引用存在性（绝对路径 / 脚本）
  {
    const probs = [];
    const isTpl = (seg) => /[<>{}]/.test(seg) || seg.startsWith('$');
    for (const d of docs) d.lines.forEach((ln, i) => {
      // 绝对路径：ROOT_LITERAL + 后缀
      let p = -1;
      while ((p = ln.indexOf(ROOT_LITERAL, p + 1)) >= 0) {
        const rest = ln.slice(p + ROOT_LITERAL.length);
        const m = /^(\/[^\s`'"()|<>]+)?/.exec(rest);
        const suffix = (m && m[1]) ? m[1] : '';
        const segs = suffix.split('/').filter(Boolean);
        if (segs.some(isTpl)) continue;                       // 含模板占位 → 无法判定，跳过
        const target = join(ROOT, ...segs);
        if (!existsSync(target)) probs.push({ rel: d.rel, line: i + 1, what: ROOT_LITERAL + suffix, kind: '路径不存在' });
      }
      // 脚本引用：node|bash|python <file>
      const sre = /\b(node|bash|sh|python3?)\s+([A-Za-z0-9_./-]+\.(?:mjs|js|sh|py))\b/g;
      let sm;
      while ((sm = sre.exec(ln)) !== null) {
        const file = sm[2];
        if (isTpl(file)) continue;
        const looksRepo = file.startsWith('_') || file.startsWith('test_') || file.startsWith('docs/') || file.startsWith('scripts/');
        if (!looksRepo) continue;                              // 用户自建脚本（如 make_frame.py）不判定
        if (!existsSync(join(ROOT, file))) probs.push({ rel: d.rel, line: i + 1, what: `${sm[1]} ${file}`, kind: '脚本不存在' });
      }
    });
    out.push(`[4/6] 引用存在性 ........ ${probs.length ? 'FAIL' : 'PASS'}`);
    for (const p of probs) { out.push(`      ${p.rel}:${p.line}  ${p.kind}：${p.what}`); F(`${p.rel}:${p.line} ${p.kind}：${p.what}`); }
  }

  // [5] 内联副本一致性
  {
    const probs = [];
    let unassoc = 0;
    for (const d of docs) d.lines.forEach((ln, i) => {
      if (d.allow[i]) return;
      const vals = extractValues(ln);
      const shas = extractShas(ln);
      for (const [list, kind] of [[vals, 'bytes'], [shas, 'sha']]) {
        if (!list.length) continue;
        const assoc = associate(ln, list, BASELINE_FILES);
        list.forEach((v, k) => {
          const as = assoc[k];
          if (!as.file) { unassoc++; return; }
          const act = a.files[as.file];
          if (!act) return;
          if (kind === 'sha') {
            if (base.has(`file.${as.file}.sha256_12`) && v.value !== act.sha256_12) {
              probs.push({ rel: d.rel, line: i + 1, msg: `${as.file} sha256 副本「${v.value}」≠ 实际 ${act.sha256_12}`, fix: act.sha256_12 });
            }
          } else if (v.kind === 'kb') {
            const exp = act.bytes / 1024;
            const dec = String(v.raw).includes('.') ? 1 : 0;
            const tol = dec ? 0.15 : 1;
            if (Math.abs(v.value - exp) > tol) probs.push({ rel: d.rel, line: i + 1, msg: `${as.file} 体积副本「${v.raw}KB」≈${exp.toFixed(1)}KB ≠ 实际`, fix: `${exp.toFixed(dec)}KB` });
          } else if (base.has(`file.${as.file}.bytes`) && v.value !== act.bytes) {
            probs.push({ rel: d.rel, line: i + 1, msg: `${as.file} 字节副本「${v.raw}${v.kind === 'kb' ? '' : 'B'}」≠ 实际 ${act.bytes}B`, fix: `${act.bytes}B` });
          }
        });
      }
    });
    out.push(`[5/6] 内联副本一致性 .... ${probs.length ? 'FAIL' : 'PASS'}  （另有 ${unassoc} 处无法关联文件）`);
    for (const p of probs) { out.push(`      ${p.rel}:${p.line}  ${p.msg}   → 建议改为 ${p.fix}`); F(`${p.rel}:${p.line} ${p.msg}`); }
  }

  // [6] 行号引用（WARN）
  {
    const probs = [];
    for (const d of docs) d.lines.forEach((ln, i) => {
      const re = /\b([A-Za-z0-9_./-]+\.(?:js|mjs)):(\d+)\b/g;
      let m;
      while ((m = re.exec(ln)) !== null) {
        const n = Number(m[2]);
        if (!existsSync(join(ROOT, m[1]))) continue;
        const total = lineCount(m[1]);
        if (total > 0 && n > total) probs.push(`${d.rel}:${i + 1} 引用 ${m[1]}:${n} 超出实际行数 ${total}`);
      }
    });
    out.push(`[6/6] 行号引用 .......... ${probs.length ? 'WARN' : 'PASS'}  （WARN 不阻断）`);
    for (const p of probs) { out.push(`      ${p}`); W(p); }
  }

  out.push('');
  out.push(`总结论：${fails.length ? 'FAIL' : 'PASS'}（${fails.length} 处 FAIL / ${warns.length} 处 WARN）`);
  out.push(`退出码：${fails.length ? 1 : 0}`);
  log(out.join('\n'));
  return { pass: fails.length === 0, fails, warns, lines: out };
}

// ── --update：用实际值重写基准块 + 同源散文副本 ──────────────────────────
// 数字/哈希归一化：用于断言「改写只动了数字与哈希，没动措辞」
//   ① ≥8 位 hex 串（含 12 位 sha 前缀、长 hex）→ '#H'
//   ② 其余数字串 → '#'
// 用 ≥8 而非 ≥6 是为了避免把 6 位纯数字（如 959689）走 hex 分支、与 3 位数字（925）比较时
// 因「归一化结果不同」而误报 —— 两者统一走 ② 都会变成 '#'。
export const normDigits = (s) => String(s).replace(/[0-9a-fA-F]{8,}/g, '#H').replace(/\d+/g, '#');

// 逐行守卫：断言 before/after 归一化后完全相同；返回 null 表示通过，否则返回失败描述
function guardLine(rel, lineNo, before, after) {
  if (normDigits(before) === normDigits(after)) return null;
  return { rel, line: lineNo, before, after, nb: normDigits(before), na: normDigits(after) };
}

export function updateBaselines({ log = console.log } = {}) {
  const a = actuals();
  const block = renderBaseline(a);
  const changes = [];
  const guardFails = [];   // 守卫拦下的行（措辞被改）
  const reverted = [];     // 因守卫失败而整体未写入的文件

  for (const rel of DOCS) {
    const text = readText(rel);
    const bl = parseBaseline(text);
    if (!bl) { log(`[update] ${rel}: 未找到基准块，跳过（请先手工放置 <!-- doccheck:baseline ... -->）`); continue; }

    const fileGuard = [];

    // ① 基准块区域：逐行守卫（键名/结构不得变，只许数值变）
    //    注意：基准块必须**先**替换，否则后续散文改写会改变行内偏移量、bl.start/bl.end 失效
    const oldBlock = text.slice(bl.start, bl.end);
    {
      const ol = oldBlock.split('\n'), nl = block.split('\n');
      if (ol.length !== nl.length) {
        fileGuard.push({ rel, line: '-', before: `${ol.length} 行`, after: `${nl.length} 行`, nb: '', na: '', msg: '基准块行数变化（键被增删）' });
      } else {
        for (let i = 0; i < ol.length; i++) { const g = guardLine(rel, `基准块+${i + 1}`, ol[i], nl[i]); if (g) fileGuard.push(g); }
      }
    }
    const textAfterBlock = text.slice(0, bl.start) + block + text.slice(bl.end);

    // ② 散文副本：按行重写（右→左保持索引），每行改写后过守卫
    const lines = textAfterBlock.split('\n');
    const allow = allowMap(lines);
    const lineChanges = [];
    for (let i = 0; i < lines.length; i++) {
      if (allow[i] || lines[i].includes(BASELINE_OPEN)) continue;
      const ln = lines[i];
      const edits = [];
      // 关联必须对「整行的同种值列表」一次算完（否则会退化为就近，可能张冠李戴）
      const vals = extractValues(ln);
      if (vals.length) {
        const as = associate(ln, vals, BASELINE_FILES);
        vals.forEach((v, k) => {
          const f = as[k].file;
          if (!f || !a.files[f]) return;
          const act = a.files[f];
          if (v.kind === 'kb') {
            const dec = String(v.raw).includes('.') ? 1 : 0;
            const nv = (act.bytes / 1024).toFixed(dec);
            if (String(v.value) !== nv) edits.push({ start: v.start, end: v.end, text: nv });
          } else if (v.value !== act.bytes) {
            edits.push({ start: v.start, end: v.end, text: String(act.bytes) });
          }
        });
      }
      const shas = extractShas(ln);
      if (shas.length) {
        const as = associate(ln, shas, BASELINE_FILES);
        shas.forEach((v, k) => {
          const f = as[k].file;
          if (!f || !a.files[f]) return;
          const nv = a.files[f].sha256_12;
          if (v.value !== nv) edits.push({ start: v.start, end: v.end, text: nv });
        });
      }
      if (!edits.length) continue;
      edits.sort((x, y) => y.start - x.start);
      let s = ln;
      for (const e of edits) { s = s.slice(0, e.start) + e.text + s.slice(e.end); lineChanges.push(`${rel}:${i + 1}  ${ln.slice(e.start, e.end)} → ${e.text}`); }
      const g = guardLine(rel, i + 1, ln, s);       // ← 守卫：整行归一化后必须相同
      if (g) { fileGuard.push(g); continue; }       // 守卫不过 → 不采纳该行改写
      lines[i] = s;
    }

    // ③ 任一守卫失败 ⇒ 该文件整体不写入（= 回滚），避免留下半改状态
    if (fileGuard.length) {
      reverted.push(rel);
      guardFails.push(...fileGuard);
      log(`[update] ✗ ${rel} 守卫拦下 ${fileGuard.length} 处「措辞被改」→ 该文件未写入（已回滚）`);
      continue;
    }
    const newText = lines.join('\n');
    writeFileSync(join(ROOT, rel), newText);
    changes.push(...lineChanges);
  }

  if (guardFails.length) {
    log(`[update] ✗ 守卫失败：${guardFails.length} 处；未写入文件：${reverted.join(', ') || '(无)'}`);
    log('[update] 规则：--update 只允许刷新「基准块 + 由基准块机械派生的数字/哈希副本」，禁止改动任何措辞。');
    for (const g of guardFails) {
      log(`  · ${g.rel}:${g.line}  ${g.msg || '归一化后不一致'}`);
      log(`      改前：${g.before}`);
      log(`      改后：${g.after}`);
      if (g.nb || g.na) { log(`      归一化改前：${g.nb}`); log(`      归一化改后：${g.na}`); }
    }
    return { ok: false, guardFails, reverted, changes };
  }
  log(`[update] 基准块已刷新；散文副本改写 ${changes.length} 处（守卫通过：全部仅数字/哈希变化）`);
  for (const c of changes) log(`  · ${c}`);
  return { ok: true, guardFails: [], reverted: [], changes };
}

// ── CLI ──────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  if (process.argv.includes('--update')) {
    const u = updateBaselines();
    if (u && u.ok === false) process.exit(2);   // 守卫拦下「措辞被改」→ 非 0 退出，且文件已回滚
  }
  const r = runDocCheck();
  if (!r.pass) process.exit(1);
}
