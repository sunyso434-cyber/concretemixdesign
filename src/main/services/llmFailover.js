/**
 * llmFailover - LLM 故障自动切换
 *
 * 当 LLM 模型调用失败时（无论什么错误），自动按配置列表顺序尝试下一个可用模型。
 *
 * v11.7.9 改进：支持激活配置优先。传入 activeId 时，激活的配置排到列表第一位，
 *   确保用户选择的模型优先被尝试，失败后才 fallback 到其他配置。
 *
 * v11.7.5 改进：移除不可重试错误检查，所有错误都触发切换。
 *   原因：每个 config 有独立的 apiKey/baseUrl/provider，400/401 只说明当前 config 有问题，
 *   不代表下一个 config 也会失败。全部失败时才抛出最后一个错误。
 *
 * v8.4.2 新增
 */

// 保留常量定义（向后兼容），实际不再按错误码区分重试策略
const RETRYABLE_CODES = new Set([
  'E-LLM-429', // 限流
  'E-LLM-500', // 服务端错误
  'E-LLM-503', // 服务不可用
  'E-NET-408', // 网络超时
  'E-NET-500', // 网络不通
])

/**
 * @deprecated v11.7.5 起不再使用；所有错误都触发 failover
 */
function isRetryableError(_error) {
  return true
}

/**
 * 将激活的配置排到列表第一位，确保用户选择的模型优先尝试。
 * @param {Array<object>} configs - 全量配置
 * @param {string|null} activeId - 激活配置的 ID
 * @returns {Array<object>} 重排序后的配置列表
 */
function prioritizeActiveFirst(configs, activeId) {
  if (!activeId || !Array.isArray(configs) || configs.length <= 1) return configs
  const idx = configs.findIndex(c => c && c.id === activeId)
  if (idx <= 0) return configs  // 已在第一位或未找到
  const reordered = [...configs]
  const [active] = reordered.splice(idx, 1)
  reordered.unshift(active)
  return reordered
}

/**
 * 遍历 LLM 配置列表，逐个尝试直到成功。
 * v11.7.9：激活配置自动排到第一位，确保用户选择的模型优先使用。
 * v11.7.5：任何错误都继续尝试下一个 config，全部失败才抛最后一个错误。
 *
 * @param {Array<object>} configs - SystemService.getLlmConfigs() 返回的全量配置
 * @param {Function} tryWithConfig - async (config) => result，用单个配置执行操作
 * @param {Function} onSwitch - (fromName, toName, reason) => void，成功切换时回调（仅第一次切换触发）
 * @param {object} [opts] - 可选参数
 * @param {string} [opts.activeId] - 激活配置的 ID，传入后优先尝试该配置
 * @param {Function} [opts.shouldStopOnError] - (error) => boolean，返回 true 时直接抛出该错误，不再切换配置
 * @param {Function} [opts.onAttemptFail] - ({ failedName, nextName, error }) => void，
 *   某配置失败且即将尝试下一个之前触发（切换前告知用户原因）
 * @returns {Promise<{result: *, usedConfig: object}>}
 * @throws 全部失败时抛出最后一个错误
 */
async function tryWithFailover(configs, tryWithConfig, onSwitch, opts = {}) {
  if (!Array.isArray(configs) || configs.length === 0) {
    throw new Error('没有可用的 LLM 配置')
  }

  // v11.7.9：激活配置优先 — 把用户选择的模型排到第一位
  const ordered = prioritizeActiveFirst(configs, opts.activeId)

  // 过滤掉没配 API Key 的（没 key 不可能成功）
  const valid = ordered.filter(c => c && c.apiKey)
  if (valid.length === 0) {
    throw new Error('所有 LLM 配置均未填写 API Key')
  }

  const firstName = valid[0].name || valid[0].provider || '未知'
  let lastError = null
  let hasSwitched = false

  for (let i = 0; i < valid.length; i++) {
    const config = valid[i]
    try {
      const result = await tryWithConfig(config)
      // 成功了：如果不是第一个，触发切换通知
      if (i > 0 && !hasSwitched && typeof onSwitch === 'function') {
        hasSwitched = true
        onSwitch(firstName, config.name || config.provider || '未知', lastError ? (lastError.code || 'unknown') : 'unknown')
      }
      return { result, usedConfig: config }
    } catch (error) {
      // v3.1 要点 2：中断错误直接穿透，不切换配置
      if (opts.shouldStopOnError?.(error)) {
        throw error
      }
      lastError = error
      // v11.7.5：所有错误都继续尝试下一个 config
      console.warn(`[llmFailover] config[${i}] "${config.name || config.provider}" 失败: ${error.message || error.code || 'unknown'}，尝试下一个...`)
      // v0.9.x：切换前先把失败原因抛给调用方（老板要求：切换前告知用户原因）。
      // 仅在还有下一个候选时触发；回调自身异常不阻断 failover 主流程
      const nextConfig = valid[i + 1]
      if (nextConfig && typeof opts.onAttemptFail === 'function') {
        try {
          opts.onAttemptFail({
            failedName: config.name || config.provider || '未知',
            nextName: nextConfig.name || nextConfig.provider || '未知',
            error,
          })
        } catch (_) {}
      }
    }
  }

  // 全部失败
  throw lastError || new Error('所有 LLM 模型均不可用')
}

module.exports = { tryWithFailover, isRetryableError, RETRYABLE_CODES, prioritizeActiveFirst }
