# GrainTCP 双端代理（Workers + Snippets）

<!-- doccheck:baseline
harness_total=275
file.worker.js.bytes=390620
file.worker.js.sha256_12=4434611cfa3b
file.snippets.js.bytes=31463
file.snippets.js.sha256_12=312c664da700
file.worker.obf.js.bytes=914491
file.worker.obf.js.sha256_12=6a06adca7279
-->

基于 [ToiCF/GrainTCP](https://github.com/ToiCF/GrainTCP) 内核与 [cmliu/edgetunnel](https://github.com/cmliu/edgetunnel) 生态兼容约定的 Cloudflare VLESS 代理，提供两个部署形态：

| 文件 | 部署目标 | 定位 |
|---|---|---|
| `worker.js` | Cloudflare **Workers** | 全功能版明文源码：管理面板、D1 持久化、TG 用量推送、订阅聚合 |
| `snippets.js` | Cloudflare **Snippets**（付费计划规则引擎） | 轻量版明文源码：受 32KB/5ms 限制，专注代理与订阅本体，无面板。**Snippets 的唯一部署件** |
| `worker.obf.js` | Cloudflare **Workers** | **Workers 的部署件**（`wrangler.jsonc` 的 `main` 指向它），与明文版行为一致（同一回归套件验证） |
| `wrangler.jsonc` / `schema.sql` | Workers | wrangler 部署配置 / D1 建表脚本 |
| `GrainTCP.js` | 参考 | 上游内核参考快照（部署文件内已内嵌，无需单独部署） |
| `test_harness.mjs` | 本地 | 275 项离线回归测试（Node ≥ 24） |

两文件核心行为对齐：同一套 VLESS 握手、路径语法、伪装体系与订阅契约，客户端无感知切换。

## 功能一览

**传输层**
- WebSocket VLESS（早数据 0-RTT、grain 上行打包合并、BYOB 下行动态分片）
- xHTTP / gRPC（POST + `application/grpc|octet-stream`，跨块握手，手动泵下行）
- HPACK-Huffman 请求 padding 校验（98–1002 字节）+ 响应随机 base62 padding 伪装
- 并发竞速建连（`CONCUR` 可调，Snippets 自动降为 1）+ 12s 建连超时

**出口链路**（按 order 回落）
- direct / ProxyIP（含 `域名!txt` TXT 池：DoH 查询、180s 缓存、随机轮换——仅 snippets 版）
- SOCKS5 / HTTP(S) CONNECT（凭证支持 base64 与 URL 编码）
- sstp 全局代理 / TURN 与 TURNS（RFC 6062 TCP allocations，HMAC-SHA1 鉴权、438 陈旧 nonce 重试、TLS-in-TLS 指纹）
- `?globalproxy` 全局化、`mode=auto` 自动排序

**订阅体系**
- 自适应客户端：clash/mihomo/singbox/surge/quanx/loon 走 subconverter 转换；v2rayN/Shadowrocket 等原生 base64
- 优选订阅生成器哨兵契约（EDT 2.1：`/sub?host=example.com&uuid=00000000-…` 双哨兵探测，地址载体本地重建）
- 转换器回源指向本部署自带端点（避免 URL 截断）、ECH 注入、`AD_FILTER` 推广行过滤、`DLS` 速度下限筛选
- 汇聚订阅 `ADDSUB`：`sub://`、远程订阅、现成节点、纯 IP 列表/CSV 自动分类，并行抓取 + 5s 超时

**测速站本地拦截**：`speed.cloudflare.com` / `cp.cloudflare.com` 直接回 204，不消耗建连。

**UDP**：CF 无 UDP 出站，cmd=2 显式拒绝（400）。

## Workers 部署

### 方式一：Dashboard（推荐新手）

1. **Workers & Pages → Create → Worker**，粘贴 `worker.obf.js` 全文，Deploy。（明文 `worker.js` 仅供排障，不推荐用于生产）
2. **绑定 D1**（**未绑定 D1 时面板将不可用**，见下方 ⚠️）：Storage & Databases → D1 建库 → Worker → Settings → Bindings 添加 `D1 Database`，变量名 **`DB`**。在 D1 Console 执行：

   ```sql
   CREATE TABLE IF NOT EXISTS config    (key TEXT PRIMARY KEY, value TEXT);
   CREATE TABLE IF NOT EXISTS whitelist (ip TEXT PRIMARY KEY, created_at TEXT);
   CREATE TABLE IF NOT EXISTS logs      (id INTEGER PRIMARY KEY AUTOINCREMENT, time TEXT, ip TEXT, region TEXT, action TEXT);
   CREATE TABLE IF NOT EXISTS stats     (date TEXT PRIMARY KEY, count INTEGER);
   ```

3. **环境变量**（Settings → Variables）：至少设置 `UUID`（标准 UUID 格式）。其余见下表，未设置的项走「环境变量 > D1 config 表（面板保存）> 代码默认值」。
4. **TG 用量推送**（可选）：配置 `TG_BOT_TOKEN` / `TG_CHAT_ID` / `STATS_ENABLED=true`，并在 Worker → Settings → Triggers → Cron Triggers 添加如 `0 */6 * * *`（scheduled 处理器会编辑同一条消息持续刷新）。

> ⚠️ **R1-b 行为变更（重要）：无 D1 部署必须显式配置 `AUTH_SECRET`，否则管理面板无法登录。**
> 面板会话 cookie 用 HMAC-SHA256 签名，密钥来源优先级为：① 环境变量 `AUTH_SECRET`（**长度 ≥ 16，弱密钥会被忽略**）→ ② 首次使用时生成 24 字节随机值并**持久化到 D1** → ③ 前两者都不可用时**拒绝签发**。
> 之所以不再回退到登录口令：默认 `WEB_PASSWORD="abc"` 是**源码里的公开常量**（且属弱口令），拿它当 HMAC 密钥等于任何人读源码即可伪造 cookie、面板完全失守。
> 因此：
> - **已绑定 D1**：开箱即用，无需额外配置。若 D1 写入失败会回退口令派生并在日志打印 `[auth] _AUTH_SECRET_AUTO 持久化失败…`，请检查 D1 绑定。
> - **未绑定 D1**：必须设置 `AUTH_SECRET`（**≥ 16 字符的强随机串**），否则登录接口返回 `503` + `no_secret`，**不签发 cookie**（代理与订阅功能不受影响，仅面板不可用）。
> - 修改 `AUTH_SECRET` 或清空 D1 中的 `_AUTH_SECRET_AUTO` 会使既有会话失效，需重新登录。

### 方式二：Wrangler

```jsonc
// wrangler.jsonc
{
  "name": "graintcp-proxy",
  "main": "worker.obf.js",
  "compatibility_date": "2026-09-01",
  "d1_databases": [
    { "binding": "DB", "database_name": "graintcp", "database_id": "<你的 D1 database_id>" }
  ],
  "triggers": { "crons": ["0 */6 * * *"] }
  // 环境变量可用 [vars] 区块，敏感值用 `wrangler secret put UUID`
}
```

```bash
npm i -g wrangler
wrangler d1 create graintcp          # 记下 database_id 填回配置
wrangler d1 execute graintcp --file=schema.sql   # 上面第 2 步的四条建表语句存成 schema.sql
wrangler secret put UUID
node _predeploy_check.mjs   # 部署前预检（产物同源 / snippets ≤32KB / 产物存在 / 文档数据自查），任一不过即拒绝部署
npm run doccheck            # 文档数据自查（文档声明值 vs 实际；上一行的 predeploy 已自动带跑）
wrangler deploy
```

> 运行时 API 以官方文档为准：<https://developers.cloudflare.com/workers/>（TCP sockets / WebSockets / D1 / Cron Triggers）。

### 主要环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| `UUID` | VLESS 用户 ID（`KEY` 设置后可按时间窗动态派生，`UUID_REFRESH` 控制周期秒数） | 代码内置 |
| `PROXYIP` | 反代地址（支持 `host:port`；snippets 版另支持 `域名!txt` 池） | 内置优选 |
| `ADD` / `ADDAPI` / `ADDCSV` / `ADDSUB` | 优选来源：明文 / API 列表 / CSV（带 `DLS` 速度筛选）/ 汇聚订阅 | 空 |
| `SUB_PASSWORD` | 订阅与面板访问密码（路径 `/{SUB_PASSWORD}`） | 内置 |
| `SUB_TOKEN` | 追加订阅令牌（设置后未携带则拒绝） | 空 |
| `SUB_DOMAIN` / `SUB` | 订阅优选域名（EDT `SUB` 别名兼容） | 内置 |
| `SUBAPI` / `CLASH_CONFIG` | subconverter 地址 / Clash 模板（EDT `SUBCONFIG` 别名兼容） | 内置 |
| `DLS` | CSV 下载速度下限 MB/s | 7 |
| `AD_FILTER` | 生成器推广行过滤正则（源字符串，勿加引号） | telegram\|t.me\|premium |
| `CONCUR` | 竞速建连并发 1–16 | 4 |
| `ECH_ENABLED` / `ECH_SNI` / `ECH_DNS` | ECH 注入开关与参数 | true / cloudflare-ech.com / 223.6.6.6 |
| `WEB_PASSWORD` / `PS` / `LOGIN_PAGE_TITLE` / `DASHBOARD_TITLE` | 面板密码 / 节点备注 / 页面标题 | 内置 |
| `TG_BOT_TOKEN` / `TG_CHAT_ID` / `STATS_ENABLED` / `STATS_CHAT_ID` | TG 通知与用量推送 | 空 |
| `CF_TOKEN`（或 `CF_EMAIL`+`CF_KEY`）/ `CF_ZONE_ID` | CF GraphQL 用量查询 | 空 |
| `SINGBOX_CONFIG_V11` / `V12` | singbox 转换模板 | 内置远程模板 |
| `BEST_SUB` | 订阅生成器哨兵：`1`/`true` 开启，且**已显式配置 `SUB_DOMAIN`/`SUB` + `BEST_SUB_TOKEN`** 时，命中「`host=example.com` + `uuid=00000000-0000-4000-8000-000000000000` + UA 含 `tunnel (https://github.com/`」三个魔术条件的 `/sub` 请求免 UUID 校验（对齐 EDT）。**未配 `SUB_DOMAIN` 或未配 `BEST_SUB_TOKEN` 时该分支整体不启用**——它跳过鉴权，属安全面 | 空（关闭） |
| `BEST_SUB_TOKEN` | 上述哨兵的**强随机令牌**：**≥32 字符**，且请求须以 `?bst=<令牌>` 携带（常量时间比较）。⚠️ 三个魔术参数与 `SUB_DOMAIN` 都不是秘密（魔术参数是源码字面量、本项目开源；`SUB_DOMAIN` 是普通面板配置项），**只有本令牌是真屏障**；命中后会返回含真实 UUID / ProxyIP / 优选 IP 的完整订阅。**未配置 → 该能力关闭**；请自行生成（如 `openssl rand -hex 24`）并提供给上游调用方 | 空（关闭） |
| `GO2SOCKS5` | SOCKS5 直连白名单（逗号分隔）：目标主机名命中则**跳过 ProxyIP 改走直连**（`a.com` 精确 / `*a.com`、`*.a.com` 点分后缀）。**仅 Workers 版**；格式闸门只接受 `[a-z0-9.*-]`，裸 `*` 被拒；**命中白名单不豁免内网封禁**，目标仍过 `_extHostSafe`。配得过宽等于关闭出网收敛，慎配 | 空（关闭） |
| `RANDOM_HOST` / `HOSTS` | 订阅域名随机化：开关（`1`/`true`）+ 域名池（逗号分隔，支持 `*` 通配为 3~16 位随机串；只接受 `[a-z0-9.*-]`，非法值丢弃）。**配错会直接断网，非自有域名勿开** | 空（关闭） |
| `TLS_FRAGMENT` | 节点串透出 TLS 分片参数：`shadowrocket` → `1,40-60,30-50,tlshello`；`happ` → `3,1,tlshello`。**需客户端支持且服务端同版本，否则别开** | 空（关闭） |
| `SUB_UDP` / `SUB_XUDP` / `SUB_TLS13` / `SUB_APPEND_TYPE` | 发给第三方转换后端的 4 个开关参数（udp / xudp / tls13 / append_type） | 全 `true` |

完整 51 键以代码内 `getSafeEnv` 调用为准（`CONCUR`、`KEY`、`UUID_REFRESH`、`OBS_ENABLED`、`OBS_MIN_LEVEL` 等少数键直接读 `env.*`，不在此列）；D1 config 表中的键与环境变量同名，面板「保存配置」即写入。

**可观测性开关**（直读 `env.*`，**不支持 D1 存储**，改完须重新部署）：

| 变量 | 说明 | 默认 |
|---|---|---|
| `OBS_ENABLED` | 结构化日志总开关，置 `false` 可一键静音 | 开（不设即开） |
| `OBS_MIN_LEVEL` | 最低输出级别：`debug` / `info` / `warn` / `error` / `silent` | `info` |

## 可观测性（批次 6）

线上信号面原先只有「D1 `logs` 表 + 面板 `flag=get_logs`」，且 TG 推送失败**完全静默**。批次 6 补三件事：

1. **SLO 探针**：新增 `GET /health`（上表）；推荐用外部拨测（GitHub Actions，5 min 一次）打它，判 200 + `ok:true`。worker 内 `scheduled` 另做 D1 连通自检并落心跳。
2. **TG 推送可见性**：`sendTgMsg` / `pushDashboard` 的失败不再被 `.catch(()=>{})` 吞掉——连续失败计数写入 D1（无 D1 时退化为 isolate 内存），**连续 3 次进降级冷却 10 分钟**（冷却期内 `pushDashboard` 直接跳过，不硬试、不刷屏），恢复时发**一条**通知。
3. **低频结构化日志**：单行 JSON，`console.log/warn/error` 出口，Workers Logs / `wrangler tail` 可直接检索。样例：

```json
{"ts":"2026-09-16T17:39:18.016Z","lvl":"error","ev":"tg_fail","n":1,"route":"path_pw_or_404","why":"api_false","streak":1,"db":1,"degraded":0}
```

| 字段 | 含义 |
|---|---|
| `ts` / `lvl` / `ev` / `n` | ISO 时间戳 / 级别(10/20/30/40) / 事件枚举 / 本 isolate 第几条 |
| `route` | **路由枚举**（`root` `health` `robots` `logout` `admin_check` `sub_query` `tg_webhook` `favicon` `version` `path_pw_or_404` `other`），**绝不记录原始 pathname** |
| `drop` | 因节流被抑制的条数（同一 `ev` 60 秒内最多 1 条） |

**事件枚举**：`d1_read_fail`（warn）/ `d1_write_fail`（error·warn）/ `d1_ping_fail`（Cron 自检）/ `tg_fail`（error）/ `tg_recovered`（warn）/ `tg_dash_degraded`（warn）/ `tg_send_fail` / `sched_tick`（info 心跳）/ `auth_secret_weak` / `auth_secret_persist_fail` / `auth_no_secret`。

⚠️ **热路径零日志**：WS / xHTTP 每帧、每连接路径上没有任何日志调用；日志只落在 D1 读写失败、TG 失败、Cron 自检这几类低频事件上。敏感值（cookie / token / 口令 / UUID / `AUTH_SECRET` / bot token / IP）一律 `[redacted]`，串内 UUID 与 bot token 也会被抹除。

## 路由速查

| 路径 | 用途 |
|---|---|
| `/{UUID}` | 订阅（原生/自适应） |
| `/{SUB_PASSWORD}` | 浏览器→面板；客户端→订阅 |
| `/sub?uuid={UUID}` | 无密码订阅端点（转换器回源用，`?flag=true` 供转换器拉取） |
| `/version?uuid={UUID}` | EDT 面板兼容探测（`{Version:2142, Kernel:"GrainTCP"}`） |
| `/tg/webhook`（POST） | TG `/stats` 命令 |
| `/robots.txt` | `User-agent: *\nDisallow: /`（防收录；位于蜘蛛拦截之前） |
| `/logout`（GET） | 清 cookie 并 302 到 `/` |
| `/admin/check?socks5=…` | 出口连通检测（**需已登录**；代理主机过 SSRF 白名单，目标固定 `cloudflare.com:80`）。⚠️ **依赖出网 80 端口可用**，与 EDT 的「443 + TLS」方案有偏差；出网 80 不通时返回 `{"success":false,"error":"未取到 cloudflare.com/cdn-cgi/trace 响应…"}`，不会挂起 |
| `/health`（GET） | 存活探针：只返回 `{"ok":true,"t":<epoch秒>}`（**不含版本号/UUID/任何配置值**）。位于蜘蛛拦截之前，curl/拨测 UA 也能拿到；不写日志、不计数 |
| 任意路径 + WS/xHTTP | 代理入口（凭据在 VLESS 层校验） |

**出口参数语法**（写入 WS path 或 xHTTP 路径）：
`/proxyip=host:port`、`/ip=`、`/s5=user:pass@host:port`（`/socks5=`、`/http=`、`/https=`、`/turn=`、`/sstp=` 同理）、`/socks5://…` 与 `/sstp://host:443` 全局代理、`/turn://` `/turns://`、`?globalproxy`、`?mode=auto|proxy|direct`。

**`g` 前缀 = 全局生效**（对齐 EDT）：`/gs5=`、`/ghttp=`、`/ghttps=`、`/gturn=`、`/gsstp=` 表示「连 ProxyIP 也走该代理」；不带 `g` 的前缀形式只在回落时生效。
⚠️ `g` 前缀与 `?sstp=` 仅 **Workers 版**支持；Snippets 版（无 `pCfg`，余量受限）遇到 `gs5=` 会退化为「无 `g` 的回落语义」，不会报错。

> ⚠️ **语义变更（老配置请注意）**：`/sstp=`、`/gsstp=`、`?sstp=`、`/turn=`、`/gturn=` 现在**一律提升为全局代理**（写入 `gP`），不再留在回落分支。原因：回落分支（`tryCon` 的 `method==='s5'`）只实现了 `socks5` / `http` 两种握手，若把 `sstp`/`turn` 留在回落会走 `htConn` 发出错误的 CONNECT 请求。若你此前用 `?sstp=` 当「兜底代理」，请改用 `/s5=` 等回落语法或显式用 `sstp://` 全局语法。

**`GO2SOCKS5` 直连白名单**（仅 Workers 版）：目标主机名命中白名单时跳过 ProxyIP 改走直连。匹配为**精确主机名**或**点分后缀**（`*a.com` / `*.a.com` 只匹配 `a.com` 与 `*.a.com`，**不**匹配 `evil-a.com`）。**白名单不等于放行内网**——命中后目标仍需通过 `_extHostSafe` 校验（回环 / 内网 / 链路本地一律拒绝，报错 `GO2SOCKS5 target blocked`）。

## Snippets 部署

1. 前提：**付费计划**（Free 无 Snippets），限制 32KB / 5ms CPU（`snippets.js` 当前 ~30KB，达标）。
2. 规则 → Snippets → 新建，粘贴 `snippets.js` 全文，绑定到你的 hostname（如 `*.{你的域}/*`），部署即生效。
3. 配置全部在文件头两行：
   - 第 1 行：`UUID`、`SUB_PWD`（订阅密码路径）、`ADF`（推广行过滤正则）
   - 第 2–7 行：`PIP`（默认 ProxyIP，支持 `域名!txt` TXT 池）、`SUB`（优选生成器）、`SUBAPI`、`SUBINI`、`SBV11/12`（singbox 模板）
4. 订阅地址：`https://{域名}/{SUB_PWD}` 或 `/sub?uuid={UUID}`；代理入口语法与 Workers 完全一致。

## 混淆版本说明

`worker.obf.js` 由 javascript-obfuscator 生成：保留顶层导出与全部行为（`renameGlobals` 关闭），本地标识符十六进制化 + 字符串数组化；另含 rc4 字符串编码与控制流平坦化。

- **`worker.obf.js`（914491B ≈ 893KB）——Workers 的部署件**：Dashboard 直接粘贴，或用 wrangler（`main` 已指向它）。Workers 无 32KB 限制，混淆不设防。
- ⚠️ **混淆产物字节不可复现**：构建器启用了 `controlFlowFlattening` / `stringArrayRotate` / `stringArrayShuffle`，带随机性，**同一份源码每次构建的字节与体积都会漂移**（实测三次：845231B → 853000B → 850949B）。因此**不能用哈希判断"产物与源码是否一致"**；唯一有效的门禁是**行为等价**——把产物复制成 `worker.js`/`snippets.js` 放进临时目录，跑同一套回归，**0 容忍——白名单为空，任何红一律 `exit≠0`**。**每次构建后都必须重跑。**<!-- doccheck:allow: 混淆产物漂移示例（历史实测三次值），刻意保留 -->
- 明文/混淆交叉验证：`worker.obf.js` 通过同一套 **275 项**回归。

## 本地测试

```bash
node test_harness.mjs
```

离线桩环境（Node ≥ 24）跑 **275 项**回归：路径语法矩阵、addrParser、WS 中继流、xHTTP 双端全链路（含**下行数据回传**）、gRPC 帧编解码（首帧嗅探/封帧/半包/粘包/畸形/零长 + 正路径 E2E + 模式判定）、`/proxyip=` 7 种路径形态（含编码与尾随斜杠）、`XH_HS` 首包就绪边界、非法百分号编码健壮性、padding/TXT 池/测速拦截/UDP 拒绝、sstp/TURN 建连、订阅哨兵重建、转换器回源、D1 缓存与降频、getCustomIPs 并行、路由冒烟。

> 红绿对照（**152 项时代的历史基线**，不是当前口径）：对修复前的代码（`git show 1496ffb:worker.js` / `git show 1496ffb:snippets.js`，即修复提交 `b8f5846` 的父提交）跑**当时的 152 项 harness** → **36 项失败（36/152）**；修复后当前 **275/275 全绿**。 <!-- doccheck:allow: 红基线为 152 项时代历史口径，刻意保留 -->
> ⚠️ **当前 275 项口径下红基线不可复现**：`1496ffb` 早于 gRPC 功能（P1-9），当前 harness 的导出清单依赖该提交不存在的符号（如 `XH_GCHK`），在其上运行会直接 `SyntaxError`，一条用例都跑不到。红基线只能在**当时的 152 项口径**下复现；本项目的红绿对照一律按「152 项时代历史基线（36/152）」理解。 <!-- doccheck:allow: 红基线为 152 项时代历史口径，刻意保留 -->

## 安全须知

- `UUID` / `SUB_PASSWORD` 泄露 = 代理被白嫖，请定期轮换；`SUB_TOKEN` 可为订阅加第二道锁。
- 管理面板操作（flag= 系列）均校验 auth cookie / 管理员身份；TG webhook 仅响应配置的 chat_id。
- 请遵守 Cloudflare 服务条款与当地法律法规，本仓库仅供学习与个人合法用途。

## 致谢

- [ToiCF/GrainTCP](https://github.com/ToiCF/GrainTCP) — 代理内核
- [cmliu/edgetunnel](https://github.com/cmliu/edgetunnel) — EDT 生态兼容约定（路径语法、哨兵契约、转换器体系）
- [sub-store-template](https://github.com/sinspired/sub-store-template) / ACL4SSR — singbox / Clash 转换模板
