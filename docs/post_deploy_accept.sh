#!/usr/bin/env bash
# =============================================================================
# GrainTCP xHTTP 部署后验收脚本（零凭据、只读、无副作用）
# -----------------------------------------------------------------------------
# 原理：手工构造一个"合法 VLESS 首包"，POST 给 xHTTP 入口，观察响应体字节数。
#   - 修复后：响应体 = [0x00,0x00] 前缀 + 远端 example.com:80 回传的 HTTP 响应
#             => 字节数远大于 2
#   - 未修复：响应体只有 [0x00,0x00] 两个字节（下行断流），或 502 xhERR（地址非法）
#
# 用法：  bash docs/post_deploy_accept.sh
#   可选：HOST_W=xtgm.snove999.eu.org HOST_S=snipt.snove999.eu.org \
#         UUID_HEX=d675a8ea61bc4db9a8a6109ca1ec8385 bash docs/post_deploy_accept.sh
# =============================================================================
set -u

HOST_W="${HOST_W:-xtgm.snove999.eu.org}"      # Workers 节点
HOST_S="${HOST_S:-snipt.snove999.eu.org}"     # Snippets 节点
UUID_HEX="${UUID_HEX:-d675a8ea61bc4db9a8a6109ca1ec8385}"
PATH_OK="/proxyip=ProxyIP.CMLiussss.net/"     # Xray stream-one 的真实形态（自动带尾随斜杠）
TMP="$(mktemp -d 2>/dev/null || echo ./.acc_tmp)"
mkdir -p "$TMP"
FRAME="$TMP/vless.bin"

# --- 1. 构造 VLESS 首包 ------------------------------------------------------
# 布局：ver(1) uuid(16) addonLen(1)=0 cmd(1)=1(TCP) port(2)=80 atype(1)=2(domain)
#       domainLen(1)=11 "example.com"  payload(HTTP GET)
# 目标 example.com:80 是为了让远端必然回一段可辨识的 HTTP 响应
# （若改用 speed.cloudflare.com / cp.cloudflare.com，入口会短路返回 204，
#   那是"入口存活"探针，不是"下行通畅"探针，不要混用）
printf '\x00\xd6\x75\xa8\xea\x61\xbc\x4d\xb9\xa8\xa6\x10\x9c\xa1\xec\x83\x85\x00\x01\x00\x50\x02\x0b\x65\x78\x61\x6d\x70\x6c\x65\x2e\x63\x6f\x6d\x47\x45\x54\x20\x2f\x20\x48\x54\x54\x50\x2f\x31\x2e\x30\x0d\x0a\x48\x6f\x73\x74\x3a\x20\x65\x78\x61\x6d\x70\x6c\x65\x2e\x63\x6f\x6d\x0d\x0a\x43\x6f\x6e\x6e\x65\x63\x74\x69\x6f\x6e\x3a\x20\x63\x6c\x6f\x73\x65\x0d\x0a\x0d\x0a' > "$FRAME"

FRAME_LEN=$(wc -c < "$FRAME" | tr -d ' ')
echo "VLESS 首包: $FRAME_LEN 字节 (期望 90 = 头 34 + payload 56)"
[ "$FRAME_LEN" -eq 90 ] || { echo "!! 首包构造失败，字节数不对，终止"; exit 2; }
echo "UUID: $UUID_HEX"
echo

# --- 2. 逐端点逐路径探测 -----------------------------------------------------
FAIL=0
probe() {
  local host="$1" path="$2" label="$3"
  local out="$TMP/out.bin"
  : > "$out"
  local code
  code=$(curl -sS -o "$out" -w '%{http_code}' --max-time 12 \
    -X POST -H 'Content-Type: application/grpc' \
    --data-binary "@$FRAME" "https://${host}${path}" 2>/dev/null)
  local curl_rc=$?
  local bytes; bytes=$(wc -c < "$out" 2>/dev/null | tr -d ' ')
  bytes="${bytes:-0}"

  # 判定：200 且字节数 > 2 才算通过（2 字节 = 只有 [0,0] 前缀 = 下行断流）
  local verdict
  if [ "$code" = "200" ] && [ "$bytes" -gt 2 ]; then
    verdict="PASS"
  else
    verdict="FAIL"
    FAIL=$((FAIL + 1))
  fi
  printf '  %-4s %-30s %-42s http=%-4s bytes=%-6s curl_rc=%s\n' \
    "$verdict" "$host" "$path" "$code" "$bytes" "$curl_rc"
  if [ "$verdict" = "FAIL" ] && [ "$bytes" -gt 0 ] && [ "$bytes" -le 400 ]; then
    printf '        body: %s\n' "$(head -c 160 "$out" | cat -v | tr -d '\0' | tr '\n' ' ')"
  fi
}

echo "=== Workers 节点 ($HOST_W) ==="
probe "$HOST_W" "/"                        "根路径"
probe "$HOST_W" "/proxyip=ProxyIP.CMLiussss.net"   "无尾随斜杠"
probe "$HOST_W" "$PATH_OK"                 "带尾随斜杠（Xray 真实形态）"

echo
echo "=== Snippets 节点 ($HOST_S) ==="
probe "$HOST_S" "/"                        "根路径"
probe "$HOST_S" "/proxyip=ProxyIP.CMLiussss.net"   "无尾随斜杠"
probe "$HOST_S" "$PATH_OK"                 "带尾随斜杠（Xray 真实形态）"

echo
echo "=== 入口存活探针（非下行探针，仅确认 xHTTP 入口不 500/502）==="
# 打 speed.cloudflare.com 会让入口短路返回 204，用来区分
# "入口本身坏了" 与 "入口好但下行断流"
printf '\x00\xd6\x75\xa8\xea\x61\xbc\x4d\xb9\xa8\xa6\x10\x9c\xa1\xec\x83\x85\x00\x01\x00\x50\x02\x14\x73\x70\x65\x65\x64\x2e\x63\x6c\x6f\x75\x64\x66\x6c\x61\x72\x65\x2e\x63\x6f\x6d' > "$TMP/speed.bin"
for h in "$HOST_W" "$HOST_S"; do
  : > "$TMP/o2"; c=$(curl -sS -o "$TMP/o2" -w '%{http_code}' --max-time 10 \
    -X POST -H 'Content-Type: application/grpc' --data-binary "@$TMP/speed.bin" \
    "https://${h}/" 2>/dev/null)
  printf '  %-30s http=%-4s body=%s\n' "$h" "$c" "$(head -c 40 "$TMP/o2" | cat -v | tr -d '\0' | tr '\n' ' ')"
done

echo
if [ "$FAIL" -eq 0 ]; then
  echo "===== 全部通过：xHTTP 入口与下行均正常 ====="
  exit 0
else
  echo "===== 有 $FAIL 项未通过 ====="
  echo "排查："
  echo "  bytes=2        -> 下行断流（P0 未修复，检查是否部署了修复后的 worker.obf.js / snippets.js）"
  echo "  http=502 xhERR -> 地址非法（P1 未修复，path 解析把非法字符带进了 connect()）"
  echo "  http=500       -> 入口抛错（看响应体报错文本）"
  echo "  http=404       -> 请求没进 xHTTP 入口（分发门槛 / 部署错文件）"
  exit 1
fi
