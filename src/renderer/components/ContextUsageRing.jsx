// 上下文占用圆环（从 SmartDesignChat.jsx 拆分，行为不变）
// 展示当前会话 token 占用 + 点击展开细分面板（含压缩入口）。
import React from 'react'
import { Popover, Tooltip, Tag } from 'antd'
import ContextBreakdownPanel from './ContextBreakdownPanel'
import ContextIndicator from './ContextIndicator'
import { estimateTokens, DEFAULT_CONTEXT_LIMIT } from '../utils/contextStats'

export default function ContextUsageRing({ state, chatState }) {
  return (
    <>
      {/* v11.7.7: 显示当前路由到的 LLM 模型，用户可感知路由状态 */}
      {state.agent.currentModel && (
        <Tooltip title={`当前模型：${state.agent.currentProvider} · ${state.agent.currentModel}`}>
          <Tag color="blue" style={{ marginRight: 0, cursor: 'default' }}>
            {state.agent.currentModel}
          </Tag>
        </Tooltip>
      )}
      {(() => {
        // v0.9.x 圆环修复（随对话实时上涨）：
        // 1. 有真实值时——真实基数（model_info 的 usage.prompt_tokens，含全部历史+工具结果）
        //    + 真实值落点之后新增消息的估算（assistant 回复/用户新消息，见 contextRealTokensAt 快照），
        //    任务间隙发消息圆环立即上涨；下一轮任务后由真实值重新校准；
        // 2. 无真实值时（新会话未跑任务/网关不回传）——全量估算兜底（system+tools 用最近一次
        //    context_stats 的构成，消息用前端字符估算）；
        // 3. 清空/压缩会重置 contextRealTokens 与快照（见 agentStoreCore）。
        // 原 max(估算, 真实) 的缺陷：真实值含工具结果很大，纯文本估算永远追不上，
        // 圆环被冻结在旧真实值，任务间隙新增消息完全不反映。
        const sysToolsTokens = (state.contextBreakdown?.system || 0) + (state.contextBreakdown?.tools || 0)
        const real = typeof state.contextRealTokens === 'number' ? state.contextRealTokens : 0
        let total
        if (real > 0) {
          const after = state.messages.slice(state.contextRealTokensAt || 0)
          total = real + estimateTokens(after)
        } else {
          total = sysToolsTokens + estimateTokens(state.messages)
        }
        const limit = state.contextLimit || DEFAULT_CONTEXT_LIMIT
        const percent = Math.min(1, Math.max(0, total / limit))
        // 细分面板数据：优先主进程 context_stats；无数据时用前端消息估算兜底（system/tools 不可知）
        const fallbackBreakdown = state.contextBreakdown || (
          state.messages && state.messages.length > 0
            ? { system: 0, tools: 0, messages: estimateTokens(state.messages) }
            : null
        )
        return (
          <Popover
            placement="bottomRight"
            trigger="click"
            title="上下文占用"
            content={
              <ContextBreakdownPanel
                breakdown={fallbackBreakdown}
                realTokens={state.contextRealTokens}
                onCompress={chatState.handleCompressContext}
                loading={chatState.isCompressing}
              />
            }
          >
            <span>
              <ContextIndicator
                percent={percent}
                loading={chatState.isCompressing}
                usedTokens={total}
                limitTokens={limit}
              />
            </span>
          </Popover>
        )
      })()}
    </>
  )
}
