// 减水剂可能匹配的类型
const WATER_REDUCER_TYPES = ['外加剂', '减水剂']

// Get all materials from main process via IPC
export const getAllMaterials = async () => {
  const result = await window.electron.ipcRenderer.invoke('getAllMaterials')
  return result?.success ? (result.data || []) : []
}

// Filter materials by type
export const getMaterialsByType = (materials, type) => {
  if (!materials || !Array.isArray(materials)) return []

  if (type === '外加剂') {
    // 减水剂需要匹配'外加剂'或'减水剂'类型
    return materials.filter(m => WATER_REDUCER_TYPES.includes(m.type))
  }
  return materials.filter(m => m.type === type)
}

// Get batches for a material via IPC
export const getBatches = async (materialId) => {
  const result = await window.electron.ipcRenderer.invoke('material:getBatches', { materialId })
  return Array.isArray(result) ? result : []
}

// Get current (in-use) batch for a material via IPC
export const getCurrentBatch = async (materialId) => {
  const result = await window.electron.ipcRenderer.invoke('material:getCurrentBatch', { materialId })
  return result || null
}

// Match material by name (fuzzy match)
export const matchMaterialByName = (materials, type, name) => {
  if (!name || !type) return null

  const candidates = getMaterialsByType(materials, type)
  if (candidates.length === 0) return null

  // 精确匹配
  let matched = candidates.find(m => m.name === name)
  if (matched) return matched

  // 模糊匹配：材料名称包含传入的名称
  matched = candidates.find(m => m.name.includes(name))
  if (matched) return matched

  // 模糊匹配：传入的名称包含材料名称
  matched = candidates.find(m => name.includes(m.name))
  if (matched) return matched

  return null
}
