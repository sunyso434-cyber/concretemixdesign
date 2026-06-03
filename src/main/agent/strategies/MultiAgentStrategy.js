/**
 * MultiAgentStrategy - 80 行委托版
 *
 * 未来扩展：多 agent 调度 + 上下文合并
 * 当前阶段：直接委托给 UnifiedStrategy，保持行为一致
 *
 * 决策依据：spec v2.0 批次 B2 注释——复制 UnifiedStrategy 主循环
 * 是零收益徒增维护成本。
 */

const UnifiedStrategy = require('./UnifiedStrategy')

class MultiAgentStrategy {
  constructor(deps) {
    this.unified = new UnifiedStrategy(deps)
  }

  async execute(input) {
    // 未来这里会是：拆分任务 → 调多个 sub-agent → 合并上下文
    return await this.unified.execute(input)
  }
}

module.exports = MultiAgentStrategy
