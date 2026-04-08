const SystemParam = require('../db/models/SystemParam')
const { sequelize } = require('../db/database')
const fs = require('fs')
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
      const param = await SystemParam.findOne({ where: { paramName: name } })
      if (param) {
        await param.update({ paramValue: value, paramType: type, description })
        return {
          name: param.paramName,
          value: param.paramValue,
          type: param.paramType,
          description: param.description
        }
      } else {
        const newParam = await SystemParam.create({ paramName: name, paramValue: value, paramType: type, description })
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
      const defaultParams = [
        {
          paramName: 'defaultLanguage',
          paramValue: 'zh-CN',
          paramType: 'system',
          description: '默认语言'
        },
        {
          paramName: 'defaultUnit',
          paramValue: 'metric',
          paramType: 'system',
          description: '默认单位制'
        },
        {
          paramName: 'defaultStrength',
          paramValue: 'C30',
          paramType: 'mixdesign',
          description: '默认强度等级'
        },
        {
          paramName: 'defaultSlump',
          paramValue: '100',
          paramType: 'mixdesign',
          description: '默认坍落度(mm)'
        },
        {
          paramName: 'defaultEnvironment',
          paramValue: '1',
          paramType: 'mixdesign',
          description: '默认环境类别'
        },
        {
          paramName: 'defaultDensity',
          paramValue: '2400',
          paramType: 'mixdesign',
          description: '默认容重(kg/m³)'
        },
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
          paramName: 'strengthStdDev_C25',
          paramValue: '5.0',
          paramType: 'jgj55',
          description: 'C25-C45强度标准差σ(MPa)'
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
        fs.copyFileSync(dbPath, backupPath)
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
    fs.copyFileSync(dbPath, filePath)
    onProgress(100)
    return filePath
  }

  // 恢复数据库（内部使用）
  async restoreDatabase(backupPath) {
    try {
      const dbPath = path.join(app.getPath('userData'), 'concrete-mixdesign.db')

      if (fs.existsSync(backupPath)) {
        fs.copyFileSync(backupPath, dbPath)
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
    onProgress(30)
    const dbPath = path.join(app.getPath('userData'), 'concrete-mixdesign.db')
    if (!fs.existsSync(backupPath)) throw new Error('备份文件不存在')

    // 直接复制文件，不需要关闭连接
    // SQLite 允许在读取时复制，sequelize.sync() 会重新加载表信息
    fs.copyFileSync(backupPath, dbPath)
    onProgress(80)

    // 重新同步模型，刷新表缓存
    await sequelize.sync({ force: false })
    onProgress(100)
    return true
  }

  // 导出数据（供 BackgroundTaskService 调用，支持多类型多格式）
  async exportData(taskId, { types, format, filePath }, onProgress) {
    const XLSX = require('xlsx')

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
      const wb = XLSX.utils.book_new()
      for (const [type, records] of Object.entries(data)) {
        const ws = XLSX.utils.json_to_sheet(records)
        XLSX.utils.book_append_sheet(wb, ws, type)
      }
      XLSX.writeFile(wb, filePath)
    } else if (format === 'csv') {
      const firstType = types[0]
      const records = data[firstType]
      const ws = XLSX.utils.json_to_sheet(records)
      const csv = XLSX.utils.sheet_to_csv(ws)
      fs.writeFileSync(filePath, csv, 'utf8')
    } else if (format === 'json') {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
    }

    onProgress(100)
    return filePath
  }

  // 生成导入模板
  async generateImportTemplate(type, filePath) {
    const XLSX = require('xlsx')

    const materialFields = [
      { name: 'name', desc: '材料名称', example: 'PO42.5普通水泥', type: 'string' },
      { name: 'type', desc: '材料类型', example: 'cement/flyash/slag/sand/aggregate/admixture', type: 'enum' },
      { name: 'density', desc: '密度 (kg/m³)', example: '3100', type: 'number' },
      { name: 'finenessModulus', desc: '细度模数', example: '2.8', type: 'number' },
      { name: 'gradingModule', desc: '级配模数', example: 'II区', type: 'string' },
      { name: 'waterRequirement', desc: '需水量比 (%)', example: '95', type: 'number' },
      { name: 'waterReducerDosage', desc: '减水剂掺量 (%)', example: '1.8', type: 'number' },
      { name: 'remarks', desc: '备注', example: '', type: 'string' },
    ]

    const mixdesignFields = [
      { name: 'schemeName', desc: '方案名称', example: 'C30普通混凝土', type: 'string' },
      { name: 'strengthGrade', desc: '强度等级', example: 'C30', type: 'string' },
      { name: 'slump', desc: '坍落度 (mm)', example: '180', type: 'number' },
      { name: 'environmentCategory', desc: '环境类别', example: '1', type: 'string' },
      { name: 'cementType', desc: '水泥类型', example: 'PO42.5', type: 'string' },
      { name: 'cementAmount', desc: '水泥用量 (kg/m³)', example: '320', type: 'number' },
      { name: 'sandAmount', desc: '砂用量 (kg/m³)', example: '650', type: 'number' },
      { name: 'stoneAmount', desc: '石用量 (kg/m³)', example: '1100', type: 'number' },
      { name: 'waterAmount', desc: '用水量 (kg/m³)', example: '175', type: 'number' },
      { name: 'admixtureAmount', desc: '外加剂用量 (kg/m³)', example: '5.76', type: 'number' },
      { name: 'costPerCubicMeter', desc: '每方成本 (元)', example: '420', type: 'number' },
    ]

    const fields = type === 'materials' ? materialFields : mixdesignFields

    const descData = [
      ['字段名称', '中文说明', '数据类型', '示例值', '有效值范围'],
      ...fields.map(f => [f.name, f.desc, f.type, f.example, f.type === 'enum' && type === 'materials' ? 'cement/flyash/slag/sand/aggregate/admixture' : f.type === 'number' ? '数值' : '文本']),
    ]
    const headerRow = fields.map(f => f.name)
    const emptyData = [headerRow]

    const wb = XLSX.utils.book_new()
    const ws1 = XLSX.utils.aoa_to_sheet(descData)
    const ws2 = XLSX.utils.aoa_to_sheet(emptyData)
    XLSX.utils.book_append_sheet(wb, ws1, '填写说明')
    XLSX.utils.book_append_sheet(wb, ws2, '数据')
    XLSX.writeFile(wb, filePath)
    return filePath
  }

  // 解析导入文件
  async parseImportFile(filePath) {
    const XLSX = require('xlsx')
    const ext = filePath.toLowerCase().split('.').pop()

    let workbook
    if (ext === 'xlsx' || ext === 'xls') {
      workbook = XLSX.readFile(filePath)
    } else if (ext === 'csv') {
      // 使用 iconv-lite 正确处理各种编码的 CSV
      const buffer = fs.readFileSync(filePath)

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

  // 执行数据导入（供 BackgroundTaskService 调用）
  async importData(taskId, { type, filePath }, onProgress) {
    const { rows } = await this.parseImportFile(filePath)

    onProgress(20)
    let count = 0

    if (type === 'materials') {
      const Material = require('../db/models/Material')
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
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
}

module.exports = new SystemService()
