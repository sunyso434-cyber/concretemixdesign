# 云端部署指引：图片上传大小限制 50MB（2026-08-13）

> 场景：手机端传大图报「图片上传失败：BAD_REQUEST」。根因是手机原图（3~15MB）在传输链路上被截断，
> 且云端 Caddy 未显式声明 body 上限。本次把云端网关限制与应用层限制统一提升到 **50MB**。

## 背景

| 环节 | 修改前 | 修改后 |
|---|---|---|
| 云端 Caddy（/concrete/ 反代） | 未声明（默认不限制，但不保险） | `request_body { max_size 50MiB }` |
| 电脑端 RemoteImageApi（MAX_IMAGE_BYTES） | 10MB | 50MB |
| 手机端 ImageUploadService（maxImageBytes） | 10MB | 50MB |

Caddy 配置修改已写进 `scripts/remote-frps-caddy-setup.sh`（幂等：旧配置自动升级，不动主站其他配置）。

## 操作步骤（在云服务器上执行，约 1 分钟）

> 本机 SSH 被云服务器安全策略拦（22 端口 banner 超时 / connection reset），请用
> **腾讯云控制台 → 云服务器 → 登录（网页终端 OrcaTerm/VNC）**，或换一个放行过的网络 SSH。
> 登录用户：`ubuntu`（有 sudo 权限）。

### 方式 A：直接跑部署脚本（推荐）

1. 把项目里的 `scripts/remote-frps-caddy-setup.sh` 上传到服务器任意目录
   （网页终端可粘贴文件内容，或 scp：`scp scripts/remote-frps-caddy-setup.sh ubuntu@<服务器>:~`）。
2. 执行：

```bash
chmod +x ~/remote-frps-caddy-setup.sh
sudo bash ~/remote-frps-caddy-setup.sh
```

3. 看到「已追加 www site（含 request_body 50MiB）」和 `caddy validate` 通过即成功。

### 方式 B：只手工改 Caddyfile（不想跑脚本时）

```bash
sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak.$(date +%Y%m%d%H%M)
sudo nano /etc/caddy/Caddyfile
```

找到 `www.concreteagent.cloud {` 块里的 `handle /concrete/* {`，改成：

```
    handle /concrete/* {
        uri strip_prefix /concrete
        request_body {
            max_size 50MiB
        }
        reverse_proxy 127.0.0.1:8080
    }
```

保存后：

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## 验证

```bash
# 服务器上确认配置生效
grep -A3 "request_body" /etc/caddy/Caddyfile
sudo systemctl status caddy --no-pager | head -5
```

手机端传一张 10MB+ 的图片验证不再报 BAD_REQUEST（需配合电脑端 0.8.3 / 手机端新 APK 一起测试）。

## 备注

- 应用层限制（电脑端/手机端 50MB）与云端 50MiB 完全一致（50MB = 50MiB = 52428800 字节），
  恰好在边界也不被拒。
- `scripts/remote-frps-setup.sh`（Nginx 版）已废弃，不要使用。
