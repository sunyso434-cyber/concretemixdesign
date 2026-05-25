export const WATER_MATERIAL_ID = '__sales_quote_water__'

export const WATER_MATERIAL_OPTION = {
  value: WATER_MATERIAL_ID,
  label: '\u6c34'
}

export function buildMaterialOptions(materials = []) {
  return [
    WATER_MATERIAL_OPTION,
    ...materials.map(material => ({
      value: material.id,
      label: `${material.type} - ${material.name}`
    }))
  ]
}

export function buildManualMixMaterials(rows = []) {
  return rows
    .filter(row => Number(row.usage) > 0 && (row.materialId === WATER_MATERIAL_ID || row.materialId))
    .map(row => {
      if (row.materialId === WATER_MATERIAL_ID) {
        return {
          materialId: null,
          materialType: '\u6c34',
          materialName: '\u6c34',
          usage: Number(row.usage)
        }
      }
      return {
        materialId: row.materialId,
        materialType: row.materialType,
        materialName: row.materialName,
        usage: Number(row.usage)
      }
    })
}
