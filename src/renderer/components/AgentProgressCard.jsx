import React, { useState } from 'react'
import { Space, Typography, Button } from 'antd'
import { LoadingOutlined, CheckCircleOutlined, CloseCircleOutlined, PauseCircleOutlined, PlayCircleOutlined, StopOutlined, CaretRightOutlined, CaretDownOutlined, BulbOutlined } from '@ant-design/icons'

// 呼吸灯动画样式
const breathingKeyframes = `
@keyframes agent-breathing {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}
`
if (typeof document !== 'undefined' && !document.getElementById('agent-breathing-style')) {
  const style = document.createElement('style')
  style.id = 'agent-breathing-style'
  style.textContent = breathingKeyframes
  document.head.appendChild(style)
}

const { Text } = Typography

const TOOL_LABELS = {
  list_available_materials: '查询材料库',
  calculate_mix_design: '计算配合比',
  optimize_mix_cost: '成本优化',
  check_compliance: '规范审查',
  predict_performance: '性能预测',
  prepare_sales_quote_draft: '生成报价草稿（已废弃）',
  calculate_sales_quote: '计算报价（已废弃）',
  reverse_sales_quote: '反向套价',
  forward_sales_quote: '正向测算',
  format_quote_report: '导出报价单',
  save_mix_design: '保存方案',
  save_to_basic_mix_library: '保存到基础库'
}

const StepIcon = ({ status }) => {
  switch (status) {
    case 'running': return <LoadingOutlined style={{ color: 'var(--color-primary, #0071e3)', fontSize: 14 }} />
    case 'done': return <CheckCircleOutlined style={{ color: 'var(--color-success, #34C759)', fontSize: 14 }} />
    case 'error': return <CloseCircleOutlined style={{ color: 'var(--color-error, #FF3B30)', fontSize: 14 }} />
    case 'skipped': return <Text type="secondary" style={{ fontSize: 14 }}>—</Text>
    default: return <Text type="secondary" style={{ fontSize: 14 }}>○</Text>
  }
}

const AgentProgressCard = ({ steps, status, onPause, onResume, onAbort, isPaused, showControls, latestReasoning }) => {
  if (!steps || steps.length === 0) return null

  const filteredSteps = steps.filter(s => s.toolName || s.type === 'reasoning' || s.status === 'done')
  if (filteredSteps.length === 0) return null

  return (
    <div style={{ marginBottom: 4 }}>
      {filteredSteps.map((s, i) => (
        <StepRow key={i} step={s} index={i} />
      ))}

      {showControls && status === 'running' && (
        <Space size={4} style={{ marginTop: 4, paddingLeft: 2 }}>
          {!isPaused ? (
            <Button size="small" type="text" icon={<PauseCircleOutlined />} onClick={onPause}>暂停</Button>
          ) : (
            <Button size="small" type="text" icon={<PlayCircleOutlined />} onClick={onResume} style={{ color: 'var(--color-primary)' }}>继续</Button>
          )}
          <Button size="small" type="text" danger icon={<StopOutlined />} onClick={onAbort}>取消</Button>
        </Space>
      )}

      {latestReasoning && status === 'running' && (
        <div style={{
          marginLeft: 20, marginTop: 4, marginBottom: 4,
          padding: '4px 8px',
          borderLeft: '2px solid var(--color-primary, #0071e3)',
          fontSize: 12,
          color: 'var(--color-text-secondary)',
          lineHeight: 1.5,
          background: 'var(--color-bg, #f5f5f7)',
          borderRadius: '0 4px 4px 0'
        }}>
          {latestReasoning}
        </div>
      )}

      {status === 'done' && (
        <Text type="secondary" style={{ fontSize: 12 }}><CheckCircleOutlined style={{ color: 'var(--color-success)' }} /> 完成</Text>
      )}
      {status === 'error' && (
        <Text type="danger" style={{ fontSize: 12 }}><CloseCircleOutlined /> 执行出错</Text>
      )}
    </div>
  )
}

const StepRow = ({ step }) => {
  const [expanded, setExpanded] = useState(false)
  const label = TOOL_LABELS[step.toolName] || step.toolName
  const hasReasoning = !!step.reasoning
  const isRunning = step.status === 'running'

  return (
    <div style={{
      padding: '2px 0',
      ...(isRunning ? {
        animation: 'agent-breathing 1.5s ease-in-out infinite',
        background: 'rgba(0, 113, 227, 0.04)',
        borderRadius: 4,
        paddingLeft: 4,
      } : {})
    }}>
      <Space size={4} style={{ cursor: hasReasoning ? 'pointer' : 'default' }}
        onClick={() => hasReasoning && setExpanded(!expanded)}
      >
        <StepIcon status={step.status} />
        <Text style={{
          fontSize: 13,
          color: step.status === 'error' ? 'var(--color-error)'
            : step.status === 'running' ? 'var(--color-primary)'
            : 'var(--color-text-body)'
        }}>
          {label || (step.reasoning ? step.reasoning.slice(0, 40) : `步骤`)}
          {step.status === 'running' && ' 中...'}
        </Text>
        {hasReasoning && (
          expanded
            ? <CaretDownOutlined style={{ fontSize: 10, color: 'var(--color-text-secondary)' }} />
            : <CaretRightOutlined style={{ fontSize: 10, color: 'var(--color-text-secondary)' }} />
        )}
      </Space>

      {/* 思考过程：reasoning 类型的步骤直接展示内容 */}
      {step.type === 'reasoning' && step.reasoning && (
        <div style={{
          marginLeft: 20, marginTop: 2, marginBottom: 2,
          padding: '4px 8px',
          borderLeft: '2px solid var(--color-primary, #0071e3)',
          fontSize: 12,
          color: 'var(--color-text-secondary)',
          lineHeight: 1.5,
          background: 'var(--color-bg, #f5f5f7)',
          borderRadius: '0 4px 4px 0',
          whiteSpace: 'pre-wrap'
        }}>
          {step.reasoning}
        </div>
      )}

      {/* 工具步骤的可展开 reasoning */}
      {hasReasoning && step.type !== 'reasoning' && expanded && (
        <div style={{
          marginLeft: 20, marginTop: 2, marginBottom: 2,
          padding: '4px 8px',
          background: 'var(--color-bg, #f5f5f7)',
          borderRadius: 4,
          fontSize: 12,
          color: 'var(--color-text-secondary)',
          lineHeight: 1.5
        }}>
          {step.reasoning}
        </div>
      )}

      {step.error && (
        <div style={{
          marginLeft: 20, marginTop: 2,
          fontSize: 12,
          color: 'var(--color-error)',
        }}>
          {typeof step.error === 'object' ? (step.error.message || step.error.error || JSON.stringify(step.error)) : String(step.error)}
        </div>
      )}
    </div>
  )
}

export default AgentProgressCard
