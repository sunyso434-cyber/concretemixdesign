/**
 * 参数诊断服务
 * 智能解析的第一步：上传数据后自动反算材料参数，对比新旧参数差异
 *
 * 诊断策略：
 * - 同材料组合仅 1 组 → 单组偏差溯源
 * - 同材料组合 ≥ 2 组 → 多组联立反算（坐标下降法 + 线性最小二乘）
 */

const Grouping = require('./ParameterDiagnosisService_Grouping')
const Solver = require('./ParameterDiagnosisService_Solver')
const Merge = require('./ParameterDiagnosisService_Merge')

class ParameterDiagnosisService {
  /**
   * 执行参数诊断
   * @param {Array} mixDesigns - 配合比数据列表，每条需含 testResults 和 materialMapping
   * @returns {Object} 诊断结果（符合设计文档 5.2 输出 JSON 结构）
   */
  async diagnose(mixDesigns) {
    if (!mixDesigns || !Array.isArray(mixDesigns) || mixDesigns.length === 0) {
      throw new Error('配合比数据不能为空')
    }

    // Step A: 材料组合分组
    const groups = this._groupByMaterialCombination(mixDesigns)

    // Step B: 跨组合共享参数分析
    const sharedParams = this._analyzeSharedParams(groups)

    // Step C: 逐组诊断
    const allResults = []
    for (const group of groups) {
      if (group.mixDesigns.length === 1) {
        allResults.push(this._singleGroupDiagnosis(group))
      } else {
        allResults.push(this._multiGroupDiagnosis(group, sharedParams))
      }
    }

    // Step D: 合并结果并评估置信度
    const merged = this._mergeResults(allResults, sharedParams)

    // Step E: 计算残差
    const residuals = this._calculateResiduals(mixDesigns, merged)

    // Step F: 格式化输出
    return this._formatOutput(merged, residuals, mixDesigns)
  }
}

// 合并所有模块的方法
Object.assign(ParameterDiagnosisService.prototype, Grouping, Solver, Merge)

module.exports = new ParameterDiagnosisService()
