// RemotePanel：桌面「远程连接」面板（R10）
//  - 二维码内容为 JSON：{"addr":"wss://<domain>/concrete/ws","code":"<8位>"}，与手机端 F2 扫码格式一致
//  - 配对码有效期 / 连接状态（已配对设备数、在线客户端数）
//  - 启用开关（默认关）：首次启用且未设密码时，主进程生成随机密码一次性展示
//  - 重置密码：主进程生成新随机密码一次性展示
//  - 域名输入：保存到 <userData>/remote-config.json（R12 FrpcManager 读取）
import React, { useState, useEffect, useCallback } from 'react'
import { Card, Button, Switch, Input, Alert, Typography, Space, Statistic, Row, Col, message } from 'antd'
import { QrcodeOutlined, ReloadOutlined, KeyOutlined, SaveOutlined, WifiOutlined, ApiOutlined } from '@ant-design/icons'
import { toDataURL } from 'qrcode'

const { Text } = Typography
const DEFAULT_DOMAIN = 'www.concreteagent.cloud'

export default function RemotePanel() {
  const [status, setStatus] = useState(null)
  const [pairCode, setPairCode] = useState(null)
  const [qrDataUrl, setQrDataUrl] = useState(null)
  const [domain, setDomain] = useState('')
  const [tempPassword, setTempPassword] = useState(null)
  const [now, setNow] = useState(Date.now())
  const [loadingCode, setLoadingCode] = useState(false)
  const [enabling, setEnabling] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [savingDomain, setSavingDomain] = useState(false)

  const loadStatus = useCallback(async () => {
    try {
      const s = await window.electronAPI.remote.getStatus()
      setStatus(s)
      setDomain((s && s.domain) || '')
    } catch (err) {
      console.error('[RemotePanel] 加载状态失败:', err)
      setStatus(null)
    }
  }, [])

  const refreshPairCode = useCallback(async () => {
    setLoadingCode(true)
    try {
      const pc = await window.electronAPI.remote.getPairCode()
      setPairCode(pc)
      if (pc && pc.addr) {
        // 二维码内容与手机端一致：{ addr, code }
        const dataUrl = await toDataURL(JSON.stringify({ addr: pc.addr, code: pc.code }), {
          margin: 2,
          width: 220,
          errorCorrectionLevel: 'M'
        })
        setQrDataUrl(dataUrl)
      } else {
        setQrDataUrl(null)
      }
    } catch (err) {
      console.error('[RemotePanel] 生成配对码失败:', err)
      setPairCode(null)
      setQrDataUrl(null)
    } finally {
      setLoadingCode(false)
    }
  }, [])

  useEffect(() => {
    loadStatus()
    refreshPairCode()
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [loadStatus, refreshPairCode])

  const handleToggleEnabled = async (checked) => {
    setEnabling(true)
    try {
      const res = await window.electronAPI.remote.setEnabled(checked)
      setStatus(prev => ({ ...(prev || {}), enabled: res && res.enabled }))
      if (res && res.tempPassword) {
        setTempPassword(res.tempPassword)
      }
      message.success(checked ? '远程连接已启用' : '远程连接已停用')
    } catch (err) {
      console.error('[RemotePanel] 切换开关失败:', err)
      message.error('操作失败，请重试')
    } finally {
      setEnabling(false)
    }
  }

  const handleResetPassword = async () => {
    setResetting(true)
    try {
      const res = await window.electronAPI.remote.resetPassword()
      setTempPassword(res && res.password)
      message.success('密码已重置')
    } catch (err) {
      console.error('[RemotePanel] 重置密码失败:', err)
      message.error('重置失败，请重试')
    } finally {
      setResetting(false)
    }
  }

  const handleSaveDomain = async () => {
    setSavingDomain(true)
    try {
      const res = await window.electronAPI.remote.setDomain(domain)
      setDomain(res && res.domain)
      message.success('域名已保存，二维码已更新')
      refreshPairCode()
    } catch (err) {
      console.error('[RemotePanel] 保存域名失败:', err)
      message.error('保存失败，请重试')
    } finally {
      setSavingDomain(false)
    }
  }

  // 配对码剩余有效期（每秒刷新）
  const ttlMs = pairCode && pairCode.expiresAt ? Math.max(0, pairCode.expiresAt - now) : 0
  const ttlText = `剩余 ${Math.floor(ttlMs / 60000)} 分 ${Math.floor((ttlMs % 60000) / 1000)} 秒`

  return (
    <div className="remote-panel" style={{ padding: 24 }}>
      <Row gutter={16}>
        <Col xs={24} md={12}>
          <Card
            title={
              <Space>
                <QrcodeOutlined />
                <span>扫码配对</span>
              </Space>
            }
          >
            {qrDataUrl ? (
              <div style={{ textAlign: 'center' }}>
                <img
                  data-testid="qr-img"
                  src={qrDataUrl}
                  alt="远程连接二维码"
                  style={{ width: 220, height: 220 }}
                />
                <div style={{ marginTop: 12 }}>
                  <Text type="secondary">配对码：</Text>
                  <Text code strong data-testid="pair-code">{pairCode ? pairCode.code : '-'}</Text>
                </div>
                <div data-testid="pair-ttl" style={{ marginTop: 8 }}>
                  <Text type="secondary">有效期 {ttlText}</Text>
                </div>
              </div>
            ) : (
              <Alert type="warning" showIcon message="请先设置域名，再生成二维码" />
            )}
            <div style={{ marginTop: 16, textAlign: 'center' }}>
              <Button icon={<ReloadOutlined />} loading={loadingCode} onClick={refreshPairCode}>
                刷新配对码
              </Button>
            </div>
          </Card>

          <Card
            title={
              <Space>
                <ApiOutlined />
                <span>连接域名</span>
              </Space>
            }
            style={{ marginTop: 16 }}
          >
            <Space direction="vertical" style={{ width: '100%' }}>
              <Alert
                type="info"
                showIcon
                message="域名将用于手机端连接（wss://域名/concrete/ws）。证书由腾讯云持有，本地无需配置证书。"
              />
              <Space.Compact style={{ width: '100%' }}>
                <Input
                  data-testid="domain-input"
                  placeholder={DEFAULT_DOMAIN}
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  prefix="wss://"
                  suffix="/concrete/ws"
                />
                <Button type="primary" icon={<SaveOutlined />} loading={savingDomain} onClick={handleSaveDomain}>
                  保存域名
                </Button>
              </Space.Compact>
            </Space>
          </Card>
        </Col>

        <Col xs={24} md={12}>
          <Card
            title={
              <Space>
                <WifiOutlined />
                <span>连接状态</span>
              </Space>
            }
          >
            <Row gutter={16}>
              <Col span={6}>
                <div data-testid="stat-paired">
                  <Statistic title="已配对设备" value={status ? status.pairedDevices : 0} />
                </div>
              </Col>
              <Col span={6}>
                <div data-testid="stat-clients">
                  <Statistic title="在线客户端" value={status ? status.connectedClients : 0} />
                </div>
              </Col>
              <Col span={6}>
                <div data-testid="stat-tunnel">
                  <Statistic
                    title="隧道连接"
                    value={status == null ? '-' : status.frpcRunning ? '已连接' : '未连接'}
                    valueStyle={{ color: status && status.frpcRunning ? '#52c41a' : '#faad14' }}
                  />
                </div>
              </Col>
              <Col span={6}>
                <div style={{ marginBottom: 8 }}>远程认证</div>
                <Switch
                  checked={status ? status.enabled : false}
                  disabled={!status || enabling}
                  onChange={handleToggleEnabled}
                  checkedChildren="已启用"
                  unCheckedChildren="已停用"
                />
              </Col>
            </Row>
            {status && status.frpcError && (
              <Alert
                type="warning"
                showIcon
                style={{ marginTop: 12 }}
                message="隧道异常"
                description={status.frpcError}
              />
            )}
          </Card>

          <Card
            title={
              <Space>
                <KeyOutlined />
                <span>安全设置</span>
              </Space>
            }
            style={{ marginTop: 16 }}
          >
            <Space direction="vertical" style={{ width: '100%' }}>
              <Alert type="info" showIcon message="登录密码仅在此处一次性展示，请立即保存；重置后旧密码立即失效。" />
              {status && status.hasPassword != null && (
                <Alert
                  type={status.hasPassword ? 'success' : 'warning'}
                  showIcon
                  data-testid="pwd-status"
                  message={status.hasPassword ? '远程密码：已设置（需要查看/更换请点下方重置）' : '远程密码：未设置'}
                />
              )}
              {tempPassword && (
                <Alert
                  type="warning"
                  showIcon
                  message={
                    <span>
                      新密码（仅本次显示）：<Text code strong data-testid="temp-password">{tempPassword}</Text>
                    </span>
                  }
                />
              )}
              <Button icon={<KeyOutlined />} loading={resetting} onClick={handleResetPassword}>
                重置密码
              </Button>
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  )
}
