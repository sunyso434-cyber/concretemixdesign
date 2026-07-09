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
  check_compliance: '规范审查',
  predict_performance: '性能预测',
  list_standards: '查询规范库',
  prepare_sales_quote_draft: '准备报价草稿（已废弃）',
  calculate_sales_quote: '计算报价（已废弃）',
  create_sales_quote_rule: '创建报价规则（已废弃）',
  reverse_sales_quote: '反向套价',
  forward_sales_quote: '正向测算',
  format_quote_report: '导出报价单',
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

/**
 * 工具结果的"翻译官" — 把结构化 JSON 翻成普通人看得懂的中文摘要。
 * 不认识的字段一律兜底成"已成功"之类的话术，绝不再裸 JSON。
 */
function renderResultSummary(toolName, result) {
  if (!result || typeof result !== 'object') return ''
  if (result._mdInstruction) return '通过 markdown 指令处理'

  switch (toolName) {
    case 'list_available_materials': {
      const count = result.count ?? result.materials?.length ?? 0
      const byType = {}
      for (const m of result.materials || []) {
        const t = m.type || m.category || '其他'
        byType[t] = (byType[t] || 0) + 1
      }
      const breakdown = Object.entries(byType).map(([t, n]) => `${t} ${n}`).join('、')
      return breakdown ? `找到 ${count} 种材料（${breakdown}）` : `找到 ${count} 种材料`
    }
    case 'calculate_mix_design': {
      const d = result.data || {}
      const parts = []
      if (d.cement != null) parts.push(`水泥 ${d.cement}`)
      if (d.water != null) parts.push(`水 ${d.water}`)
      if (d.sand != null) parts.push(`砂 ${d.sand}`)
      if (d.stone != null || d.gravel != null) parts.push(`石 ${d.stone ?? d.gravel}`)
      if (d.waterBinderRatio != null || d.wcratio != null) {
        parts.push(`水胶比 ${d.waterBinderRatio ?? d.wcratio}`)
      }
      return parts.length ? `草稿已生成：${parts.join('，')}（kg/m³）${result.draftId ? ' ✓' : ''}` : '草稿已生成'
    }
    case 'optimize_mix_cost': {
      const d = result.data || {}
      const meta = result.meta || {}
      const total = meta.totalEvaluated || d.totalEvaluated
      const stages = meta.stagesCompleted || d.stagesCompleted || 5
      const best = d.top5?.[0]
      const bestCost = best?.totalCost ?? best?.cost
      let text = `完成 ${stages} 阶段成本优化`
      if (total) text += `，共评估 ${total} 组方案`
      if (bestCost) text += `，最优成本 ${Number(bestCost).toFixed(1)} 元/m³`
      return text
    }
    case 'check_compliance': {
      const violations = result.data?.violations || result.violations || []
      const warnings = result.data?.warnings || result.warnings || []
      const passed = result.data?.passed ?? result.passed
      if (passed) return '符合规范 ✓'
      const total = violations.length + warnings.length
      return total ? `不符合规范：${violations.length} 项违规、${warnings.length} 项警告（合计 ${total} 条）` : '不符合规范'
    }
    case 'predict_performance': {
      const d = result.data || {}
      const parts = []
      if (d.fc28 != null || d.strength28d != null || d.compressiveStrength != null) {
        parts.push(`28d 强度 ${d.fc28 ?? d.strength28d ?? d.compressiveStrength} MPa`)
      }
      if (d.slump != null) parts.push(`坍落度 ${d.slump} mm`)
      if (d.density != null || d.unitWeight != null) parts.push(`容重 ${d.density ?? d.unitWeight} kg/m³`)
      return parts.length ? `预测完成：${parts.join('，')}` : '预测完成'
    }
    case 'save_mix_design':
      return result.message ? `✓ ${result.message}` : '✓ 方案已保存'
    case 'save_to_basic_mix_library':
      return result.message ? `✓ ${result.message}` : '✓ 已保存到基准库'
    case 'list_standards': {
      const count = result.count ?? result.standards?.length ?? 0
      return count ? `找到 ${count} 条规范` : '查询完成'
    }
    case 'prepare_sales_quote_draft':
    case 'calculate_sales_quote': {
      return '已废弃(v10.10)'
    }
    case 'create_sales_quote_rule':
      return '已废弃(v10.10)'
    case 'reverse_sales_quote':
    case 'forward_sales_quote': {
      const d = result.data || result
      const total = d.suggestedDealPrice ?? d.suggestedPrice ?? d.total ?? d.price
      if (total != null) return `报价完成：含税价 ${Number(total).toFixed(2)} 元/m³`
      return '报价已生成'
    }
    case 'format_quote_report': {
      const path = result.filePath || result.path
      return path ? `✓ 报告已生成: ${path}` : '✓ 报告已生成'
    }
    default:
      // 兜底：未知工具，提示成功而不暴露 JSON
      return result.success === false ? '执行失败' : '执行完成'
  }
}

/**
 * 把参数 args 翻译成简短的"输入条件"摘要，显示在标题旁。
 * 覆盖所有已知工具；未识别就给空字符串，不暴露原始 JSON。
 */
function renderArgsSummary(toolName, args = {}) {
  if (!args || typeof args !== 'object') return ''
  if (toolName === 'list_available_materials') {
    return args.type ? `类型：${args.type}` : '全部材料'
  }
  if (toolName === 'calculate_mix_design' || toolName === 'optimize_mix_cost') {
    const parts = [args.strength, args.slump ? `坍落度 ${args.slump}mm` : null]
    if (toolName === 'optimize_mix_cost' && args.gridStep) parts.push(`步长 ${args.gridStep}`)
    return parts.filter(Boolean).join(' | ')
  }
  if (toolName === 'check_compliance') {
    return args.mixDesign?.strengthGrade || args.mixDesign?.strength || '规范审查'
  }
  if (toolName === 'save_mix_design') {
    return args.schemeName || args.name || '保存方案'
  }
  if (toolName === 'save_to_basic_mix_library') {
    return args.name || '保存到基准库'
  }
  if (toolName === 'predict_performance') {
    return '预测强度 / 坍落度 / 容重'
  }
  if (toolName === 'calculate_sales_quote') {
    return '已废弃'
  }
  if (toolName === 'prepare_sales_quote_draft') {
    return '已废弃'
  }
  if (toolName === 'create_sales_quote_rule') {
    return '已废弃'
  }
  if (toolName === 'reverse_sales_quote') {
    return args.targetUnitPrice ? `目标市价 ${args.targetUnitPrice} 元/m³` : '反向套价'
  }
  if (toolName === 'forward_sales_quote') {
    return args.equipmentAmortization ? '含新设备分摊' : '正向议价测算'
  }
  if (toolName === 'format_quote_report') {
    return args.filename || '导出报价单'
  }
  if (toolName === 'list_standards') {
    return args.category || args.keyword || '查询规范库'
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
  const [showRaw, setShowRaw] = useState(false) // ponytail: 给开发/调试留的 JSON 折叠开关，默认收起
  const isRunning = item.status === 'running'
  const label = TOOL_LABELS[item.toolName] || item.toolName || '未知工具'
  const argsSummary = renderArgsSummary(item.toolName, item.args)
  const resultSummary = item.result && item.status !== 'running' ? renderResultSummary(item.toolName, item.result) : ''

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

      {/* 展开的工具详情 — 默认展示人话摘要，底部可折叠出原始 JSON 给调试用 */}
      {expanded && (
        <div style={{
          marginTop: 4,
          marginLeft: 20,
          padding: '6px 10px',
          background: 'var(--color-bg, #f5f5f7)',
          borderRadius: 4,
          fontSize: 12,
          color: 'var(--color-text-body, #333)',
          lineHeight: 1.7
        }}>
          {item.args && Object.keys(item.args).length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <Text strong style={{ fontSize: 11, color: 'var(--color-text-secondary, #666)' }}>输入条件：</Text>
              <div style={{ marginTop: 2 }}>{argsSummary || '（默认参数）'}</div>
            </div>
          )}
          {item.result && item.status !== 'running' && (
            <div style={{ marginBottom: 6 }}>
              <Text strong style={{ fontSize: 11, color: 'var(--color-text-secondary, #666)' }}>执行结果：</Text>
              <div style={{ marginTop: 2 }}>{resultSummary || '已完成'}</div>
            </div>
          )}
          {item.status === 'running' && (
            <div style={{ color: 'var(--color-primary, #0071e3)', fontStyle: 'italic' }}>正在执行...</div>
          )}
          {/* ponytail: 给开发/调试留的原始 JSON 折叠开关，默认收起 */}
          <details style={{ marginTop: 4 }}>
            <summary style={{ cursor: 'pointer', fontSize: 11, color: 'var(--color-text-secondary, #999)', userSelect: 'none' }}>
              查看原始数据
            </summary>
            {item.args && Object.keys(item.args).length > 0 && (
              <div style={{ marginTop: 4 }}>
                <Text strong style={{ fontSize: 10 }}>args：</Text>
                <pre style={{
                  margin: '2px 0 0 0', fontSize: 10,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  fontFamily: 'inherit', background: 'rgba(0,0,0,0.03)',
                  padding: '4px 8px', borderRadius: 3,
                  maxHeight: 120, overflowY: 'auto'
                }}>{JSON.stringify(item.args, null, 2)}</pre>
              </div>
            )}
            {item.result && (
              <div style={{ marginTop: 4 }}>
                <Text strong style={{ fontSize: 10 }}>result：</Text>
                <pre style={{
                  margin: '2px 0 0 0', fontSize: 10,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  fontFamily: 'inherit', background: 'rgba(0,0,0,0.03)',
                  padding: '4px 8px', borderRadius: 3,
                  maxHeight: 150, overflowY: 'auto'
                }}>
                  {typeof item.result === 'string' ? item.result : JSON.stringify(item.result, null, 2)}
                </pre>
              </div>
            )}
          </details>
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
 *
 * 数据来源：
 * - `timeline`     — 消息对象上的 timeline（AI 回复完毕后落地的那份）
 * - `liveTimeline` — `state.agent.timeline`（流式过程中的实时数据）
 * - `live`         — true 时优先用 `liveTimeline`，让呼吸灯/三点动画真正转起来
 */
const StreamingAgentCard = ({ timeline, liveTimeline, live, status, agentReplyText, isPaused, showControls, onPause, onResume, onAbort }) => {
  const effectiveTimeline = live && liveTimeline?.length ? liveTimeline : timeline
  if (!effectiveTimeline || effectiveTimeline.length === 0) {
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

  const hasRunningItems = effectiveTimeline.some(item => item.status === 'running')

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
        {effectiveTimeline.map((item, index) => (
          item.type === 'reasoning'
            ? <ReasoningBlock key={`r-${item.roundIndex ?? index}`} item={item} />
            : <ToolBlock key={`t-${item.toolCallId || item.id || index}`} item={item} />
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
