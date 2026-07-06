const SystemParam = require('../db/models/SystemParam')
const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const { app } = require('electron')
const iconv = require('iconv-lite')

class SystemService {
  // 获取所有系统参数
  async getAllParams() {
    try {
      console.log('开始获取所有系统参数')
      const params = await SystemParam.findAll()
      console.log('从数据库获取到系统参数:', params.length, '个')
      // 转换为前端需要的格式
      const formattedParams = params.map(param => ({
        name: param.paramName,
        value: param.paramValue,
        type: param.paramType,
        description: param.description,
        status: param.status
      }))
      console.log('格式化后的系统参数:', formattedParams)
      return formattedParams
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
        logger.info('清理历史遗留的 strengthStdDev_C25 orphan 记录')
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
        // JGJ 55标准 - 强度等级与减水剂掺量关系
        {
          paramName: 'superplasticizerDosage_C20',
          paramValue: '1.6',
          paramType: 'jgj55',
          description: 'C20减水剂掺量(%)'
        },
        {
          paramName: 'superplasticizerDosage_C25',
          paramValue: '1.7',
          paramType: 'jgj55',
          description: 'C25减水剂掺量(%)'
        },
        {
          paramName: 'superplasticizerDosage_C30',
          paramValue: '1.8',
          paramType: 'jgj55',
          description: 'C30减水剂掺量(%)'
        },
        {
          paramName: 'superplasticizerDosage_C35',
          paramValue: '1.9',
          paramType: 'jgj55',
          description: 'C35减水剂掺量(%)'
        },
        {
          paramName: 'superplasticizerDosage_C40',
          paramValue: '2.0',
          paramType: 'jgj55',
          description: 'C40减水剂掺量(%)'
        },
        {
          paramName: 'superplasticizerDosage_C45',
          paramValue: '2.1',
          paramType: 'jgj55',
          description: 'C45减水剂掺量(%)'
        },
        {
          paramName: 'superplasticizerDosage_C50',
          paramValue: '2.2',
          paramType: 'jgj55',
          description: 'C50减水剂掺量(%)'
        },
        // JGJ 55标准 - 减水剂掺量与减水率关系
        {
          paramName: 'waterReducingRatePer01Dosage',
          paramValue: '2.0',
          paramType: 'jgj55',
          description: '每增加0.1%减水剂掺量，减水率增加的百分比(%)'
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
          paramName: 'agentDefaultMode',
          paramValue: 'collaborative',
          paramType: 'ai',
          description: 'Agent 默认模式：chat/collaborative/auto'
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

  // 备份数据库（内部使用，自动生成路径）
  async backupDatabase() {
    try {
      const backupDir = path.join(app.getPath('userData'), 'backups')
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true })
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const backupPath = path.join(backupDir, `backup-${timestamp}.sqlite`)
      const dbPath = path.join(app.getPath('userData'), 'concrete-mixdesign.db')

      if (fs.existsSync(dbPath)) {
        await fsp.copyFile(dbPath, backupPath)
        return backupPath
      } else {
        throw new Error('数据库文件不存在')
      }
    } catch (error) {
      console.error('备份数据库失败:', error)
      throw error
    }
  }

  // 备份数据库到指定路径（供后台任务调用）
  async backupDatabaseToFile(filePath, onProgress) {
    onProgress(30)
    const dbPath = path.join(app.getPath('userData'), 'concrete-mixdesign.db')
    if (!fs.existsSync(dbPath)) throw new Error('数据库文件不存在')
    await fsp.copyFile(dbPath, filePath)
    onProgress(100)
    return filePath
  }

  // 恢复数据库（内部使用）
  async restoreDatabase(backupPath) {
    try {
      const dbPath = path.join(app.getPath('userData'), 'concrete-mixdesign.db')

      if (fs.existsSync(backupPath)) {
        await fsp.copyFile(backupPath, dbPath)
        return true
      } else {
        throw new Error('备份文件不存在')
      }
    } catch (error) {
      console.error('恢复数据库失败:', error)
      throw error
    }
  }

  // 从指定路径恢复数据库（供后台任务调用）
  async restoreDatabaseFromFile(backupPath, onProgress) {
    console.log('[SystemService] restoreDatabaseFromFile called, backupPath:', backupPath)
    onProgress(30)
    const dbPath = path.join(app.getPath('userData'), 'concrete-mixdesign.db')
    if (!fs.existsSync(backupPath)) {
      console.error('[SystemService] Backup file does not exist:', backupPath)
      throw new Error('备份文件不存在')
    }
    console.log('[SystemService] DB path:', dbPath)

    // 使用异步复制，避免阻塞主线程
    await fsp.copyFile(backupPath, dbPath)
    console.log('[SystemService] Database file copied from', backupPath, 'to', dbPath)
    onProgress(80)

    // 注意：不要调用 closeAllConnections()，因为 sequelize.close() 会导致
    // 后续查询报 "ConnectionManager was closed" 错误。
    // sequelize 会在下次查询时自动重连到新的数据库文件。
    onProgress(100)
    console.log('[SystemService] restoreDatabaseFromFile completed')
    return true
  }

  // 导出数据（供 BackgroundTaskService 调用，支持多类型多格式）
  async exportData(taskId, { types, format, filePath }, onProgress) {
    const XLSX = require('xlsx')
    const TemplateService = require('./TemplateService')

    const data = {}
    const totalSteps = types.length

    for (let i = 0; i < types.length; i++) {
      const type = types[i]
      let records = []
      if (type === 'materials') {
        const Material = require('../db/models/Material')
        records = await Material.findAll()
        records = records.map(r => r.toJSON())
      } else if (type === 'mixdesigns') {
        const MixDesign = require('../db/models/MixDesign')
        records = await MixDesign.findAll()
        records = records.map(r => r.toJSON())
      } else if (type === 'params') {
        const SystemParam = require('../db/models/SystemParam')
        records = await SystemParam.findAll()
        records = records.map(r => ({ paramName: r.paramName, paramValue: r.paramValue, paramType: r.paramType, description: r.description }))
      }
      data[type] = records
      onProgress(Math.round(((i + 1) / totalSteps) * 90))
    }

    if (format === 'xlsx') {
      if (types.includes('materials') && types.length === 1) {
        // 单独导出原材料：使用多Sheet格式
        await TemplateService.exportMaterialsToExcel(data.materials, filePath, onProgress)
      } else if (types.includes('mixdesigns') && types.length === 1) {
        // 单独导出配合比：使用多Sheet格式
        await TemplateService.exportMixDesignsToExcel(data.mixdesigns, filePath, onProgress)
      } else {
        // 其他情况：使用简单格式（兼容旧版）
        const wb = XLSX.utils.book_new()
        for (const [type, records] of Object.entries(data)) {
          const ws = XLSX.utils.json_to_sheet(records)
          XLSX.utils.book_append_sheet(wb, ws, type)
        }
        const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' })
        await fsp.writeFile(filePath, buf)
      }
    } else if (format === 'csv') {
      const firstType = types[0]
      const records = data[firstType]
      const ws = XLSX.utils.json_to_sheet(records)
      const csv = XLSX.utils.sheet_to_csv(ws)
      await fsp.writeFile(filePath, csv, 'utf8')
    } else if (format === 'json') {
      await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8')
    }

    onProgress(100)
    return filePath
  }

  // 生成导入模板
  async generateImportTemplate(type, filePath) {
    const TemplateService = require('./TemplateService')

    if (type === 'materials') {
      return await TemplateService.generateMaterialTemplate(filePath)
    } else if (type === 'mixdesigns') {
      return await TemplateService.generateMixDesignTemplate(filePath)
    }
  }

  // 解析导入文件
  async parseImportFile(filePath) {
    const XLSX = require('xlsx')
    const ext = filePath.toLowerCase().split('.').pop()

    let workbook
    if (ext === 'xlsx' || ext === 'xls') {
      // 使用同步读取对于 xlsx 仍然是最快的方法（文件通常较小），保持现状
      workbook = XLSX.readFile(filePath)
    } else if (ext === 'csv') {
      // 使用 iconv-lite 正确处理各种编码的 CSV
      const buffer = await fsp.readFile(filePath)

      // 检测 BOM
      let bomStripped = buffer
      if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
        // UTF-8 BOM
        bomStripped = buffer.slice(3)
      }

      // 尝试 UTF-8 解码，检查是否有无效字符
      let content = iconv.decode(bomStripped, 'utf8')
      if (content.includes('\uFFFD')) {
        // 包含替换字符，说明不是有效 UTF-8，尝试 GBK
        content = iconv.decode(bomStripped, 'gbk')
      }

      workbook = XLSX.read(content, { type: 'string' })
    }

    // 检查是否是多Sheet格式（新模板）
    const sheetNames = workbook.SheetNames

    // 新模板判断：包含"说明"Sheet且包含材料类别Sheet
    const isNewMaterialTemplate = sheetNames.includes('说明') &&
      sheetNames.some(name => name.match(/^\d{2}_/))

    // 新模板判断：包含"配合比方案"Sheet
    const isNewMixDesignTemplate = sheetNames.includes('配合比方案')

    if (isNewMaterialTemplate || isNewMixDesignTemplate) {
      return await this._parseNewTemplate(workbook, sheetNames)
    }

    const sheetName = workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 })

    if (rows.length < 2) {
      throw new Error('文件数据不足，请检查格式')
    }

    const headers = rows[0]
    const dataRows = rows.slice(1).filter(row => row.some(cell => cell !== null && cell !== ''))

    const records = dataRows.map(row => {
      const obj = {}
      headers.forEach((h, i) => { obj[h] = row[i] ?? null })
      return obj
    })

    return { columns: headers, rows: records }
  }

  // 解析新格式模板（多Sheet）
  async _parseNewTemplate(workbook, sheetNames) {
    const XLSX = require('xlsx')
    const TemplateService = require('./TemplateService')

    // 判断是原材料还是配合比模板
    if (sheetNames.some(name => name.match(/^\d{2}_/))) {
      // 原材料模板
      const allData = {}

      for (const sheetName of sheetNames) {
        if (sheetName === '说明' || sheetName === '汇总') continue

        const materialType = TemplateService.getMaterialTypeFromSheetName(sheetName)
        if (!materialType) continue

        const sheet = workbook.Sheets[sheetName]
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 })

        if (rows.length < 2) continue

        const headers = rows[0]
        const dataRows = rows.slice(1).filter(row =>
          row.some(cell => cell !== null && cell !== '')
        )

        const records = dataRows.map(row => {
          const obj = { type: materialType } // 自动填充类型
          headers.forEach((h, i) => {
            // 解析 "中文 / english" 格式
            const parts = String(h).split(' / ')
            const englishKey = parts.length > 1 ? parts[1].trim() : String(h).trim()
            obj[englishKey] = row[i] ?? null
          })
          return obj
        })

        if (records.length > 0) {
          allData[sheetName] = records
        }
      }

      // 构建用于预览的扁平数据：合并所有sheet的材料数据
      const previewRows = []
      for (const [sheetName, records] of Object.entries(allData)) {
        for (const record of records) {
          previewRows.push({ ...record, _sheetName: sheetName })
        }
      }

      // 从第一个sheet获取列信息用于预览
      const firstSheetName = Object.keys(allData)[0]
      const firstRecords = allData[firstSheetName] || []
      const previewColumns = firstRecords.length > 0
        ? Object.keys(firstRecords[0]).filter(k => !k.startsWith('_'))
        : ['name', 'type', 'specification']

      return {
        type: 'materials',
        sheets: allData,
        isNewFormat: true,
        // 预览用数据
        rows: previewRows,
        columns: previewColumns,
        totalSheets: Object.keys(allData).length
      }
    }

    if (sheetNames.includes('配合比方案')) {
      // 配合比模板
      const mixDesigns = []
      const materialDetailsMap = {}
      const fineAggregateMap = {}
      const coarseAggregateMap = {}
      const tempSettingsMap = {}

      // 解析配合比方案Sheet
      const sheet2 = workbook.Sheets['配合比方案']
      const rows2 = XLSX.utils.sheet_to_json(sheet2, { header: 1 })
      if (rows2.length >= 2) {
        const headers = rows2[0]
        const dataRows = rows2.slice(1).filter(row => row.some(cell => cell !== null && cell !== ''))

        for (const row of dataRows) {
          const obj = {}
          let mixDesignName = ''
          headers.forEach((h, i) => {
            const parts = String(h).split(' / ')
            const englishKey = parts.length > 1 ? parts[1].trim() : String(h).trim()
            if (englishKey === 'name') mixDesignName = row[i]
            obj[englishKey] = row[i] ?? null
          })
          if (mixDesignName) {
            mixDesigns.push(obj)
            materialDetailsMap[mixDesignName] = []
            fineAggregateMap[mixDesignName] = []
            coarseAggregateMap[mixDesignName] = []
            tempSettingsMap[mixDesignName] = {}
          }
        }
      }

      // 解析材料用量Sheet
      if (sheetNames.includes('材料用量')) {
        const sheet3 = workbook.Sheets['材料用量']
        const rows3 = XLSX.utils.sheet_to_json(sheet3, { header: 1 })
        if (rows3.length >= 2) {
          const headers = rows3[0]
          const dataRows = rows3.slice(1).filter(row => row.some(cell => cell !== null && cell !== ''))

          for (const row of dataRows) {
            const obj = {}
            let mixDesignName = ''
            headers.forEach((h, i) => {
              const parts = String(h).split(' / ')
              const englishKey = parts.length > 1 ? parts[1].trim() : String(h).trim()
              if (englishKey === 'mixDesignName') mixDesignName = row[i]
              obj[englishKey] = row[i] ?? null
            })
            if (mixDesignName && materialDetailsMap[mixDesignName] !== undefined) {
              materialDetailsMap[mixDesignName].push(obj)
            }
          }
        }
      }

      // 解析骨料分配Sheet
      if (sheetNames.includes('骨料分配')) {
        const sheet4 = workbook.Sheets['骨料分配']
        const rows4 = XLSX.utils.sheet_to_json(sheet4, { header: 1 })
        if (rows4.length >= 2) {
          const headers = rows4[0]
          const dataRows = rows4.slice(1).filter(row => row.some(cell => cell !== null && cell !== ''))

          for (const row of dataRows) {
            const obj = {}
            let mixDesignName = ''
            let aggregateType = ''
            headers.forEach((h, i) => {
              const parts = String(h).split(' / ')
              const englishKey = parts.length > 1 ? parts[1].trim() : String(h).trim()
              if (englishKey === 'mixDesignName') mixDesignName = row[i]
              if (englishKey === 'aggregateType') aggregateType = row[i]
              obj[englishKey] = row[i] ?? null
            })
            if (mixDesignName) {
              if (aggregateType === '细骨料' && fineAggregateMap[mixDesignName] !== undefined) {
                fineAggregateMap[mixDesignName].push(obj)
              } else if (aggregateType === '粗骨料' && coarseAggregateMap[mixDesignName] !== undefined) {
                coarseAggregateMap[mixDesignName].push(obj)
              }
            }
          }
        }
      }

      // 解析计算参数Sheet
      if (sheetNames.includes('计算参数')) {
        const sheet5 = workbook.Sheets['计算参数']
        const rows5 = XLSX.utils.sheet_to_json(sheet5, { header: 1 })
        if (rows5.length >= 2) {
          const headers = rows5[0]
          const dataRows = rows5.slice(1).filter(row => row.some(cell => cell !== null && cell !== ''))

          for (const row of dataRows) {
            let mixDesignName = ''
            const settings = {}
            headers.forEach((h, i) => {
              const parts = String(h).split(' / ')
              const englishKey = parts.length > 1 ? parts[1].trim() : String(h).trim()
              if (englishKey === 'mixDesignName') mixDesignName = row[i]
              else settings[englishKey] = row[i] ?? null
            })
            if (mixDesignName && tempSettingsMap[mixDesignName] !== undefined) {
              tempSettingsMap[mixDesignName] = settings
            }
          }
        }
      }

      // 将关联数据合并到主数据
      for (const md of mixDesigns) {
        md._materialDetails = materialDetailsMap[md.name] || []
        md._fineAggregateBreakdown = fineAggregateMap[md.name] || []
        md._coarseAggregateBreakdown = coarseAggregateMap[md.name] || []
        md._tempSettings = tempSettingsMap[md.name] || {}
      }

      return {
        type: 'mixdesigns',
        sheets: {
          '配合比方案': mixDesigns
        },
        isNewFormat: true
      }
    }

    throw new Error('无法识别的模板格式')
  }

  // 执行数据导入（供 BackgroundTaskService 调用）
  async importData(taskId, { type, filePath }, onProgress) {
    const result = await this.parseImportFile(filePath)

    // 检查是否是新格式
    const isNewFormat = result.isNewFormat === true

    if (isNewFormat) {
      // 新格式：多Sheet导入
      const { type: resultType, sheets } = result

      if (resultType === 'materials') {
        // 新格式：按Sheet分别导入
        const Material = require('../db/models/Material')
        let totalCount = 0
        const sheetKeys = Object.keys(sheets).filter(k => k !== '说明' && k !== '汇总')

        for (let i = 0; i < sheetKeys.length; i++) {
          const sheetName = sheetKeys[i]
          const records = sheets[sheetName]

          for (const row of records) {
            // 跳过 name 或 type 为空的行
            if (!row.name || !row.type) {
              continue
            }

            // 构建材料记录，只包含Material模型存在的字段
            const materialData = {
              name: row.name,
              type: row.type,
              specification: row.specification || null,
              manufacturer: row.manufacturer || null,
              price: parseFloat(row.price) || null,
              density: parseFloat(row.density) || null,
              waterContent: parseFloat(row.waterContent) || null,
              status: row.status || '正常',
              notes: row.notes || null,
              // 类型特有字段
              specificSurfaceArea: parseFloat(row.specificSurfaceArea) || null,
              standardConsistency: parseFloat(row.standardConsistency) || null,
              stability: row.stability || null,
              initialSettingTime: parseInt(row.initialSettingTime) || null,
              finalSettingTime: parseInt(row.finalSettingTime) || null,
              flexuralStrength3d: parseFloat(row.flexuralStrength3d) || null,
              flexuralStrength28d: parseFloat(row.flexuralStrength28d) || null,
              compressiveStrength3d: parseFloat(row.compressiveStrength3d) || null,
              compressiveStrength28d: parseFloat(row.compressiveStrength28d) || null,
              fineness: parseFloat(row.fineness) || null,
              waterDemandRatio: parseFloat(row.waterDemandRatio) || null,
              lossOnIgnition: parseFloat(row.lossOnIgnition) || null,
              activityIndex7d: parseFloat(row.activityIndex7d) || null,
              activityIndex28d: parseFloat(row.activityIndex28d) || null,
              fluidityRatio: parseFloat(row.fluidityRatio) || null,
              mudContent: parseFloat(row.mudContent) || null,
              clayLumpContent: parseFloat(row.clayLumpContent) || null,
              mbValue: parseFloat(row.mbValue) || null,
              finenessModulus: parseFloat(row.finenessModulus) || null,
              needleFlakeContent: parseFloat(row.needleFlakeContent) || null,
              crushingValue: parseFloat(row.crushingValue) || null,
              grading: row.grading || null,
              solidContent: parseFloat(row.solidContent) || null,
              waterReducingRate: parseFloat(row.waterReducingRate) || null,
              airContent: parseFloat(row.airContent) || null,
              recommendedDosage: parseFloat(row.recommendedDosage) || null,
              waterReducingRatePer01Dosage: parseFloat(row.waterReducingRatePer01Dosage) || null,
              influenceFactor_10: parseFloat(row.influenceFactor_10) || null,
              influenceFactor_20: parseFloat(row.influenceFactor_20) || null,
              influenceFactor_30: parseFloat(row.influenceFactor_30) || null,
              influenceFactor_40: parseFloat(row.influenceFactor_40) || null,
              influenceFactor_50: parseFloat(row.influenceFactor_50) || null,
              phValue: parseFloat(row.phValue) || null,
              insolubleMatter: parseFloat(row.insolubleMatter) || null,
              solubleMatter: parseFloat(row.solubleMatter) || null,
              sieve_4_75: parseFloat(row.sieve_4_75) || null,
              sieve_2_36: parseFloat(row.sieve_2_36) || null,
              sieve_1_18: parseFloat(row.sieve_1_18) || null,
              sieve_0_60: parseFloat(row.sieve_0_60) || null,
              sieve_0_30: parseFloat(row.sieve_0_30) || null,
              sieve_0_15: parseFloat(row.sieve_0_15) || null,
              sieve_37_5: parseFloat(row.sieve_37_5) || null,
              sieve_31_5: parseFloat(row.sieve_31_5) || null,
              sieve_26_5: parseFloat(row.sieve_26_5) || null,
              sieve_19_0: parseFloat(row.sieve_19_0) || null,
              sieve_16_0: parseFloat(row.sieve_16_0) || null,
              sieve_9_50: parseFloat(row.sieve_9_50) || null,
            }

            await Material.create(materialData)
            totalCount++
          }

          onProgress(20 + Math.round(((i + 1) / sheetKeys.length) * 75))
        }

        onProgress(100)
        return { count: totalCount }
      } else if (resultType === 'mixdesigns') {
        // 配合比导入暂不支持，返回提示
        onProgress(100)
        return { count: 0, message: '配合比导入功能开发中' }
      }
    }

    // 旧格式：简单处理
    const { rows } = result
    onProgress(20)
    let count = 0

    if (type === 'materials') {
      const Material = require('../db/models/Material')
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        // 跳过 name 或 type 为空的行
        if (!row.name || !row.type) {
          continue
        }
        await Material.create({
          name: row.name,
          type: row.type,
          density: parseFloat(row.density) || 0,
          finenessModulus: parseFloat(row.finenessModulus) || 0,
          gradingModule: row.gradingModule,
          waterRequirement: parseFloat(row.waterRequirement) || 0,
          waterReducerDosage: parseFloat(row.waterReducerDosage) || 0,
          remarks: row.remarks || '',
        })
        count++
        onProgress(20 + Math.round((i / rows.length) * 75))
      }
    } else if (type === 'mixdesigns') {
      const MixDesign = require('../db/models/MixDesign')
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        await MixDesign.create({
          schemeName: row.schemeName,
          strengthGrade: row.strengthGrade,
          slump: parseFloat(row.slump) || 0,
          environmentCategory: row.environmentCategory || '1',
          cementType: row.cementType,
          cementAmount: parseFloat(row.cementAmount) || 0,
          sandAmount: parseFloat(row.sandAmount) || 0,
          stoneAmount: parseFloat(row.stoneAmount) || 0,
          waterAmount: parseFloat(row.waterAmount) || 0,
          admixtureAmount: parseFloat(row.admixtureAmount) || 0,
          costPerCubicMeter: parseFloat(row.costPerCubicMeter) || 0,
        })
        count++
        onProgress(20 + Math.round((i / rows.length) * 75))
      }
    }

    onProgress(100)
    return { count }
  }

  /**
   * 读取视觉模型配置
   * @returns {Promise<{enabled: boolean, apiUrl: string|null, apiKey: string|null, model: string|null, maxDimension: number, maxSizeMb: number}>}
   */
  async getVisionConfig() {
    const [enabled, apiUrl, apiKey, model, maxDim, maxSize] = await Promise.all([
      this.getParamByName('visionEnabled'),
      this.getParamByName('visionApiUrl'),
      this.getParamByName('visionApiKey'),
      this.getParamByName('visionModel'),
      this.getParamByName('visionMaxDimension'),
      this.getParamByName('visionMaxSizeMb')
    ])
    return {
      enabled: enabled?.value === 'true',
      apiUrl: apiUrl?.value || null,
      apiKey: apiKey?.value || null,
      model: model?.value || null,
      maxDimension: maxDim?.value ? parseInt(maxDim.value, 10) : 1024,
      maxSizeMb: maxSize?.value ? parseInt(maxSize.value, 10) : 10
    }
  }

  /**
   * 保存视觉模型配置（仅写入传入的字段，其他字段保留不变）
   * @param {object} cfg - {enabled?, apiUrl?, apiKey?, model?, maxDimension?, maxSizeMb?}
   * @returns {Promise<void>}
   */
  async saveVisionConfig(cfg = {}) {
    const writes = []
    if (cfg.enabled !== undefined) {
      writes.push(this.setParam('visionEnabled', String(!!cfg.enabled), 'ai', '视觉模型功能开关'))
    }
    if (cfg.apiUrl !== undefined) {
      writes.push(this.setParam('visionApiUrl', cfg.apiUrl || '', 'ai', '视觉模型 API 基础地址'))
    }
    if (cfg.apiKey !== undefined) {
      writes.push(this.setParam('visionApiKey', cfg.apiKey || '', 'ai', '视觉模型 API 密钥'))
    }
    if (cfg.model !== undefined) {
      writes.push(this.setParam('visionModel', cfg.model || '', 'ai', '视觉模型名称'))
    }
    if (cfg.maxDimension !== undefined) {
      writes.push(this.setParam('visionMaxDimension', String(cfg.maxDimension), 'ai', '图片最大边长(px)'))
    }
    if (cfg.maxSizeMb !== undefined) {
      writes.push(this.setParam('visionMaxSizeMb', String(cfg.maxSizeMb), 'ai', '图片最大文件大小(MB)'))
    }
    await Promise.all(writes)
  }

  /**
   * 清除视觉模型配置（重置为默认值）
   * @returns {Promise<void>}
   */
  async clearVisionConfig() {
    await this.saveVisionConfig({
      enabled: false,
      apiUrl: '',
      apiKey: '',
      model: '',
      maxDimension: 1024,
      maxSizeMb: 10
    })
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
   */
  getLlmProviderPresets() {
    return [
      {
        value: 'deepseek',
        label: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/v1',
        defaults: {
          model: 'deepseek-v4-flash',
          maxTokens: 32768,
          timeout: 120000,
          contextLimit: 800000,
          thinkingEnabled: true,
          reasoningEffort: 'high',
        },
        features: {
          // 官方文档：https://api-docs.deepseek.com/zh-cn/guides/thinking_mode
          // thinking: { type: 'enabled' | 'disabled' }
          // reasoning_effort: high | max（low/medium 映射为 high，xhigh 映射为 max）
          // 思考模式不支持 temperature/top_p/presence_penalty/frequency_penalty
          // 工具调用轮次必须回传 reasoning_content，否则 400
          supportsThinking: true,
          supportsReasoningEffort: true,
          supportsMaxTokens: true,
          supportsMaxCompletionTokens: false,
          supportsTools: true,
          supportsStreaming: true,
          supportsVision: false, // 默认模型 deepseek-v4-flash 不支持
        },
      },
      {
        value: 'agnes',
        label: 'Agnes AI',
        baseUrl: 'https://apihub.agnes-ai.com/v1',
        defaults: {
          model: 'agnes-2.0-flash',
          maxTokens: 65536, // 官方文档：最大输出 65.5K
          timeout: 120000,
          contextLimit: 512000, // 官方文档：上下文窗口 512K
          thinkingEnabled: false,
        },
        features: {
          // 官方文档：https://www.agnes-ai.com/zh-Hans/docs/agnes-20-flash
          // thinking 用 chat_template_kwargs: { enable_thinking: true }（OpenAI 兼容格式）
          // 原生支持 image_url 图片输入
          // 旧代码用 DeepSeek 格式 thinking 会导致 503
          supportsThinking: true,
          supportsReasoningEffort: false,
          supportsMaxTokens: true,
          supportsMaxCompletionTokens: false,
          supportsTools: true,
          supportsStreaming: true,
          supportsVision: true, // 原生支持 image_url
        },
      },
      {
        value: 'openai',
        label: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        defaults: {
          model: 'gpt-4o-mini',
          maxTokens: 4096,
          timeout: 120000,
          contextLimit: 128000,
          thinkingEnabled: false,
          reasoningEffort: 'medium',
        },
        features: {
          // 官方文档：https://platform.openai.com/docs/api-reference/chat/create
          // max_tokens 已弃用，推荐 max_completion_tokens
          // reasoning_effort 仅 o1/o3 系列支持（low/medium/high，o3 还支持 minimal/xhigh）
          // gpt-4o 系列原生支持 image_url
          supportsThinking: false,
          supportsReasoningEffort: true,
          supportsMaxTokens: false,
          supportsMaxCompletionTokens: true,
          supportsTools: true,
          supportsStreaming: true,
          supportsVision: true, // gpt-4o 系列原生支持
        },
      },
      {
        value: 'moonshot',
        label: 'Moonshot',
        baseUrl: 'https://api.moonshot.cn/v1',
        defaults: {
          model: 'kimi-k2.7-code',
          maxTokens: 4096,
          timeout: 120000,
          contextLimit: 128000,
          thinkingEnabled: false,
        },
        features: {
          // 官方文档：https://platform.moonshot.cn/docs/api/chat
          // max_tokens 已弃用，推荐 max_completion_tokens
          // thinking 仅 kimi-k2.7-code 支持，且仅 enabled（传 disabled 会报错）
          // Kimi K2.5 原生支持视觉输入
          supportsThinking: false, // 默认关闭避免误用（仅 kimi-k2.7-code 支持）
          supportsReasoningEffort: false,
          supportsMaxTokens: false,
          supportsMaxCompletionTokens: true,
          supportsTools: true,
          supportsStreaming: true,
          supportsVision: true, // Kimi K2.5 原生支持视觉
        },
      },
      {
        value: 'zhipu',
        label: '智谱 GLM',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        defaults: {
          model: 'glm-4-flash',
          maxTokens: 1024, // 官方文档：默认 1024，最大 4095
          timeout: 120000,
          contextLimit: 128000,
          thinkingEnabled: false,
        },
        features: {
          // 官方文档：https://open.bigmodel.cn/dev/api/normal-model/glm-4
          // 支持 max_tokens（最大 4095），不支持 max_completion_tokens
          // 不支持 thinking/reasoning_effort
          // glm-4v 是独立视觉模型，默认模型不支持
          supportsThinking: false,
          supportsReasoningEffort: false,
          supportsMaxTokens: true,
          supportsMaxCompletionTokens: false,
          supportsTools: true,
          supportsStreaming: true,
          supportsVision: false, // 默认模型不支持；glm-4v 是独立模型
        },
      },
      {
        value: 'qwen',
        label: '通义千问',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        defaults: {
          model: 'qwen-plus',
          maxTokens: 4096,
          timeout: 120000,
          contextLimit: 128000,
          thinkingEnabled: false,
        },
        features: {
          // 官方文档：https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope
          // OpenAI 兼容，支持 tools
          // 不支持 thinking/reasoning_effort
          // qwen-vl 是独立视觉模型，默认模型不支持
          supportsThinking: false,
          supportsReasoningEffort: false,
          supportsMaxTokens: true,
          supportsMaxCompletionTokens: true,
          supportsTools: true,
          supportsStreaming: true,
          supportsVision: false, // 默认模型不支持；qwen-vl 是独立模型
        },
      },
      {
        value: 'ollama',
        label: 'Ollama（本地）',
        baseUrl: 'http://localhost:11434/v1',
        defaults: {
          model: 'llama3.2',
          maxTokens: 4096,
          timeout: 120000,
          contextLimit: 128000,
          thinkingEnabled: false,
        },
        features: {
          // 官方文档：https://github.com/ollama/ollama/blob/main/docs/openai.md
          // OpenAI 兼容性为实验性，支持 max_tokens 和 tools
          // 不支持 thinking/reasoning_effort/max_completion_tokens
          // vision 取决于本地加载的模型（llava 等支持，llama3.2 不支持）
          supportsThinking: false,
          supportsReasoningEffort: false,
          supportsMaxTokens: true,
          supportsMaxCompletionTokens: false,
          supportsTools: true,
          supportsStreaming: true,
          supportsVision: false, // 取决于本地模型，默认关闭
        },
      },
      {
        value: 'minimax',
        label: 'MiniMax',
        baseUrl: 'https://api.minimax.chat/v1',
        defaults: {
          model: 'MiniMax-M3', // 官方文档：最新 M 系列
          maxTokens: 8192,
          timeout: 120000,
          contextLimit: 1000000, // 官方文档：1M 上下文
          thinkingEnabled: false, // M3 省略时默认开启 thinking，这里显式关闭
        },
        features: {
          // 官方文档：https://platform.minimaxi.com/docs/api-reference/text-openai-api
          // M3 支持 thinking: { type: 'disabled' | 'adaptive' }，省略时默认开启
          // M2.x 系列 thinking 无法关闭
          // 同时支持 max_tokens（旧版）和 max_completion_tokens（推荐）
          // M3 支持多模态：image_url（图片）和 video_url（视频）
          // 不支持 reasoning_effort（用 thinking 控制而非 reasoning_effort）
          // 旧代码发 DeepSeek 格式 thinking 会导致 503
          supportsThinking: true,
          supportsReasoningEffort: false,
          supportsMaxTokens: true,
          supportsMaxCompletionTokens: true,
          supportsTools: true,
          supportsStreaming: true,
          supportsVision: true, // M3 支持 image_url 和 video_url
        },
      },
    ]
  }
}

module.exports = new SystemService()
