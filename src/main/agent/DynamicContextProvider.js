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
      calculate: ['materialService', 'mixDesignService'],
      optimize: ['materialService', 'mixDesignService', 'mixDesignOptimizer'],
      check: ['materialService', 'knowledgeService'],
      sales: ['materialService', 'salesQuoteCalculation', 'salesQuoteHistory'],
      all: Object.keys(allServices)
    }
  }

  /**
   * 获取技能执行上下文（SkillExecutor调用此方法）
   * @param {string} skillName - 技能名称
   * @returns {object} 执行上下文
   */
  getForSkill(skillName) {
    // 从registry获取技能定义
    const skill = this._registry ? this._registry.getSkill(skillName) : null

    if (!skill) {
      // 技能不存在时，返回全部服务（兼容性）
      return this._createFullContext(skillName)
    }

    return this.getServices(skill)
  }

  /**
   * 设置SkillRegistry引用
   * @param {object} registry - SkillRegistry实例
   */
  setRegistry(registry) {
    this._registry = registry
  }

  /**
   * 获取技能执行上下文
   * @param {object} skill - 技能定义
   * @returns {object} 执行上下文
   */
  getServices(skill) {
    // G3.2：未声明 services 字段 → 显式抛错（避免静默全量注入）
    // 显式空数组 [] 允许（系统 skill 无依赖服务时）
    if (skill.services === undefined) {
      throw new Error(`services_undeclared: skill "${skill.name}" 没声明 services 字段（应 services: [] 或 services: ['xxxService', ...]）`)
    }

    const requiredServices = skill.services
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
   * 创建完整上下文（注入全部服务）
   * @param {string} skillName - 技能名称
   * @returns {object} 执行上下文
   */
  _createFullContext(skillName) {
    const context = { ...this.allServices }
    context.logger = this._createLogger(skillName)
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
