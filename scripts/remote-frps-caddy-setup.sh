#!/usr/bin/env bash
# ============================================================
# remote-frps-caddy-setup.sh（砼智远程版 · 云端部署脚本 · Caddy 版）
#
# 实测发现服务器用 Caddy（非 nginx）托管 concreteagent.cloud：
#   - Caddyfile: /etc/caddy/Caddyfile（主站 concreteagent.cloud 反代 127.0.0.1:3721，带 Basic Auth）
#   - 证书: /etc/caddy/ssl/concreteagent.cloud_bundle.crt（SAN 含 www.concreteagent.cloud）
#   - Ubuntu 24.04
#
# 拓扑 B1（云端 TLS 终结，Caddy 替代 nginx）：
#   手机 wss://<pcId>.concreteagent.cloud/concrete/ws（pcId 为电脑端唯一编号子域名）
#     → Caddy 443 终结 TLS（*.concreteagent.cloud 通配符 site，证书复用现有通配符证书）
#     → handle /concrete/* + uri strip_prefix /concrete → 127.0.0.1:8080（frps vhostHTTPPort）
#     → frps 按 customDomains(<pcId>.concreteagent.cloud) 路由 → 对应电脑端 frpc → RemoteServer
#
# 主站 concreteagent.cloud 不受影响（砼智用独立的通配符子域名 site，只新增不改现有块）
#
# 用法：sudo bash remote-frps-caddy-setup.sh [--token <token>]（或用 FRP_TOKEN 环境变量）
# ============================================================
set -euo pipefail

FRP_VERSION="0.60.0"
TOKEN="${FRP_TOKEN:-}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --token) TOKEN="$2"; shift 2 ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done
if [[ -z "$TOKEN" ]]; then
  TOKEN="$(openssl rand -hex 16)"
  echo ">> 已生成强随机 token：$TOKEN"
fi

need() { command -v "$1" >/dev/null 2>&1 || { echo "缺少命令: $1"; exit 1; }; }
need curl; need tar; need systemctl; need caddy

# ---------- 1) 安装 frps v0.60.0（linux_amd64） ----------
echo "== [1/4] 安装 frps ${FRP_VERSION} =="
if command -v frps >/dev/null 2>&1 && frps -v 2>/dev/null | grep -q "${FRP_VERSION}"; then
  echo "   frps ${FRP_VERSION} 已安装，跳过下载。"
else
  TMPD="$(mktemp -d)"
  trap 'rm -rf "$TMPD"' EXIT
  cd "$TMPD"
  URL="https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/frp_${FRP_VERSION}_linux_amd64.tar.gz"
  if ! curl -fsSL --connect-timeout 15 --max-time 240 -o frp.tar.gz "$URL"; then
    echo "   GitHub 直连慢，改用 ghproxy 镜像…"
    curl -fsSL --connect-timeout 15 --max-time 240 -o frp.tar.gz "https://ghproxy.net/$URL"
  fi
  tar -xzf frp.tar.gz
  install -m 0755 "frp_${FRP_VERSION}_linux_amd64/frps" /usr/local/bin/frps
  echo "   已安装到 /usr/local/bin/frps"
fi

# ---------- 2) 写 frps.toml ----------
echo "== [2/4] 写入 /etc/frp/frps.toml =="
mkdir -p /etc/frp
cat > /etc/frp/frps.toml <<EOF
# frps.toml（remote-frps-caddy-setup.sh 生成）
bindPort = 7000
auth.token = "${TOKEN}"
vhostHTTPPort = 8080
proxyBindAddr = "127.0.0.1"
EOF
echo "   auth.token 已写入"

# ---------- 3) systemd 开机自启 ----------
echo "== [3/4] 配置 systemd =="
cat > /etc/systemd/system/frps.service <<'EOF'
[Unit]
Description=frp server (frps) - 砼智远程
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/frps -c /etc/frp/frps.toml
Restart=on-failure
RestartSec=5
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable frps >/dev/null 2>&1 || true
systemctl restart frps
echo "   frps 状态：$(systemctl is-active frps)"

# ---------- 4) Caddyfile 追加 www site（幂等；旧版无 request_body 的块自动升级） ----------
echo "== [4/4] 配置 Caddy /concrete/ 反代 =="
NEED_APPEND=1
if grep -q "砼智远程版" /etc/caddy/Caddyfile; then
  if grep -q "request_body" /etc/caddy/Caddyfile && grep -q '\*\.concreteagent\.cloud' /etc/caddy/Caddyfile; then
    echo "   Caddyfile 已包含最新砼智配置（通配符子域名 + request_body 50MiB），跳过追加"
    NEED_APPEND=0
  else
    echo "   Caddyfile 含旧版砼智配置 → 先移除旧块，再追加新块"
    cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%Y%m%d%H%M)"
    python3 - /etc/caddy/Caddyfile <<'PY'
import sys
p = sys.argv[1]
src = open(p, encoding='utf-8').read()
idx = src.find('砼智远程版')
if idx != -1:
    line_start = src.rfind('\n', 0, idx) + 1
    open(p, 'w', encoding='utf-8').write(src[:line_start])
PY
  fi
fi
if [[ "$NEED_APPEND" == "1" ]]; then
  cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%Y%m%d%H%M)"
  cat >> /etc/caddy/Caddyfile <<'EOF'

# ---- 砼智远程版：/concrete/ 子路径 → frps vhostHTTPPort(8080) → 电脑端 frpc ----
# 通配符子域名 *.concreteagent.cloud：电脑端多电脑并存方案用 <pcId>.concreteagent.cloud 子域名，
# 手机扫码连 wss://<pcId>.concreteagent.cloud/concrete/ws（frps 按 customDomains 精确路由到对应电脑）
# request_body 50MiB：与电脑端/手机端 MAX_IMAGE_BYTES（50MB）对齐，防止大图在网关被截断
*.concreteagent.cloud {
    tls /etc/caddy/ssl/concreteagent.cloud_bundle.crt /etc/caddy/ssl/concreteagent.cloud.key

    handle /concrete/* {
        uri strip_prefix /concrete
        request_body {
            max_size 50MiB
        }
        reverse_proxy 127.0.0.1:8080
    }
    handle {
        respond "concreteagent.cloud" 200
    }
}
EOF
  echo "   已追加 site（*.concreteagent.cloud 通配符 + request_body 50MiB；备份: /etc/caddy/Caddyfile.bak.*）"
fi

caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
echo "   caddy 状态：$(systemctl is-active caddy)"

# ---------- 防火墙（安全组已放行，ufw 兜底） ----------
if command -v ufw >/dev/null 2>&1; then
  ufw allow 7000/tcp >/dev/null 2>&1 || true
  echo "   ufw 已放行 7000/tcp"
fi

echo
echo "================ 部署完成 ================"
echo "frps : $(systemctl is-active frps)  (systemd 已开机自启)"
echo "caddy: $(systemctl is-active caddy)"
echo "监听 : 7000（frpc 连入）; 127.0.0.1:8080（Caddy vhost）"
echo "TOKEN: ${TOKEN}"
echo "手机端地址: wss://<pcId>.concreteagent.cloud/concrete/ws（电脑端面板扫码显示实际地址）"
echo "=========================================="
