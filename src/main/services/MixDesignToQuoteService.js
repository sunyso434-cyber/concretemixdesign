/**
 * 配合比设计 → 销售报价 数据流服务
 * 确保配合比设计和报价使用完全相同的数据，避免数据不一致问题
 */

const BasicMixDesignService = require('./BasicMixDesignService')
const SalesQuoteCalculationService = require('./SalesQuoteCalculationService')

class MixDesignToQuoteService {
  /**
   * 从配合比设计结果生成基础配合比数据
   * @param {Object} mixDesignResult - 配合比设计结果
   * @returns {Object} 格式化后的基础配合比数据
   */
  static formatMixDesignToBasicMix(mixDesignResult) {
    if (!mixDesignResult) {
      throw new Error('配合比设计结果为空')
    }

    const { strengthGrade, concreteType, slump, materials } = mixDesignResult

    if (!strengthGrade) {
      throw new Error('配合比缺少强度等级')
    }

    if (!Array.isArray(materials) || materials.length === 0) {
      throw new Error('配合比没有材料用量数据')
    }

    // 格式化材料数据，确保字段完整
    const formattedMaterials = materials.map(mat => ({
      materialId: mat.materialId || mat.id,
      materialType: mat.materialType || mat.type,
      materialName: mat.materialName || mat.name,
      usage: Number(mat.usage || mat.amount || 0),
      price: mat.price != null ? Number(mat.price) : null
    }))

    // 验证材料用量
    for (const mat of formattedMaterials) {
      if (!mat.materialName) {
        throw new Error('存在未命名的材料')
      }
      if (!Number.isFinite(mat.usage) || mat.usage <= 0) {
        throw new Error(`${mat.materialName} 的用量无效`)
      }
    }

    return {
      name: `${strengthGrade} ${concreteType || '普通'}混凝土`,
      strengthGrade,
      concreteType: concreteType || '普通',
      slump: slump || 180,
      materials: formattedMaterials,
      isDefault: false,
      source: '配合比设计',
      enabled: true
    }
  }

  /**
   * 保存配合比设计为基础配合比
   * @param {Object} mixDesignResult - 配合比设计结果
   * @returns {Object} 保存的基础配合比记录
   */
  static async saveMixDesignAsBasicMix(mixDesignResult) {
    const basicMixData = this.formatMixDesignToBasicMix(mixDesignResult)
    const saved = await BasicMixDesignService.createBasicMixDesign(basicMixData)
    return saved
  }

  /**
   * 验证报价数据与配合比数据的一致性
   * @param {Object} basicMix - 基础配合比
   * @param {Object} quoteResult - 报价结果
   * @returns {Object} 验证结果
   */
  static validateQuoteConsistency(basicMix, quoteResult) {
    const errors = []
    const warnings = []
    const details = []

    if (!basicMix || !quoteResult) {
      return { valid: false, errors: ['缺少配合比或报价数据'], warnings, details }
    }

    // 检查材料数量
    const mixMaterialCount = basicMix.materials.length
    const quoteMaterialCount = quoteResult.materialDetails.length

    if (mixMaterialCount !== quoteMaterialCount) {
      errors.push(`材料数量不匹配：配合比有 ${mixMaterialCount} 种，报价有 ${quoteMaterialCount} 种`)
    }

    // 检查每种材料
    for (const mixMat of basicMix.materials) {
      const quoteMat = quoteResult.materialDetails.find(
        q => q.materialName === mixMat.materialName || q.materialId === mixMat.materialId
      )

      if (!quoteMat) {
        errors.push(`报价中缺少材料：${mixMat.materialName}`)
        details.push({
          material: mixMat.materialName,
          status: 'missing',
          mixUsage: mixMat.usage,
          quoteUsage: null
        })
        continue
      }

      // 检查用量一致性
      const mixUsage = Number(mixMat.usage)
      const quoteUsage = Number(quoteMat.usage)

      if (Math.abs(mixUsage - quoteUsage) > 0.01) {
        errors.push(`${mixMat.materialName} 用量不一致：配合比 ${mixUsage} kg，报价 ${quoteUsage} kg`)
        details.push({
          material: mixMat.materialName,
          status: 'mismatch',
          mixUsage,
          quoteUsage,
          difference: Math.abs(mixUsage - quoteUsage)
        })
      } else {
        details.push({
          material: mixMat.materialName,
          status: 'match',
          mixUsage,
          quoteUsage
        })
      }
    }

    // 检查是否有报价中多余的材料
    for (const quoteMat of quoteResult.materialDetails) {
      const exists = basicMix.materials.some(
        m => m.materialName === quoteMat.materialName || m.materialId === quoteMat.materialId
      )
      if (!exists) {
        errors.push(`报价中包含配合比没有的材料：${quoteMat.materialName}`)
        details.push({
          material: quoteMat.materialName,
          status: 'extra',
          mixUsage: null,
          quoteUsage: quoteMat.usage
        })
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      details,
      summary: {
        totalMaterials: mixMaterialCount,
        matched: details.filter(d => d.status === 'match').length,
        mismatched: details.filter(d => d.status === 'mismatch').length,
        missing: details.filter(d => d.status === 'missing').length,
        extra: details.filter(d => d.status === 'extra').length
      }
    }
  }

  /**
   * 生成数据一致性对比报告（用于调试和展示）
   * @param {Object} basicMix - 基础配合比
   * @param {Object} quoteResult - 报价结果
   * @returns {string} 格式化的对比报告
   */
  static generateConsistencyReport(basicMix, quoteResult) {
    const validation = this.validateQuoteConsistency(basicMix, quoteResult)

    let report = '## 数据一致性检查报告\n\n'

    if (validation.valid) {
      report += '✅ **检查通过** — 配合比与报价数据完全一致\n\n'
    } else {
      report += '❌ **检查失败** — 发现数据不一致\n\n'
      report += '### 错误详情\n'
      validation.errors.forEach(err => {
        report += `- ${err}\n`
      })
      report += '\n'
    }

    report += '### 材料对比\n'
    report += '| 材料名称 | 配合比用量 | 报价用量 | 状态 |\n'
    report += '|:---------|:----------:|:--------:|:----:|\n'

    validation.details.forEach(detail => {
      const statusIcon = {
        match: '✅',
        mismatch: '❌',
        missing: '⚠️ 缺失',
        extra: '⚠️ 多余'
      }[detail.status]

      report += `| ${detail.material} | ${detail.mixUsage ?? '-'} | ${detail.quoteUsage ?? '-'} | ${statusIcon} |\n`
    })

    return report
  }

  /**
   * 从配合比设计直接生成报价（确保数据一致）
   * @param {Object} mixDesignResult - 配合比设计结果
   * @param {Object} pricing - 定价参数
   * @returns {Object} 包含配合比和报价的完整结果
   */
  static async generateQuoteFromMixDesign(mixDesignResult, pricing) {
    // 第一步：格式化配合比数据
    const basicMixData = this.formatMixDesignToBasicMix(mixDesignResult)

    // 第二步：保存为基础配合比
    const savedBasicMix = await BasicMixDesignService.createBasicMixDesign(basicMixData)

    // 第三步：使用完全相同的数据计算报价
    const quoteResult = SalesQuoteCalculationService.calculate({
      basicMix: basicMixData,
      pricing
    })

    // 第四步：验证数据一致性
    const validation = this.validateQuoteConsistency(basicMixData, quoteResult)

    if (!validation.valid) {
      console.error('[MixDesignToQuoteService] 数据一致性验证失败:', validation.errors)
      throw new Error(`报价数据不一致：${validation.errors.join('; ')}`)
    }

    return {
      basicMix: savedBasicMix.toJSON(),
      quote: quoteResult,
      validation
    }
  }
}

module.exports = MixDesignToQuoteService
