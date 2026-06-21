import React, { useEffect, useState } from 'react'
import { Modal, Button, Tag, List, Spin, Alert, Empty, Space } from 'antd'
import {
  CheckCircleOutlined,
  WarningOutlined,
  CloseCircleOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import {
  normalizeLintResponse,
  summarizeReport,
  getIssueSections,
  formatStaleSummary,
  validateReport
} from './LintReportModal.core'

/**
 * LintReportModal - Wiki 健康检查结果展示（Task 6.3）
 *
 * Props:
 *  - visible:  Modal 开关
 *  - onClose:  关闭回调
 *  - api:      可选；测试用注入。默认用 window.electronAPI.workspace.lint
 *
 * 数据流：
 *  visible=true → useEffect 触发 lint() → 解析响应（兼容多种 IPC 形态）→ 展示
 */
export default function LintReportModal({ visible, onClose, api }) {
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // 取 api（支持注入以便测试）
  const getApi = () => api || (typeof window !== 'undefined' && window.electronAPI)

  const loadReport = async () => {
    const electronAPI = getApi()
    if (!electronAPI || !electronAPI.workspace || typeof electronAPI.workspace.lint !== 'function') {
      setError('当前环境不支持 workspace.lint（请在 Electron 内运行）')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const raw = await electronAPI.workspace.lint()
      const normalized = normalizeLintResponse(raw)
      if (!normalized) {
        // raw 可能是 ErrorCodes.createError 返回的 {success:false, error}
        const errMsg = (raw && (raw.error || raw.message)) || '健康检查返回为空'
        setError(errMsg)
        setReport(null)
        return
      }
      const v = validateReport(normalized)
      if (!v.ok) {
        setError('报告格式异常：' + v.error)
        setReport(null)
        return
      }
      setReport(normalized)
    } catch (err) {
      setError(err && err.message ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (visible) {
      loadReport()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  const summary = summarizeReport(report)
  const sections = getIssueSections(report)

  const renderHeader = () => {
    if (loading) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}>
          <Spin />
          <span>正在扫描 wiki 健康状态…</span>
        </div>
      )
    }
    if (error) {
      return <Alert type="error" showIcon message="健康检查失败" description={error} />
    }
    if (!report) {
      return <Empty description="暂无数据" />
    }
    if (summary.level === 'ok') {
      return (
        <Alert
          type="success"
          showIcon
          icon={<CheckCircleOutlined />}
          message="Wiki 健康：未发现问题"
          description={`扫描时间：${report.scannedAt || '—'}`}
        />
      )
    }
    return (
      <Alert
        type={summary.level === 'error' ? 'error' : 'warning'}
        showIcon
        icon={summary.level === 'error' ? <CloseCircleOutlined /> : <WarningOutlined />}
        message={`Wiki 健康：发现 ${summary.total} 项问题`}
        description={`扫描时间：${report.scannedAt || '—'}`}
      />
    )
  }

  const renderSection = (section) => {
    return (
      <div key={section.key} style={{ marginTop: 16 }}>
        <Space style={{ marginBottom: 8 }}>
          <Tag color="blue">{section.items.length}</Tag>
          <strong>{section.label}</strong>
        </Space>
        <List
          size="small"
          bordered
          dataSource={section.items}
          renderItem={(item) => {
            // 各类项目渲染
            if (section.key === 'orphans') {
              return <List.Item><code>{item.path}</code></List.Item>
            }
            if (section.key === 'missingFrontmatter') {
              return (
                <List.Item>
                  <Space direction="vertical" size={0} style={{ width: '100%' }}>
                    <code>{item.path}</code>
                    <span style={{ color: '#999', fontSize: 12 }}>
                      缺失字段：{(item.missing || []).join('、')}
                    </span>
                  </Space>
                </List.Item>
              )
            }
            if (section.key === 'missingCrossRefs') {
              return (
                <List.Item>
                  <Space direction="vertical" size={0} style={{ width: '100%' }}>
                    <span><code>{item.path}</code> 引用 <code>[[{item.ref}]]</code> 不存在</span>
                  </Space>
                </List.Item>
              )
            }
            if (section.key === 'staleSummaries') {
              return (
                <List.Item>
                  <Space direction="vertical" size={0} style={{ width: '100%' }}>
                    <code>{item.path}</code>
                    <span style={{ color: '#999', fontSize: 12 }}>
                      源文件：{item.sourceFile} · {formatStaleSummary(item)}
                    </span>
                  </Space>
                </List.Item>
              )
            }
            if (section.key === 'contradictions') {
              return (
                <List.Item>
                  <Space direction="vertical" size={0} style={{ width: '100%' }}>
                    <code>{item.path || '（未指定路径）'}</code>
                    {item.message && <span style={{ color: '#999', fontSize: 12 }}>{item.message}</span>}
                  </Space>
                </List.Item>
              )
            }
            return <List.Item>{JSON.stringify(item)}</List.Item>
          }}
        />
      </div>
    )
  }

  return (
    <Modal
      title="🩺 Wiki 健康检查"
      open={visible}
      onCancel={onClose}
      width={720}
      destroyOnClose
      footer={[
        <Button key="reload" icon={<ReloadOutlined />} onClick={loadReport} disabled={loading}>
          重新扫描
        </Button>,
        <Button key="close" onClick={onClose}>关闭</Button>
      ]}
    >
      {renderHeader()}
      {!loading && !error && report && sections.length > 0 && (
        <div data-testid="lint-sections">
          {sections.map(renderSection)}
        </div>
      )}
    </Modal>
  )
}
