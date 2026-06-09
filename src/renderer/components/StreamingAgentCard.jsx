import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Space, Typography, Button } from 'antd'
import {
  LoadingOutlined, CheckCircleOutlined, CloseCircleOutlined,
  PauseCircleOutlined, PlayCircleOutlined, StopOutlined,
  CaretRightOutlined, CaretDownOutlined, BulbOutlined, ToolOutlined
} from '@ant-design/icons'

const { Text } = Typography

// 工具中文标签
const TOOL_LABELS = {
  list_available_materials: '查询材料库',
  calculate_mix_design: '计算配合比',
  optimize_mix_cost: '成本优化',
  compare_materials: '材料对比',
  check_compliance: '规范审查',
  run_parameter_diagnosis: '参数诊断',
  predict_performance: '性能预测',
  list_standards: '查询规范库',
  prepare_sales_quote_draft: '准备报价草稿',
  calculate_sales_quote: '计算报价',
  create_sales_quote_rule: '创建报价规则',
  save_mix_design: '保存方案',
  save_to_basic_mix_library: '保存到基准库'
}

// 呼吸灯 + AI思考中 动画样式（全局只注入一次）
const STYLE_ID = 'streaming-agent-styles'
if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
@keyframes agent-breathing {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}
@keyframes ai-thinking-dots {
  0% { content: ''; }
  25% { content: '.'; }
  50% { content: '..'; }
  75% { content: '...'; }
}
.ai-thinking-text::after {
  content: '';
  animation: ai-thinking-dots 1.5s steps(1) infinite;
}
`
  document.head.appendChild(style)
}

/** 构建工具参数摘要 */
function buildArgsSummary(toolName, args = {}) {
  if (toolName === 'list_available_materials') {
    return args.type ? `类型: ${args.type}` : '全部材料'
  }
  if (toolName === 'calculate_mix_design' || toolName === 'optimize_mix_cost') {
    return [args.strength, args.slump ? `坍落度 ${args.slump}mm` : null].filter(Boolean).join(' | ')
  }
  if (toolName === 'compare_materials') {
    return [args.compareType, args.candidateIds?.length ? `${args.candidateIds.length}个候选` : null].filter(Boolean).join(' | ')
  }
  if (toolName === 'check_compliance') {
    return args.mixDesign?.strengthGrade || args.mixDesign?.strength || '规范审查'
  }
  return ''
}

/** 状态图标 */
const StatusIcon = ({ type, status }) => {
  if (status === 'running') {
    return <LoadingOutlined style={{ color: 'var(--color-primary, #0071e3)', fontSize: 14 }} />
  }
  if (status === 'done') {
    return <CheckCircleOutlined style={{ color: 'var(--color-success, #34C759)', fontSize: 14 }} />
  }
  if (status === 'error') {
    return <CloseCircleOutlined style={{ color: 'var(--color-error, #FF3B30)', fontSize: 14 }} />
  }
  if (type === 'reasoning') {
    return <BulbOutlined style={{ color: '#faad14', fontSize: 14 }} />
  }
  return <ToolOutlined style={{ color: '#999', fontSize: 14 }} />
}

/** 单个推理块 */
const ReasoningBlock = ({ item }) => {
  const [expanded, setExpanded] = useState(false)
  const isRunning = item.status === 'running'
  const hasContent = (item.content || '').length > 0

  return (
    <div style={{
      padding: '4px 0 4px 12px',
      borderLeft: '2px solid var(--color-primary, #0071e3)',
      marginLeft: 8,
      ...(isRunning ? {
        animation: 'agent-breathing 1.5s ease-in-out infinite',
        background: 'rgba(0, 113, 227, 0.03)',
        borderRadius: '0 4px 4px 0',
      } : {})
    }}>
      <Space size={4} style={{ cursor: hasContent ? 'pointer' : 'default', width: '100%' }}
        onClick={() => hasContent && setExpanded(!expanded)}
      >
        <StatusIcon type="reasoning" status={item.status} />
        {isRunning && !hasContent ? (
          <Text className="ai-thinking-text" style={{
            fontSize: 13,
            color: 'var(--color-primary, #0071e3)',
            fontStyle: 'italic'
          }}>
            AI思考中
          </Text>
        ) : (
          <>
            <Text style={{
              fontSize: 13,
              color: isRunning ? 'var(--color-primary, #0071e3)'
                : item.status === 'error' ? 'var(--color-error, #FF3B30)'
                : 'var(--color-text-body, #333)'
            }}>
              {isRunning ? 'AI思考中...' : '思考过程'}
            </Text>
            {hasContent && (
              expanded
                ? <CaretDownOutlined style={{ fontSize: 10, color: 'var(--color-text-secondary)' }} />
                : <CaretRightOutlined style={{ fontSize: 10, color: 'var(--color-text-secondary)' }} />
            )}
          </>
        )}
      </Space>

      {/* 展开的推理内容 */}
      {hasContent && expanded && (
        <div style={{
          marginTop: 4,
          padding: '6px 10px',
          background: 'var(--color-bg, #f5f5f7)',
          borderRadius: 4,
          fontSize: 12,
          color: 'var(--color-text-secondary, #666)',
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: 300,
          overflowY: 'auto'
        }}>
          {item.content}
        </div>
      )}

      {/* 折叠时显示前40字预览 */}
      {hasContent && !expanded && (
        <div style={{
          marginTop: 2,
          fontSize: 12,
          color: 'var(--color-text-secondary, #999)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: 400
        }}>
          {item.content.slice(0, 40)}{item.content.length > 40 ? '...' : ''}
        </div>
      )}

      {item.error && (
        <div style={{ marginTop: 4, fontSize: 12, color: 'var(--color-error, #FF3B30)' }}>
          {item.error}
        </div>
      )}
    </div>
  )
}

/** 单个工具块 */
const ToolBlock = ({ item }) => {
  const [expanded, setExpanded] = useState(false)
  const isRunning = item.status === 'running'
  const label = TOOL_LABELS[item.toolName] || item.toolName || '未知工具'
  const argsSummary = buildArgsSummary(item.toolName, item.args)

  return (
    <div style={{
      padding: '4px 12px',
      marginLeft: 8,
      ...(isRunning ? {
        animation: 'agent-breathing 1.5s ease-in-out infinite',
        background: 'rgba(0, 113, 227, 0.04)',
        borderRadius: 4,
      } : {})
    }}>
      <Space size={4} style={{ cursor: 'pointer', width: '100%' }}
        onClick={() => setExpanded(!expanded)}
      >
        <StatusIcon type="tool" status={item.status} />
        <Text style={{
          fontSize: 13,
          color: item.status === 'error' ? 'var(--color-error, #FF3B30)'
            : isRunning ? 'var(--color-primary, #0071e3)'
            : 'var(--color-text-body, #333)'
        }}>
          {label}
          {isRunning && ' 执行中...'}
          {item.status === 'done' && ' ✓'}
          {item.status === 'error' && ' ✗'}
        </Text>
        {argsSummary && (
          <Text type="secondary" style={{ fontSize: 11 }}>{argsSummary}</Text>
        )}
        {expanded
          ? <CaretDownOutlined style={{ fontSize: 10, color: 'var(--color-text-secondary)' }} />
          : <CaretRightOutlined style={{ fontSize: 10, color: 'var(--color-text-secondary)' }} />
        }
      </Space>

      {/* 展开的工具详情 */}
      {expanded && (
        <div style={{
          marginTop: 4,
          marginLeft: 20,
          padding: '6px 10px',
          background: 'var(--color-bg, #f5f5f7)',
          borderRadius: 4,
          fontSize: 12,
          color: 'var(--color-text-secondary, #666)',
          lineHeight: 1.6
        }}>
          {item.args && Object.keys(item.args).length > 0 && (
            <div style={{ marginBottom: 4 }}>
              <Text strong style={{ fontSize: 11 }}>参数：</Text>
              <pre style={{
                margin: '2px 0 0 0',
                fontSize: 11,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: 'inherit',
                background: 'rgba(0,0,0,0.03)',
                padding: '4px 8px',
                borderRadius: 3,
                maxHeight: 150,
                overflowY: 'auto'
              }}>
                {JSON.stringify(item.args, null, 2)}
              </pre>
            </div>
          )}
          {item.result && (
            <div>
              <Text strong style={{ fontSize: 11 }}>结果：</Text>
              <pre style={{
                margin: '2px 0 0 0',
                fontSize: 11,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: 'inherit',
                background: 'rgba(0,0,0,0.03)',
                padding: '4px 8px',
                borderRadius: 3,
                maxHeight: 200,
                overflowY: 'auto'
              }}>
                {typeof item.result === 'string' ? item.result : JSON.stringify(item.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {item.error && (
        <div style={{
          marginLeft: 20, marginTop: 2,
          fontSize: 12, color: 'var(--color-error, #FF3B30)'
        }}>
          {typeof item.error === 'object' ? (item.error.message || item.error.error || JSON.stringify(item.error)) : String(item.error)}
        </div>
      )}
    </div>
  )
}

/**
 * StreamingAgentCard — 实时流式 Agent 进度卡片
 *
 * 按时间线渲染思考块和工具块，支持：
 * - 思考过程默认折叠、可展开
 * - 工具调用穿插在思考过程中
 * - 运行中的项目呼吸灯效果
 * - "AI思考中..." 动画提示
 * - 流式回复文本预览 + 打字机光标
 */
const StreamingAgentCard = ({ timeline, status, agentReplyText, isPaused, showControls, onPause, onResume, onAbort }) => {
  if (!timeline || timeline.length === 0) {
    // 如果没有 timeline，但 agent 在运行，显示 "AI思考中..."
    if (status === 'running') {
      return (
        <div style={{
          marginBottom: 4, padding: '6px 12px',
          display: 'flex', alignItems: 'center', gap: 8
        }}>
          <LoadingOutlined style={{ color: 'var(--color-primary, #0071e3)', fontSize: 14 }} />
          <Text className="ai-thinking-text" style={{
            fontSize: 13,
            color: 'var(--color-primary, #0071e3)',
            fontStyle: 'italic'
          }}>
            AI思考中
          </Text>
          {showControls && (
            <Space size={4} style={{ marginLeft: 8 }}>
              <Button size="small" type="text" danger icon={<StopOutlined />} onClick={onAbort}>取消</Button>
            </Space>
          )}
        </div>
      )
    }
    return null
  }

  const hasRunningItems = timeline.some(item => item.status === 'running')

  return (
    <div style={{ marginBottom: 4 }}>
      {/* 顶部状态条 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '4px 8px', marginBottom: 4
      }}>
        <Space size={6}>
          {status === 'running' && hasRunningItems ? (
            <>
              <LoadingOutlined style={{ color: 'var(--color-primary, #0071e3)', fontSize: 14 }} />
              <Text className="ai-thinking-text" style={{
                fontSize: 13,
                color: 'var(--color-primary, #0071e3)',
                fontStyle: 'italic'
              }}>
                AI思考中
              </Text>
            </>
          ) : status === 'done' ? (
            <>
              <CheckCircleOutlined style={{ color: 'var(--color-success, #34C759)', fontSize: 14 }} />
              <Text style={{ fontSize: 13, color: 'var(--color-success, #34C759)' }}>完成</Text>
            </>
          ) : status === 'error' ? (
            <>
              <CloseCircleOutlined style={{ color: 'var(--color-error, #FF3B30)', fontSize: 14 }} />
              <Text style={{ fontSize: 13, color: 'var(--color-error, #FF3B30)' }}>执行出错</Text>
            </>
          ) : null}
        </Space>

        {showControls && status === 'running' && (
          <Space size={4}>
            {!isPaused ? (
              <Button size="small" type="text" icon={<PauseCircleOutlined />} onClick={onPause}>暂停</Button>
            ) : (
              <Button size="small" type="text" icon={<PlayCircleOutlined />} onClick={onResume} style={{ color: 'var(--color-primary)' }}>继续</Button>
            )}
            <Button size="small" type="text" danger icon={<StopOutlined />} onClick={onAbort}>取消</Button>
          </Space>
        )}
      </div>

      {/* 时间线 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {timeline.map((item, index) => (
          item.type === 'reasoning'
            ? <ReasoningBlock key={`r-${index}`} item={item} />
            : <ToolBlock key={`t-${item.toolCallId || index}`} item={item} />
        ))}
      </div>

      {/* 流式回复文本预览（仅 streaming 状态时显示） */}
      {status === 'streaming' && agentReplyText && (
        <div className="reply-preview" style={{ marginTop: 8, fontSize: 13, color: 'var(--color-text-secondary)' }}>
          <ReactMarkdown>{agentReplyText}</ReactMarkdown>
          <span className="streaming-cursor">|</span>
        </div>
      )}
    </div>
  )
}

export default StreamingAgentCard
