const { groupedKFold, shuffleIndices } = require('../folds')

// 构造行主序 Float32Array：rows 是 [[f1,f2,...], ...]
function makeData(rows) {
  const nFeatures = rows[0].length
  const X = new Float32Array(rows.length * nFeatures)
  const y = new Float32Array(rows.length)
  rows.forEach((r, i) => {
    r.forEach((v, j) => { X[i * nFeatures + j] = v })
    y[i] = 0
  })
  return { X, y, nFeatures }
}

// 行内容签名（用于断言"同内容行不同折"）
function rowSignature(X, y, i, nFeatures) {
  return Array.from(X.subarray(i * nFeatures, (i + 1) * nFeatures)).join(',') + '|' + y[i]
}

describe('groupedKFold（分组 K 折 / 2026-08-23 泄漏修复）', () => {
  test('过采样副本（×5）整组进同一折——训练折与测试折无同源样本', () => {
    // 10 条原始数据 × 5 份过采样（模拟 TrainingDataBuilder Plan B）
    const originals = []
    for (let i = 0; i < 10; i++) {
      originals.push([i * 1.1, i * 2.2 + 0.5, i * 3.3, i + 0.7])
    }
    const rows = []
    for (let copy = 0; copy < 5; copy++) rows.push(...originals.map(r => [...r]))
    const { X, y, nFeatures } = makeData(rows)

    const folds = groupedKFold(X, y, nFeatures, 5, 42)
    expect(folds).toHaveLength(5)

    let covered = 0
    for (const { train, test } of folds) {
      covered += test.length
      const trainSigs = new Set(train.map(i => rowSignature(X, y, i, nFeatures)))
      for (const i of test) {
        // 核心断言：测试折中任何一行的内容，不允许出现在训练折
        expect(trainSigs.has(rowSignature(X, y, i, nFeatures))).toBe(false)
      }
      // train/test 互斥且并集为全集
      const testSet = new Set(test)
      expect(train.some(i => testSet.has(i))).toBe(false)
    }
    expect(covered).toBe(50)
  })

  test('无重复行的数据：train/test 互斥、并集覆盖全部行', () => {
    const rows = []
    for (let i = 0; i < 30; i++) rows.push([i * 0.37, i * 1.13, i * 2.71, i * 0.53])
    const { X, y, nFeatures } = makeData(rows)

    const folds = groupedKFold(X, y, nFeatures, 5, 42)
    const seen = new Set()
    for (const { train, test } of folds) {
      expect(train.length + test.length).toBe(30)
      for (const i of test) seen.add(i)
    }
    expect(seen.size).toBe(30)
  })

  test('同 seed 结果可复现，不同折大小按组粒度大致均衡', () => {
    const rows = []
    for (let i = 0; i < 40; i++) rows.push([i * 0.11, i * 0.23, i * 0.37, i * 0.51])
    const { X, y, nFeatures } = makeData(rows)

    const a = groupedKFold(X, y, nFeatures, 5, 42)
    const b = groupedKFold(X, y, nFeatures, 5, 42)
    expect(a).toEqual(b)

    // 40 个独立组（无重复行）分 5 折，每折应接近 8 行
    for (const { test } of a) {
      expect(Math.abs(test.length - 8)).toBeLessThanOrEqual(1)
    }
  })

  test('shuffleIndices 输出为 0..n-1 的排列且可复现', () => {
    const a = shuffleIndices(20, 7)
    expect([...a].sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, i) => i))
    expect(shuffleIndices(20, 7)).toEqual(a)
  })
})
