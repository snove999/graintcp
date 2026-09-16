# GrainTCP 部署 · 线上验证 · 回滚手册

<!-- doccheck:baseline
harness_total=180
file.worker.js.bytes=361753
file.worker.js.sha256_12=a9aed13aeddb
file.snippets.js.bytes=31463
file.snippets.js.sha256_12=312c664da700
file.worker.obf.js.bytes=861905
file.worker.obf.js.sha256_12=572d32b515fd
-->

> 适用版本：本次 xHTTP 下行断流（P0）、`/proxyip=` 路径解析（P1）、gRPC 帧编解码（P1-9）与 `XH_GDEC` O(n²) DoS 加固（G.2）修复后
> 项目根：`C:/Users/snove/workbuddy-ai/GitHub Project/graintcp`
> 双部署形态：**Workers**（`worker.js` / 线上跑 `worker.obf.js`）· **Snippets**（`snippets.js`，32KB 硬限额）
> 手册定位：照做即可执行；每一步都给出**明确判定标准**与**失败时的下一步**。

---

## 0. 安全边界与前置约定（先读）

**本手册不会、也不要求你改动本机 Windows 系统。** 具体地：

- 不安装/卸载软件，不改注册表、组策略、计划任务、系统代理、防火墙规则；
- 不启停本机任何应用或服务；
- 手册中的部署命令（`wrangler deploy` 等）**由你本人在需要时执行**，本文档只描述步骤，不代为执行；
- 所有操作范围限定在项目目录 `C:/Users/snove/workbuddy-ai/GitHub Project/graintcp` 与其子目录内；
- 唯一需要"联网"的动作是**只读探测**（`curl` 请求你自己的域名），不写入远端数据。

**占位符约定**（下文统一使用，请自行替换）：

| 占位符 | 含义 | 示例 |
|---|---|---|
| `{HOST}` | Worker/Snippets 绑定的域名（不带协议） | `proxy.example.com` |
| `{UUID}` | VLESS 用户 ID（16 进制 UUID 格式） | `d675a8ea-61bc-4db9-a8a6-109ca1ec8385` |
| `{SUB_PASSWORD}` | 订阅/面板密码 | `sub` |
| `{WORKER_NAME}` | Worker 名称（= `wrangler.jsonc` 的 `name`） | `graintcp-proxy` |

> ⚠️ **本手册的验证手法分三档，请务必看清每步的标签：**
> - `[curl 可判定]` —— 一条 curl 就能出结论；
> - `[需真实客户端]` —— 必须用 v2rayN/Xray/sing-box 等真实 xHTTP 客户端才能判定；
> - `[离线 harness]` —— 在本地用 Node 跑回归，不依赖线上。
>
> 之所以要分档：**`/proxyip=` 与"下行数据"这两件事都发生在 VLESS 握手之后**，裸 curl 发不出合法 VLESS 帧，无法单独隔离它们。把不能判定的步骤伪装成能判定，是本手册最想避免的事。

> 🔴 **另一条必须先记住的前提：Workers 与 Snippets 是两个不同的运行环境，必须各自适配，禁止盲目统一改写。**
> 两者在**执行时间 / 内存 / 包体 / subrequest 预算 / 是否可用 D1 与面板 / 配置入口**上都有实质差异，
> 详见 §3.4。把一处验证通过的做法直接照搬到另一处，是本项目最容易复发的错误来源。

> 📌 **本手册的定位**：只覆盖**部署、验证、回滚、排查**。xHTTP 实现层面的逐项差异审计
> （`XH_HD` 该不该精简、`IdentityTransformStream` 与 `TransformStream` 的差异、握手扫描边界等）
> 由**「按官方文档与 EDT 的逐环境审计」专项**负责，本手册**不预设其结论**，只提供部署侧可观测的判定手段。

---

## 1. 部署前：产物准备与备份（必做）

### 1.1 确认你要部署的是哪份产物

| 部署目标 | 应部署文件 | 大小（冻结基线实测） | 说明 |
|---|---|---|---|
| Workers | **`worker.obf.js`** | 861905B（≈842KB） | **线上实际跑的就是它**（`wrangler.jsonc` 的 `main` 指向它） |
| Workers（排障临时） | `worker.js` | 361753B | 明文版，便于看堆栈；需改 `main` 才能部署 |
| Snippets | **`snippets.js`**（明文） | 31463B（≈30.7KB） | ✅ **唯一可部署版本**（≤ 32768B） |

> 🔴 **一句话记住产物对应关系**：**Workers 用 `worker.obf.js`；Snippets 必须贴明文 `snippets.js`**。
> （`snippets.obf.js` 已废弃删除：它必然超 32KB、从来不是部署件，`_obfuscate.mjs` 也不再生成它。）
>
> 体积数字会随源码改动漂移，**一律以 `wc -c` 实测为准**；§1.3 给了自检式门禁命令。

> 🔴 **最易踩的坑（P0 修复后的头号问题）**：`wrangler.jsonc` 里 `"main": "worker.obf.js"`。
> 你如果只改了 `worker.js` 就直接 `wrangler deploy`，**部署上去的是旧混淆版，修复等于没上线**。
> 正确顺序：改 `worker.js` → 重新混淆生成 `worker.obf.js` → 再 `wrangler deploy`。

### 1.1.1 冻结基线（本手册对应的唯一有效版本）

本次修复的基线已冻结。**部署前先核对**，避免"改对了却部署了别的版本"：

| 文件 | sha256（前 12 位） | 大小 |
|---|---|---|
| `worker.js`（明文，Workers 源） | `a9aed13aeddb…` | — |
| `snippets.js`（明文，**Snippets 部署件**） | `312c664da700…` | 31463B |
| `worker.obf.js`（**Workers 部署件**） | `572d32b515fd…` | 861905B |
| `test_harness.mjs` | — | **180 项** |

```bash
cd C:/Users/snove/workbuddy-ai/GitHub Project/graintcp
sha256sum worker.js snippets.js worker.obf.js | cut -c1-12
```

**判定标准**：明文两项前缀对上 `cef32273a828` / `93153be9504d`（确认"源码没被改过"）。
`worker.obf.js` 的前缀 `572d32b515fd` **仅标识"仓库里提交的这一份"**，重建后会变 —— 见下方警告。

> ⚠️ **哈希的正确用法（务必分清，否则会误判）**
> - **明文 `worker.js` / `snippets.js` 的哈希是权威且稳定的** —— 用来确认"这份源码没被改过"。
> - **混淆产物 `worker.obf.js` 的哈希只用于标识"仓库里提交的这一份"**，**不能**用来判断"产物与源码是否一致"。`_obfuscate.mjs` 开了 `controlFlowFlattening(0.7)` / `stringArrayRotate` / `stringArrayShuffle`，**带随机性，字节与体积都不可复现**（同一份源码实测三次构建：`worker.obf.js` 845231B → 853000B → 850949B）。**合法重建后哈希变了是正常的，不要据此拒绝部署。**<!-- doccheck:allow: 混淆产物漂移示例（历史实测三次值），刻意保留 -->
> - 因此上面那句"对不上就别部署"**只适用于明文**。对混淆产物，唯一有效的门禁是**行为等价**：
>   ```bash
>   # 把产物 + 明文部署件放进临时目录，跑同一套回归，看行为是否等价
>   cd C:/Users/snove/workbuddy-ai/GitHub Project/graintcp
>   mkdir -p .obfcheck && cp test_harness.mjs .obfcheck/
>   cp worker.obf.js .obfcheck/worker.js          # 产物 → 当 worker.js 用（验行为等价）
>   cp snippets.js   .obfcheck/snippets.js        # 明文部署件 → 必须复制，否则 harness 9 处 import 会崩
>   ( cd .obfcheck && node test_harness.mjs | tail -n 3 ); rm -rf .obfcheck
>   ```
>   **期望：180 项全绿、0 失败**（`snippets.obf.js` 已删除，不再有「体积 > 32768」这条预期红；
>   门禁白名单为空、**0 容忍**，任何红一律 `exit≠0`）。
>   这才能证明"混淆产物与明文行为等价"。**每次重新构建后都要重跑。**

### 1.2 备份旧产物（回滚的物理前提）

在**修改或重新混淆之前**，先做带时间戳的备份。这是回滚唯一的凭据。

```bash
cd C:/Users/snove/workbuddy-ai/GitHub Project/graintcp
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p docs/backup/$STAMP
cp worker.obf.js   docs/backup/$STAMP/
cp snippets.js     docs/backup/$STAMP/      # 若当前线上是 snippets 形态
cp wrangler.jsonc  docs/backup/$STAMP/
# 记录指纹，便于回滚后核对是否真的换回去了
sha256sum worker.obf.js snippets.js wrangler.jsonc > docs/backup/$STAMP/SHA256SUMS.txt
cat docs/backup/$STAMP/SHA256SUMS.txt
```

**判定标准**：`docs/backup/<时间戳>/` 下存在 `worker.obf.js`、`SHA256SUMS.txt`，且 `sha256sum -c` 校验通过。

```bash
cd docs/backup/$STAMP && sha256sum -c SHA256SUMS.txt   # 期望：3 行全部 OK
```

> 若线上还挂着旧的 Worker 版本，**同时记下 Dashboard 的版本号**（Deployments 页每条记录都有 Version ID），这是不依赖本地文件的最强回滚手段。

### 1.3 重新生成混淆版（改了 `worker.js` 之后）

```bash
cd C:/Users/snove/workbuddy-ai/GitHub Project/graintcp
node _obfuscate.mjs
```

**判定标准**：脚本输出一行体积对比，`worker.obf.js` 生成成功且**体积在 300KB~1.5MB 区间**（明显偏离说明混淆配置被改坏）。随后**必须**跑一次回归：

```bash
node test_harness.mjs      # 期望：180 项、0 失败

# --- 红绿对照：证明这套用例不是"空洞全绿" ---
# 关键：test_harness.mjs 的 DIR = 它自己所在目录，所以把 harness 与旧文件
#       一起放进临时目录即可，**完全不必改动工作区里的任何源码**。
# ⚠️ 修复前的提交 1496ffb 早于 gRPC 功能（P1-9）；当前 180 项 harness 的导出清单
#    硬依赖 gRPC 符号（XH_GCHK/XH_GFR/XH_GDEC/XH_isGrpc/XH_pdFeat），1496ffb 无这些
#    符号 → 在其上跑当前 harness 会在**导入阶段 SyntaxError**、无法产出结果。
#    因此红基线只能在**当时的 152 项口径**下复现：实测 1496ffb 在其可运行的 152 项<!-- doccheck:allow: 红基线历史口径（152 项），刻意保留 -->
#    中 **36 项失败**（5 类缺陷），证明用例确实能测出缺陷（非空洞）。
cd C:/Users/snove/workbuddy-ai/GitHub Project/graintcp
mkdir -p .redcheck && cp test_harness.mjs .redcheck/
git show 1496ffb:worker.js   > .redcheck/worker.js      # 修复前的 worker（1496ffb = 修复提交 b8f5846 的父提交）
git show 1496ffb:snippets.js > .redcheck/snippets.js    # 修复前的 snippets（同上）
( cd .redcheck && node test_harness.mjs | tail -n 3 )   # ⚠️ 当前 180 项 harness 在此会 SyntaxError（见上）
rm -rf .redcheck
# 说明：36 项红 → 0 项绿，才是"修复真实生效"的证据链；
#       只跑绿的不跑红的，无法排除"测试本身就测不到"的可能。

# Snippets 体积门禁：>32768 直接拒绝部署（防"改了源码顺手重新混淆、把超限产物当部署物"）
SNIP=snippets.js
S=$(wc -c < "$SNIP")
if [ "$S" -le 32768 ]; then echo "PASS $SNIP=$S ≤ 32768，可部署";
else echo "FAIL $SNIP=$S > 32768（Cloudflare Snippets 硬限额），拒绝部署"; exit 1; fi
```

> `snippets.obf.js` 已废弃删除（`_obfuscate.mjs` 不再生成它）——它必然超 32KB、从来不是部署件。
> `test_harness.mjs` 全文不含 `snippets.obf.js` 体积断言（该断言针对的是**部署件 `snippets.js`**）。
> （harness 里那条体积断言针对的是**部署件 `snippets.js`**，当前 31463B ≤ 32768，通过。）

---

## 2. Workers 侧部署

### 2.1 路径 A：Wrangler（推荐，可审计、可复现）

**一次性准备**（仅首次需要）：

```bash
cd C:/Users/snove/workbuddy-ai/GitHub Project/graintcp
npm i -g wrangler
wrangler login                       # 浏览器授权 Cloudflare 账号
wrangler d1 create graintcp          # 输出里记下 database_id
wrangler d1 execute graintcp --remote --file=schema.sql   # 建 config/whitelist/logs/stats 四张表
wrangler secret put UUID             # 粘贴 {UUID}
```

把 `wrangler d1 create` 返回的 `database_id` 填回 `wrangler.jsonc`：

```jsonc
{
  "name": "graintcp-proxy",
  "main": "worker.obf.js",                                  // ← 线上跑混淆版
  "compatibility_date": "2026-09-01",
  "d1_databases": [
    { "binding": "DB", "database_name": "graintcp",
      "database_id": "<你的 D1 database_id>" }               // ← 必须替换
  ],
  "triggers": { "crons": ["0 */6 * * *"] },
  "vars": { /* 非敏感项；UUID/PROXYIP 等敏感值走 secret */ }
}
```

**每次发布**：

```bash
cd C:/Users/snove/workbuddy-ai/GitHub Project/graintcp
node _obfuscate.mjs        # 保证 worker.obf.js 与 worker.js 同源（见 1.3）
node _predeploy_check.mjs  # 部署前独立预检（产物同源 / snippets ≤32KB / 产物存在 / 文档数据自查），任一不过即拒绝部署（等价 `npm run predeploy`）
npm run doccheck           # 文档数据自查：文档声明的项数/字节数/sha256/路径 vs 实际（也可由上一行自动带跑；`DOCCHECK=off` 可临时跳过）
wrangler deploy            # 打包并发布 main 指向的文件
wrangler deployments list  # 记下本次 Version ID，回滚要用
```

**判定标准**：
- `wrangler deploy` 输出 `Uploaded <name>` + `Deployed <name> triggers`，且打印的 **Upload 体积 ≈ 831KB**（若只有 300 多 KB，说明部署的是明文版，`main` 被改过）；
- `wrangler deployments list` 首行是刚刚的 Version ID，时间戳为当前时间。

### 2.2 路径 B：Dashboard（新手友好，无本地工具链）

1. **Workers & Pages → Create → Worker**（或进入已有 Worker → **Edit code**）。
2. **全量粘贴 `worker.obf.js` 全文**（不是 `worker.js`，除非你刻意要明文版），**Deploy**。
   - 混淆版约 85 万字符，粘贴时**务必等编辑器完全响应再点 Deploy**；大文件粘贴不完整是"部署成功但行为诡异"的常见来源。
3. **绑定 D1**：Storage & Databases → D1 → 建库 `graintcp` → 回到 Worker → **Settings → Bindings → Add → D1 Database**，**变量名必须填 `DB`**（大小写敏感，写错等于没绑）。
4. **初始化表结构**：D1 → Console，粘贴 `schema.sql` 全文执行。
5. **环境变量**：Worker → **Settings → Variables and Secrets**。
   - 敏感项（`UUID`、`PROXYIP`、`SUB_PASSWORD`、`TG_BOT_TOKEN`…）用 **Secret** 类型；
   - 非敏感项可用明文 Variable；
   - 改完**必须再点一次 Deploy 让变量生效**（Dashboard 改了变量不重新部署是第二大坑）。
6. **Cron Triggers**：Worker → Settings → Triggers → Cron Triggers → 添加 `0 */6 * * *`（配合 `STATS_ENABLED=true` 才真正推送）。

**判定标准**：
- Bindings 列表出现 `DB` → `D1 Database` → 你的库名；
- Triggers 里 Cron 表达式为 `0 */6 * * *`；
- Variables 列表里 `UUID` 类型显示为 `Secret`（值显示为 `****`）。

### 2.3 环境变量优先级（务必记住这条链）

```
环境变量（Dashboard Secret / wrangler secret / vars）
        ↓ 未设置时回落
D1 `config` 表（面板「保存配置」写入，键名与环境变量同名）
        ↓ 仍无值时回落
代码内置默认值
```

**运维含义**：
- 你在**面板**里改了 `PROXYIP`，但**环境变量**里也有 `PROXYIP` → **环境变量赢**，面板改了看不出效果。排障时先确认"这个键到底哪一层在生效"。
- 排查 SQL：`SELECT key, value FROM config;`（D1 Console）——只能看到第二层，环境变量层要去 Settings 看。
- 面板可写键为白名单（`flag=save_config` 的 `ALLOWED_KEYS`），`UUID`、`KEY`、`SUB_PASSWORD` 等**不在白名单**，只能通过环境变量改。

**判定标准**：设置一个可观测变量（如 `PS` 节点备注）到环境变量层，刷新订阅，备注变化 → 说明环境变量层生效；再从面板保存同键不同值，**若订阅备注不变** → 优先级链符合预期。

### 2.4 Cron Triggers

| 项 | 值 |
|---|---|
| 表达式 | `0 */6 * * *`（每 6 小时） |
| 生效前提 | `STATS_ENABLED=true` 且 `TG_BOT_TOKEN` / `TG_CHAT_ID` 已配 |
| 行为 | `scheduled` 处理器**编辑同一条 TG 消息**持续刷新（不刷屏） |
| 手动触发 | Dashboard → Worker → Settings → Triggers → 点 Cron 的 **Run**（或等下一个整点） |

**判定标准**：TG 里出现用量消息；6 小时后同一条消息被编辑更新（`message_id` 不变、内容变化）。

---

## 3. Snippets 侧部署

### 3.1 前提与限额

| 项 | 要求 | 判定 |
|---|---|---|
| 计划 | **付费计划**（Free 无 Snippets 功能） | Dashboard 能看到 Rules → Snippets 入口 |
| 体积 | **≤ 32768 字节（硬限额）** | `wc -c snippets.js` → 冻结基线实测 31463 字节（≈30.7KB）✅ |
| CPU | 5ms/请求 | 轻量形态，勿加面板类重逻辑 |

```bash
wc -c C:/Users/snove/workbuddy-ai/GitHub Project/graintcp/snippets.js      # 必须 ≤ 32768

# 体积门禁（>32768 直接拒绝，防止把超限产物当部署物）
S=$(wc -c < C:/Users/snove/workbuddy-ai/GitHub Project/graintcp/snippets.js)
[ "$S" -le 32768 ] && echo "PASS $S" || { echo "FAIL $S > 32768，拒绝部署"; exit 1; }
```

### 3.2 部署步骤

1. Dashboard → **Rules → Snippets → Create Snippet**。
2. **粘贴 `snippets.js` 全文**（明文版；本项目不再生成混淆版 snippets 产物）。
3. **绑定 hostname**：规则形如 `*.{你的域}/*`（或精确 host，如 `{HOST}/*`）。
   - ⚠️ **Snippets 只对"经过 Cloudflare 代理（橙云）的 hostname"生效**；DNS 记录为灰云（DNS only）的域名，Snippets 不会执行 → 现象是"规则配了但完全没反应"。
   - 一个 hostname 同时命中 Worker 路由与 Snippet 时，**两者都会执行**，行为叠加难以推理；排障期建议一个域名只挂一种形态。
4. **保存即生效**（Snippets 无需 Deploy 按钮，保存后下一次请求就生效）。

**判定标准**：Snippets 列表显示该规则为 Active，体积显示 < 32KB；`curl -I https://{HOST}/{SUB_PASSWORD}` 返回 200 而非 Cloudflare 默认页。

#### 3.2.1 ⭐ 粘贴保真校验（Snippets 独有的真实风险）

`snippets.js` **不是单行文件**：共 **61 行**，其中压缩块**最长行 11627 字符**。实测无 CR、无 BOM、无控制字符（除 `\n`/`\t`），以单个 LF 结尾，末字符为 `}`，含中文注释（合法非 ASCII）。

**真实风险是"超长行被编辑器回折/截断"和"智能引号替换"（`"` → `“ ”`），不是字符级损坏。** 粘贴后**必须回读校验**：

```bash
cd C:/Users/snove/workbuddy-ai/GitHub Project/graintcp
S=$(wc -c < snippets.js)
echo "长度=$S（基准 31446）"
head -c 60 snippets.js; echo "   <- 首 60 字符（基准见下）"
tail -c 2 snippets.js | cat -A              # 基准：} 后接 $（即以 LF 结尾）
sha256sum snippets.js | cut -c1-12          # 基准：312c664da700
```

| 校验项 | 基准值 |
|---|---|
| 长度 | **31446** 字节 |
| sha256（前 12 位） | **`93153be9504d`** |
| 首 60 字符 | `const UUID="d675a8ea-61bc-4db9-a8a6-109ca1ec8385",SUB_PWD="s` |
| 末字符 | `}`（文件以 LF 结尾） |
| 行数 / 最长行 | 61 行 / 11627 字符 |

> ⚠️ 上述长度与哈希是**当前冻结版**的值。**若后续再改动源码，这组基准必须同步更新**（体积会变）。

**回读方法**（按可靠性排序）：① 用 Cloudflare API 回读该 Snippet 内容比对 sha256；② 面板内全选复制回本地文件再比对；③ 至少比对「长度 + 首 60 字符 + 末 2 字符」。**致命项是截断与智能引号。**

### 3.3 文件头两行配置（Snippets 的全部配置入口）

Snippets 没有环境变量，所有配置**硬编码在文件头部**，改完必须重新保存：

```js
// 第 1 行：UUID / SUB_PWD（订阅密码路径）/ ADF（推广行过滤正则）
const UUID="...",SUB_PWD="sub",ADF=/telegram|t\.me|premium/i;
// 第 2–7 行：出口与订阅参数
let PIP="Pro"+"xyIP."+"CM"+"Liussss.net";       // 默认 ProxyIP，支持 `域名!txt` TXT 池（Snippets 独有）
let SUB="https://sub.xdu.qzz.io/";        // 优选订阅生成器
let SUBAPI="https://subapi.cmliussss.net";
let SUBINI="https://raw.githubusercontent.com/.../ACL4SSR_Online_Full_MultiMode.ini";
const SBV11="https://raw.githubusercontent.com/.../1.11.x/sing-box.json";
const SBV12="https://raw.githubusercontent.com/.../1.12.x/sing-box.json";
```

> 注意源码里字符串被拆成 `"Pro"+"xyIP."+"CM"+"Liussss.net"` 这类拼接形式——这是作者刻意的抗静态扫描写法，**改配置时改整段拼接结果即可，不要把拼接拆坏**。

**判定标准**：改 `SUB_PWD` 后保存，旧路径 `/{旧密码}` 返回非 200、新路径 `/{新密码}` 返回 200。

### 3.4 环境约束差异（决定你该选哪种形态）

**Workers 与 Snippets 是两个不同的运行环境，能力上限不同，禁止把两者当成"同一份代码换个地方跑"。**
下表只列**部署侧可观测的硬约束**（官方文档口径）；xHTTP 实现层面的逐项差异属该**逐环境审计专项**的范围，本手册不预设结论。

| 维度 | Workers | Snippets |
|---|---|---|
| 执行时间 | 无 5ms 级限制 | **5ms / 请求** |
| 内存 | 宽松 | **2MB** |
| 脚本/包体 | 单脚本限额宽松（`worker.obf.js` 861905B 可部署） | **32KB 硬限额**（`snippets.js` 31463B ✅） |
| 出站 subrequest 数 | 宽松 | **Pro 2 / Business 3 / Enterprise 5** ⚠️ 关键瓶颈 |
| 持久化 | **有 D1**（绑定名 `DB`）+ `config`/`whitelist`/`logs`/`stats` | **无 D1** |
| 管理面板 | 有（`/{SUB_PASSWORD}` 登录、`flag=` 系列） | **无面板** |
| Cron Triggers | 有（`0 */6 * * *` + TG 用量推送） | 无 |
| 环境变量 | 有（三层优先级，见 §2.3） | **无**——全部硬编码在文件头（见 §3.3） |
| 竞速建连 `CONCUR` | 1–16 | **强制降为 1** |
| 部署方式 | wrangler / Dashboard 粘贴 | Dashboard 规则引擎粘贴，保存即生效 |
| 产物 | `worker.obf.js`（线上）/ `worker.js`（排障） | `snippets.js`（唯一可部署） |

**部署选型建议**：

- 需要面板、D1 持久化、Cron 用量推送、订阅聚合 → **Workers**。
- 只要"代理 + 订阅本体"、且接受无面板 → **Snippets**；但务必先算清 **subrequest 预算**（见下）。
- **不要**为了"统一维护"把 Workers 的功能往 Snippets 里塞：32KB + 5ms + 2MB 是硬墙，塞进去只会超限或超时。

> ⚠️ **subrequest 预算（Snippets 侧最容易被忽略的部署阻塞点）**
> `/proxyip=` 命中后 `order = ['direct','proxy']`，**target 与 proxyip 都是域名**时，实测消耗：
> - **`fetch()` 子请求 = 2**（直连腿 1× DoH **A** + 反代腿 1× DoH **TXT**；实测**没有 AAAA 查询**）
> - **`connect()` = 2**（直连腿 1 + 反代腿 1）
>
> 在 **Pro 计划的 2 个 subrequest** 预算下：若 CF 只把 `fetch()` 计为 subrequest → **2 ≤ 2，不超，但 Pro 恰好卡满、零余量**；Business(3)/Enterprise(5) 有余量。若 `connect()` 也计入 → 4 > 2 会超限。
> **但用户实测 WS 可用 ⇒ 实际总消耗未超其计划上限 ⇒ 可推断 `connect()` 不计入 subrequest。**
> 超限现象：Snippet 抛 "too many subrequests" 类错误 → 客户端 502 / 中断。
>
> **降级办法（只对 Snippets 有效）**：`proxyip` 填**IP**（省掉 1 次 TXT DoH），或让直连腿成功（省掉 TXT + 1 次 connect）。
> 正确做法仍是：在真实计划的 staging 上跑一次 `/proxyip=` 路径确认。
> **该降级策略不得反向施加到 Workers**（Workers 无此预算，跳过预解析只会白白损失直连能力）。

---

## 4. 线上验证清单（核心）

**执行顺序**：L0 → L1 → L2 → L3 → L4 → L5 → L6 → **L8（出厂检验，最重要）**。
L7 是**修复前的线上实测证据**（只读，供理解根因），L6 为待确认项。

- **只想知道"修好没有"**：直接跑 **L8**（一条命令、两个断言，同时覆盖 P0 与 P1）。
- **要完整交付**：跑 L0 → L8，并核对 L5 的 **180 项 0 失败** 与 **36 项红基线**。
- **L2 是 P0 的判定点，不通过就等于修复失败**，后面不用看。

### L0 基础可达性 `[curl 可判定]`

```bash
# 1) DNS + TLS + 边缘是否活着
curl -sS -o /dev/null -w 'dns=%{time_namelookup}s tls=%{time_appconnect}s ttfb=%{time_starttransfer}s code=%{http_code}\n' \
  https://{HOST}/version?uuid={UUID}
```

| 观测 | 判定 |
|---|---|
| `code=200` | ✅ 边缘路由到本 Worker/Snippet，继续 |
| `code=404` | 端点可达但 UUID 校验没过 → 检查 `{UUID}` 是否与线上配置一致 |
| 连接超时 / `dns=` 很大 | 域名解析或橙云代理未开 → 先修 DNS，**不要继续往下测** |

### L1 `/version` 与订阅端点 `[curl 可判定]`

```bash
# /version：EDT 兼容探测，模糊校验（前 8 位十六进制和 + 后 12 位全等）
curl -sS "https://{HOST}/version?uuid={UUID}"
# 期望：{"Version":2142,"Kernel":"GrainTCP"}

# /sub?uuid=：无密码订阅端点（转换器回源用）
curl -sS -o /tmp/sub.txt -w 'code=%{http_code} bytes=%{size_download}\n' \
  "https://{HOST}/sub?uuid={UUID}"
head -c 200 /tmp/sub.txt; echo

# /{SUB_PASSWORD}：浏览器→面板；客户端→订阅
curl -sS -o /tmp/panel.html -w 'code=%{http_code} bytes=%{size_download}\n' \
  "https://{HOST}/{SUB_PASSWORD}"
```

| 端点 | 判定标准 |
|---|---|
| `/version?uuid={UUID}` | HTTP 200 且 JSON 含 `"Version":2142` 与 `"Kernel":"GrainTCP"` |
| `/sub?uuid={UUID}` | HTTP 200 且体积 > 0；内容为 base64 订阅（解码后含 `vless://`）或 Clash YAML |
| `/{SUB_PASSWORD}` | HTTP 200 且返回 HTML（面板登录页）；体积通常 > 1KB |
| 设了 `SUB_TOKEN` 时 | 未带令牌的 `/sub` 请求应被拒绝（非 200）→ 反向验证令牌在生效 |

### L2 ⭐ xHTTP 下行是否恢复（本次 P0 的唯一判定点）

> **说明**：裸 curl 发不出合法 VLESS 帧，但**可以手工拼一帧**。下面 L2.1/L2.2 的所有 curl 命令都基于
> 「用一个手工构造的 34~40 字节 VLESS 帧」——它足以让 Worker 走完 `padding → XH_HS → parseVP → matchID → 出口建连`
> 全流程。因此 **L2.2 是纯 curl 就能判定 P0 的测试**，不需要真实客户端。
>
> 帧结构（与 `worker.js` 的 `XH_HS` / `parseVP` 对齐）：
> `[0]=0x00 版本` · `[1..16]=UUID 16 字节` · `[17]=0x00 addon 长度` · `[18]=0x01 cmd(TCP)` ·
> `[19..20]=端口大端` · `[21]=地址类型(0x02=域名)` · `[22]=域名长度` · `[23..]=域名` · 其后为可选**首包载荷**

#### L2.1 入口存活探测（随机体）`[curl 可判定]`

```bash
curl -sS -D - -o /tmp/xh_body.txt -w '\nHTTP=%{http_code}\n' \
  -X POST "https://{HOST}/xh" \
  -H 'Content-Type: application/octet-stream' \
  --data-binary @<(head -c 64 /dev/urandom) \
  --max-time 10
echo '--- body ---'; cat /tmp/xh_body.txt; echo
```

**响应语义对照表（本手册最有判别力的一张表）：**

| 观测 | 含义 | 下一步 |
|---|---|---|
| `HTTP=400` + body **为空** | ✅ **xHTTP 入口活着**：padding 校验通过、已进入握手解析，只是随机体不是合法帧 | 入口健康，进 L2.2 |
| `HTTP=400` + body=`Bad Request` | ❌ **padding 校验失败**：请求带了 padding 头但 Huffman 长度不在 98–1002 字节 | 见 §7 分支 D |
| `HTTP=502` + body 以 `xhERR:` 开头 | ⚠️ 握手**成功**、**出口建连失败**（`xhERR:` 后是具体错误） | 见 §7 分支 B/C |
| `HTTP=500`（Cloudflare 错误页 / 空 500） | ❌ **入口内部抛异常**（**本轮线上实测未观测到 500**，属"万一见到"的形态）。**必须先按 URL 形状分两类**（§7 分支 F）：含 `%3F`+非法转义 ⇒ **F1，已确证且已修复**；普通 path 下仍 500 ⇒ 原怀疑的 `new Headers(XH_HD)` **已被实测否定**，转查 `XH_TS()` / `XH_HS` / `req.fetcher.connect()` | 见 §7 分支 F（F1/F2 判据） |
| `HTTP=200` + `Content-Type: application/octet-stream` | 命中测速站拦截，或随机体恰好构成合法握手（概率极低） | 进 L2.2 用确定帧重测 |
| `HTTP=404` / `405` | ❌ 根本没进 xHTTP 分支 | 查：① `Content-Type` 是否 `application/octet-stream`（`application/grpc` 亦可）；② 是否 `POST`；③ Snippet/Worker 是否真绑到这个 hostname |
| 无响应 / 超时 | 边缘或运行时挂了 | `wrangler tail`（Workers）/ Snippets 日志 |

#### L2.2 ⭐⭐ 下行数据是否恢复 —— 纯 curl 判定（P0 核心判定点）

**思路**：让 Worker 去连一个**明文 HTTP 目标**（`example.com:80`），并在 VLESS 帧后**附带首包载荷**（一个 HTTP/1.0 请求）。
目标会把 HTTP 响应写回来 —— 这段响应**只能通过"远端 → 下行管道 → 响应流"回传**。
所以：**收到 `00 00` 之后的 HTTP 文本 = 下行已恢复；只收到 `00 00` 然后挂死 = 下行仍断流。**

```bash
cd C:/Users/snove/workbuddy-ai/GitHub Project/graintcp

# 1) 构造 VLESS 帧：UUID 换成你的 {UUID}（此处示例为 d675a8ea-…）
#    \x00 + UUID16 + \x00 + \x01 + \x00\x50(端口80) + \x02(域名) + \x0b(长度11) + "example.com"
#    之后拼接首包载荷：一个最小 HTTP/1.0 请求
{
  printf '\x00\xd6\x75\xa8\xea\x61\xbc\x4d\xb9\xa8\xa6\x10\x9c\xa1\xec\x83\x85\x00\x01\x00\x50\x02\x0bexample.com'
  printf 'GET / HTTP/1.0\r\nHost: example.com\r\n\r\n'
} > /tmp/frame_http.bin
wc -c /tmp/frame_http.bin      # 期望 34 + 37 = 71 字节

# 2) 发出请求（--max-time 是判定关键：断流时会挂到超时）
curl -sS -D /tmp/xh_hdr.txt -o /tmp/xh_out.bin \
  -X POST "https://{HOST}/xh" \
  -H 'Content-Type: application/octet-stream' \
  --data-binary @/tmp/frame_http.bin \
  --max-time 15 ; echo "curl_exit=$?"

# 3) 看结果
echo '--- headers ---'; cat /tmp/xh_hdr.txt
echo '--- body 前 2 字节（必须是 00 00）---'; xxd /tmp/xh_out.bin | head -3
echo '--- body 全文（前 300 字符）---'; head -c 300 /tmp/xh_out.bin | tr -d '\r'; echo
```

**判定标准（这是 P0 的最终结论依据）：**

| 观测 | 判定 |
|---|---|
| `curl_exit=0`，body 前两字节为 `00 00`，**其后有 `HTTP/1.1 200 OK`（或 3xx）等真实响应文本** | ✅✅ **下行已恢复，P0 修复生效** |
| `curl_exit=28`（超时），body **只有 `00 00`** 或为空，无任何后续字节 | ❌ **下行仍断流** → §7 分支 A，立即回滚（§6） |
| `curl_exit=0` 但 body 只有 `00 00`（远端主动关闭） | ⚠️ 目标可能拒绝了请求；换目标（`example.org` / 你的自建 HTTP 服务）重测 |
| HTTP 头是 `502` + `xhERR:` | 出口建连失败，不是下行问题 → §7 分支 C |

> **为什么这个测试能精确打中 P0**：修复前的缺陷是 `xhF` 在同一同步任务里对 `ts.writable` 发了两次 `pipeTo`
> （先写 `[0,0]` 前缀那次，再 `rm.readable.pipeTo(ts.writable)`），第二次抢锁必然失败 → 走 `.then(drop, drop)`
> 的失败分支 → **关掉远端 socket**。结果就是：`[0,0]` 能出来（第一次写成功），**远端数据永远进不了响应流**。
> 本测试恰好把这"半步"暴露成"有 `00 00`、无后续字节"。

> **换目标的备选**：若你的出口访问不到 `example.com:80`，换成任意**明文 HTTP** 目标与配套 Host 头，
> 例如 `\x02\x0bexample.org`（`example.org` 同为 11 字节，帧长度不变）；或指向你自建的 HTTP 服务
> （域名长度不同时记得同步改第 `[22]` 字节的长度值）。

#### L2.3 响应伪装头指纹（padding 头）`[curl 可判定]`

真实代理成功（HTTP 200）时，响应会带一个**动态命名**的 padding 头：

| 项 | 规则 |
|---|---|
| 头名 | `{UUID}.slice(1,7)` —— UUID 的**第 2–7 位共 6 个字符** |
| 头值 | 形如 `https://x.invalid/?_{UUID}.slice(25,31)=<100–900 位 base62 随机串>` |

```bash
# 在 L2.2 的 headers 里核对（示例 UUID=d675a8ea-61bc-4db9-a8a6-109ca1ec8385）
grep -iE 'grpc-status|x-accel-buffering|cache-control|^675a8e:' /tmp/xh_hdr.txt
```

| 观测 | 判定 |
|---|---|
| 出现 `675a8e: https://x.invalid/?_09ca1e=<随机串>` | ✅ UUID 已正确注入运行时、响应伪装链路完好 |
| 头名对不上 UUID 前 6 位（第 2–7 位） | ❌ 线上跑的**不是你以为的那份配置**（UUID 环境变量/`KEY` 派生与客户端不一致） |
| `grpc-status` / `X-Accel-Buffering` / `Cache-Control` 缺失或值异常 | ⚠️ 中间层改写了响应头，可能导致**缓冲**而非流式（表现类似"下行卡住"） |

> ⚠️ 该头**只在真实代理响应上出现**。测速站拦截（`speed.cloudflare.com` / `cp.cloudflare.com`）走的是另一条
> 提前返回分支，**没有**这个头 —— 别拿它当判据。

#### L2.4 真实客户端复验（最终用户视角）`[需真实客户端]`

curl 通过后，仍建议用真实客户端做一次端到端确认（curl 手工帧无法覆盖客户端的 padding、gRPC 分块、并发竞速行为）：

1. 客户端（v2rayN / Xray / sing-box）导入 **xHTTP 传输**节点（`network=xhttp` / `type=xhttp`）。
2. 经其本地入站拉一个**非测速域名**的可校验载荷：

```bash
curl -sS --socks5-hostname 127.0.0.1:10808 -o /tmp/dl.bin \
  -w 'code=%{http_code} bytes=%{size_download} speed=%{speed_download}B/s\n' \
  https://{你的自建或可信站点}/1mb.bin --max-time 30
```

| 观测 | 判定 |
|---|---|
| `bytes` 与预期一致、`speed` 明显 > 0 | ✅ 下行恢复 |
| `bytes` 为 0 / 极小且挂到超时 | ❌ 下行仍断流 → §7 分支 A |
| 客户端日志 `connection established` 后再无流量 | ❌ 典型"连上但无下行" → §7 分支 A |

> ❗ **不要用 `speed.cloudflare.com` 验证"下行是否通"**：本实现会**本地拦截并直接回 204**（不消耗建连），
> 会给你"通了"的假象。做下行体积验证请换非测速域名。

#### L2.5 出口路径解析验证（P1）`[需真实客户端]` / `[离线 harness]`

`/proxyip=` 的解析发生在**握手之后**，且 `order = ['direct','proxy']` **直连腿优先** ——
这意味着：只要直连能通，无论 path 里的 proxyip 解析成没解析成，**结果都一样（都走直连）**，
curl 从外部无法把它区分开。**所以 P1 没有可靠的 curl-only 判定法**，请用下面两种方式之一。

**方式 A：真实客户端对照（推荐）**

1. 用**同一客户端**建两个节点，仅 path 不同：
   - 节点甲：path = `/proxyip=192.0.2.1:80`（`192.0.2.0/24` 是 RFC 5737 TEST-NET-1，**保证不可路由**）
   - 节点乙：path = `/proxyip%3D192.0.2.1:80`（`=` 以 `%3D` 到达，**P1 的核心场景**）
   - 两者都连一个**直连必然失败**的目标（例如同为 `192.0.2.1:80`），以逼出 proxy 腿
2. 各发起一次请求，观察**错误特征**：

| 观测 | 判定 |
|---|---|
| 甲、乙**行为一致**（同样快速失败、同样报错形态） | ✅ P1 修复生效：`%3D` 已被正确解码 |
| 乙与甲**明显不同**（乙"看似成功"或走了默认反代） | ❌ P1 未生效：`%3D` 解析失败 → 静默回落默认 `PROXYIP`，path 指定被忽略 |
| 两者都成功 | ⚠️ 说明目标并非"不可达"，换更确定不可达的目标重测 |

3. 同法验证**点号形式与尾随斜杠**：`/proxyip=proxyip.example.com.`、`/proxyip=host:443/` ——
   修复后应与不带尾随字符时**行为一致**。

**方式 B：离线 harness（最可靠、可重复）**

```bash
cd C:/Users/snove/workbuddy-ai/GitHub Project/graintcp
node test_harness.mjs     # 重点看「路径语法矩阵」「addrParser」两组是否全绿
```

> 优先采信方式 B：它直接断言解析结果，不受直连/代理腿先后顺序干扰。
> 若 harness 全绿但线上仍"出口不对"，那是**配置层**问题（`PROXYIP` 环境变量覆盖了 path），
> 回到 §2.3 的优先级链排查。

### L3 传输形态对照 `[需真实客户端]`

| 形态 | 期望 | 判定 |
|---|---|---|
| **WS**（本次未改动，对照组） | 正常 | 能打开网页、能看视频 → 证明"出口链路/账号/UUID"都没问题 |
| **xHTTP**（本次修复对象） | 修复后应与 WS 同等可用 | L2.2 通过 |

> **对照法的价值**：WS 通而 xHTTP 不通，且 xHTTP 能握手不能下行 → 问题被**精确锁定在下行链路**，可排除 UUID、出口地址、客户端配置等一整片区域。

### L4 客户端行为矩阵 `[需真实客户端]`

| 场景 | 期望 | 不通过时看 |
|---|---|---|
| 打开普通网页 | 正常渲染 | §7 分支 A |
| 拉取 1MB 大文件 | 完成、速度合理 | §7 分支 A |
| UDP 类请求（如 DNS over UDP 直连） | **明确 400 `UDP is not supported`** | 这是**设计行为**，非故障；见 §7 分支 E |
| 访问 `speed.cloudflare.com` | 直接 204，不消耗建连 | 若走真实建连 → 拦截逻辑异常 |

### L5 离线回归 `[离线 harness]`

```bash
cd C:/Users/snove/workbuddy-ai/GitHub Project/graintcp
node test_harness.mjs        # 期望：180 项、0 失败
```

**判定标准**：**180 项、0 失败**，尤其关注 `xHTTP 双端全链路`、`gRPC 编解码`、`路径语法矩阵`、`addrParser` 四组。任一项红 → **不要部署**，退回 fullstack-engineer。

**红绿对照（权威数字，必看）**：对**修复前**的代码（`git show 1496ffb:worker.js` / `git show 1496ffb:snippets.js`，即修复提交 `b8f5846` 的父提交）跑回归，实测 **36 项失败**（该提交早于 gRPC 功能，当前 180 项 harness 的导出清单依赖其不存在的符号，无法在其上完整运行；36 为其可运行项中的失败数）。

| 被测代码 | 结果 | 含义 |
|---|---|---|
| 修复前（`1496ffb`） | **36 项失败** | 红基线 —— 证明这套测试**确实能测出这些缺陷** |
| 修复后（冻结基线） | **0 / 180 失败** | 绿 —— 证明缺陷已被消除 |

**36 项红分别落在 5 类缺陷上**（可用于确认"测试打中的就是我们要修的东西"）：

| 缺陷 | 红项数 | 代表失败用例 |
|---|---|---|
| **P1** 路径解析（`%3D` / `%2F` / `proxyip.` 点号 / 尾随斜杠 / `/ip=` / `/pyip=` / `/xh/proxyip=`） | 17 | `worker pCfg /proxyip%3D1.1.1.12`、`worker xHTTP /proxyip=1.1.1.15/`、`snippets xHTTP /proxyip.1.1.1.14` |
| **%3F 预解码非法编码**（未捕获 ⇒ 500） | 12 | `worker xhF 入口 "%3F+非法编码 x%3F%zz"：正常放行 200 不崩溃`（worker/snippets × ws/xhF × 3 种非法编码） |
| **XH_HS 域长越界**（`n==o+3` 读 `b[o+3]` 越界 ⇒ 误 400） | 4 | `worker XH_HS 域帧切片=o+3 → 1（等待更多，不得 -1）` |
| **P0** 下行断流 | 2 | `worker xHTTP 下行：远端数据回传客户端`、`worker xHTTP 下行：远端 socket 未被关闭` |
| **snippets 无 `!txt` 直连**（`snippets` 侧新增用例） | 1 | `snippets /proxyip=域名（无 !txt）：预算内直接 connect 主机名` |
| **合计** | **36** | |

> 🔑 **只跑绿的不跑红的，证据链是不完整的**：如果测试本身就测不到该缺陷，它也会"全绿"。
> **36 项红 → 0 项绿的对照才是"修复真实生效"的证明**。这也是本手册不再给任何断言留"预期失败"豁免的原因。

> ✅ **没有豁免项**：harness 全文**不含** `snippets.obf.js` 体积断言（该文件已废弃删除）。
> 所以"0 失败"就是字面意义的 0 失败，**不要给自己留任何"这条红是预期的"空间** —— 那正是掩盖真红的第一步。
>
> ⚠️ **离线全绿 ≠ 线上可用**：harness 跑在 **Node/undici** 上，**未建模 workerd 边缘的行为**（尤其是头处理与 URL 预解码环境）。
> 因此 L5 通过只是"逻辑层没坏"，**不能替代 L2 / L7 的真实环境验证**。

### L6 待确认项

#### L6.1 ✅ 已关闭：`Connection: keep-alive` / `grpc-status`（`XH_HD`）在 workerd 下的行为

**结论：已验证 —— workerd 不会拒绝该头，此前的猜测已被实测推翻。**

依据（**我方真实线上探针，已确证的实测事实**）：对线上端点 POST 一个合法 VLESS 首包
（目标 `speed.cloudflare.com`，UUID 用真实值），**两端（`xtgm` / `snipt`）均返回 `200 + HTTP/1.1 204 No Content`**，
且响应头里**能看到 `Connection: keep-alive` 与 `grpc-status: 0` 被原样回传** ⇒ workerd **不会**拒绝该头。

由此确定：

- 删除 `Connection` 属**对齐 EDT 的卫生清理**，**不是根因**；
- **任何文档不得写成"workerd 会抛错"** —— 该说法无官方依据（官方 Headers 文档 "Differences" 仅列
  `getAll()` / `Set-Cookie` 折叠 / `USVString`；按 Fetch 规范 forbidden **response**-header name 只有
  `Set-Cookie` / `Set-Cookie2`，`Connection` 属 forbidden **request**-header name，对 Response 不适用），
  且已被上面的实测直接否定；
- quality-security-expert 的**安全复核结论**（`new Headers(XH_HD)` **无需改动，低风险**）与实测一致。

> 原"待确认"状态**予以关闭**。§7 分支 F 中关于该头的部分随之降级为**排查用假设**（见下）。

#### L6.2 ⏳ 仍开放：Snippets subrequest 预算

| 项 | 现状 | 收口动作 |
|---|---|---|
| Snippets 侧 **subrequest 预算**（Pro 2 / Business 3 / Ent 5）是否被 `/proxyip=` 的 DoH 组合打爆（§3.4） | 未在真实计划上实测；**用户实测 WS 可用**，故不能断言现状已超限 | 用真实计划的 staging 跑一次 `/proxyip=` 路径，观察是否出现 subrequest 超限错误；若有，再决定是否做**仅 Snippets 的**降级（不得反向施加到 Workers） |
| `worker.obf.js` 体积 861905B 距 Workers 单脚本限额的余量 | 未超限，可部署 | 每次重新混淆后确认体积未出现异常跳变（> 1.5MB 需排查混淆配置） |

> 标注原则：**未在真实运行时验证过的结论不写成"已验证"**。L6.2 两项为开放项，请勿在交付说明中表述为已通过。

### L7 线上根因实测证据表（冻结基线 · 修复前）

这是本轮**最有价值的证据**：在**修复前的线上代码**上，对两个真实端点做 VLESS 首包探测的实测结果。
它把 P0 与 P1 从"推测"变成了"可复现的事实"。

| 端点 | 请求 path | 实测结果 |
|---|---|---|
| `xtgm`（Workers，`xtgm.snove999.eu.org`） | `/` | 200，只有 2 字节 `[0,0]` |
| `xtgm` | `/proxyip=ProxyIP.CMLiussss.net` | 200，只有 2 字节 `[0,0]` |
| `xtgm` | `/proxyip=ProxyIP.CMLiussss.net/` | 200，2 字节后 curl 超时（exit 28） |
| `snipt`（Snippets，`snipt.snove999.eu.org`） | `/` | 200，只有 2 字节 |
| `snipt` | `/proxyip=ProxyIP.CMLiussss.net` | 200，只有 2 字节 |
| `snipt` | `/proxyip=ProxyIP.CMLiussss.net/` | **502 `xhERR:Specified address is empty string, contains unsupported characters or is too long.`** |
| `snipt` | `/proxyip%3DProxyIP.CMLiussss.net` | 200 + 2 字节（**静默回落到默认反代**） |
| `snipt` | `/proxyip=1.1.1.1` | 502 `xhERR:proxy request failed, cannot connect to the specified address.` |

> 复现方式：见 **L8**（同一个 90 字节 VLESS 首包），或直接跑 `docs/post_deploy_accept.sh`。

#### L7.1 P0 确证：下行断流

**两端都是「200 + 恰好 `[0,0]`，之后一个字节都没有」** —— 这正是用户所报
**"能握手、打不开网页"** 的精确形态：握手成功、`[0,0]` 前缀能出，但**下行数据永远不来**。
对应 §7 分支 A，与 P0（`xhF` 对 `ts.writable` 重复 `pipeTo` 抢锁 → `drop()` 关远端 socket）完全吻合。

#### L7.2 P1 确证：且是 Snippets 的直接死因

`/proxyip=ProxyIP.CMLiussss.net/`（**带尾随斜杠**）在 Snippets 上直接 **502**：
旧代码把 `ProxyIP.CMLiussss.net/` **连着斜杠**塞进了 `connect()`，于是报
`Specified address is empty string, contains unsupported characters or is too long.`

**为什么客户端真实请求就是这个形状**：Xray 的 `GetNormalizedPath()` 在 `sessionIDPlacement`
默认为 `path` 时，会**自动给 path 追加尾随 `/`**。所以**用户客户端的真实请求路径就是
`/proxyip=ProxyIP.CMLiussss.net/`** —— 正好命中这条 502。

> 这解释了为什么 P1 不是"边缘 case"而是**必现**：只要客户端用默认配置，请求路径就带尾随斜杠。
> 同时 `/proxyip%3D…` 返回 200（**静默回落默认反代**）证实了 P1 的另一半——
> 编码形式解析失败时**不报错、悄悄用默认反代**，属最难排查的一类缺陷。
>
> 对照 `snipt` 的 `/proxyip=1.1.1.1` → 502 `proxy request failed, cannot connect…`：说明**修复后**
> 反代地址能被正确解析并真正尝试建连（而不是被当成非法字符串拒绝）——这是 P1 修好的可观测信号。

### L8 部署后验收协议（可直接执行 · 零凭据）

**这是本手册的"出厂检验"**：一条命令判定 P0 + P1 是否同时修好。

> ✅ **已有现成脚本，优先直接用它**：`docs/post_deploy_accept.sh`（本手册同目录，零凭据、只读、无副作用）。
> ```bash
> cd C:/Users/snove/workbuddy-ai/GitHub Project/graintcp
> bash docs/post_deploy_accept.sh
> ```
> 它做的事与本节完全一致：构造同一个 90 字节 VLESS 首包 → 对 **`xtgm.snove999.eu.org`（Workers）** 与
> **`snipt.snove999.eu.org`（Snippets）** 各探 `/`、`/proxyip=…`（无尾随斜杠）、`/proxyip=…/`（带尾随斜杠）
> 三条路径 → 判 **200 且字节数 > 2** → 另跑一次 `speed.cloudflare.com` 的**入口存活**探针。
> 退出码 0 = 全部通过。
>
> 本节保留**完整原理与手工步骤**，用于：脚本不可用时的替代执行、以及理解"为什么这样判"。

#### 步骤 1：构造合法 VLESS 首包

字段布局（与 `XH_HS` / `parseVP` 对齐）：

| 偏移 | 内容 |
|---|---|
| `[0]` | `0x00` 版本 |
| `[1..16]` | UUID 16 字节（`d675a8ea-61bc-4db9-a8a6-109ca1ec8385`） |
| `[17]` | `0x00` addon 长度 |
| `[18]` | `0x01` cmd = TCP |
| `[19..20]` | 端口大端（`0x0050` = 80） |
| `[21]` | `0x02` 地址类型 = 域名 |
| `[22]` | `0x0b` 域名长度（11） |
| `[23..33]` | `example.com` |
| `[34..]` | 首包载荷（56 字节 HTTP 请求） |

**方式 A：Python（推荐，不易错）**

```python
# make_frame.py —— 生成 VLESS 首包
import struct, sys, uuid
UUID = "d675a8ea-61bc-4db9-a8a6-109ca1ec8385"
HOST, PORT = "example.com", 80
payload = b"GET / HTTP/1.0\r\nHost: example.com\r\nConnection: close\r\n\r\n"
head = (b"\x00" + uuid.UUID(UUID).bytes + b"\x00" + b"\x01"
        + struct.pack(">H", PORT) + b"\x02" + bytes([len(HOST)]) + HOST.encode())
sys.stdout.buffer.write(head + payload)
```

```bash
python make_frame.py > /tmp/frame.bin
wc -c /tmp/frame.bin        # 期望 90 字节（帧头 34 + 载荷 56）
```

**方式 B：纯 hex（无 Python 环境时）**

```bash
# 180 个 hex 字符 = 90 字节；分段含义见上表
FRAME_HEX='00d675a8ea61bc4db9a8a6109ca1ec838500010050020b6578616d706c652e636f6d474554202f20485454502f312e300d0a486f73743a206578616d706c652e636f6d0d0a436f6e6e656374696f6e3a20636c6f73650d0a0d0a'

printf '%s' "$FRAME_HEX" | xxd -r -p > /tmp/frame.bin
# 若 xxd 不可用，等价写法：
# perl -e 'print pack("H*", $ARGV[0])' "$FRAME_HEX" > /tmp/frame.bin

wc -c /tmp/frame.bin        # 同样期望 90 字节
```

#### 步骤 2：POST 到带尾随斜杠的 `/proxyip=` 路径

> 两个端点的真实域名：**`xtgm.snove999.eu.org`（Workers）**、**`snipt.snove999.eu.org`（Snippets）**。
> `Content-Type` 用 `application/grpc` 或 `application/octet-stream` **都可以**（入口两者都接受；
> 现成脚本 `post_deploy_accept.sh` 用的是 `application/grpc`）。

```bash
for H in xtgm.snove999.eu.org snipt.snove999.eu.org; do
  echo "=== $H ==="
  curl -sS -D /tmp/h_$H.txt -o /tmp/b_$H.bin \
    -X POST "https://$H/proxyip=ProxyIP.CMLiussss.net/" \
    -H 'Content-Type: application/grpc' \
    --data-binary @/tmp/frame.bin --max-time 20
  echo "curl_exit=$?  bytes=$(wc -c < /tmp/b_$H.bin)"
  xxd /tmp/b_$H.bin | head -3
  head -c 200 /tmp/b_$H.bin | tr -d '\r'; echo
done
```

#### 步骤 3：判定标准

| 观测 | 判定 |
|---|---|
| 两端**都返回 200，且 `bytes` 远大于 2**（应含 `example.com` 的 HTTP 响应原文，形如 `HTTP/1.1 200 OK` 或 `3xx`） | ✅✅ **P0 与 P1 同时通过** |
| 仍是 **恰好 2 字节**（只有 `[0,0]`） | ❌ **P0 未修好** → 下行仍断流，§7 分支 A |
| 返回 **502**（含 `xhERR:...`） | ❌ **P1 未修好**（或出口不可用）→ §7 分支 B/C |
| 返回 **404** | ❌ 请求没进 xHTTP 入口（分发门槛 / 部署错了文件，见 §1.1） |
| 返回 **5xx / 连接异常** | ⚠️ 其他形态 → §7 分支 F（本轮实测未观测到） |

> **为什么这个协议同时覆盖 P0 与 P1**：path 带**尾随斜杠**（P1 的必现触发形状，见 L7.2），
> 而 `bytes >> 2` 要求**真实下行数据回传**（P0 的判定点）。一条命令、两个断言。
>
> **注意**：本协议用 `example.com:80` 明文目标，**不要**换成 `speed.cloudflare.com` / `cp.cloudflare.com`
> ——那两个会被入口短路成 204，测的是"入口存活"而不是"下行通畅"（见 L2.4 的警告）。

---

## 5. 可观测性与 SLO（建议纳入日常）

### 5.1 SLI / SLO 定义

| 指标 | 目标值 | 测量方式 | 告警阈值 |
|---|---|---|---|
| 代理入口可用率 | 99.9% / 30 天 | 外部探针每 5 分钟 POST xHTTP 入口（L2.1），**判 `400 + 空 body` 为健康**；`404`/`405`/`5xx`/超时计为失败 | 连续 3 次探测失败（15 分钟） |
| xHTTP 入口 5xx 率 | < 0.1% | 统计 xHTTP 分支返回 5xx 的比例（**安全网**：本轮实测未观测到 500，保留以防回归） | > 1% 持续 5 分钟 |
| **`/proxyip=` 尾随斜杠 502 率** | < 0.1% | 探针 POST `/proxyip=<默认反代>/`（**P1 的必现形状**，见 L7.2），统计 502 比例 | > 1% 持续 5 分钟 |
| **xHTTP 下行字节数** | > 2 字节 | 探针按 **L8 验收协议** 执行，记录 `wc -c` 结果 | 出现"恰好 2 字节"即告警（P0 回归） |
| xHTTP 下行成功率 | ≥ 99% | 客户端探针经代理拉取固定 64KB 载荷（L2.4），统计"完整收完"比例 | 5 分钟内成功率 < 95% |
| 订阅端点可用率 | 99.9% | 探针 GET `/sub?uuid=` 与 `/{SUB_PASSWORD}`，判 HTTP 200 + 体积 > 0 | 连续 3 次失败 |
| 首字节时延（TTFB） | P95 < 1.5s | 探针记录 `time_starttransfer` | P95 > 3s 持续 15 分钟 |
| 出口建连失败率 | < 1% | 统计响应体以 `xhERR:` 开头的比例（需日志采样） | > 5% 持续 10 分钟 |

> 说明：`/version` 的 404 是**正常的鉴权拒绝**，不要把它计入可用率分子分母——否则探针会被自己的错误配置刷成"全红"。

### 5.2 探针与日志

- **Workers**：`wrangler tail {WORKER_NAME} --format pretty` 实时看请求；Dashboard → Worker → Logs 看历史。
- **Snippets**：Snippets 日志能力弱，建议**外置探针**（上面的 SLO 探针）而非依赖平台日志。
- **D1 侧**：`SELECT date, count FROM stats ORDER BY date DESC LIMIT 7;` 看日请求量趋势；异常下跌通常先于用户报障。
- **告警去噪**：只对"连续 N 次失败"告警（见上表），单次抖动不告警。

---

## 6. 回滚方案

### 6.1 回滚触发条件（满足任一即回滚，不要犹豫）

| 编号 | 触发条件 |
|---|---|
| R1 | 部署后 L2.2（真实下行）由"通"变"不通"，且 5 分钟内未定位到配置类原因 |
| R2 | 部署后 WS 形态也异常（说明改动波及面超出预期） |
| R3 | L5 离线回归在部署前就是红的（**预防性回滚：直接不部署**） |
| R4 | 订阅端点 `/sub` 或 `/{SUB_PASSWORD}` 由 200 变非 200，且 10 分钟内未恢复 |
| R5 | 出口建连失败率 > 5% 持续 10 分钟 |

### 6.2 回滚步骤（Workers）

**方式一：Dashboard 版本回滚（最快，推荐）**

1. Dashboard → Workers & Pages → `{WORKER_NAME}` → **Deployments**。
2. 找到**上一个已知良好**的 Version（时间戳早于本次发布）。
3. 点该版本右侧 **⋯ → Rollback**（或选中后 Rollback to this deployment）。
4. **判定**：Deployments 顶部出现新的 Active 记录，其内容等于被回滚到的旧版本。

**方式二：本地备份回滚（Dashboard 版本已不可用时）**

```bash
cd C:/Users/snove/workbuddy-ai/GitHub Project/graintcp
STAMP=<你要回滚到的备份时间戳>
cp docs/backup/$STAMP/worker.obf.js   worker.obf.js
cp docs/backup/$STAMP/wrangler.jsonc  wrangler.jsonc
cd docs/backup/$STAMP && sha256sum -c SHA256SUMS.txt   # 期望全部 OK
cd C:/Users/snove/workbuddy-ai/GitHub Project/graintcp
wrangler deploy
```

**判定**：`wrangler deploy` 的 Upload 体积与备份产物**同一量级**（≈800KB 量级，**不要要求逐字节一致** ——
混淆器带随机性，见 §1.1.1 的说明）；随后按 **L0 → L2 → L8** 复测通过。

> ⚠️ **回滚也要验行为，不能只看体积**：体积对不上不代表回滚失败（混淆产物不可复现），
> 但**行为必须对上** —— 跑 `node test_harness.mjs`（180 项 0 失败）与 **L8** 验收协议。

**方式三：临时切明文版定位（不是回滚，是排障）**

把 `wrangler.jsonc` 的 `main` 改成 `"worker.js"` → `wrangler deploy`，可拿到可读堆栈。**排障结束务必改回 `worker.obf.js`**，否则等于长期跑未混淆版。

### 6.3 回滚步骤（Snippets）

Snippets 无版本历史，**只能靠备份文本**：

1. 打开 Snippets 编辑页，**全选删除**现有内容；
2. 粘贴 `docs/backup/$STAMP/snippets.js` 全文；
3. 保存（保存即生效）。
4. **判定**：`wc -c` 体积与备份一致；L0–L2 复测通过。

> ⚠️ 注意：备份目录里存的可能是**旧行为**的 `snippets.js`。若本次修复也改了 snippets 侧的对应逻辑，回滚 snippets 会**同时回退该修复**——回滚前先确认"退回去的那版是不是真的可用"。

### 6.4 回滚后必做

1. 复跑 L0 → L2 全部通过，才算回滚成功；
2. 记录：触发条件编号、回滚到的版本/时间戳、复测结果；
3. 把失败现象与 `xhERR:` 原文、`wrangler tail` 片段回传 team-lead，**不要自行再次部署**——需要先定位再重新走 §1.2 备份流程。

---

## 7. 「节点连上但打不开网页」排查树

**起点问题：客户端显示已连接（或"延迟正常"），但浏览器打不开页面。**

```
症状：连上但打不开
│
├─ 先做一次二分：把同一账号/同一出口、只换传输形态
│   ├─ WS 能上网、xHTTP 不能  → 问题在 xHTTP 链路（进 A）
│   └─ WS 也不能上网          → 与本次改动无关，先查出口/账号/客户端（进 B/C/E）
│
├─ A【下行断流】← 本次 P0 的典型特征
│   特征：客户端能握手；能收到 VLESS [0,0] 前缀；之后永远没有下行数据；
│         上行看似有量（或客户端显示已连接），页面一直转圈最终超时。
│   区分点：★「有 [0,0] 前缀、无后续字节」是下行断流的**唯一硬指纹**；
│          若连 [0,0] 都收不到，那不是下行断流，是握手或入口问题（回到 L2.1）。
│   判别动作：
│     [curl 可判定]  L2.1 → HTTP=400 且 body 为空 ⇒ 入口与握手解析正常
│     [curl 可判定]  L2.2 → body 只有 `00 00`、curl_exit=28 超时 ⇒ ★直接命中下行断流
│     [已确证]       L7.1 线上实测：两端均「200 + 恰好 2 字节 [0,0]，之后无字节」
│                     ⇒ 这就是"能握手、打不开网页"的精确形态（修复前的实测事实）
│   根因：worker.js 中 xhF 在同一同步任务内对 ts.writable 发起了两次 pipeTo
│         （先 start() 里 enqueue [0,0] 的那次，再 rm.readable.pipeTo(ts.writable)），
│         按 Streams 规范第二次必然抢锁失败 → 走 .then(drop, drop) 的失败分支 → 关远端 socket。
│   止损：回滚到上一个已知良好版本（§6.2）。
│   修复状态：**已在冻结基线中修复**（改为链式 `pre.then()` 单写者模型），
│             以 **L8 部署后验收协议**复验（`bytes` 必须远大于 2）。
│
├─ B【反代地址未生效（P1）】
│   特征：能连上、也能上网，但**出口 IP/地区不是 path 里指定的那个**；
│         或 path 写了 `%3D` / 尾随斜杠 / 点号形式时"看似成功但走的是默认反代"。
│   区分点：★与 A 的区别是「有下行、能上网」，只是出口不对；
│          ★与 C 的区别是「没有超时，反而成功了」——**静默回落**才是 P1 的特征。
│   判别动作：[需真实客户端] L2.5 两节点对照（`=` vs `%3D`），
│             行为不一致 ⇒ P1 未生效（`/proxyip=` 未 decodeURIComponent 且正则锚定 `^`，
│             `%3D` 或点号/尾随斜杠导致解析失败 → 静默回落默认反代）。
│             [已确证] L7.2 线上实测（修复前）：
│               · `snipt` + `/proxyip=ProxyIP.CMLiussss.net/` → 502
│                 `xhERR:Specified address is empty string, contains unsupported characters or is too long.`
│               · `snipt` + `/proxyip%3DProxyIP.CMLiussss.net` → 200 + 2 字节（**静默回落**）
│             ★ 且这是 **Snippets 的必现死因**：Xray `GetNormalizedPath()` 在默认
│               `sessionIDPlacement=path` 下会**自动给 path 追加尾随 `/`**，客户端真实请求路径
│               就是 `/proxyip=…/`，直接命中 502。
│             [离线 harness] 更可靠：`node test_harness.mjs` 的「路径语法矩阵」须全绿。
│   止损：改用未编码的 `/proxyip=host:port` 形式临时绕过（不 encode 的 `=` 能正常解析）。
│   修复状态：**已在冻结基线中修复**（decodeURIComponent + 放宽正则锚定）；
│             以 **L8 部署后验收协议**（path 带尾随斜杠）复验。
│
├─ C【直连腿超时】
│   特征：`[curl 可判定]` L2.1 返回 **502 + `xhERR:`**；客户端表现为"连上后长时间无响应后失败"。
│   区分点：★与 A 的区别是 **A 会先给你 [0,0] 再静默**，C 在**建连阶段就失败**（拿不到数据流）；
│           ★响应体里有 `xhERR:` 明文 = 出口建连抛异常，这是 C 的指纹。
│   排查动作：
│     · 看 `xhERR:` 后面的错误文本（连接被拒 / DNS 失败 / TLS 失败 / 超时）；
│     · 检查 `PROXYIP` 环境变量层是否覆盖了你以为的值（§2.3 优先级链）；
│     · 直连腿超时常见于目标地址被墙或 ProxyIP 不可用，换出口参数
│       （`/proxyip=`、`?mode=proxy`）复测。
│   止损：临时把 `PROXYIP` 换成已知可用地址；或 `?mode=direct` 走直连验证目标本身是否可达。
│
├─ D【padding 头不匹配】
│   特征：`[curl 可判定]` L2.1 返回 **400 且 body 为 `Bad Request`**（注意：不是空 body！）。
│   区分点：★与"入口正常"的区别就在**响应体**：空 body 的 400 = 握手解析失败（正常），
│          `Bad Request` 文本的 400 = **padding 校验失败**（异常）。
│   根因：请求携带的 padding 头（头名 = UUID 第 2–7 位）值经 HPACK-Huffman 编码后
│         长度不在 98–1002 字节区间；注意**不带 padding 头时校验直接放行**，
│         所以"头不匹配"一定是客户端主动发了但发错了。
│   排查动作：用客户端对比不同 padding 设置；或直接 curl 复现（L2.1 的响应体形态即可确诊）。
│   止损：客户端侧关闭/调整 padding 长度，或改用与部署一致的默认配置。
│
├─ E【UDP 被拒 400（设计行为，不是故障）】
│   特征：只有 UDP 类流量失败（如某些客户端的 UDP DNS/QUIC），TCP 一切正常。
│   区分点：★TCP 正常、仅 UDP 异常 ⇒ 就是它。
│   Cloudflare Workers 无 UDP 出站，实现里对 `cmd=2` **显式返回 400 `UDP is not supported`**。
│   处置：这是**预期行为**，不是 bug。客户端侧把 UDP 关闭、改用 TCP DNS（DoH/TCP）即可。
│   ⚠️ 不要把它当成"xHTTP 修复失败"来排查——它和本次改动无关。
│
└─ F【xHTTP 入口 500（运行时报错）】
    特征：L2.1 返回 **500**（而非 400/502）；`wrangler tail` 里能看到抛出的异常堆栈；
          客户端表现是"完全不通"——连 `[0,0]` 都拿不到。
    区分点：★与 A 的区别是 **A 能拿到 [0,0]**，F 连数据流都建立不起来；
           ★与 C 的区别是 **C 是 502 + `xhERR:` 明文**（出口建连失败，已被 try 捕获），
             **F 是 500**（异常逃逸到运行时，说明出错点在 try 覆盖范围之外）。
    ★★ 关键第一步：**500 必须与请求 URL 形状关联，有两类互不相干的 500** ——
       F1【URL 解码类】✅ **已确证且已在冻结基线中修复**
          URL 含 `%3F` + 非法转义（如 `/x%3F%zz`）⇒ 命中 `%3F` 预解码路径
          （`worker.js:1623` / `2134` 附近；**修复前**该处 `decodeURIComponent` **未包 try** ⇒ 抛错 500；修复后已包 `try` 安全降级）。
          **证据**：红基线里 **12 项**失败全部属此类 —— worker/snippets × ws/xhF 入口 × 3 种非法编码
          （`%`、`%zz`、`%E0%A4%A`），期望"正常放行不崩溃"但旧代码抛错。
          修复后这 12 项转绿（`node test_harness.mjs` → 180 项 0 失败）。
          判据：**把 URL 换成不含 `%3F` 的普通 path（如 `/xh`）重测；若 500 消失 ⇒ 属 F1。**
       F2【响应头类】❌ **假设已被实测否定**（见下方）
          普通 path 下仍 500 ⇒ 原本怀疑 `new Headers(XH_HD)`；但线上探针已证明
          `Connection: keep-alive` / `grpc-status: 0` 被**原样回传**（L6.1）⇒ **不是这个原因**。
    为什么桩测抓不到（当时的判断）：离线 harness 跑在 **Node/undici** 上，**未建模 workerd 边缘的行为**
              （尤其是头处理与 URL 预解码的执行环境差异）—— 这是"全绿但仍不通"的典型来源。
              ⚠️ 这是"桩测建模不全"的**现象描述**，**不等于**已证明任何具体机制。
    判别动作：
      · [curl 可判定] L2.1 用**普通 path**（`/xh`）→ 500 ⇒ 排除 F1，转查其他抛错点；
      · [curl 可判定] 同参数换 `%3F` 形状 URL → 500 ⇒ 命中 F1（**若在冻结基线上出现，说明修复未部署成功**）；
      · [需真实环境] `wrangler tail {WORKER_NAME}` 看堆栈，用行号定位。
    止损：回滚（§6）；改法由 fullstack-engineer 定稿。
    ⚠️ **不要再去验证 `Connection` 头**：实测已否定该假设。若真遇到普通 path 下的 500，
       应转查 `XH_TS()` / `XH_HS` / `req.fetcher.connect()` 那条线。
    ⚠️ **本轮线上实测未观测到 500**（实测为 400/200）——F1 是在**离线红基线**上确证的，
       本分支保留用于"万一见到 500"时的定位方向。
```

**速查：一句话区分六类**

| 症状指纹 | 指向 |
|---|---|
| 有 `[0,0]`、之后无任何下行字节；远端 socket 被关闭 | **A 下行断流** |
| 有下行、能上网，但出口不是 path 指定的地址 | **B 反代未生效（P1）** |
| 拿不到数据流；响应体 `xhERR:`；502 | **C 直连腿超时** |
| 400 + body 恰好是 `Bad Request` | **D padding 不匹配** |
| TCP 全好、仅 UDP 400 | **E 设计行为** |
| **500**；连 `[0,0]` 都没有；tail 有 xhF 内异常堆栈 | **F 入口运行时抛错**（F1 已确证并已修复；线上实测未观测到 500） |

---

## 8. 判定速查卡（打印/收藏）

| 检查 | 命令要点 | 通过标准 |
|---|---|---|
| 备份就绪 | `sha256sum -c docs/backup/<STAMP>/SHA256SUMS.txt` | 全部 OK |
| 冻结基线核对 | `sha256sum worker.js snippets.js worker.obf.js` | 前缀 `a9aed13aeddb`/`312c664da700`/`572d32b515fd` |
| 部署的是修复版 | `wrangler deploy` 输出的 Upload 体积 | ≈831KB（≈850949B，混淆版；明文版只有 300 多 KB） |
| 混淆与源码同源 | 把产物复制成 `worker.js`、明文 `snippets.js` 放临时目录后跑同一套 harness | **180 项全绿、0 失败**（白名单为空、**0 容忍**，任何红一律 `exit≠0`） |
| 断言未被静默跳过 | 产物保留顶层名（`renameGlobals:false`），故 `export { XH_HS }` 追加有效 | `XH_HS 域帧切片` 6 条在产物里**真跑且全绿**（`o+3→1`、`o+3+l→1`、`o+4+l→0`，两端各 3 条），**不是 skipped** |
| 红绿对照 | 对 `1496ffb` 旧代码跑回归 | **36 项失败**（`1496ffb` 早于 gRPC，180 项 harness 无法在其上完整运行；证明测试确实能测出缺陷） |
| 离线≠线上 | — | L5 全绿**不能**替代 L2 / L7 / L8 |
| Snippets 体积门禁 | `wc -c snippets.js` ≤ 32768 | PASS（冻结基线 31463B） |
| 边缘可达 | `curl /version?uuid={UUID}` | 200 + `Version:2142` |
| 订阅可达 | `curl /sub?uuid={UUID}` | 200 + 体积 > 0 |
| 面板可达 | `curl /{SUB_PASSWORD}` | 200 + HTML |
| **xHTTP 入口存活** | L2.1 POST octet-stream | **400 + 空 body** |
| **入口未抛错** | L2.1 状态码（**用普通 path `/xh`**） | **不得为 5xx**（本轮实测为 400/200） |
| **P0+P1 出厂检验** ⭐⭐⭐ | **L8 验收协议**（POST `/proxyip=<默认反代>/`） | **200 且 `bytes` 远大于 2** |
| **下行已恢复** ⭐⭐ | L2.2 手工 VLESS 帧打 `example.com:80` | **`00 00` 之后有 HTTP 响应文本、curl_exit=0** |
| **下行已恢复（客户端侧）** | L2.4 真实客户端拉 1MB 非测速资源 | **bytes 与预期一致、speed>0** |
| **P1 已生效** | L8 / L2.5（`=` vs `%3D`）/ harness | **带尾随斜杠不再 502；路径语法矩阵全绿** |
| 响应头未被拒 | L6.1 线上探针 | **`Connection` / `grpc-status` 原样回传**（已验证） |
| 形态选型正确 | §3.4 环境约束差异表 | Snippets 侧 subrequest 未超限、体积 ≤32768 |
| UUID 注入正确 | 响应头名 = UUID 第 2–7 位 | 头名与 UUID 对得上 |
| UDP 行为 | 客户端 UDP 请求 | 400 `UDP is not supported`（预期） |
| 回滚可用 | Deployments 有旧 Version / 备份齐全 | 二选一至少一条成立 |

---

## 9. 交付边界声明

- 本手册**只做只读分析与文档产出**，未修改 `worker.js` / `snippets.js` / `test_harness.mjs` 等任何源码。
- 本手册**不要求、也不建议改动用户本机系统**：不装软件、不改注册表/计划任务/系统代理、不启停本机应用。
- 手册中的 `wrangler deploy` 等**变更类命令由用户本人按需执行**，本文档不代为执行，也未实际部署。
- 所有路径引用均限定在 `C:/Users/snove/workbuddy-ai/GitHub Project/graintcp` 内。
- 安全加固相关内容需与 quality-security-expert 复核后方可作为最终结论。

---

## 10. 本轮 backlog（未实现，仅记录）

以下三项**本轮明确不做**，仅记录结论与理由，避免后续重复讨论或误判为缺陷。

### 10.1 GET 下行 / `stream-up` / `packet-up` 支持 —— 不做

- **现状**：xHTTP 入口**只收 `POST`**（`application/grpc` 或 `application/octet-stream`），下行数据在 POST 响应体内回传。
- **风险**：`mode=auto` 在 **TLS + H2** 下，Xray 会选 `stream-up`，此时**下行是独立的 GET 请求** → 会落到 404。
- **为何不做**：**用户当前配置是显式 `mode=stream-one`**，下行在 POST 响应体内，不受影响。
  本轮目标是修好"两个已确证缺陷"，扩大入口形态属功能扩展，会显著放大回归面。
- **若将来要做**：需同时支持 `stream-up`（独立 GET 下行）与 `packet-up`，并补齐对应的回归用例。

### 10.2 出站门槛放宽为「POST 即进」（EDT 做法）—— 不做

- **内容**：EDT 对 xHTTP 的处理更宽松，不校验 `Content-Type` 白名单。
- **为何不做**：与 10.1 **绑定**（放宽后才能真正用上 stream-up/packet-up）；
  单独放宽**收益低**，且会**吞掉面板的 POST 路由**（`/tg/webhook`、`flag=` 系列都是 POST），引入路由冲突风险。
- **结论**：等 10.1 一起做，或不做。

### 10.3 `Access-Control-Allow-Origin` —— ✅ 已补（本轮回填）

- **现状**：响应**已带** CORS 头。`worker.js:2082` 的 `XH_HD` 含 `'Access-Control-Allow-Origin':'*'`；
  `worker.js:2144` 还会按请求 `Origin` 回显（`hh.set('Access-Control-Allow-Origin', og)`）；`snippets.js` 侧同样已带。
- **轮次**：该头是在**本修复轮的工作区改动**中补入的（`HEAD` 版本的 `worker.js` / `snippets.js` 均**不含**此头，属本轮相对 HEAD 的新增；原「不做」结论作废）。
- **注意**：本项**不再是"有意省略"**；排障时不要把它当成"打不开网页"的原因，也不要再按"缺 CORS 头"去排查。
