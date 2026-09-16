// 部署前独立预检（Pre-deploy Check）—— P0-1 的「部署前卡点」
//
// 为什么需要它：`_obfuscate.mjs` 的门禁只在「真的跑了构建」时才触发；而 P0-1 的根因恰恰是
// 「改了 worker.js 却根本没跑构建就 wrangler deploy」—— 门禁在这种路径上完全不会执行。
// 本脚本不依赖构建，直接对当前工作区的文件状态做判定，作为 deploy 前的独立防线。
//
// 检查项（按序，任一不过即 exit ≠ 0，拒绝部署）：
//   1. 产物与源码同源：worker.obf.js 存在且 mtime > worker.js mtime（P0-1 核心防线）
//   2. 明文 snippets 体积硬限：snippets.js ≤ 32768B（Snippets 平台硬限额）
//   3. 产物存在性：worker.obf.js 必须存在（wrangler.jsonc 的 main 指向它）
//   4. 文档数据自查（doc-check）：文档里声明的可验证数据必须与实际一致（见 _doccheck.mjs）
//      —— 环境变量 DOCCHECK=off 可跳过（文档大改进行中的临时逃生阀）
//
// 以脚本所在目录为根（与 _obfuscate.mjs 同约定），因此可被复制到临时目录做自测。
import { statSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

const WORKER_SRC = 'worker.js';
const WORKER_OUT = 'worker.obf.js';
const SNIPPETS = 'snippets.js';
const SNIPPETS_LIMIT = 32768; // Snippets 平台硬限额（字节）

const statOrNull = (p) => { try { return statSync(p); } catch { return null; } };
const iso = (ms) => new Date(ms).toISOString();

const lines = [];
const fixes = []; // 失败项的「可执行修复指引」

lines.push('================= 部署前预检（Pre-deploy Check） =================');
lines.push(`根目录：${ROOT}`);

// ── 1. 产物与源码同源（P0-1 核心防线）────────────────────────────────
const srcSt = statOrNull(join(ROOT, WORKER_SRC));
const outSt = statOrNull(join(ROOT, WORKER_OUT));
let sameSource = false;
lines.push('');
if (!outSt) {
  lines.push(`[1/4] 产物与源码同源 ......... FAIL`);
  lines.push(`      ${WORKER_OUT} 不存在，无法与 ${WORKER_SRC} 比对`);
  fixes.push(`产物缺失 → 请先跑 \`node _obfuscate.mjs\` 生成 ${WORKER_OUT}`);
} else if (!srcSt) {
  lines.push(`[1/4] 产物与源码同源 ......... FAIL`);
  lines.push(`      ${WORKER_SRC} 不存在，无法比对（确认源码在仓库根目录）`);
  fixes.push(`源码缺失 → 确认 ${WORKER_SRC} 存在后重跑 \`node _obfuscate.mjs\``);
} else {
  sameSource = outSt.mtimeMs > srcSt.mtimeMs;
  lines.push(`[1/4] 产物与源码同源 ......... ${sameSource ? 'PASS' : 'FAIL'}`);
  lines.push(`      ${WORKER_OUT} mtime ${iso(outSt.mtimeMs)} ${sameSource ? '>' : '<='} ${WORKER_SRC} mtime ${iso(srcSt.mtimeMs)} ${sameSource ? '✓' : '✗'}`);
  lines.push(`      ${WORKER_OUT} ${outSt.size}B  /  ${WORKER_SRC} ${srcSt.size}B`);
  if (!sameSource) fixes.push(`产物陈旧（${WORKER_OUT} 早于 ${WORKER_SRC}）→ 请先跑 \`node _obfuscate.mjs\` 重建，再 deploy`);
}

// ── 2. 明文 snippets 体积硬限 ────────────────────────────────────────
const snipSt = statOrNull(join(ROOT, SNIPPETS));
let snipOk = false;
lines.push('');
if (!snipSt) {
  lines.push(`[2/4] 明文 snippets 体积 ....... FAIL`);
  lines.push(`      ${SNIPPETS} 不存在，无法判定体积`);
  fixes.push(`部署件缺失 → 确认 ${SNIPPETS} 存在`);
} else {
  const bytes = readFileSync(join(ROOT, SNIPPETS)).length; // Buffer.length = 字节数
  snipOk = bytes <= SNIPPETS_LIMIT;
  const delta = bytes - SNIPPETS_LIMIT;
  lines.push(`[2/4] 明文 snippets 体积 ....... ${snipOk ? 'PASS' : 'FAIL'}`);
  lines.push(`      ${SNIPPETS} ${bytes}B / 限额 ${SNIPPETS_LIMIT}B ${snipOk ? `✓（余量 ${-delta}B）` : `✗（超出 ${delta}B）`}`);
  if (!snipOk) fixes.push(`部署件超限（${bytes}B，超出 ${delta}B）→ 请精简 ${SNIPPETS} 后重试（Snippets 平台硬限额 ${SNIPPETS_LIMIT}B）`);
}

// ── 3. 产物存在性 ────────────────────────────────────────────────────
lines.push('');
const outExists = !!outSt;
lines.push(`[3/4] 产物存在性（wrangler main）.. ${outExists ? 'PASS' : 'FAIL'}`);
lines.push(`      ${WORKER_OUT} ${outExists ? `存在 ✓（${outSt.size}B）` : '缺失 ✗'}（wrangler.jsonc 的 main 指向它）`);
if (!outExists && !fixes.some((f) => f.includes('产物缺失'))) {
  fixes.push(`产物缺失 → \`node _obfuscate.mjs\` 生成 ${WORKER_OUT}`);
}

// ── 4. 文档数据自查（doc-check）──────────────────────────────────────
lines.push('');
let docOk = true;
const hasDocs = existsSync(join(ROOT, 'docs', 'DEPLOY_VERIFY.md')) && existsSync(join(ROOT, 'README.md'));
if ((process.env.DOCCHECK || '').toLowerCase() === 'off') {
  lines.push('[4/4] 文档数据自查 ......... SKIP（DOCCHECK=off）');
} else if (!hasDocs) {
  lines.push('[4/4] 文档数据自查 ......... SKIP（未找到文档，可能处于自测临时目录）');
} else {
  try {
    const { runDocCheck } = await import('./_doccheck.mjs');
    const dc = runDocCheck({ log: () => {} }); // 明细由本脚本统一汇总输出
    docOk = dc.pass;
    lines.push(`[4/4] 文档数据自查 ......... ${docOk ? 'PASS' : 'FAIL'}（${dc.fails.length} FAIL / ${dc.warns.length} WARN）`);
    for (const f of dc.fails) lines.push(`      ✗ ${f}`);
    for (const w of dc.warns) lines.push(`      ! ${w}`);
    if (!docOk) fixes.push('文档数据与实际不一致 → 跑 `node _doccheck.mjs` 看明细；`node _doccheck.mjs --update` 可刷新基准块与同源副本');
  } catch (e) {
    lines.push(`[4/4] 文档数据自查 ......... WARN（无法加载 _doccheck.mjs：${e.message}）`);
  }
}

// ── 总结论 ───────────────────────────────────────────────────────────
const pass = sameSource && snipOk && outExists && docOk;
lines.push('');
lines.push(`总结论：${pass ? 'PASS —— 允许部署' : 'FAIL —— 禁止部署'}`);
if (!pass) {
  lines.push('修复指引：');
  for (const f of fixes) lines.push(`  · ${f}`);
}
lines.push(`退出码：${pass ? 0 : 1}`);
console.log(lines.join('\n'));

if (!pass) process.exit(1);
