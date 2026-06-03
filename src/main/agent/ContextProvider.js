/**
 * Skill 上下文提供者
 * 为 Skill 执行提供共享的服务和资源
 */

const MaterialService = require('../services/MaterialService')
const MixDesignService = require('../services/MixDesignService/index')
const BasicMixDesignService = require('../services/BasicMixDesignService')
const MixDesignOptimizer = require('../services/MixDesignOptimizer')
const StandardComplianceService = require('../services/StandardComplianceService')
const StandardKnowledgeService = require('../services/StandardKnowledgeService')
const SalesQuoteCalculationService = require('../services/SalesQuoteCalculationService')
const SalesQuoteHistoryService = require('../services/SalesQuoteHistoryService')
const XGBoostPredictionService = require('../services/XGBoostPredictionService')
const MixDesignToQuoteService = require('../services/MixDesignToQuoteService')

class ContextProvider {
  constructor() {
    this._services = {
      materialService: MaterialService,
      mixDesignService: MixDesignService,
      basicMixDesignService: BasicMixDesignService,
      mixDesignOptimizer: MixDesignOptimizer,
      complianceService: StandardComplianceService,
      knowledgeService: StandardKnowledgeService,
      salesQuoteCalculation: SalesQuoteCalculationService,
      salesQuoteHistory: SalesQuoteHistoryService,
      xgboostPrediction: XGBoostPredictionService,
      mixDesignToQuote: MixDesignToQuoteService
    }
  }

  /**
   * 获取 Skill 执行上下文
   * @param {string} skillName - Skill 名称
   * @returns {object} 上下文对象
   */
  getForSkill(skillName) {
    return {
      // 服务
      ...this._services,

      // 日志器
      logger: this._createLogger(skillName),

      // 工具方法
      findMaterialById: (id) => this._findMaterialById(id),
      findMaterialsByIds: (ids) => this._findMaterialsByIds(ids)
    }
  }

  /**
   * 创建带 Skill 名称的日志器
   * @param {string} skillName - Skill 名称
   * @returns {object} 日志器
   */
  _createLogger(skillName) {
    return {
      info: (...args) => console.log(`[Skill:${skillName}]`, ...args),
      warn: (...args) => console.warn(`[Skill:${skillName}]`, ...args),
      error: (...args) => console.error(`[Skill:${skillName}]`, ...args),
      debug: (...args) => {
        if (process.env.DEBUG) {
          console.log(`[Skill:${skillName}:DEBUG]`, ...args)
        }
      }
    }
  }

  /**
   * 根据 ID 查找材料
   * O(1) 直接查询，避免 O(n) 全表扫描
   * @param {number} id - 材料 ID
   * @returns {object|null} 材料对象
   */
  async _findMaterialById(id) {
    try {
      return await this._services.materialService.getMaterialById(id)
    } catch (error) {
      console.error('[ContextProvider] 查找材料失败:', error)
      return null
    }
  }

  /**
   * 根据 ID 列表查找材料
   * @param {number[]} ids - 材料 ID 列表
   * @returns {object[]} 材料对象列表
   */
  async _findMaterialsByIds(ids) {
    try {
      const materials = await MaterialService.getAllMaterials()
      return ids.map(id => materials.find(m => m.id === id) || null).filter(Boolean)
    } catch (error) {
      console.error('[ContextProvider] 查找材料失败:', error)
      return []
    }
  }
}

module.exports = ContextProvider
