/**
 * 学习服务
 * 监听工具执行事件，自动学习用户偏好和修正记录
 */

const eventBus = require('../agent/EventBus')
const agentMemoryService = require('./AgentMemoryService')

class LearningService {
  constructor() {
    this._initialized = false
  }

  /**
   * 初始化学习服务，注册事件监听
   */
  init() {
    if (this._initialized) return

    // 监听工具执行完成事件
    eventBus.on('tool:executed', this._onToolExecuted.bind(this))

    // 监听用户修正事件
    eventBus.on('user:correction', this._onUserCorrection.bind(this))

    this._initialized = true
    console.log('[LearningService] 学习服务已初始化')
  }

  /**
   * 工具执行完成后的学习逻辑
   * @param {object} data - 事件数据
   */
  async _onToolExecuted({ skillName, args, result }) {
    try {
      // 只在执行成功时学习
      if (!result || result.success === false) return

      // 1. 学习材料偏好（仅配合比计算时）
      if (skillName === 'calculate_mix_design') {
        await this._learnMaterialPreferences(args)
        await this._learnSlumpPreference(args.slump)
      }

      // 2. 学习砂率偏好
      if (args.sandRatio) {
        await this._learnSandRatioPreference(args.sandRatio)
      }

      console.log(`[LearningService] 学习完成: ${skillName}`)
    } catch (error) {
      // 学习失败不影响主流程，只记录日志
      console.error('[LearningService] 学习失败:', error.message)
    }
  }

  /**
   * 学习材料偏好
   * @param {object} args - 工具参数
   */
  async _learnMaterialPreferences(args) {
    const { cementId, flyAshId, slagId, superplasticizerId } = args

    // 记录最近使用的材料（覆盖式，保留最后一次）
    if (cementId) {
      await agentMemoryService.savePreference('lastUsedCementId', cementId, 'material')
    }
    if (flyAshId) {
      await agentMemoryService.savePreference('lastUsedFlyAshId', flyAshId, 'material')
    }
    if (slagId) {
      await agentMemoryService.savePreference('lastUsedSlagId', slagId, 'material')
    }
    if (superplasticizerId) {
      await agentMemoryService.savePreference('lastUsedSuperplasticizerId', superplasticizerId, 'material')
    }
  }

  /**
   * 学习砂率偏好
   * @param {number} sandRatio - 砂率值
   */
  async _learnSandRatioPreference(sandRatio) {
    if (!sandRatio || sandRatio <= 0) return

    // 记录最近使用的砂率
    await agentMemoryService.savePreference('lastSandRatio', sandRatio, 'parameter')

    // 计算平均砂率（用于推荐）
    let history = await agentMemoryService.getPreference('sandRatioHistory')
    if (!Array.isArray(history)) history = []

    history.push(sandRatio)
    // 只保留最近10次
    if (history.length > 10) history.shift()

    await agentMemoryService.savePreference('sandRatioHistory', history, 'parameter')

    // 计算平均值
    const avg = history.reduce((a, b) => a + b, 0) / history.length
    await agentMemoryService.savePreference('avgSandRatio', Math.round(avg * 10) / 10, 'parameter')
  }

  /**
   * 学习坍落度偏好
   * @param {number} slump - 坍落度值
   */
  async _learnSlumpPreference(slump) {
    if (!slump || slump <= 0) return

    await agentMemoryService.savePreference('lastSlump', slump, 'parameter')
  }

  /**
   * 用户修正记录处理
   * @param {object} correction - 修正数据
   */
  async _onUserCorrection(correction) {
    try {
      await agentMemoryService.saveCorrection({
        context: correction.context || {},
        originalSuggestion: correction.original,
        userCorrection: correction.corrected,
        toolName: correction.toolName
      })

      console.log('[LearningService] 修正记录已保存:', correction.toolName)
    } catch (error) {
      console.error('[LearningService] 保存修正记录失败:', error.message)
    }
  }

  /**
   * 手动触发修正记录（供外部调用）
   * @param {object} correction - 修正数据
   */
  async saveCorrection(correction) {
    await this._onUserCorrection(correction)
  }
}

// 导出单例
module.exports = new LearningService()
