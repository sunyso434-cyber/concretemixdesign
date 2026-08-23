const SystemParam = require('../db/models/SystemParam')
const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const { app } = require('electron')
const iconv = require('iconv-lite')
const llmProviderPresets = require('./llmProviderPresets')
const dataImportExport = require('./dataImportExport')
const featureConfigs = require('./featureConfigs')
const backupRestore = require('./backupRestore')

class SystemService {
  // 获取所有系统参数
  async getAllParams() {
    try {
      const params = await SystemParam.findAll()
      // 安全（2026-08-22 审查）：参数值含 deepseekApiKey/webSearchApiKey 等密钥，禁止整表打印进日志
      console.log(`[SystemService] getAllParams: ${params.length} 个参数`)
      // 转换为前端需要的格式
      return params.map(param => ({
        name: param.paramName,
        value: param.paramValue,
        type: param.paramType,
        description: param.description,
        status: param.status
      }))
    } catch (error) {
      console.error('获取系统参数失败:', error)
      throw error
    }
  }

  /**
   * 获取 Agent 全部配置（13 个 key，带类型转换和默认值）
   * - DeepSeek API (5): model / maxTokens / timeout / contextLimit / thinkingEnabled
   * - Agent 编排 (5): maxSteps / maxConsecutiveFailures / rateLimitBaseMs / rateLimitMaxMs / confirmationTimeoutMs
   * - SkillCache (3): maxAgeMs / maxSize / evictRatio
   *
   * 注意：使用 getParamByName 复用现有逻辑，任一 key 缺失时回退到默认值。
   * @returns {Promise<object>}
   */
  async getAgentConfig() {
    const strVal = async (key, def) => {
      const p = await this.getParamByName(key)
      return (p && p.value != null && p.value !== '') ? String(p.value) : def
    }
    const numVal = async (key, def) => {
      const p = await this.getParamByName(key)
      if (!p || p.value == null || p.value === '') return def
      const n = Number(p.value)
      return Number.isFinite(n) ? n : def
    }
    const boolVal = async (key, def) => {
      const p = await this.getParamByName(key)
      if (!p || p.value == null || p.value === '') return def
      const v = String(p.value).toLowerCase()
      return v === 'true' || v === '1' || v === 'yes'
    }

    return {
      // DeepSeek API (5)
      deepseekModel: await strVal('deepseekModel', 'deepseek-v4-flash'),
      deepseekMaxTokens: await numVal('deepseekMaxTokens', 32768),
      deepseekTimeout: await numVal('deepseekTimeout', 120000),
      deepseekContextLimit: await numVal('deepseekContextLimit', 800000),
      deepseekThinkingEnabled: await boolVal('deepseekThinkingEnabled', true),
      // Agent 编排 (5)
      agentMaxSteps: await numVal('agentMaxSteps', 10),
      agentMaxConsecutiveFailures: await numVal('agentMaxConsecutiveFailures', 2),
      agentRateLimitBaseMs: await numVal('agentRateLimitBaseMs', 5000),
      agentRateLimitMaxMs: await numVal('agentRateLimitMaxMs', 30000),
      agentConfirmationTimeoutMs: await numVal('agentConfirmationTimeoutMs', 120000),
      // SkillCache (3)
      skillCacheMaxAgeMs: await numVal('skillCacheMaxAgeMs', 7 * 24 * 60 * 60 * 1000),
      skillCacheMaxSize: await numVal('skillCacheMaxSize', 1000),
      skillCacheEvictRatio: await numVal('skillCacheEvictRatio', 0.1),
      // messageTrimmer (1) - E2 新增
      messageTrimmerTokenBudget: await numVal('messageTrimmerTokenBudget', 30000)
    }
  }

  // 根据名称获取系统参数
  async getParamByName(name) {
    try {
      const param = await SystemParam.findOne({ where: { paramName: name } })
      if (param) {
        return {
          name: param.paramName,
          value: param.paramValue,
          type: param.paramType,
          description: param.description
        }
      }
      return null
    } catch (error) {
      console.error('获取系统参数失败:', error)
      throw error
    }
  }

  // 设置系统参数
  async setParam(name, value, type = 'system', description = '') {
    try {
      const strValue = typeof value === 'boolean' ? String(value) : String(value ?? '')
      const param = await SystemParam.findOne({ where: { paramName: name } })
      if (param) {
        await param.update({ paramValue: strValue, paramType: type, description })
        return {
          name: param.paramName,
          value: param.paramValue,
          type: param.paramType,
          description: param.description
        }
      } else {
        const newParam = await SystemParam.create({ paramName: name, paramValue: strValue, paramType: type, description })
        return {
          name: newParam.paramName,
          value: newParam.paramValue,
          type: newParam.paramType,
          description: newParam.description
        }
      }
    } catch (error) {
      console.error('设置系统参数失败:', error)
      throw error
    }
  }

  // 删除系统参数
  async deleteParam(name) {
    try {
      const param = await SystemParam.findOne({ where: { paramName: name } })
      if (param) {
        await param.destroy()
        return true
      }
      return false
    } catch (error) {
      console.error('删除系统参数失败:', error)
      throw error
    }
  }

  // 初始化默认系统参数
  async initDefaultParams() {
    try {
      // 一次性迁移：清理历史遗留的 strengthStdDev_C25 orphan 记录（2026-07-04 规格统一为 C45）
      const orphan = await SystemParam.findOne({ where: { paramName: 'strengthStdDev_C25' } })
      if (orphan) {
        console.log('清理历史遗留的 strengthStdDev_C25 orphan 记录')
        await orphan.destroy()
      }

      const defaultParams = [
        // JGJ 55标准 - 回归系数
        {
          paramName: 'regressionAlphaA',
          paramValue: '0.53',
          paramType: 'jgj55',
          description: '回归系数α_a（碎石默认0.53）'
        },
        {
          paramName: 'regressionAlphaB',
          paramValue: '0.20',
          paramType: 'jgj55',
          description: '回归系数α_b（碎石默认0.20）'
        },
        // JGJ 55标准 - 强度标准差σ（按强度等级）
        {
          paramName: 'strengthStdDev_C20',
          paramValue: '4.0',
          paramType: 'jgj55',
          description: 'C20及以下强度标准差σ(MPa)'
        },
        {
          paramName: 'strengthStdDev_C45',
          paramValue: '5.0',
          paramType: 'jgj55',
          description: 'C25-C45强度标准差σ(MPa)'
        },
        {
          paramName: 'strengthStdDev_C50',
          paramValue: '6.0',
          paramType: 'jgj55',
          description: 'C50及以上强度标准差σ(MPa)'
        },
        // JGJ 55标准 - C30 减水剂掺量基准（决定其他等级派生；不填=跟所选减水剂材料的 recommendedDosage 走）
        {
          paramName: 'superplasticizerDosageBase_C30',
          paramValue: '',
          paramType: 'jgj55',
          description: 'C30减水剂掺量基准(%)，决定各等级派生；不填=跟所选减水剂材料推荐掺量走，材料也无值时兜底1.8%'
        },
        // JGJ 55标准 - 各等级减水剂掺量（用户单点指定；不填=从C30基准派生）
        {
          paramName: 'superplasticizerDosage_C20',
          paramValue: '',
          paramType: 'jgj55',
          description: 'C20减水剂掺量(%)，不填=从C30基准派生'
        },
        {
          paramName: 'superplasticizerDosage_C25',
          paramValue: '',
          paramType: 'jgj55',
          description: 'C25减水剂掺量(%)，不填=从C30基准派生'
        },
        {
          paramName: 'superplasticizerDosage_C30',
          paramValue: '',
          paramType: 'jgj55',
          description: 'C30减水剂使用掺量(%)，不填=等于C30基准'
        },
        {
          paramName: 'superplasticizerDosage_C35',
          paramValue: '',
          paramType: 'jgj55',
          description: 'C35减水剂掺量(%)，不填=从C30基准派生'
        },
        {
          paramName: 'superplasticizerDosage_C40',
          paramValue: '',
          paramType: 'jgj55',
          description: 'C40减水剂掺量(%)，不填=从C30基准派生'
        },
        {
          paramName: 'superplasticizerDosage_C45',
          paramValue: '',
          paramType: 'jgj55',
          description: 'C45减水剂掺量(%)，不填=从C30基准派生'
        },
        {
          paramName: 'superplasticizerDosage_C50',
          paramValue: '',
          paramType: 'jgj55',
          description: 'C50减水剂掺量(%)，不填=从C30基准派生'
        },
        {
          paramName: 'autoBackup',
          paramValue: 'true',
          paramType: 'backup',
          description: '自动备份'
        },
        {
          paramName: 'backupInterval',
          paramValue: '7',
          paramType: 'backup',
          description: '备份间隔(天)'
        },
        {
          paramName: 'deepseekApiKey',
          paramValue: '',
          paramType: 'ai',
          description: 'DeepSeek API 密钥'
        },
        {
          paramName: 'agentEnabled',
          paramValue: 'false',
          paramType: 'ai',
          description: 'AI Agent 功能开关'
        },
        {
          paramName: 'visionEnabled',
          paramValue: 'false',
          paramType: 'ai',
          description: '视觉模型功能开关'
        },
        {
          paramName: 'visionApiUrl',
          paramValue: '',
          paramType: 'ai',
          description: '视觉模型 API 基础地址（OpenAI 兼容）'
        },
        {
          paramName: 'visionApiKey',
          paramValue: '',
          paramType: 'ai',
          description: '视觉模型 API 密钥'
        },
        {
          paramName: 'visionModel',
          paramValue: '',
          paramType: 'ai',
          description: '视觉模型名称（如 qwen-vl-plus）'
        },
        {
          paramName: 'visionMaxDimension',
          paramValue: '1024',
          paramType: 'ai',
          description: '图片最大边长(px)'
        },
        {
          paramName: 'visionMaxSizeMb',
          paramValue: '10',
          paramType: 'ai',
          description: '图片最大文件大小(MB)'
        },
        {
          paramName: 'webSearchEnabled',
          paramValue: 'false',
          paramType: 'ai',
          description: '联网搜索功能开关'
        },
        {
          paramName: 'webSearchProvider',
          paramValue: 'bocha',
          paramType: 'ai',
          description: '搜索服务商（bocha/tavily/tinyfish）'
        },
        {
          paramName: 'webSearchApiKey',
          paramValue: '',
          paramType: 'ai',
          description: '搜索 API 密钥'
        },
        {
          paramName: 'webFetchProvider',
          paramValue: 'auto',
          paramType: 'ai',
          description: '网页抓取服务商（auto/jina/tinyfish），auto 时按 web_search 配置自动选择'
        },
        {
          paramName: 'webFetchEnabled',
          paramValue: 'true',
          paramType: 'ai',
          description: '网页抓取功能开关'
        },
        {
          paramName: 'academicSearchProvider',
          paramValue: 'semantic_scholar',
          paramType: 'ai',
          description: '学术搜索服务商（semantic_scholar/openalex）'
        },
        {
          paramName: 'academicSearchArxivFallback',
          paramValue: 'true',
          paramType: 'ai',
          description: '学术搜索是否启用 arxiv 预印本兜底'
        }
      ]

      for (const param of defaultParams) {
        const existing = await SystemParam.findOne({ where: { paramName: param.paramName } })
        if (!existing) {
          await SystemParam.create(param)
        }
      }

      console.log('系统参数初始化完成，共初始化', defaultParams.length, '个参数')
    } catch (error) {
      console.error('初始化系统参数失败:', error)
      throw error
    }
  }


  // ========== LLM 配置管理 ==========

  /**
   * 获取所有 LLM 配置列表
   * @returns {Promise<Array<{id:string,name:string,provider:string,baseUrl:string,apiKey:string,model:string,thinkingEnabled:boolean,maxTokens:number,timeout:number,contextLimit:number}>>}
   */
  async getLlmConfigs() {
    const raw = await this.getParamByName('llmConfigs')
    let configs = []
    if (raw && raw.value) {
      try {
        configs = JSON.parse(raw.value)
      } catch (_) { configs = [] }
    }
    if (configs.length === 0) {
      const migrated = await this._tryMigrateLegacyLlm()
      if (migrated) {
        configs = [migrated]
        await this.saveLlmConfigs(configs)
        await this.setActiveLlmConfig(migrated.id)
      }
    }
    return configs
  }

  /**
   * 保存 LLM 配置列表（整体替换）
   * @param {Array} configs
   */
  async saveLlmConfigs(configs) {
    await this.setParam('llmConfigs', JSON.stringify(configs), 'ai', 'LLM 配置列表')
  }

  /**
   * 获取当前激活的 LLM 配置
   * @returns {Promise<object|null>}
   */
  async getActiveLlmConfig() {
    const configs = await this.getLlmConfigs()
    if (configs.length === 0) return null
    const activeIdParam = await this.getParamByName('activeLlmConfigId')
    const activeId = activeIdParam && activeIdParam.value ? activeIdParam.value : null
    if (activeId) {
      const found = configs.find(c => c.id === activeId)
      if (found) return found
    }
    return configs[0]
  }

  /**
   * 设置当前激活的 LLM 配置 ID
   * @param {string} id
   */
  async setActiveLlmConfig(id) {
    await this.setParam('activeLlmConfigId', id, 'ai', '当前生效的 LLM 配置 ID')
  }

  /**
   * 从遗留 deepseekApiKey / deepseekModel 迁移单个配置
   * @returns {Promise<object|null>}
   */
  async _tryMigrateLegacyLlm() {
    const apiKey = await this.getParamByName('deepseekApiKey')
    if (!apiKey || !apiKey.value) return null
    const model = await this.getParamByName('deepseekModel')
    const maxTokens = await this.getParamByName('deepseekMaxTokens')
    const timeout = await this.getParamByName('deepseekTimeout')
    const contextLimit = await this.getParamByName('deepseekContextLimit')
    const thinkingEnabled = await this.getParamByName('deepseekThinkingEnabled')
    return {
      id: 'deepseek-default',
      name: 'DeepSeek 默认',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: apiKey.value,
      model: model && model.value ? model.value : 'deepseek-v4-flash',
      thinkingEnabled: thinkingEnabled && thinkingEnabled.value === 'true',
      maxTokens: maxTokens && maxTokens.value ? parseInt(maxTokens.value, 10) : 32768,
      timeout: timeout && timeout.value ? parseInt(timeout.value, 10) : 120000,
      contextLimit: contextLimit && contextLimit.value ? parseInt(contextLimit.value, 10) : 800000,
    }
  }

  /**
   * 返回内置 provider 预设，供前端下拉选择
   * （2026-08-23 拆分：静态数据迁至 llmProviderPresets.js，此处一行委托保持调用路径不变）
   */
  getLlmProviderPresets() {
    return llmProviderPresets.getLlmProviderPresets()
  }
}

// 2026-08-23 拆分：导入导出迁至 dataImportExport.js（行为不变），原型挂载保持调用路径不变
Object.assign(SystemService.prototype, dataImportExport)

// 2026-08-23 拆分：功能配置迁至 featureConfigs.js、备份恢复迁至 backupRestore.js（行为不变）
Object.assign(SystemService.prototype, featureConfigs)
Object.assign(SystemService.prototype, backupRestore)

module.exports = new SystemService()