// 生成部署用混淆版：worker.obf.js（强混淆；wrangler.jsonc 的 main 指向它，是 Workers 部署件）
// 约束：renameGlobals=false 保留顶层导出；产物必须通过同一套回归（临时目录跑 test_harness.mjs）
//
// ── P0-4 门禁强制化（把「人工流程」变成「脚本强制」）─────────────────────────────
// 依据 README:135 仓库自定的规矩：
//   「混淆产物字节不可复现（controlFlowFlattening / stringArrayRotate / stringArrayShuffle 带随机性），
//     因此不能用哈希判断『产物与源码是否一致』；唯一有效的门禁是行为等价 —— 把产物复制成
//     worker.js 放进临时目录，跑同一套回归。每次构建后都必须重跑。」
// 本脚本据此：构建完成后 **自动** 在临时目录跑 test_harness.mjs：
//   · worker.obf.js（产物） → tmp/worker.js     —— 验证「混淆产物与源码行为等价」
//   · snippets.js（明文）   → tmp/snippets.js   —— Snippets 真实部署件，harness 依赖它，必须复制
//   已知可接受的红项进 EXPECTED_RED 白名单（当前为空）；其余任何红（含回归崩溃 / 汇总不可解析）
//   一律以非 0 退出码阻断部署。不放宽 32768 阈值。
import JavaScriptObfuscator from 'javascript-obfuscator';
import { minify } from 'terser';
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync, rmSync } from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';

// 以脚本所在目录为根，保证从任意 CWD 调用都读写同一份文件
const ROOT = fileURLToPath(new URL('.', import.meta.url));

const common = {
  compact: true,
  selfDefending: false,
  debugProtection: false,
  disableConsoleOutput: false,
  renameGlobals: false,          // 顶层 const/function 名保留 → harness 追加导出仍可用
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
  splitStrings: false,
  sourceMap: false,
  target: 'browser'
};

const jobs = [
  {
    src: 'worker.js', out: 'worker.obf.js',
    opts: {
      ...common,
      controlFlowFlattening: true,
      controlFlowFlatteningThreshold: 0.7,
      deadCodeInjection: false,
      stringArray: true,
      stringArrayEncoding: ['rc4'],
      stringArrayThreshold: 0.8,
      stringArrayRotate: true,
      stringArrayShuffle: true,
      stringArrayWrappersCount: 1,
      stringArrayWrappersType: 'function',
      identifierNamesGenerator: 'hexadecimal',
      numbersToExpressions: true,
      simplify: true
    }
  }
];

for (const j of jobs) {
  const src = readFileSync(join(ROOT, j.src), 'utf8');
  const t0 = Date.now();
  let out = JavaScriptObfuscator.obfuscate(src, j.opts).getObfuscatedCode();
  if (j.opts.terser) {
    // 二次压缩：局部名压回短名 + 结构压缩（顶层名保留），吃掉混淆器命名膨胀
    out = (await minify(out, { compress: true, mangle: { toplevel: false }, format: { comments: false } })).code;
  }
  writeFileSync(join(ROOT, j.out), out);
  console.log(`${j.out}: ${Buffer.byteLength(src)}B -> ${Buffer.byteLength(out)}B  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

// ================= P0-4 门禁：行为等价 + EXPECTED_RED 白名单 =================
// 已知可接受的预期红项（EXPECTED_RED）—— 当前 **为空**：门禁临时目录里的 snippets.js 是明文部署件，
// 其体积断言（≤32768）会直接通过，故不存在需要豁免的红项。机制保留，供将来出现「确有依据」的预期红时登记。
// 判定方式：红项名以 ` - <name>` 出现在 harness 汇总的「失败项:」块中。
const EXPECTED_RED = [];

function runRegressionGate() {
  const tmp = mkdtempSync(join(tmpdir(), 'graintcp-obf-gate-'));
  try {
    copyFileSync(join(ROOT, 'test_harness.mjs'), join(tmp, 'test_harness.mjs'));
    copyFileSync(join(ROOT, 'worker.obf.js'), join(tmp, 'worker.js'));   // 产物 → 当 worker.js 用（验行为等价）
    copyFileSync(join(ROOT, 'snippets.js'), join(tmp, 'snippets.js'));   // 明文部署件 → 必须复制，否则 harness 9 处 import 崩溃
    const r = spawnSync(process.execPath, ['test_harness.mjs'], { cwd: tmp, encoding: 'utf8', env: process.env });
    const raw = `${r.stdout || ''}${r.stderr || ''}`;
    const lines = raw.split(/\r?\n/);
    const m = /^共 (\d+) 项，失败 (\d+) 项/.exec(lines.find(l => /^共 \d+ 项，失败 \d+ 项/.test(l)) || '');
    const failedNames = [];
    const fi = lines.indexOf('失败项:');
    if (fi >= 0) {
      for (let i = fi + 1; i < lines.length; i++) {
        const mm = /^ - (.+)$/.exec(lines[i]);
        if (mm) failedNames.push(mm[1]);
      }
    }
    const isExpected = (n) => EXPECTED_RED.some(e => e.re.test(n));
    return {
      total: m ? Number(m[1]) : 0,
      failed: m ? Number(m[2]) : -1,
      expected: failedNames.filter(isExpected),
      unexpected: failedNames.filter(n => !isExpected(n)),
      harnessExit: r.status,
      raw
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// Snippets 真实部署件（明文 snippets.js）体积硬判定 —— 这才是「>32768 拒绝部署」的对象
function snippetsDeployableBudget() {
  const bytes = Buffer.byteLength(readFileSync(join(ROOT, 'snippets.js')));
  return { bytes, limit: 32768, ok: bytes <= 32768, headroom: 32768 - bytes };
}

const g = runRegressionGate();
const snip = snippetsDeployableBudget();

const report = [];
report.push('');
report.push('================= 混淆门禁（P0-4 · 脚本强制） =================');
report.push(`行为等价回归（临时目录跑 test_harness.mjs）：共 ${g.total} 项，失败 ${g.failed} 项  [harness exit=${g.harnessExit}]`);
report.push(`  预期红 EXPECTED_RED：${g.expected.length} 项`);
g.expected.forEach(n => report.push(`    · ${n}`));
report.push(`  非预期红：${g.unexpected.length} 项`);
g.unexpected.forEach(n => report.push(`    · ${n}`));
report.push(`Snippets 部署件（明文 snippets.js）：${snip.bytes}B / ${snip.limit}B，余量 ${snip.headroom}B → ${snip.ok ? 'PASS' : 'FAIL（超硬限额，拒绝部署）'}`);
const pass = g.total > 0 && g.failed >= 0 && g.unexpected.length === 0 && snip.ok;
report.push(`门禁结论：${pass ? 'PASS（无非预期红）' : 'FAIL（存在非预期红或部署件超限）'}`);
console.log(report.join('\n'));

if (!pass) process.exit(1);
