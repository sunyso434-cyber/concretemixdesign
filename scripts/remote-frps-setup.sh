#!/usr/bin/env bash
# ============================================================
# remote-frps-setup.sh（R12 砼智远程版 · 云端部署脚本）
#
# 在腾讯云 Ubuntu 服务器上部署 frps v0.60.0 + Nginx（TLS 终结 + /concrete/ 反代 + 限流）
#
# 拓扑 B1（云端 TLS 终结）：
#   手机 wss://www.concreteagent.cloud/concrete/ws
#     → 云端 Nginx 443 终结 TLS
#     → location /concrete/ 反代到 frps vhostHTTPPort(8080, 只监听 127.0.0.1)
#     → frps 按 customDomains(www.concreteagent.cloud) 路由给电脑端 frpc
#     → 电脑端 frpc → RemoteServer(127.0.0.1:<本地端口>)
#
# 主站 www.concreteagent.cloud 被另一个项目占用：脚本只「注入」location /concrete/
#   到现有 server 块，绝不覆盖/删除其他项目配置。
#
# 用法（root 或 sudo）：
#   sudo bash remote-frps-setup.sh
#   sudo bash remote-frps-setup.sh --token '你的强随机token'   # 也可用环境变量 FRP_TOKEN
#
# 前置准备（老板手动）：
#   1. 域名 www.concreteagent.cloud 的 SSL 证书放入 /etc/ssl/concreteagent.cloud.crt / .key
#      （或改脚本底部 CERT_FILE / KEY_FILE 指向你的证书位置）
#   2. 腾讯云安全组放行 TCP 443 / 7000（控制台操作，脚本无法代做）
#   3. 本脚本生成的 token 与电脑端「砼智」远程面板配置保持一致
#
# 说明：frps 的 auth.token 为内网隧道认证口令（frpc↔frps），与手机端登录口令不是一回事。
# ============================================================
set -euo pipefail

FRP_VERSION="0.60.0"
DOMAIN="www.concreteagent.cloud"
SERVER_IP="43.153.116.131"          # 腾讯云公网 IP（仅注释用）
FRPS_BIND_PORT="7000"               # frpc 从公网连入 frps 的端口
VHOST_HTTP_PORT="8080"              # frps HTTP vhost 端口（仅 127.0.0.1 监听）
PROXY_BIND_ADDR="127.0.0.1"         # 关键：vhost 只绑回环，避免 8080 裸暴露
CERT_FILE="/etc/ssl/concreteagent.cloud.crt"
KEY_FILE="/etc/ssl/concreteagent.cloud.key"
FRP_DIR="/etc/frp"
FRPS_TOML="$FRP_DIR/frps.toml"
SYSTEMD_UNIT="/etc/systemd/system/frps.service"
NGINX_HTTP_CONF="/etc/nginx/nginx.conf"
REQ_ZONE="concrete_api"             # limit_req zone 名

# ---------- 参数 ----------
TOKEN="${FRP_TOKEN:-}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --token) TOKEN="$2"; shift 2 ;;
    *) echo "未知参数: $1（仅支持 --token）"; exit 1 ;;
  esac
done
if [[ -z "$TOKEN" ]]; then
  TOKEN="$(openssl rand -hex 16)"
  echo ">> 未指定 token，已自动生成强随机 token：$TOKEN"
  echo ">> 请把该 token 保存好，并配置到电脑端「砼智」远程面板。"
else
  echo ">> 使用指定的 token（${#TOKEN} 字符）"
fi

need() { command -v "$1" >/dev/null 2>&1 || { echo "缺少命令: $1，请先安装"; exit 1; }; }
need curl; need tar; need python3; need systemctl; need nginx

# 统一临时文件与清理（避免 trap 被覆盖）
TMPD="$(mktemp -d)"
LOCATION_FILE="$(mktemp)"
trap 'rm -rf "$TMPD" "$LOCATION_FILE"' EXIT

# ============================================================
# 1) 安装 frps v0.60.0（linux_amd64）
# ============================================================
echo "== [1/5] 安装 frps ${FRP_VERSION} =="
if command -v frps >/dev/null 2>&1 && frps -v 2>/dev/null | grep -q "${FRP_VERSION}"; then
  echo "   frps ${FRP_VERSION} 已安装，跳过下载。"
else
  URL="https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/frp_${FRP_VERSION}_linux_amd64.tar.gz"
  if ! curl -fsSL --connect-timeout 15 --max-time 240 -o "$TMPD/frp.tar.gz" "$URL"; then
    echo "   GitHub 直连慢，改用 ghproxy 镜像…"
    curl -fsSL --connect-timeout 15 --max-time 240 -o "$TMPD/frp.tar.gz" "https://ghproxy.net/$URL"
  fi
  tar -xzf "$TMPD/frp.tar.gz" -C "$TMPD"
  install -m 0755 "$TMPD/frp_${FRP_VERSION}_linux_amd64/frps" /usr/local/bin/frps
  echo "   已安装到 /usr/local/bin/frps"
fi

# ============================================================
# 2) 写 frps.toml
# ============================================================
echo "== [2/5] 写入 ${FRPS_TOML} =="
mkdir -p "$FRP_DIR"
cat > "$FRPS_TOML" <<EOF
# frps.toml（由 remote-frps-setup.sh 生成，R12 云端 TLS 终结拓扑 B1）
bindPort = ${FRPS_BIND_PORT}
auth.token = "${TOKEN}"
vhostHTTPPort = ${VHOST_HTTP_PORT}
proxyBindAddr = "${PROXY_BIND_ADDR}"
# transport.tls 仅用于 frpc↔frps 隧道（与「终端 TLS」无关）。若要加密隧道可加：
# transport.tls.force = true   # 需同步电脑端 frpc.toml 配 transport.tls.enable = true
# 可选：frps 管理面板（不建议暴露公网）
# webServer.addr = "127.0.0.1"
# webServer.port = 7500
# webServer.user = "admin"
# webServer.password = "change-me"
EOF
echo "   auth.token = \"${TOKEN}\"（已写入）"

# ============================================================
# 3) systemd 开机自启
# ============================================================
echo "== [3/5] 配置 systemd 开机自启 =="
cat > "$SYSTEMD_UNIT" <<EOF
[Unit]
Description=frp server (frps) - 砼智远程
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/frps -c ${FRPS_TOML}
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

# ============================================================
# 4) Nginx：TLS 终结 + /concrete/ 反代 + limit_req 限流
#    主站被另一个项目占用 → 只注入 location，不覆盖现有配置
# ============================================================
echo "== [4/5] 配置 Nginx =="
# 生成 location /concrete/ 片段（供注入或新建 conf）
cat > "$LOCATION_FILE" <<'NGINX_LOC'
    # ---- 砼智远程版：/concrete/ 子路径 → frps HTTP vhost → 电脑端 frpc ----
    # proxy_pass 末尾 / 剥离 /concrete/ 前缀 → frps vhostHTTPPort
    location /concrete/ {
        proxy_pass http://127.0.0.1:8080/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;                     # 保留域名供 frp 按 customDomains 路由
        proxy_set_header Upgrade $http_upgrade;          # WebSocket 支持（frp vhost 原生处理 Upgrade）
        proxy_set_header Connection "upgrade";
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;      # 后端感知 wss/https
        proxy_read_timeout 600s;                         # 覆盖心跳之外的流式长连接
    }
    # pair/login 按真实 IP 限流（防暴力破解；rate=5r/m + burst 10）
    location = /concrete/api/pair {
        limit_req zone=concrete_api burst=10 nodelay;
        proxy_pass http://127.0.0.1:8080/api/pair;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
    location = /concrete/api/login {
        limit_req zone=concrete_api burst=10 nodelay;
        proxy_pass http://127.0.0.1:8080/api/login;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
NGINX_LOC

# 在 nginx.conf 的 http 块注入 limit_req_zone（幂等）
REQ_ZONE_LINE="limit_req_zone \$binary_remote_addr zone=${REQ_ZONE}:10m rate=5r/m;"
python3 - "$NGINX_HTTP_CONF" "$REQ_ZONE_LINE" <<'PY'
import sys
conf, zone = sys.argv[1], sys.argv[2]
src = open(conf, encoding='utf-8').read()
if zone in src:
    print('   limit_req_zone 已存在，跳过注入')
    sys.exit(0)
i = src.find('http {')
if i == -1:
    print('   !!! 未找到 http { 块，请手动把以下行加进 http 块：')
    print('       ' + zone)
    sys.exit(2)
j = src.index('\n', i) + 1
open(conf, 'w', encoding='utf-8').write(src[:j] + '    ' + zone + '\n' + src[j:])
print('   已注入 limit_req_zone -> http 块')
PY

# 查找含该域名的现有 server 块配置文件，注入 location /concrete/（幂等）
# 主站被另一个项目占用，必须走「注入」而非「新建覆盖」
INJECTED=""
for f in /etc/nginx/conf.d/*.conf /etc/nginx/sites-enabled/*  /etc/nginx/sites-available/*; do
  [[ -f "$f" ]] || continue
  if grep -q "server_name.*${DOMAIN}" "$f"; then
    echo "   在 $f 中发现 ${DOMAIN} 的 server 块，尝试注入 location /concrete/…"
    if python3 - "$f" "$LOCATION_FILE" <<'PY'
import sys
conf, block_file = sys.argv[1], sys.argv[2]
block = open(block_file, encoding='utf-8').read()
lines = open(conf, encoding='utf-8').read().splitlines()

def bare(line):
    return line.split('#', 1)[0]  # 忽略注释，避免 { } 误算

if any('location /concrete/' in l for l in lines):
    print('   location /concrete/ 已存在，跳过'); sys.exit(0)

for i, line in enumerate(lines):
    if ('server_name' in bare(line)) and (DOMAIN in bare(line)) and ('{' not in bare(line)):
        start = None
        for j in range(i, -1, -1):
            b = bare(lines[j])
            if 'server' in b and '{' in b:
                start = j; break
        if start is None:
            print('   !! 找不到 server { 起始行'); sys.exit(2)
        depth = 0; end = None
        for j in range(start, len(lines)):
            depth += bare(lines[j]).count('{') - bare(lines[j]).count('}')
            if depth == 0 and j > start:
                end = j; break
        if end is None:
            print('   !! server 块括号不配对'); sys.exit(2)
        indent = lines[end][:len(lines[end]) - len(lines[end].lstrip())]
        blk = [indent + ln if ln.strip() else ln for ln in block.rstrip().split('\n')]
        lines = lines[:end] + blk + lines[end:]
        open(conf, 'w', encoding='utf-8').write('\n'.join(lines))
        print('   已注入 location /concrete/ 到现有 server 块'); sys.exit(0)
print('   !! 未定位到 server 块'); sys.exit(3)
PY
    then
      INJECTED=1
      break
    fi
  fi
done

if [[ -z "$INJECTED" ]]; then
  echo "   未找到 ${DOMAIN} 的现有 server 块，新建完整配置…"
  cat > "/etc/nginx/conf.d/${DOMAIN}.conf" <<EOF
server {
    listen 443 ssl;
    server_name ${DOMAIN};
    ssl_certificate     ${CERT_FILE};
    ssl_certificate_key ${KEY_FILE};

$(cat "$LOCATION_FILE")
}
EOF
fi

# 证书缺失时提示（nginx -t 会因此失败，等证书就位后再 reload）
if [[ ! -f "$CERT_FILE" || ! -f "$KEY_FILE" ]]; then
  echo "   !!! 未找到证书文件：${CERT_FILE} / ${KEY_FILE}"
  echo "   >>> 请把域名 SSL 证书放到上述路径后，执行：sudo nginx -t && sudo systemctl reload nginx"
else
  nginx -t && systemctl reload nginx
  echo "   nginx 配置校验并 reload 完成"
fi

# ============================================================
# 5) 防火墙放行（443 / 7000；另需腾讯云安全组放行）
# ============================================================
echo "== [5/5] 防火墙放行 =="
if command -v ufw >/dev/null 2>&1; then
  ufw allow 7000/tcp >/dev/null 2>&1 && echo "   ufw 放行 7000/tcp（frpc 连入）"
  ufw allow 443/tcp  >/dev/null 2>&1 && echo "   ufw 放行 443/tcp（HTTPS/WSS）"
  ufw allow 80/tcp   >/dev/null 2>&1 && echo "   ufw 放行 80/tcp（HTTP，如需重定向）"
fi

echo
echo "================ 部署完成 ================"
echo "frps  : $(systemctl is-active frps)  (systemd 已开机自启)"
echo "监听  : ${SERVER_IP}:${FRPS_BIND_PORT}（frpc 连入）; 127.0.0.1:${VHOST_HTTP_PORT}（Nginx vhost）"
echo "token : ${TOKEN}（电脑端远程面板需一致）"
echo "证书  : ${CERT_FILE} / ${KEY_FILE}"
echo "=========================================="
echo "最后确认（老板）：
  1. 腾讯云控制台安全组已放行 TCP 443 与 7000。
  2. 证书已就位且 nginx 正常（sudo nginx -t && sudo systemctl reload nginx）。
  3. 电脑端「砼智」远程面板的 token / 域名与这里一致。
手机端连接地址：wss://www.concreteagent.cloud/concrete/ws"
