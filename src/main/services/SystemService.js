const SystemParam = require('../db/models/SystemParam')
const { sequelize } = require('../db/database')
const fs = require('fs')
const path = require('path')
const { app } = require('electron')

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

  // 备份数据库
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

  // 恢复数据库
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

  // 导入数据
  async importData(filePath) {
    try {
      // 简化实现，实际应根据文件格式进行解析
      console.log('导入数据:', filePath)
      // 这里可以实现具体的导入逻辑
      return true
    } catch (error) {
      console.error('导入数据失败:', error)
      throw error
    }
  }

  // 导出数据
  async exportData(filePath) {
    try {
      // 简化实现，实际应根据需要导出的数据进行处理
      console.log('导出数据:', filePath)
      // 这里可以实现具体的导出逻辑
      return true
    } catch (error) {
      console.error('导出数据失败:', error)
      throw error
    }
  }
}

module.exports = new SystemService()
