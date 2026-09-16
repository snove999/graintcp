# GrainTCP 双端代理（Workers + Snippets）

基于 [ToiCF/GrainTCP](https://github.com/ToiCF/GrainTCP) 内核与 [cmliu/edgetunnel](https://github.com/cmliu/edgetunnel) 生态兼容约定的 Cloudflare VLESS 代理，提供两个部署形态：

| 文件 | 部署目标 | 定位 |
|---|---|---|
| `worker.js` | Cloudflare **Workers** | 全功能版明文源码：管理面板、D1 持久化、TG 用量推送、订阅聚合 |
| `snippets.js` | Cloudflare **Snippets**（付费计划规则引擎） | 轻量版明文源码：受 32KB/5ms 限制，专注代理与订阅本体，无面板。**Snippets 的唯一部署件** |
| `worker.obf.js` | Cloudflare **Workers** | **Workers 的部署件**（`wrangler.jsonc` 的 `main` 指向它），与明文版行为一致（同一回归套件验证） |
| `wrangler.jsonc` / `schema.sql` | Workers | wrangler 部署配置 / D1 建表脚本 |
| `GrainTCP.js` | 参考 | 上游内核参考快照（部署文件内已内嵌，无需单独部署） |
| `test_harness.mjs` | 本地 | 180 项离线回归测试（Node ≥ 24） |

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
2. **绑定 D1**（可选但强烈建议）：Storage & Databases → D1 建库 → Worker → Settings → Bindings 添加 `D1 Database`，变量名 **`DB`**。在 D1 Console 执行：

   ```sql
   CREATE TABLE IF NOT EXISTS config    (key TEXT PRIMARY KEY, value TEXT);
   CREATE TABLE IF NOT EXISTS whitelist (ip TEXT PRIMARY KEY, created_at TEXT);
   CREATE TABLE IF NOT EXISTS logs      (id INTEGER PRIMARY KEY AUTOINCREMENT, time TEXT, ip TEXT, region TEXT, action TEXT);
   CREATE TABLE IF NOT EXISTS stats     (date TEXT PRIMARY KEY, count INTEGER);
   ```

3. **环境变量**（Settings → Variables）：至少设置 `UUID`（标准 UUID 格式）。其余见下表，未设置的项走「环境变量 > D1 config 表（面板保存）> 代码默认值」。
4. **TG 用量推送**（可选）：配置 `TG_BOT_TOKEN` / `TG_CHAT_ID` / `STATS_ENABLED=true`，并在 Worker → Settings → Triggers → Cron Triggers 添加如 `0 */6 * * *`（scheduled 处理器会编辑同一条消息持续刷新）。

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
node _predeploy_check.mjs   # 部署前预检（产物同源 / snippets ≤32KB / 产物存在），任一不过即拒绝部署
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

完整 38 键以代码内 `getSafeEnv` 调用为准（`CONCUR`、`KEY`、`UUID_REFRESH` 等少数键直接读 `env.*`，不在此列）；D1 config 表中的键与环境变量同名，面板「保存配置」即写入。

## 路由速查

| 路径 | 用途 |
|---|---|
| `/{UUID}` | 订阅（原生/自适应） |
| `/{SUB_PASSWORD}` | 浏览器→面板；客户端→订阅 |
| `/sub?uuid={UUID}` | 无密码订阅端点（转换器回源用，`?flag=true` 供转换器拉取） |
| `/version?uuid={UUID}` | EDT 面板兼容探测（`{Version:2142, Kernel:"GrainTCP"}`） |
| `/tg/webhook`（POST） | TG `/stats` 命令 |
| 任意路径 + WS/xHTTP | 代理入口（凭据在 VLESS 层校验） |

**出口参数语法**（写入 WS path 或 xHTTP 路径）：
`/proxyip=host:port`、`/ip=`、`/s5=user:pass@host:port`（`/socks5=`、`/http=`、`/https=` 同理）、`/socks5://…` 与 `/sstp://host:443` 全局代理、`/turn://` `/turns://`、`?globalproxy`、`?mode=auto|proxy|direct`。

## Snippets 部署

1. 前提：**付费计划**（Free 无 Snippets），限制 32KB / 5ms CPU（`snippets.js` 当前 ~30KB，达标）。
2. 规则 → Snippets → 新建，粘贴 `snippets.js` 全文，绑定到你的 hostname（如 `*.{你的域}/*`），部署即生效。
3. 配置全部在文件头两行：
   - 第 1 行：`UUID`、`SUB_PWD`（订阅密码路径）、`ADF`（推广行过滤正则）
   - 第 2–7 行：`PIP`（默认 ProxyIP，支持 `域名!txt` TXT 池）、`SUB`（优选生成器）、`SUBAPI`、`SUBINI`、`SBV11/12`（singbox 模板）
4. 订阅地址：`https://{域名}/{SUB_PWD}` 或 `/sub?uuid={UUID}`；代理入口语法与 Workers 完全一致。

## 混淆版本说明

`worker.obf.js` 由 javascript-obfuscator 生成：保留顶层导出与全部行为（`renameGlobals` 关闭），本地标识符十六进制化 + 字符串数组化；另含 rc4 字符串编码与控制流平坦化。

- **`worker.obf.js`（850949B ≈ 831KB）——Workers 的部署件**：Dashboard 直接粘贴，或用 wrangler（`main` 已指向它）。Workers 无 32KB 限制，混淆不设防。
- ⚠️ **混淆产物字节不可复现**：构建器启用了 `controlFlowFlattening` / `stringArrayRotate` / `stringArrayShuffle`，带随机性，**同一份源码每次构建的字节与体积都会漂移**（实测三次：845231B → 853000B → 850949B）。因此**不能用哈希判断"产物与源码是否一致"**；唯一有效的门禁是**行为等价**——把产物复制成 `worker.js`/`snippets.js` 放进临时目录，跑同一套回归，**0 容忍——白名单为空，任何红一律 `exit≠0`**。**每次构建后都必须重跑。**
- 明文/混淆交叉验证：`worker.obf.js` 通过同一套 **180 项**回归。

## 本地测试

```bash
node test_harness.mjs
```

离线桩环境（Node ≥ 24）跑 **180 项**回归：路径语法矩阵、addrParser、WS 中继流、xHTTP 双端全链路（含**下行数据回传**）、gRPC 帧编解码（首帧嗅探/封帧/半包/粘包/畸形/零长 + 正路径 E2E + 模式判定）、`/proxyip=` 7 种路径形态（含编码与尾随斜杠）、`XH_HS` 首包就绪边界、非法百分号编码健壮性、padding/TXT 池/测速拦截/UDP 拒绝、sstp/TURN 建连、订阅哨兵重建、转换器回源、D1 缓存与降频、getCustomIPs 并行、路由冒烟。

> 红绿对照：对修复前的代码（`git show 1496ffb:worker.js` / `git show 1496ffb:snippets.js`，即修复提交 `b8f5846` 的父提交）跑回归 → **36 项失败**；修复后 **180/180 全绿**。（注：`1496ffb` 早于 gRPC 功能，当前 harness 的导出清单依赖旧提交不存在的符号，无法在其上完整运行；36 为该提交可运行项中的失败数。）这才是"修复真实生效"的证据链。

## 安全须知

- `UUID` / `SUB_PASSWORD` 泄露 = 代理被白嫖，请定期轮换；`SUB_TOKEN` 可为订阅加第二道锁。
- 管理面板操作（flag= 系列）均校验 auth cookie / 管理员身份；TG webhook 仅响应配置的 chat_id。
- 请遵守 Cloudflare 服务条款与当地法律法规，本仓库仅供学习与个人合法用途。

## 致谢

- [ToiCF/GrainTCP](https://github.com/ToiCF/GrainTCP) — 代理内核
- [cmliu/edgetunnel](https://github.com/cmliu/edgetunnel) — EDT 生态兼容约定（路径语法、哨兵契约、转换器体系）
- [sub-store-template](https://github.com/sinspired/sub-store-template) / ACL4SSR — singbox / Clash 转换模板
