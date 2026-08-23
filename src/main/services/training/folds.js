// K 折切分（分组版）：训练数据评估专用纯函数模块
// 背景（2026-08-23 审查修复）：TrainingDataBuilder 会把用户数据 ×5 过采样（Plan B 加权），
// 原实现先复制再 kFold —— 同一原始样本的 5 份副本会散进不同折，训练折与测试折出现同源
// 样本（数据泄漏），TPE 调参与 CV 报告的 rmse/r² 系统性虚高。
// 修复：内容完全相同的行归为同组、整组进同一折。无重复行的数据上行为等价于普通 kFold。

// 可复现伪随机（mulberry32）+ Fisher-Yates
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffleIndices(n, seed = 42) {
  const rng = mulberry32(seed)
  const idx = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }
  return idx
}

// float 位级精确哈希（避免 |0 截断让 33.1/33.2 撞组）
const _fbuf = new ArrayBuffer(4)
const _f32 = new Float32Array(_fbuf)
const _u32 = new Uint32Array(_fbuf)
function hashFloat(h, v) {
  _f32[0] = v
  return Math.imul(h ^ _u32[0], 16777619)
}

/**
 * 分组 K 折：X（行主序 Float32Array）+ y 中内容完全相同的行归为同组，整组进同一折。
 * 返回 [{ train: number[], test: number[] }]，契约与原 kFold 相同。
 * 组轮转分配保证各折大小均衡（按组粒度）。
 */
function groupedKFold(X, y, nFeatures, k = 5, seed = 42) {
  const n = y.length
  const groups = new Map() // 行内容哈希 -> [rowIdx...]
  for (let i = 0; i < n; i++) {
    let h = 0x811c9dc5
    for (let j = 0; j < nFeatures; j++) h = hashFloat(h, X[i * nFeatures + j])
    h = hashFloat(h, y[i])
    const key = h >>> 0
    let rows = groups.get(key)
    if (!rows) { rows = []; groups.set(key, rows) }
    rows.push(i)
  }

  // 组随机排序（可复现）后轮转分配到 k 折
  const groupArr = Array.from(groups.values())
  const order = shuffleIndices(groupArr.length, seed)
  const foldRows = Array.from({ length: k }, () => [])
  order.forEach((g, pos) => {
    foldRows[pos % k].push(...groupArr[g])
  })

  // test = 本折全部行；train = 其余行（Set 避免 O(n²) includes）
  return foldRows.map((rows, f) => {
    const testSet = new Set(rows)
    const train = []
    for (let i = 0; i < n; i++) if (!testSet.has(i)) train.push(i)
    return { train, test: rows }
  })
}

module.exports = { groupedKFold, shuffleIndices }
