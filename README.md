# GrainTCP

Cloudflare 上的 VLESS 代理，两种部署形态：**Workers**（全功能：管理面板、D1 持久化、TG 用量推送）和 **Snippets**（轻量：仅代理与订阅，付费计划的规则引擎）。内核来自 [ToiCF/GrainTCP](https://github.com/ToiCF/GrainTCP)，路径语法、订阅契约与 [cmliu/edgetunnel](https://github.com/cmliu/edgetunnel) 生态兼容。

<!-- doccheck:baseline
harness_total=433
file.worker.js.bytes=442720
file.worker.js.sha256_12=9324c393f0c1
file.snippets.js.bytes=32422
file.snippets.js.sha256_12=1bdd9aee5c1a
file.worker.obf.js.bytes=1016294
file.worker.obf.js.sha256_12=4f89f66fb3f8
-->

## 选哪个

| | Workers | Snippets |
|---|---|---|
| 部署件 | `worker.obf.js`（混淆版；`worker.js` 为明文源码，仅排障） | `snippets.js` |
| 计划 | Free 即可 | 付费计划（Pro 及以上） |
| 面板 / D1 / TG 推送 | 有 | 无 |
| 传输 | WebSocket · xHTTP · gRPC | WebSocket · xHTTP · gRPC |
| 出口 | direct · ProxyIP · SOCKS5 · HTTP(S) · TURN/TURNS · SSTP | direct · ProxyIP · SOCKS5 · HTTP(S) · TURN |
| 配置方式 | 环境变量 / 面板 | 文件头常量 |

## Workers 部署

1. Cloudflare Dashboard → **Workers & Pages → Create → Worker**，把 `worker.obf.js` 全文粘贴进去，Deploy。
2. **Settings → Variables** 添加 `UUID`（标准 UUID 格式）。这是唯一必填项。
3. 想要面板：建一个 D1 数据库并绑定到 Worker，变量名 **`DB`**，在 D1 Console 执行

  ```sql
   CREATE TABLE IF NOT EXISTS config    (key TEXT PRIMARY KEY, value TEXT);
   CREATE TABLE IF NOT EXISTS whitelist (ip TEXT PRIMARY KEY, created_at TEXT);
   CREATE TABLE IF NOT EXISTS logs      (id INTEGER PRIMARY KEY AUTOINCREMENT, time TEXT, ip TEXT, region TEXT, action TEXT);
   CREATE TABLE IF NOT EXISTS stats     (date TEXT PRIMARY KEY, count INTEGER);
   ```

面板地址 `https://你的域名/`，默认口令 `abc`，请改 `WEB_PASSWORD`。
6. 订阅地址：`https://你的域名/sub?uuid=你的UUID`，或 `https://你的域名/你的SUB_PASSWORD`（默认 `123456`）。

用 wrangler 的话：把 [wrangler.jsonc](wrangler.jsonc) 里的 D1 `database_id` 换成你的，然后 `wrangler secret put UUID` → `wrangler deploy`。

## Snippets 部署

1. Dashboard → **Rules → Snippets → Create Snippet**，粘贴 `snippets.js` 全文，规则绑定到你的 hostname（必须是橙云代理记录），Deploy。
2. 改文件第 1 行：`UUID`、`SUB_PWD`（订阅密码路径）、`SRQ`（你的计划的子请求配额：Pro 2 / Business 3 / Enterprise 5）、`NET`（订阅默认传输 `ws` 或 `xhttp`）。
3. 订阅地址：`https://你的域名/sub?uuid=你的UUID` 或 `https://你的域名/你的SUB_PWD`。

官方限额：包体 32KB、CPU 5ms、内存 2MB、无环境变量。当前 `snippets.js` 32422B。

## 订阅

- 追加 `?net=xhttp` 或 `?net=ws` 可单次切换传输；xhttp
- 在节点路径里写出口：`/proxyip=host:port`、`/s5=user:pass@host:port`、`/socks5://…`（全局）、`/gs5=`（g 前缀 = 全局）、`?global=1`。完整语法见参考手册。

## 更多文档

- [docs/REFERENCE.md](docs/REFERENCE.md)：全部环境变量、路由、出口语法、安全说明、审查修复清单。
- [docs/DEPLOY_VERIFY.md](docs/DEPLOY_VERIFY.md)：部署验证、回滚、排查树。

## 本地开发

```bash
npm ci
node test_harness.mjs        # 离线回归（Node ≥ 22）
node _obfuscate.mjs          # 改了 worker.js 后重建 worker.obf.js（自带行为等价门禁）
node _predeploy_check.mjs    # 部署前预检（产物同源 / snippets ≤32KB / 文档数据自查）
```

## 安全须知

`UUID` 与订阅密码泄露等于代理被白嫖，请定期轮换；请遵守 Cloudflare 服务条款与当地法律法规，本仓库仅供学习与个人合法用途。

## 致谢

[ToiCF/GrainTCP](https://github.com/ToiCF/GrainTCP) · [cmliu/edgetunnel](https://github.com/cmliu/edgetunnel) · [sub-store-template](https://github.com/sinspired/sub-store-template) / ACL4SSR
