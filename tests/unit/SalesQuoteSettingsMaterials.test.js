const assert = require('assert')
const path = require('path')
const { pathToFileURL } = require('url')

async function run(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    console.error(error)
    process.exitCode = 1
  }
}

async function main() {
  const {
    WATER_MATERIAL_OPTION,
    buildMaterialOptions,
    buildManualMixMaterials
  } = await import(pathToFileURL(path.join(__dirname, '..', '..', 'src', 'renderer', 'utils', 'salesQuoteMaterials.mjs')).href)

  await run('manual mix material options include water without material library rows', () => {
    const options = buildMaterialOptions([])
    assert.deepStrictEqual(options[0], WATER_MATERIAL_OPTION)
  })

  await run('manual mix material payload keeps water without materialId', () => {
    const rows = [
      { materialId: WATER_MATERIAL_OPTION.value, materialType: '', materialName: '', usage: 175 },
      { materialId: 1, materialType: 'cement', materialName: 'P.O 42.5', usage: 320 },
      { materialId: null, materialType: '', materialName: '', usage: 100 },
      { materialId: 2, materialType: 'sand', materialName: 'Sand', usage: 0 }
    ]

    assert.deepStrictEqual(buildManualMixMaterials(rows), [
      { materialId: null, materialType: '\u6c34', materialName: '\u6c34', usage: 175 },
      { materialId: 1, materialType: 'cement', materialName: 'P.O 42.5', usage: 320 }
    ])
  })
}

main()
