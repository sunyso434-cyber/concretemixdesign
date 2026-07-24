const MixResultValidator = require('../../services/MixResultValidator')

// 构造指定体积误差%的方案（数组格式，density 直接给出）
function makeSolutionWithVolumeError(errorPercent) {
  // 误差 = (总体积 - 1) / 1 × 100%
  // 正常方案 Σ体积≈0.985 + 0.015含气 = 1.0
  // 要造 error% 误差：Σ体积 = 1 + error%/100 - 0.015
  const targetVolume = 1 + errorPercent / 100 - 0.015
  const cementMass = targetVolume * 3100
  // predictions.density 设等于总质量，使容重复核通过（只测体积）
  return {
    materials: [
      { type: 'cement', materialId: 1, mass: cementMass, density: 3100 },
      { type: 'water', materialId: 11, mass: 0, density: 1000 },
      { type: 'sand1', materialId: 7, mass: 0, density: 2650 },
      { type: 'stone1', materialId: 9, mass: 0, density: 2700 },
      { type: 'sp', materialId: 10, mass: 0, density: 1050 }
    ],
    predictions: { density: cementMass }
  }
}

// snapshot 参数仍传但体积法不依赖它（density 在 materials 数组里）
const mockSnapshot = { byId: new Map(), candidatePools: {} }

describe('MixResultValidator.validate', () => {
  test('体积误差1.2% → pass', () => {
    const solution = makeSolutionWithVolumeError(1.2)
    const [result] = MixResultValidator.validate([solution], mockSnapshot)
    expect(result.validation.checks.volume.error).toBeCloseTo(1.2, 1)
    expect(result.validation.checks.volume.ok).toBe(true)
    expect(result.validation.status).toBe('pass')
  })

  test('体积误差3% → warning', () => {
    const solution = makeSolutionWithVolumeError(3)
    const [result] = MixResultValidator.validate([solution], mockSnapshot)
    expect(result.validation.status).toBe('warning')
  })

  test('体积误差6% → fail', () => {
    const solution = makeSolutionWithVolumeError(6)
    const [result] = MixResultValidator.validate([solution], mockSnapshot)
    expect(result.validation.status).toBe('fail')
  })

  test('容重偏差60kg → warning', () => {
    const solution = {
      materials: [
        { type: 'cement', materialId: 1, mass: 350, density: 3100 },
        { type: 'water', materialId: 11, mass: 175, density: 1000 },
        { type: 'sand1', materialId: 7, mass: 800, density: 2650 },
        { type: 'stone1', materialId: 9, mass: 1050, density: 2700 },
        { type: 'sp', materialId: 10, mass: 5, density: 1050 }
      ],
      predictions: { density: 2440 }  // Σ质量=2380, 预测=2440, 偏差=60
    }
    const [result] = MixResultValidator.validate([solution], mockSnapshot)
    expect(result.validation.checks.density.ok).toBe(false)
    expect(result.validation.status).toBe('warning')
  })
})
