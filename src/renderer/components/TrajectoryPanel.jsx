import React, { useMemo, useState, useRef, useEffect } from 'react'
import { Input, Segmented, Typography, Space, Empty, Divider, Button } from 'antd'
import {
  BulbOutlined, ToolOutlined, CheckCircleOutlined, CloseCircleOutlined,
  CaretRightOutlined, CaretDownOutlined, LoadingOutlined, UnorderedListOutlined,
} from '@ant-design/icons'
import {
  buildTrajectorySteps,
  filterTrajectorySteps,
} from '../utils/trajectorySteps'
import { resultToTableData } from '../utils/toolResultTable'

const { Text } = Typography

// 工具中文名（与 StreamingAgentCard 保持一致的精简版）
const TOOL_LABELS = {
  list_available_materials: '查询材料库',
  calculate_mix_design: '计算配合比',
  optimize_mix_cost: '成本优化',
  predict_performance: '性能预测',
  reverse_sales_quote: '反向套价',
  forward_sales_quote: '正向测算',
  format_quote_report: '导出报价单',
  save_mix_design: '保存方案',
  workspace_writeFile: '生成报告',
  workspace_search: '工作区搜索',
  workspace_grep: '搜索文件内容',
  workspace_readFile: '读取文件',
  ask_user: '询问确认',
  todo_manage: '任务清单',
}

/** 步骤摘要（折叠态显示） */
function stepSummary(step) {
  if (step.type === 'reasoning') {
    const c = (step.content || '').trim()
    return c ? c.slice(0, 48) + (c.length > 48 ? '…' : '') : '思考中…'
  }
  // tool
  const args = step.args
  const parts = []
  if (args && typeof args === 'object') {
    if (args.strength) parts.push(args.strength)
    if (args.slump) parts.push(`坍落度 ${args.slump}mm`)
    if (args.type) parts.push(`类型：${args.type}`)
    if (args.filename) parts.push(args.filename)
  }
  const r = step.result
  if (r && typeof r === 'object' && r.success === false && r.error) {
    return `✗ ${typeof r.error === 'object' ? (r.error.message || JSON.stringify(r.error)) : r.error}`
  }
  if (r && typeof r === 'object' && r.count !== undefined) {
    parts.push(`${r.count} 条`)
  }
  if (r && typeof r === 'object' && r.type === 'mix_design' && r.data) {
    const d = r.data
    if (d.waterRatio) parts.push(`水胶比 ${d.waterRatio.toFixed(4)}`)
    if (d.totalCost) parts.push(`成本 ¥${d.totalCost.toFixed(2)}`)
  }
  if (parts.length === 0 && r && typeof r === 'object') {
    const keys = Object.keys(r)
    if (keys.length > 0 && r.success !== undefined) parts.push(r.success ? '成功' : '失败')
  }
  return parts.join(' | ') || '已执行'
}

/**
 * v0.9.x 轨迹功能（阶段 1）：会话轨迹视图
 *
 * 按回合（assistant 消息）分组的步骤账本：思考 + 工具调用全过程，
 * 支持搜索（工具名/参数/结果）、过滤（全部/工具/思考/失败）、步骤详情展开。
 *
 * v0.9.4 改版：由右侧抽屉改为与"会话"并列的内嵌 tab 视图（参考 DSH 布局），
 * 组件仅在轨迹 tab 激活时挂载（卸载即重置状态，等同原 destroyOnHidden）。
 */
const TrajectoryPanel = ({ messages, liveTimeline, agentStatus, focusToolCallId }) => {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [expandedKeys, setExpandedKeys] = useState(new Set())
  const listRef = useRef(null)

  const steps = useMemo(() => buildTrajectorySteps(messages), [messages])

  // v0.9.x 轨迹阶段2：实时同步——AI 干活过程中把 agent.liveTimeline 附加为"进行中回合"
  // （'running' 是主进程状态枚举，前端 store 从未设置，不在判断内）
  const isAgentWorking = ['thinking', 'streaming', 'tool_calling', 'paused'].includes(agentStatus)
  const liveSteps = useMemo(() => {
    if (!isAgentWorking || !Array.isArray(liveTimeline) || liveTimeline.length === 0) return []
    const turn = steps.length > 0 ? steps[steps.length - 1].turn + 1 : 1
    return liveTimeline
      .filter(item => item && typeof item === 'object' && item.type !== 'notice')
      .map((item, ti) => ({
        key: `live-${turn}-${ti}`,
        turn,
        msgId: null,
        msgContent: '',
        msgStats: null,
        type: item.type === 'reasoning' ? 'reasoning' : 'tool',
        toolName: item.type === 'tool' ? item.toolName : undefined,
        args: item.type === 'tool' ? item.args : undefined,
        result: item.type === 'tool' ? item.result : undefined,
        content: item.type === 'reasoning' ? item.content : undefined,
        status: item.status || 'running',
        elapsedMs: typeof item.elapsedMs === 'number' ? item.elapsedMs : null,
        toolCallId: item.toolCallId || undefined,
        live: true,
      }))
  }, [liveTimeline, isAgentWorking, steps])

  const allSteps = useMemo(() => [...steps, ...liveSteps], [steps, liveSteps])
  const visible = useMemo(
    () => filterTrajectorySteps(allSteps, query, filter),
    [allSteps, query, filter]
  )

  // v0.9.x 轨迹阶段2：跨视图跳转定位（聊天工具块 → 轨迹面板展开并滚动到该步骤）
  // 修复：AI 干活中工具刚完成时位于 liveTimeline（进行中回合），历史 steps 里没有——
  // 只查 steps 会静默失败（点了没反应）。先查历史，再查进行中。
  const focusKey = useMemo(() => {
    if (!focusToolCallId) return null
    const hit = steps.find(s => s.type === 'tool' && s.toolCallId === focusToolCallId)
      || liveSteps.find(s => s.type === 'tool' && s.toolCallId === focusToolCallId)
    return hit ? hit.key : null
  }, [focusToolCallId, steps, liveSteps])

  useEffect(() => {
    if (!focusKey) return
    // 展开目标步骤（含其回合下同组），再滚动定位
    setExpandedKeys(prev => new Set(prev).add(focusKey))
    const timer = setTimeout(() => {
      const el = listRef.current && listRef.current.querySelector(`[data-step-key="${focusKey}"]`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 150)
    return () => clearTimeout(timer)
  }, [focusKey])

  const allExpanded = visible.length > 0 && visible.every(s => expandedKeys.has(s.key))
  const toggleAll = () => {
    setExpandedKeys(allExpanded ? new Set() : new Set(visible.map(s => s.key)))
  }

  // 按回合分组（保留顺序）
  const groups = useMemo(() => {
    const map = new Map()
    for (const s of visible) {
      if (!map.has(s.turn)) map.set(s.turn, [])
      map.get(s.turn).push(s)
    }
    return [...map.entries()].map(([turn, list]) => {
      const stats = list.find(s => s.msgStats)?.msgStats || null
      return { turn, steps: list, stats }
    })
  }, [visible])

  const toggle = (key) => {
    setExpandedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const fmtTime = (ms) => (ms != null && ms >= 0) ? `${(ms / 1000).toFixed(1)}s` : null
  const fmtTokens = (n) => {
    if (!Number.isFinite(n) || n <= 0) return null
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n))
  }

  const stepCount = allSteps.length
  const toolCount = allSteps.filter(s => s.type === 'tool').length
  const failCount = allSteps.filter(s => s.status === 'error').length
  const hasLive = liveSteps.length > 0

  return (
    <div className="trajectory-view">
      {/* 工具条：统计行 + 搜索/过滤（全宽布局） */}
      <div className="trajectory-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <Space size={8}>
            <span style={{ fontWeight: 600 }}>轨迹</span>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {stepCount} 步 · 工具 {toolCount}
              {failCount > 0 && <Text type="danger" style={{ fontSize: 12 }}> · 失败 {failCount}</Text>}
              {hasLive && <Text style={{ fontSize: 12, color: 'var(--color-primary, #0071e3)' }}> · 进行中…</Text>}
            </Text>
          </Space>
          {visible.length > 0 && (
            <Button
              type="text"
              size="small"
              icon={<UnorderedListOutlined />}
              onClick={toggleAll}
              title={allExpanded ? '全部收起' : '全部展开'}
            >
              {allExpanded ? '全部收起' : '全部展开'}
            </Button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Input.Search
            allowClear
            placeholder="搜索工具/参数/结果…"
            onChange={e => setQuery(e.target.value)}
            value={query}
            style={{ flex: 1, minWidth: 200 }}
          />
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { label: '全部', value: 'all' },
              { label: '工具', value: 'tool' },
              { label: '思考', value: 'reasoning' },
              { label: '失败', value: 'failed' },
            ]}
          />
        </div>
        <Divider style={{ margin: '12px 0 8px 0' }} />
      </div>

      {/* 步骤账本：按回合分组，独立滚动 */}
      {groups.length === 0 ? (
        <Empty
          description={stepCount === 0 ? '暂无轨迹数据（AI 干活时实时显示）' : '无匹配步骤'}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      ) : (
        <div className="trajectory-body" ref={listRef}>
        {groups.map(group => (
          <div key={group.turn} style={{ marginBottom: 16 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '4px 8px', background: 'var(--color-bg, #f5f5f7)',
              borderRadius: 4, marginBottom: 4,
            }}>
              <Text strong style={{ fontSize: 12 }}>回合 {group.turn}</Text>
              <Text type="secondary" style={{ fontSize: 11 }}>{group.steps.length} 步</Text>
              {group.steps.some(s => s.live) && (
                <Text style={{ fontSize: 11, color: 'var(--color-primary, #0071e3)', fontStyle: 'italic' }}>进行中</Text>
              )}
              {group.stats && fmtTime(group.stats.elapsedMs) && (
                <Text type="secondary" style={{ fontSize: 11 }}>用时 {fmtTime(group.stats.elapsedMs)}</Text>
              )}
              {/* v0.9.x 轨迹阶段2：回合 token 消耗（真实 usage） */}
              {group.stats && group.stats.usage && fmtTokens(group.stats.usage.total_tokens) && (
                <Text type="secondary" style={{ fontSize: 11 }}>token {fmtTokens(group.stats.usage.total_tokens)}</Text>
              )}
            </div>

            {group.steps.map(step => {
              const expanded = expandedKeys.has(step.key)
              const isError = step.status === 'error'
              const isRunning = step.status === 'running'
              return (
                <div key={step.key} data-step-key={step.key} style={{ marginBottom: 2 }}>
                  <div
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '4px 8px', cursor: 'pointer', borderRadius: 4,
                      background: isError ? 'rgba(255, 59, 48, 0.05)' : 'transparent',
                    }}
                    onClick={() => toggle(step.key)}
                  >
                    {step.type === 'reasoning'
                      ? <BulbOutlined style={{ color: '#faad14', fontSize: 13 }} />
                      : <ToolOutlined style={{ color: '#8c8c8c', fontSize: 13 }} />}
                    <Text style={{ fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {step.type === 'tool'
                        ? (TOOL_LABELS[step.toolName] || step.toolName || '工具调用')
                        : '思考过程'}
                      <Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>{stepSummary(step)}</Text>
                    </Text>
                    {/* v0.9.x 轨迹阶段2：每步精确耗时 */}
                    {step.elapsedMs != null && (
                      <Text type="secondary" style={{ fontSize: 11 }}>{fmtTime(step.elapsedMs)}</Text>
                    )}
                    {isRunning
                      ? <LoadingOutlined style={{ color: 'var(--color-primary, #0071e3)', fontSize: 12 }} />
                      : isError
                        ? <CloseCircleOutlined style={{ color: 'var(--color-error, #FF3B30)', fontSize: 13 }} />
                        : <CheckCircleOutlined style={{ color: 'var(--color-success, #34C759)', fontSize: 13 }} />}
                    {expanded
                      ? <CaretDownOutlined style={{ fontSize: 10, color: '#999' }} />
                      : <CaretRightOutlined style={{ fontSize: 10, color: '#999' }} />}
                  </div>

                  {expanded && <StepDetail step={step} />}
                </div>
              )
            })}
          </div>
        ))}
        </div>
      )}
    </div>
  )
}

/** 步骤详情（展开态）：思考全文 / 工具 args+result */
function StepDetail({ step }) {
  if (step.type === 'reasoning') {
    return (
      <div style={{ margin: '0 8px 6px 26px', padding: '6px 10px', background: 'var(--color-bg, #f5f5f7)', borderRadius: 4 }}>
        <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6, fontFamily: 'inherit', maxHeight: 300, overflowY: 'auto' }}>
          {step.content || '（无内容）'}
        </pre>
      </div>
    )
  }

  const tableData = step.result && typeof step.result === 'object' ? resultToTableData(step.result) : null
  return (
    <div style={{ margin: '0 8px 6px 26px', padding: '6px 10px', background: 'var(--color-bg, #f5f5f7)', borderRadius: 4 }}>
      {step.args && typeof step.args === 'object' && Object.keys(step.args).length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <Text strong style={{ fontSize: 11, color: '#666' }}>输入参数</Text>
          <pre style={{ margin: '2px 0 0 0', fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', maxHeight: 120, overflowY: 'auto' }}>
            {JSON.stringify(step.args, null, 2)}
          </pre>
        </div>
      )}
      {step.result !== undefined && step.result !== null && (
        <div>
          <Text strong style={{ fontSize: 11, color: '#666' }}>执行结果</Text>
          {tableData ? (
            <div style={{ marginTop: 4 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    {tableData.columns.map(c => (
                      <th key={c.key} style={{ border: '1px solid #e5e5e5', padding: '3px 6px', textAlign: 'left', background: '#fafafa' }}>{c.title}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableData.data.slice(0, 12).map(row => (
                    <tr key={row.key}>
                      {tableData.columns.map(c => (
                        <td key={c.key} style={{ border: '1px solid #e5e5e5', padding: '3px 6px', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row[c.dataIndex]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {tableData.data.length > 12 && (
                <Text type="secondary" style={{ fontSize: 11 }}>…共 {tableData.data.length} 行</Text>
              )}
            </div>
          ) : (
            <pre style={{ margin: '2px 0 0 0', fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', maxHeight: 200, overflowY: 'auto' }}>
              {typeof step.result === 'string' ? step.result : JSON.stringify(step.result, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

export default TrajectoryPanel
