/**
 * 动态上下文提供者
 * 根据技能声明的services字段动态注入服务，节省token
 */

class DynamicContextProvider {
  constructor(allServices) {
    this.allServices = allServices

    // 服务类别定义
    this.serviceCategories = {
      query: ['materialService', 'knowledgeService'],
      calculate: ['materialService', 'mixDesignService', 'basicMixDesignService'],
      optimize: ['materialService', 'mixDesignService', 'mixDesignOptimizer'],
      check: ['materialService', 'complianceService', 'knowledgeService'],
      sales: ['materialService', 'salesQuoteCalculation', 'salesQuoteHistory'],
      all: Object.keys(allServices)
    }
  }

  /**
   * 获取技能执行上下文
   * @param {object} skill - 技能定义
   * @returns {object} 执行上下文
   */
  getServices(skill) {
    const requiredServices = skill.services || []
    const context = {}

    // 解析服务列表（支持类别和具体服务名）
    const resolvedServices = this._resolveServices(requiredServices)

    // 注入需要的服务
    for (const serviceName of resolvedServices) {
      if (this.allServices[serviceName]) {
        context[serviceName] = this.allServices[serviceName]
      }
    }

    // 添加基础服务
    context.logger = this._createLogger(skill.name)
    context.findMaterialById = this._createFindMaterialById()
    context.findMaterialsByIds = this._createFindMaterialsByIds()

    return context
  }

  /**
   * 解析服务列表，支持类别名
   */
  _resolveServices(services) {
    const resolved = new Set()

    for (const service of services) {
      if (this.serviceCategories[service]) {
        // 是类别名，展开为具体服务
        for (const s of this.serviceCategories[service]) {
          resolved.add(s)
        }
      } else {
        // 是具体服务名
        resolved.add(service)
      }
    }

    return Array.from(resolved)
  }

  /**
   * 创建带前缀的logger
   */
  _createLogger(skillName) {
    return {
      info: (...args) => console.log(`[${skillName}]`, ...args),
      warn: (...args) => console.warn(`[${skillName}]`, ...args),
      error: (...args) => console.error(`[${skillName}]`, ...args),
      debug: (...args) => console.debug(`[${skillName}]`, ...args)
    }
  }

  /**
   * 创建findMaterialById工具方法
   */
  _createFindMaterialById() {
    return async (id) => {
      if (this.allServices.materialService) {
        return await this.allServices.materialService.getMaterialById(id)
      }
      console.warn('[DynamicContextProvider] materialService未注入，无法调用findMaterialById')
      return null
    }
  }

  /**
   * 创建findMaterialsByIds工具方法
   */
  _createFindMaterialsByIds() {
    return async (ids) => {
      if (this.allServices.materialService) {
        return await this.allServices.materialService.getMaterialsByIds(ids)
      }
      console.warn('[DynamicContextProvider] materialService未注入，无法调用findMaterialsByIds')
      return []
    }
  }
}

module.exports = DynamicContextProvider
