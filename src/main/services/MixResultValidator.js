/**
 * 配合比结果复核器 MixResultValidator
 *
 * 对 GA 优化输出的多组配合比方案进行结果复核（事后校验），包含：
 *   1. 体积法复核 — Σ(质量/密度) + 含气量 ≈ 1 m³
 *   2. 容重复核 — Σ质量 ≈ ML 预测容重
 *
 * 复核结果为 pass / warning / fail 三级标签，附着在每条方案上，
 * **不影响 GA 寻优过程**，仅用于人工决策参考。
 */

const AIR_CONTENT = 0.015 // 1.5% 默认含气量

const VOLUME_THRESHOLD = {
  PASS: 0.02, // ≤2% → pass
  WARNING: 0.05 // ≤5% → warning, >5% → fail
}

const DENSITY_THRESHOLD = {
  PASS: 50, // ≤50 kg/m³ → pass
  WARNING: 100 // ≤100 → warning, >100 → fail
}

/**
 * 体积法复核
 * @param {Array<{mass:number, density:number}>} materials
 * @returns {{ok:boolean, error:number, detail:string, status:string}}
 */
function checkVolume(materials) {
  let solidVolume = 0
  for (const m of materials) {
    if (m.mass > 0 && m.density > 0) {
      solidVolume += m.mass / m.density
    }
  }
  const totalVolume = solidVolume + AIR_CONTENT
  const error = Math.abs(totalVolume - 1)

  // 判定等级
  let ok, status
  if (error <= VOLUME_THRESHOLD.PASS) {
    ok = true
    status = 'pass'
  } else if (error <= VOLUME_THRESHOLD.WARNING) {
    ok = false
    status = 'warning'
  } else {
    ok = false
    status = 'fail'
  }

  return {
    ok,
    error: +(error * 100).toFixed(2), // 转为百分比
    detail: `体积误差${(error * 100).toFixed(1)}%`,
    status
  }
}

/**
 * 容重复核
 * @param {Array<{mass:number}>} materials
 * @param {number} predictedDensity ML 预测容重 (kg/m³)
 * @returns {{ok:boolean, error:number, detail:string, status:string}}
 */
function checkDensity(materials, predictedDensity) {
  const totalMass = materials.reduce((sum, m) => sum + (m.mass > 0 ? m.mass : 0), 0)
  const error = Math.abs(totalMass - predictedDensity)

  let ok, status
  if (error <= DENSITY_THRESHOLD.PASS) {
    ok = true
    status = 'pass'
  } else if (error <= DENSITY_THRESHOLD.WARNING) {
    ok = false
    status = 'warning'
  } else {
    ok = false
    status = 'fail'
  }

  return {
    ok,
    error,
    detail: `容重偏差${error}kg/m³`,
    status
  }
}

/**
 * 汇总状态：任一 fail → fail，任一 warning → warning，全 pass → pass
 * @param {Array<string>} statuses
 * @returns {'pass'|'warning'|'fail'}
 */
function aggregateStatus(volumeStatus, densityStatus) {
  const all = [volumeStatus, densityStatus]
  if (all.includes('fail')) return 'fail'
  if (all.includes('warning')) return 'warning'
  return 'pass'
}

module.exports = {
  /**
   * 批量复核配合比方案
   * @param {Array} solutions - 方案数组
   * @param {Object} [_snapshot] - 材料快照（保留参数，体积法不依赖）
   * @returns {Array} 附加 validation 字段的方案数组
   */
  validate(solutions, _snapshot) {
    return solutions.map((solution) => {
      const materials = solution.materials || []
      const predictedDensity = (solution.predictions && solution.predictions.density) || 0

      const volumeResult = checkVolume(materials)
      const densityResult = checkDensity(materials, predictedDensity)

      return {
        ...solution,
        validation: {
          status: aggregateStatus(volumeResult.status, densityResult.status),
          checks: {
            volume: {
              ok: volumeResult.ok,
              error: volumeResult.error,
              detail: volumeResult.detail
            },
            density: {
              ok: densityResult.ok,
              error: densityResult.error,
              detail: densityResult.detail
            }
          }
        }
      }
    })
  }
}
