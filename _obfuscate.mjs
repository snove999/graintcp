// 生成部署用混淆版：worker.obf.js（强混淆，可部署）/ snippets.obf.js（混淆参考版，超 32KB 不可部署到 Snippets）
// 约束：renameGlobals=false 保留顶层导出；产物必须通过同一套回归（临时目录跑 test_harness.mjs）
import JavaScriptObfuscator from 'javascript-obfuscator';
import { minify } from 'terser';
import { readFileSync, writeFileSync } from 'fs';

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
  },
  {
    src: 'snippets.js', out: 'snippets.obf.js',
    opts: {
      ...common,
      controlFlowFlattening: false,   // 尺寸受限，轻量变换
      deadCodeInjection: false,
      stringArray: true,              // 字符串进数组（base64 编码，尺寸开销低于 rc4）
      stringArrayEncoding: ['base64'],
      stringArrayThreshold: 0.75,
      stringArrayRotate: true,
      stringArrayShuffle: true,
      stringArrayWrappersCount: 1,
      stringArrayWrappersType: 'function',
      identifierNamesGenerator: 'mangled',  // 短名（hexadecimal 会把 1 字符名撑到 7+ 字符，超 32KB）
      numbersToExpressions: false,    // 保留 12e3 等字面量
      simplify: false,                // 防膨胀
      terser: true                    // 混淆后二次压缩
    }
  }
];

for (const j of jobs) {
  const src = readFileSync(j.src, 'utf8');
  const t0 = Date.now();
  let out = JavaScriptObfuscator.obfuscate(src, j.opts).getObfuscatedCode();
  if (j.opts.terser) {
    // 二次压缩：局部名压回短名 + 结构压缩（顶层名保留），吃掉混淆器命名膨胀
    out = (await minify(out, { compress: true, mangle: { toplevel: false }, format: { comments: false } })).code;
  }
  writeFileSync(j.out, out);
  console.log(`${j.out}: ${Buffer.byteLength(src)}B -> ${Buffer.byteLength(out)}B  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
