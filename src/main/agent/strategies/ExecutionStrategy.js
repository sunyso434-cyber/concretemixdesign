/**
 * ExecutionStrategy 接口
 *
 * 策略模式：Orchestrator 不关心具体执行方式，委托给 strategy.execute()
 *
 * 契约：
 * - execute(input) 返回 Promise<Output>
 * - input: { sessionId, message, mode, webContents }
 * - output: { success: boolean, content?: string, toolCalls?: [], error?: string }
 * - 抛出错误：表示 FATA L 级别失败（连续失败超阈值）
 * - 正常返回 { success: false, error }：表示 ERROR 级别（单次失败可重试）
 *
 * 实现：
 * - UnifiedStrategy：单 agent + SkillCache + 主循环（迁自 UnifiedOrchestrator）
 * - MultiAgentStrategy：80 行委托版（未来扩展多 agent 调度）
 */

/**
 * @typedef {Object} ExecuteInput
 * @property {string} sessionId
 * @property {string} message
 * @property {string} [mode='auto']
 * @property {Object} [webContents]
 */

/**
 * @typedef {Object} ExecuteOutput
 * @property {boolean} success
 * @property {string} [content]
 * @property {Array} [toolCalls]
 * @property {string} [error]
 */

/**
 * @interface ExecutionStrategy
 */
class ExecutionStrategy {
  /**
   * @param {ExecuteInput} input
   * @returns {Promise<ExecuteOutput>}
   */
  async execute(input) {
    throw new Error('Not implemented: subclass must override execute()')
  }
}

module.exports = ExecutionStrategy
