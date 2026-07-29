/**
 * DataValidator.js
 * 物理范围检查器：验证混凝土配合比参数是否在合理物理范围内
 *
 * 范围表参考 spec C.3 物理范围表，覆盖所有可训练特征和实测目标。
 * 检查规则：
 *   - 缺失值（null/undefined/-1/NaN）跳过检查
 *   - 单条记录检查：返回 { valid, warnings }
 *   - 批量检查：返回 { totalValid, totalWarnings, details }
 */

// ============ 物理范围表 ============
const RANGE_TABLE = {
  // --- 配合比参数 ---
  water_binder_ratio:       { min: 0.2,  max: 0.7,  label: '水胶比' },
  cement_amount:            { min: 200,  max: 600,  label: '水泥用量(kg/m³)' },
  water_amount:             { min: 120,  max: 220,  label: '用水量(kg/m³)' },
  sand_ratio:               { min: 30,   max: 45,   label: '砂率(%)' },
  superplasticizer_dosage:  { min: 0,    max: 5,    label: '减水剂掺量(%)' },
  slump:                    { min: 50,   max: 250,  label: '设计坍落度(mm)' },
  feature_slump:            { min: 50,   max: 250,  label: '特征坍落度(mm)' },

  // --- 矿物掺合料 ---
  fly_ash_dosage:           { min: 0,    max: 40,   label: '粉煤灰掺量(%)' },
  slag_dosage:              { min: 0,    max: 50,   label: '矿渣粉掺量(%)' },
  lithium_slag_dosage:      { min: 0,    max: 30,   label: '锂渣掺量(%)' },
  composite_powder_dosage:  { min: 0,    max: 40,   label: '复合粉掺量(%)' },

  // --- 实测值 ---
  trialTestedStrength:      { min: 10,   max: 100,  label: '28d强度(MPa)' },
  trialTestedDensity:       { min: 2200, max: 2600, label: '容重(kg/m³)' },
  trialTestedSlump:         { min: 30,   max: 260,  label: '实测坍落度(mm)' },
  trialTestedDosage:        { min: 0,    max: 5,    label: '实测减水剂掺量(%)' },

  // --- 训练目标（CSV 导出列）---
  target_strength_28d:              { min: 10,   max: 100,  label: '28d强度目标(MPa)' },
  target_density:                   { min: 2200, max: 2600, label: '容重目标(kg/m³)' },
  target_superplasticizer_dosage:   { min: 0,    max: 5,    label: '减水剂掺量目标(%)' },
  target_slump:                     { min: 30,   max: 260,  label: '坍落度目标(mm)' }
}

class DataValidator {
  /**
   * 验证单条记录的物理范围
   * @param {Object} data - 数据记录（key=字段名, value=数值）
   * @returns {{ valid: boolean, warnings: string[], checkedCount: number }}
   */
  validate(data) {
    const warnings = []
    let checkedCount = 0

    for (const [field, range] of Object.entries(RANGE_TABLE)) {
      const value = data[field]

      // 跳过缺失值、占位值
      if (value === undefined || value === null || value === '' ||
          value === -1 || (typeof value === 'number' && !Number.isFinite(value))) {
        continue
      }

      checkedCount++

      if (value < range.min || value > range.max) {
        warnings.push(
          `${range.label} ${value} 超出物理范围 [${range.min}, ${range.max}]`
        )
      }
    }

    return {
      valid: warnings.length === 0,
      warnings,
      checkedCount
    }
  }

  /**
   * 批量验证多条记录
   * @param {Object[]} records - 数据记录数组
   * @returns {{ validCount: number, warningCount: number, totalChecked: number, details: Array<{row: number, warnings: string[]}> }}
   */
  validateBatch(records) {
    let warningCount = 0
    let totalChecked = 0
    const details = []

    for (let i = 0; i < records.length; i++) {
      const result = this.validate(records[i])
      totalChecked += result.checkedCount
      if (result.warnings.length > 0) {
        warningCount += result.warnings.length
        details.push({
          row: i,
          warnings: result.warnings
        })
      }
    }

    return {
      validCount: records.length - details.length,
      warningCount,
      totalChecked,
      details
    }
  }
}

module.exports = new DataValidator()
