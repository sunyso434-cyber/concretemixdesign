/**
 * 将配合比方案转换为 BasicMixDesign.materials 数组格式。
 *
 * materialId 解析顺序（任一命中即返回）：
 *   1. selected[key].id（来自 scheme.materialDetails，是首选）
 *   2. 按 (type + name) 在 allMaterials 中精确匹配（兜底 1）
 *   3. 按 name 在 allMaterials 中模糊匹配（兜底 2）
 *   4. 按 type 找唯一的那条（兜底 3：解决 materialDetails 缺失、fallbackName 与实际名不一致的场景）
 *   5. 返回 null（最末兜底；报价侧会按名+类型手工指定价格）
 *
 * 关键 bug 场景（2026-06-08 老板报告）：配合比设计草稿保存时漏掉 materialDetails 字段，
 * 导致 buildMaterialsArray 拿不到 id，把所有 materialId 存成 null，
 * 报价时按 null 查价格触发"水泥没有单价，无法准确报价"。
 * 本函数通过兜底 3 保证即便上游漏写 materialDetails，报价时也能查到价格。
 *
 * @param {object} params
 * @param {object} params.materials - 用量对象 {cement, sand, stone, flyAsh, slag, lithiumSlag, compositePowder, superplasticizer, water}
 * @param {object} params.selected - 方案中的 materialDetails，结构 {cement: {id, name, price, ...}, ...}
 * @param {Array}  [params.fineBreakdown] - 细骨料分配 [{id, name, amount}, ...]
 * @param {Array}  [params.coarseBreakdown] - 粗骨料分配 [{id, name, amount}, ...]
 * @param {Array}  [params.allMaterials] - 全部材料库 [{id, name, type, ...}, ...]，用于兜底反查
 * @returns {Array<{materialId, materialType, materialName, usage}>}
 */
function buildBasicMixMaterials({ materials, selected, fineBreakdown, coarseBreakdown, allMaterials }) {
  const mats = materials || {}
  const sel = selected || {}
  const fineBd = Array.isArray(fineBreakdown) ? fineBreakdown : []
  const coarseBd = Array.isArray(coarseBreakdown) ? coarseBreakdown : []
  const lib = Array.isArray(allMaterials) ? allMaterials : []

  // 反查工具：
  //   1. 按 (type + name) 精确匹配
  //   2. 按 name 模糊匹配
  //   3. 按 type 找唯一的那条
  const findIdByTypeAndName = (type, name) => {
    if (name) {
      const exact = lib.find(m => m.type === type && m.name === name)
      if (exact) return exact.id
      const fuzzy = lib.find(m => m.name === name)
      if (fuzzy) return fuzzy.id
    }
    const sameType = lib.filter(m => m.type === type)
    if (sameType.length === 1) return sameType[0].id
    return null
  }

  // 取材料 id：优先 sel[key].id，其次按 type + name 反查
  const resolveId = (key, type, fallbackName) => {
    const s = sel[key]
    if (s && typeof s === 'object' && s.id != null) return s.id
    const name = (s && typeof s === 'object' && s.name) || (typeof s === 'string' ? s : null) || fallbackName
    return findIdByTypeAndName(type, name)
  }

  // 取材料 name：优先 sel[key].name，否则按 type 在材料库中找
  const resolveName = (key, type, fallback) => {
    const s = sel[key]
    if (s && typeof s === 'object' && s.name) return s.name
    if (typeof s === 'string') return s
    const sameType = lib.filter(m => m.type === type)
    if (sameType.length === 1) return sameType[0].name
    if (sameType.length > 1) return sameType[0].name // 调用方应通过 selected 避免歧义
    return fallback
  }

  const arr = []
  const pushIf = (cond, type, name, usage, id) => {
    if (cond) arr.push({ materialId: id != null ? id : null, materialType: type, materialName: name, usage })
  }

  pushIf(mats.cement != null, '水泥', resolveName('cement', '水泥', '水泥'), mats.cement, resolveId('cement', '水泥', '水泥'))
  pushIf(mats.flyAsh != null && mats.flyAsh > 0, '粉煤灰', resolveName('flyAsh', '粉煤灰', '粉煤灰'), mats.flyAsh, resolveId('flyAsh', '粉煤灰', '粉煤灰'))
  pushIf(mats.slag != null && mats.slag > 0, '矿渣粉', resolveName('slag', '矿渣粉', '矿渣粉'), mats.slag, resolveId('slag', '矿渣粉', '矿渣粉'))
  pushIf(mats.lithiumSlag != null && mats.lithiumSlag > 0, '锂渣', resolveName('lithiumSlag', '锂渣', '锂渣'), mats.lithiumSlag, resolveId('lithiumSlag', '锂渣', '锂渣'))
  pushIf(mats.compositePowder != null && mats.compositePowder > 0, '复合粉', resolveName('compositePowder', '复合粉', '复合粉'), mats.compositePowder, resolveId('compositePowder', '复合粉', '复合粉'))
  pushIf(mats.superplasticizer != null && mats.superplasticizer > 0, '减水剂', resolveName('superplasticizer', '减水剂', '减水剂'), mats.superplasticizer, resolveId('superplasticizer', '减水剂', '减水剂'))

  // 细骨料：优先 breakdown，否则用 sand
  if (fineBd.length > 0) {
    fineBd.forEach((f, i) => {
      const id = f.id != null ? f.id : findIdByTypeAndName('细骨料', f.name)
      arr.push({ materialId: id != null ? id : null, materialType: '细骨料', materialName: f.name || `细骨料${i + 1}`, usage: f.amount })
    })
  } else if (mats.sand != null && mats.sand > 0) {
    arr.push({ materialId: resolveId('sand', '细骨料', '细骨料'), materialType: '细骨料', materialName: resolveName('sand', '细骨料', '细骨料'), usage: mats.sand })
  }

  // 粗骨料：优先 breakdown，否则用 stone
  if (coarseBd.length > 0) {
    coarseBd.forEach((c, i) => {
      const id = c.id != null ? c.id : findIdByTypeAndName('粗骨料', c.name)
      arr.push({ materialId: id != null ? id : null, materialType: '粗骨料', materialName: c.name || `粗骨料${i + 1}`, usage: c.amount })
    })
  } else if (mats.stone != null && mats.stone > 0) {
    arr.push({ materialId: resolveId('stone', '粗骨料', '粗骨料'), materialType: '粗骨料', materialName: resolveName('stone', '粗骨料', '粗骨料'), usage: mats.stone })
  }

  // 水
  if (mats.water != null && mats.water > 0) {
    const waterMat = lib.find(m => m.type === '水' || (m.type === '其他' && m.name === '水') || m.name === '水')
    arr.push({ materialId: waterMat?.id || null, materialType: '水', materialName: '水', usage: mats.water })
  }
  return arr
}

module.exports = { buildBasicMixMaterials }
