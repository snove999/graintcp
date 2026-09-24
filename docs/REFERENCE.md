# GrainTCP 参考手册（环境变量 · 路由 · 出口语法 · 安全说明）

<!-- doccheck:baseline
harness_total=433
file.worker.js.bytes=442720
file.worker.js.sha256_12=9324c393f0c1
file.snippets.js.bytes=32422
file.snippets.js.sha256_12=1bdd9aee5c1a
file.worker.obf.js.bytes=1016294
file.worker.obf.js.sha256_12=4f89f66fb3f8
-->

> 本文是 README 的完整版。部署入门看 [README](../README.md)；线上验证与回滚看 [DEPLOY_VERIFY](DEPLOY_VERIFY.md)。
基于 [ToiCF/GrainTCP](https://github.com/ToiCF/GrainTCP) 内核与 [cmliu/edgetunnel](https://github.com/cmliu/edgetunnel) 生态兼容约定的 Cloudflare VLESS 代理，提供两个部署形态：

| 文件 | 部署目标 | 定位 |
|---|---|---|
| `worker.js` | Cloudflare **Workers** | 全功能版明文源码：管理面板、D1 持久化、TG 用量推送、订阅聚合 |
| `snippets.js` | Cloudflare **Snippets**（付费计划规则引擎） | 轻量版明文源码：受官方 32KB / 5ms / 2MB / 子请求配额限制，专注代理与订阅本体，无面板。**Snippets 的唯一部署件**（当前 32422B，余量 346B） |
| `worker.obf.js` | Cloudflare **Workers** | **Workers 的部署件**（`wrangler.jsonc` 的 `main` 指向它），与明文版行为一致（同一回归套件验证） |
| `wrangler.jsonc` / `schema.sql` | Workers | wrangler 部署配置 / D1 建表脚本 |
| `GrainTCP.js` | 参考 | 上游内核参考快照（部署文件内已内嵌，无需单独部署） |
| `test_harness.mjs` | 本地 | 433 项离线回归测试（Node ≥ 22，实测 v22.22.2 / v24.19.0 全绿） |

两文件核心行为对齐：同一套 VLESS 握手、路径语法、伪装体系与订阅契约，客户端无感知切换。

## 功能一览

**传输层**
- WebSocket VLESS（早数据 0-RTT、grain 上行打包合并、BYOB 下行动态分片）
- xHTTP / gRPC（POST + `application/grpc|octet-stream`，跨块握手，手动泵下行）
- HPACK-Huffman 请求 padding 校验（98–1002 字节）+ 响应随机 base62 padding 伪装（头值取 Xray queryInHeader 形态 `?键=值`，无固定前缀）
- 并发竞速建连（`CONCUR` 可调，仅 Workers；Snippets 单路建连）+ 12s 建连超时

**出口链路**（按 order 回落）
- direct / ProxyIP（Workers：TXT ∥ A → AAAA 展开 + 池内竞速 + tp1 兜底；Snippets：`域名!txt` 显式、或 `SRQ≥3` 时自动查 TXT 池随机取一，180s 缓存）
- SOCKS5 / HTTP(S) CONNECT（凭证支持 base64 与 URL 编码）
- SSTP 全局代理（**仅 Workers**；移植自 EDT：TLS → `SSTP_DUPLEX_POST` → PPP LCP/PAP/IPCP → TCP-in-IP 封装。此前的 `sstp` 分支只是裸 TCP 连到 sstp 主机再直写 VLESS 载荷，并非 SSTP，本轮已替换）
- TURN 与 TURNS（RFC 6062 TCP allocations，HMAC-SHA1 鉴权、438 陈旧 nonce 重试、20s 总预算、中继固定 IPv4）。⚠️ TURNS 目标为 **IP 字面量**时使用不校验证书链的自实现 TLS（无主机名可校验）；域名目标只走运行时原生 TLS，握手失败即失败，不再降级
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
node _predeploy_check.mjs   # 部署前预检（产物同源 / snippets ≤32KB / 产物存在 / 部署件体积 / 文档数据自查），任一不过即拒绝部署
npm run doccheck            # 文档数据自查（文档声明值 vs 实际；上一行的 predeploy 已自动带跑）
node _doccheck.mjs --update # 刷新基准块。只允许刷新「基准块 + 由基准块机械派生的数字/哈希副本」，禁止改措辞
                            # （脚本逐行断言：归一化后除数字/哈希外必须逐字符相同，违反则回滚该文件并 exit 2）
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
| `ECH_ENABLED` / `ECH_SNI` / `ECH_DNS` | ECH 注入开关与参数 | true / cloudflare-ech.com / `https://odvr.nic.cz/doh` |
| `WEB_PASSWORD` / `PS` / `LOGIN_PAGE_TITLE` / `DASHBOARD_TITLE` | 面板密码 / 节点备注 / 页面标题 | 内置 |
| `TG_BOT_TOKEN` / `TG_CHAT_ID` / `STATS_ENABLED` / `STATS_CHAT_ID` | TG 通知与用量推送 | 空 |
| `CF_TOKEN`（或 `CF_EMAIL`+`CF_KEY`）/ `CF_ZONE_ID` | CF GraphQL 用量查询 | 空 |
| `SINGBOX_CONFIG_V11` / `V12` | singbox 转换模板 | 内置远程模板 |
| `BEST_SUB` | 订阅生成器哨兵：`1`/`true` 开启，且**已显式配置 `SUB_DOMAIN`/`SUB` + `BEST_SUB_TOKEN`** 时，命中「`host=example.com` + `uuid=00000000-0000-4000-8000-000000000000` + UA 含 `tunnel (https://github.com/`」三个魔术条件的 `/sub` 请求免 UUID 校验（对齐 EDT）。**未配 `SUB_DOMAIN` 或未配 `BEST_SUB_TOKEN` 时该分支整体不启用**——它跳过鉴权，属安全面 | 空（关闭） |
| `BEST_SUB_TOKEN` | 上述哨兵的**强随机令牌**：**≥32 字符**，且请求须以 `?bst=<令牌>` 携带（常量时间比较）。⚠️ 三个魔术参数与 `SUB_DOMAIN` 都不是秘密（魔术参数是源码字面量、本项目开源；`SUB_DOMAIN` 是普通面板配置项），**只有本令牌是真屏障**；命中后会返回含真实 UUID / ProxyIP / 优选 IP 的完整订阅。**未配置 → 该能力关闭**；请自行生成（如 `openssl rand -hex 24`）并提供给上游调用方 | 空（关闭） |
| `GO2SOCKS5` | SOCKS5 直连白名单（逗号分隔）：目标主机名命中则**跳过 ProxyIP 改走直连**（`a.com` 精确 / `*a.com`、`*.a.com` 点分后缀）。**仅 Workers 版**；格式闸门只接受 `[a-z0-9.*-]`，裸 `*` 被拒；**命中白名单不豁免内网封禁**，目标仍过 `_extHostSafe`。配得过宽等于关闭出网收敛，慎配 | 空（关闭） |
| `RANDOM_HOST` / `HOSTS` | 订阅域名随机化：开关（`1`/`true`）+ 域名池（逗号分隔，支持 `*` 通配为 3~16 位随机串；只接受 `[a-z0-9.*-]`，非法值丢弃）。**配错会直接断网，非自有域名勿开** | 空（关闭） |
| `NET` | base64 订阅默认传输：`ws`（默认）或 `xhttp`；`?net=ws|xhttp` 单次覆盖；xhttp 节点固定 `mode=stream-one`（本端无 GET 下行），并附 padding 混淆 `extra`（`xPaddingObfsMode` + `tokenish` + `queryInHeader`，头/键由 UUID 派生，与入站校验同源）；节点不写 `alpn`（客户端自行协商）。转换器回源（`flag=` / subconverter UA）恒 ws：mihomo / sing-box 不支持 xhttp。可由面板保存 | ws |
| `TLS_FRAGMENT` | 节点串透出 TLS 分片参数：`shadowrocket` → `1,40-60,30-50,tlshello`；`happ` → `3,1,tlshello`。**需客户端支持且服务端同版本，否则别开** | 空（关闭） |
| `SUB_UDP` / `SUB_XUDP` / `SUB_TLS13` / `SUB_APPEND_TYPE` | 发给第三方转换后端的 4 个开关参数（udp / xudp / tls13 / append_type） | 全 `true` |
| `URL` | **A-8 伪装页 / 反代真实站点**（默认 `''` 关闭，保持未知路径 404）：`nginx` → 内置 nginx 欢迎页；`1101` → Cloudflare 1101 错误页；其他值（如 `example.com` 或 `https://example.com`）→ 反代该站点：`http://` **强制升级为 `https://`**、**必须过 `_extHostSafe` SSRF 闸门**（内网/回环 → 回落 404）、**内部域名后缀黑名单**（`localhost`/`.localhost`/`.local`/`.internal`/`.lan`/`.home`/`.localdomain`/`.intranet`/`.corp`）、**DoH 预解析 + 封禁段校验**（解析不出、或任一解析结果命中内网/回环/链路本地 → 拒绝）、剥离 `Location`/`Set-Cookie`、响应头白名单拷贝（仅 `content-type`/`cache-control`/`etag`/`last-modified`）、**响应体上限 1MiB**（超限回落 404）。**仅 Workers 版**，且为 **env-only**（`URL` 不在面板 `save_config` 白名单内，不可由面板写入） | 空（关闭） |
| `CHAIN_PROXY` | **A-9 链式代理**开关（`1`/`true` 启用）：启用后**带 `Upgrade: websocket`** 的 `GET /video/<密文>` 会解密出全局代理并强制走它（普通 GET 不走）。密文 = `base64url( iv[12] ‖ AES-GCM(JSON{v,t,type,hostname,port,username,password}) )`，其中 `v` 必须为 `1`、`t` 为签发 Unix 秒（服务端 >30 天判过期 → 回落）；密钥 = `HKDF-SHA256(UUID, salt='chain', info='chain')`；`type` 白名单 `socks5/http/https/turn/sstp`；**解密出的 `hostname` 必须过 `_extHostSafe` + DoH 预解析**，否则静默回落。**仅 Workers 版**（Snippets 无 `pCfg`，放不下） | 空（关闭） |

完整 53 键以代码内 `getSafeEnv` 调用为准（`CONCUR`、`KEY`、`UUID_REFRESH`、`OBS_ENABLED`、`OBS_MIN_LEVEL` 等少数键直接读 `env.*`，不在此列）；D1 config 表中的键与环境变量同名，面板「保存配置」即写入。

> **A-2 运营商识别 + 本地随机优选 IP 库（无需任何配置）**：回源第三方转换后端时自动追加 `&cnIspCode=<ct|cu|cmcc|cf>`（由 `request.cf` 的 `country`/`asOrganization`/`asn` 判定，非 CN 或未命中 → `cf`）。当 `ADD`/`ADDAPI`/`ADDCSV`/`ADDSUB` **全部为空**时，订阅回退到「本地随机优选 IP 库」：从 CF-CIDR 源随机生成 `IP:端口#名称`（端口 ∈ `443/2053/2083/2087/2096/8443`）。请求侧 `?cnIspCode=` 参数**只接受 `ct`/`cu`/`cmcc`/`cf` 白名单值**，非法值一律回退识别结果；CIDR 源为**源码字面量枚举**（不受任何请求参数影响），抓取失败/超时/超 256KB 一律回退内置 `104.16.0.0/13`。**不新增任何环境变量**。

> **A-8 伪装页 / 反代（默认关闭，仅 Workers）**：仅当显式配置 `URL` 时启用；未配置时未知路径仍返回 404（零回归）。反代强制复用既有 `_extHostSafe` SSRF 收敛（不新造校验），`http://` 升级为 `https://`，剥离 `Location`/`Set-Cookie`，响应头白名单拷贝，**响应体上限 1MiB（超限回落 404）**，失败仍回 404。反代目标另过**内部域名后缀黑名单**（`localhost`/`.localhost`/`.local`/`.internal`/`.lan`/`.home`/`.localdomain`/`.intranet`/`.corp`）——**仅加在 A-8 反代路径**，不改 `_extHostSafe` 本体。蜘蛛拦截（UA 含 bot/curl 等）保留在伪装之前。
>
> **A-9 链式代理（默认关闭，仅 Workers）**：需 `CHAIN_PROXY=1`，且仅接受**带 `Upgrade: websocket`** 的请求（本轮修复：`ws()` 传入的路径无前导斜杠，旧正则 `\/video\/` 永不命中，该功能此前在真实调用路径下从未生效）（VLESS over WS 握手本身即带 Upgrade，正常用法不受影响）。Snippets 版不识别 `/video/`，该路径按普通路径解析并回落默认 ProxyIP（安全无副作用）。
>
> **⚠️ 已知限制与生成约束（安全复核 F3/F4）**：
> - **F3（A-8 反代 DNS 层）**：已加 **DoH 预解析 + 封禁段校验**（fail-closed：解析不出、或任一解析结果命中内网/回环/链路本地 → 拒绝）。但**纯 DNS rebinding（TTL=0，先回公网再回内网）在本平台不可防** —— `cf.resolveOverride` 经查证**只对「与 Worker 同 zone」的主机生效**，无法钉死第三方域名解析。`URL` 属**管理员配置**（env-only、非攻击者可控）——**请只配置可信外部站点**。
> - **F4-a（A-9 密文）生成约束**：密文须由**本方式**生成 —— `AES-GCM` + **每次随机 12 字节 IV**（`crypto.getRandomValues(new Uint8Array(12))`）；**切勿复用 IV**（GCM 下 IV 重用会导致明文可恢复且可伪造）。明文须含 `v:1` 与 `t`（Unix 秒，服务端 >30 天判过期 → 回落）。**密文等价于上游代理凭据：泄露后须轮换 UUID 或派生盐**。服务端**不防重放**（无状态，无法判 IV 是否重复）。
> - **F4-b（A-11 `admin/check`）不可信声明**：所用 `TlsClient` **不校验证书链**（第三方压缩实现如此）→ **输出不保证真实性，仅供排查参考**（已加 ip/loc 格式闸门：非法格式 → `success:false`，非法 loc → 清空）。该请求不含任何凭据，MITM 最坏后果是出口 IP/loc 误报；如需更强保证，可考虑**双来源交叉验证**（本平台内唯一不改 TLS 栈的加固方向）。

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
| `/admin/check?socks5=…` | 出口连通检测（**需已登录**；代理主机过 SSRF 白名单，目标固定 `cloudflare.com:443` 并**走 TLS 握手**，对齐 EDT）。目标主机/端口**不可由请求参数指定**；出网 443 不通时返回 `{"success":false,"error":"未取到 cloudflare.com:443/cdn-cgi/trace 响应…"}`，不会挂起 |
| `/health`（GET） | 存活探针：只返回 `{"ok":true,"t":<epoch秒>}`（**不含版本号/UUID/任何配置值**）。位于蜘蛛拦截之前，curl/拨测 UA 也能拿到；不写日志、不计数 |
| 任意路径 + WS/xHTTP | 代理入口（凭据在 VLESS 层校验） |

**出口参数语法**（写入 WS path 或 xHTTP 路径）：
`/proxyip=host:port`、`/ip=`、`/s5=user:pass@host:port`（`/socks5=`、`/http=`、`/https=` 同理；`/turn=` 为「直连失败后回落 TURN」，`/sstp=` 提升为全局）、`/socks5://…` 与 `/sstp://host:443` 全局代理、`/turn://` `/turns://`、`?globalproxy`、`?mode=auto|proxy|direct`。

**`g` 前缀 = 全局生效**（对齐 EDT）：`/gs5=`、`/ghttp=`、`/ghttps=`、`/gturn=`、`/gsstp=` 表示「连 ProxyIP 也走该代理」；不带 `g` 的前缀形式只在回落时生效。
`g` 前缀、`/turn=` 与 `?s5=|?socks5=|?http=|?https=|?turn=`、`?global=1` **两端均支持**；`/sstp=` `?sstp=` `sstp://` **仅 Workers**。⚠️ Snippets 侧 TURN 目标为域名时需 3 次子请求（DoH + 2×connect），Pro 计划（配额 2）只能用 IP 字面量目标。

> ⚠️ **语义（老配置请注意）**：`/sstp=`、`/gsstp=`、`?sstp=`、`/gturn=`、`?turn=` **提升为全局代理**（写入 `gP`）；Workers 的 `/turn=`（无 g）保留为「直连失败后回落 TURN」腿；Snippets 无回落腿，`/turn=` 直接全局，且 **Snippets 不支持 sstp**（任何 sstp 语法返回 400 Bad cfg）。原因：回落分支（`tryCon` 的 `method==='s5'`）只实现了 `socks5` / `http` 两种握手，若把 `sstp`/`turn` 留在回落会走 `htConn` 发出错误的 CONNECT 请求。若你此前用 `?sstp=` 当「兜底代理」，请改用 `/s5=` 等回落语法或显式用 `sstp://` 全局语法。

**`GO2SOCKS5` 直连白名单**（仅 Workers 版）：目标主机名命中白名单时跳过 ProxyIP 改走直连。匹配为**精确主机名**或**点分后缀**（`*a.com` / `*.a.com` 只匹配 `a.com` 与 `*.a.com`，**不**匹配 `evil-a.com`）。**白名单不等于放行内网**——命中后目标仍需通过 `_extHostSafe` 校验（回环 / 内网 / 链路本地一律拒绝，报错 `GO2SOCKS5 target blocked`）。

## Snippets 部署

1. 前提：**付费计划**（Free 无 Snippets）。官方限额（[developers.cloudflare.com/rules/snippets](https://developers.cloudflare.com/rules/snippets/)）：**包体 32KB、CPU 5ms、内存 2MB、无环境变量/绑定/日志**；**子请求配额 Pro 2 / Business 3 / Enterprise 5**（重定向链每跳各计 1 次）。`snippets.js` 当前 32422B，余量 346B。
2. 规则 → Snippets → 新建，粘贴 `snippets.js` 全文，绑定到你的 hostname（如 `*.{你的域}/*`），Deploy 即生效（该域名必须是橙云代理记录）。
3. 配置全部在文件头 8 行：
   - 第 1 行：`UUID`、`SUB_PWD`（订阅密码路径）、`ADF`（推广行过滤正则）、**`SRQ`（你的计划的子请求配额，默认 2=Pro）**、**`NET`（base64 订阅默认传输：`ws` 或 `xhttp`）**
   - 第 6–12 行：`PIP`（默认 ProxyIP，支持 `域名!txt` TXT 池）、`SUB`（优选生成器）、`SUBAPI`、`SUBINI`、`SBV11/12`（singbox 模板）、ECH 参数
4. 订阅地址：`https://{域名}/{SUB_PWD}` 或 `/sub?uuid={UUID}`；追加 `&net=xhttp` / `&net=ws` 可单次覆盖 `NET`。xhttp 节点固定 `mode=stream-one`（Snippets 无跨请求状态，GET 下行不可用）并附 padding 混淆 `extra`（同 Workers），仅 Xray 系客户端（v2rayN / v2rayNG / Shadowrocket 等）支持；clash / sing-box 等经转换器的输出恒为 ws（转换器回源 `flag=true` 忽略 `net`）。代理入口语法与 Workers 一致（含 gRPC：`Content-Type: application/grpc` 且无 padding 特征时按 Xray gun 帧剥帧/封帧）。

**`SRQ` 子请求配额门控（Snippets 独有，按官方配额表设计）**：线上实测 `connect()` 与 `fetch()` 合并计数，超限即 Error 1202。默认 `SRQ=2`（Pro）下：`/proxyip=域名` 走「直连 1 + 反代 connect 1」，不做任何 DoH；`域名!txt` 显式池化时跳过直连（TXT 1 + connect 1）。`SRQ≥3` 时 `/proxyip=域名` 自动先查 TXT 池再连（对齐 EDT）；`SRQ≥4` 时 TURN 目标解析追加 AAAA。订阅侧按同一请求内已用次数决定是否回源 ECH DoH、是否再试备用 DoH / 备用 singbox 模板，保证不超配额。`proxyip` 为字面 IP 时永不发起 DoH。

**编辑器 TS 诊断说明**：VS Code 对 `.js` 开启 checkJs 时会报 `IdentityTransformStream` / `WebSocketPair` / `Uint8Array.fromBase64` / `Response({webSocket})` 未知，这是 TypeScript 内置 lib 没有 Cloudflare Workers 运行时类型所致，不影响运行；安装 `@cloudflare/workers-types` 或关闭 checkJs 即可消除。其余可修的诊断（布尔/数组类型收窄、`charCodeAt(0)`、spread 参数）已修。

**Snippets 侧其余适配**：xHTTP 上行背压阈值 256KB、gRPC 重组缓冲上限 512KB（2MB 内存）；WS 侧 cmd=2（UDP）直接关闭；早数据 `Uint8Array.fromBase64` 解码失败回退手动解码（不再 500）；所有未命中路径统一 404 并提示正确订阅写法（`/sub?uuid=<UUID>` 或 `/<SUB_PWD>`；Snippets 无跨请求状态，xHTTP GET 下行不可用，xhttp 节点须 `mode=stream-one`）。

## 混淆版本说明

`worker.obf.js` 由 javascript-obfuscator 生成：保留顶层导出与全部行为（`renameGlobals` 关闭），本地标识符十六进制化 + 字符串数组化；另含 rc4 字符串编码与控制流平坦化。

- **`worker.obf.js`（1016294B ≈ 992KB）——Workers 的部署件**：Dashboard 直接粘贴，或用 wrangler（`main` 已指向它）。Workers 无 32KB 限制，混淆不设防。
  - ⚠️ **别被 999KB 这个数字误导**：Workers 单脚本限额按**未压缩** bundle 计（官方 `Worker size (uncompressed)` = **64 MiB**，Free 与 Paid 相同），本项目占 **1.52%**、余 63.02MiB。压缩后（gzip 398.1KB / brotli 364.7KB）**官方明确不设限**，只作传输参考。`_predeploy_check.mjs` 的 `[4/5]` 会同时打印原始 / gzip / brotli 三个数字与余量。
- ⚠️ **混淆产物字节不可复现**：构建器启用了 `controlFlowFlattening` / `stringArrayRotate` / `stringArrayShuffle`，带随机性，**同一份源码每次构建的字节与体积都会漂移**（实测三次：845231B → 853000B → 850949B）。因此**不能用哈希判断"产物与源码是否一致"**；唯一有效的门禁是**行为等价**——把产物复制成 `worker.js`/`snippets.js` 放进临时目录，跑同一套回归，**0 容忍——白名单为空，任何红一律 `exit≠0`**。**每次构建后都必须重跑。**<!-- doccheck:allow: 混淆产物漂移示例（历史实测三次值），刻意保留 -->
- 明文/混淆交叉验证：`worker.obf.js` 通过同一套 **433 项**回归。

## 本地测试

```bash
node test_harness.mjs
```

离线桩环境（Node ≥ 22，实测 v22.22.2 / v24.19.0）跑 **433 项**回归：路径语法矩阵、addrParser、WS 中继流、xHTTP 双端全链路（含**下行数据回传**）、gRPC 帧编解码（首帧嗅探/封帧/半包/粘包/畸形/零长 + 正路径 E2E + 模式判定）、`/proxyip=` 7 种路径形态（含编码与尾随斜杠）、`XH_HS` 首包就绪边界、非法百分号编码健壮性、padding/TXT 池/测速拦截/UDP 拒绝、sstp/TURN 建连、订阅哨兵重建、转换器回源、D1 缓存与降频、getCustomIPs 并行、运营商识别（cnIspCode 白名单）/ 本地随机优选 IP 库（CF-CIDR + 失败回退）、伪装页/反代（SSRF 闸门 + Location/Set-Cookie 剥离 + 响应头白名单）、链式代理（HKDF 派生 + AES-GCM + SSRF 闸门 + Upgrade 判定）、安全复核残留修复（F1 反代 text 响应体 1MiB 上限 / F2 日志 `err` 白名单 + URL 抹除 / F3 内部域名后缀黑名单）、第十二轮加固（F3 DoH 预解析 + 封禁段校验 / F4-a 密文 `v`+`t` 版本与 30 天过期 / F4-b admin/check 格式闸门）、Snippets 平台适配（WS 侧 cmd=2 拒绝 / 早数据 fromBase64 回退 / A-6 `g` 前缀与 turn= sstp= 查询参数族 / gRPC 紧凑版正路径 + 半包 + 粘包 + 非法帧长 / `SRQ` 子请求配额门控：TXT 池、字面 IP 免 DoH、订阅侧 ECH 与备用模板按剩余配额回源）、路由冒烟。

> 红绿对照（**152 项时代的历史基线**，不是当前口径）：对修复前的代码（`git show 1496ffb:worker.js` / `git show 1496ffb:snippets.js`，即修复提交 `b8f5846` 的父提交）跑**当时的 152 项 harness** → **36 项失败（36/152）**；修复后当前 **433/433 全绿**。 <!-- doccheck:allow: 红基线为 152 项时代历史口径，刻意保留 -->
> ⚠️ **当前 433 项口径下红基线不可复现**：`1496ffb` 早于 gRPC 功能（P1-9），当前 harness 的导出清单依赖该提交不存在的符号（如 `XH_GCHK`），在其上运行会直接 `SyntaxError`，一条用例都跑不到。红基线只能在**当时的 152 项口径**下复现；本项目的红绿对照一律按「152 项时代历史基线（36/152）」理解。 <!-- doccheck:allow: 红基线为 152 项时代历史口径，刻意保留 -->

## 第十五轮：全面审查修复清单（2026-09-19）

四个区域（数据路径 / 面板与 D1 / 订阅 / TURN·SSTP）逐条核实后修复，全部有回归用例（`test_harness.mjs` 第 19、20 节）。

| 编号 | 严重度 | 问题 | 修复 |
|---|---|---|---|
| D1 | P1 | WS 文本帧经 `new Uint8Array(str)` 按数字分配，无需 UUID 即可打爆内存 | 文本帧直接忽略（两端） |
| D2 | P1 | 上行队列无上限，远端慢时无界增长 | 16MiB / 4096 条高水位，溢出断开（Snippets 1MiB） |
| D3 | P2 | 建连期间客户端关闭 → 迟到 socket 永久泄漏 | 建连返回后复查 closed，立即关闭 |
| D4 | P2 | socks5 / HTTP CONNECT 握手失败不关 socket、不释放锁；半关闭时 `resp[1]` 抛 TypeError | try/finally 统一清理，读取判 done |
| D5 | P2 | SSRF 闸门漏 `0x7f.1` 等 inet_aton 2/3 段简写 | 补齐展开 |
| D6 | P3 | SOCKS5 域名长度用 UTF-16 长度；CONNECT 行可注入 CRLF | UTF-8 字节长度；拒绝含空白/CRLF 的目标 |
| P0 | P0 | IP 白名单管理员的 `flag=` POST 无同站校验 → 任意网页 CSRF 改配置；面板 4 个输入框值未转义 | Fetch Metadata 校验；`safeVal` 转义 |
| P1-a | P1 | A-9 链式代理正则要求前导斜杠，真实路径永不命中 | 正则放宽；新增经 `ws()` 的端到端用例 |
| P1-b | P1 | A-8 反代把面板 cookie / cf-connecting-ip 转发给目标站 | 出站剥离敏感头 |
| P2-a | P2 | `getSafeEnv` 对数字型 vars 调 `.trim()` → 全站 500；D1 读失败缓存空表 30s（fail-open） | 类型容错；失败不缓存 |
| P2-b | P2 | 缓存空表窗口内登录会覆盖 `_AUTH_SECRET_AUTO`，所有会话失效 | `INSERT … DO NOTHING` + 直读 |
| P2-c | P2 | `validate_cf/tg` 把请求体当 env（`{DB:1}` 污染全局缓存 / 500） | 字段白名单；非法 JSON → 400 |
| P2-d | P2 | 每请求一次 D1 UPSERT（含 404 扫描），免费额度极易耗尽 | isolate 内聚合 30s/200 次落一次；logs 用 `DB.batch`；订阅日志节流 |
| P3 | P3 | webhook secret / UUID 非常量时间比较；save_config 非 batch | `_ctEq`；`DB.batch` + finally 失效缓存 |
| S1 | P1 | ADDSUB 标签把 `#` 编成 `%23`，vmess base64 与末尾参数被破坏 | 只编码标签内容 |
| S2 | P1 | 路径 B 对透传的 vmess/ss/trojan 行注入 ech/fp/PS 把它们改坏 | 只改写本端 UUID 的 vless 行 |
| S3 | P1 | BEST_SUB 命中时输出真实 UUID/ProxyIP，被调用方当外来节点透传（凭据泄露） | 输出 EDT 哨兵形态（占位 UUID / example.com） |
| S4 | P2 | 未配 `SUB_TOKEN` 时 `/sub?base=` 无鉴权，可耗尽子请求并拿走优选列表 | 未配即关闭端点；常量时间比较 |
| S5 | P2 | pSB 给无 uuid 的 trojan/hysteria2 注入 utls/ech → sing-box 拒载 | 只处理 uuid/password 等于 UUID 的节点 |
| S6–S16 | P2/P3 | 无 padding base64 拒解、裂变 IPv6 丢失、转换器 fetch 无超时/上限、pCL 重复 `dns:`、带引号 uuid 不命中、pipSet 子串误配、target 未白名单、转换器失败回落 base64、ECH 每次 DoH、host==SUB_DOMAIN 回源形态 | 逐项修复 |
| F1 | P1 | `sstp` 只是裸 TCP，从未按 SSTP 握手；A-6 提升的 cfg 形状与连接器不符（host 为 undefined） | 移植 EDT `sstpConnect`；统一 cfg 形状；Snippets 移除该伪功能 |
| F2 | P1 | TURNS 域名目标原生 TLS 失败即降级到不校验证书的自实现 TLS | 域名只走原生 TLS；IP 字面量才用自实现并文档标注 |
| F3 | P2 | TURN `writable.close` 整体拆连，xHTTP 上行结束即掐断下行 | 半关闭数据侧 |
| F4 | P2 | 建连超时 / TLS 失败留半开 socket | 超时即 close |
| F5–F8 | P3 | `?turn=` 凭据 "undefined"；IPv6 目标必败仍逐个尝试且无总预算；DoH 响应体读取不在超时内 | 凭据判空；只用 IPv4 目标 + 20s 预算；body 纳入超时 |

## 安全须知

- `UUID` / `SUB_PASSWORD` 泄露 = 代理被白嫖，请定期轮换；`SUB_TOKEN` 可为订阅加第二道锁。
- 管理面板操作（flag= 系列）均校验 auth cookie / 管理员身份；所有 `flag=` 的 POST 另加 Fetch Metadata 同站校验（`Sec-Fetch-Site` 为 cross-site / same-site，或 `Origin` 不同源 → 403），堵住 IP 白名单管理员被任意网页 CSRF 的路径；TG webhook 仅响应配置的 chat_id，secret 常量时间比较。
- 反代（`URL`）出站请求剥离 `Cookie` / `Authorization` / `cf-*` 等入站头，面板会话不会泄露给伪装目标站。
- WebSocket 文本帧一律忽略（`new Uint8Array("2000000000")` 会按数字分配，攻击者无需 UUID 即可触发）；上行队列 16MiB / 4096 条高水位，溢出即断开。
- 请遵守 Cloudflare 服务条款与当地法律法规，本仓库仅供学习与个人合法用途。

## 致谢

- [ToiCF/GrainTCP](https://github.com/ToiCF/GrainTCP) — 代理内核
- [cmliu/edgetunnel](https://github.com/cmliu/edgetunnel) — EDT 生态兼容约定（路径语法、哨兵契约、转换器体系）
- [sub-store-template](https://github.com/sinspired/sub-store-template) / ACL4SSR — singbox / Clash 转换模板
