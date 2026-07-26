/**
 * 调试：看materials数组的结构
 */
const CandidatePoolBuilder = require('../src/main/services/CandidatePoolBuilder')
const ConcreteFitness = require('../src/main/services/ConcreteFitness')
const MaterialService = require('../src/main/services/MaterialService')

async function main() {
  const allMaterials = await MaterialService.getAllMaterials()
  const materialIds = {
    cementIds: [allMaterials.find(m => m.type === '水泥').id],
    sandIds: [allMaterials.filter(m => m.type === '细骨料')[0].id],
    stoneIds: [allMaterials.filter(m => m.type === '粗骨料')[0].id],
    spIds: [allMaterials.find(m => m.type === '减水剂').id],
    waterIds: [allMaterials.find(m => m.type === '其他' || m.type === '水').id],
    flyAshIds: [], slagIds: [], lithiumSlagIds: [], compositePowderIds: []
  }
  const snapshot = await CandidatePoolBuilder.buildSnapshot(materialIds)
  const fitness = new ConcreteFitness(snapshot, 45, 210, {})

  const sand = snapshot.candidatePools.sand[0]
  const stone = snapshot.candidatePools.stone[0]
  const cement = snapshot.candidatePools.cement[0]
  const sp = snapshot.candidatePools.sp[0]
  const water = snapshot.candidatePools.water[0]

  const genes = {
    wb: 0.485, sandRatio: 32, spDosage: 2.3,
    cement, sand, stone, sp, water,
    flyAshDosage: 5, slagDosage: 1, lithiumSlagDosage: 24, compositePowderDosage: 20,
    sand2Proportion: 0, stone2Proportion: 0
  }

  const r = await fitness.evaluate(genes)
  console.log('materials 数组结构:')
  console.log(JSON.stringify(r.materials, null, 2))
  console.log()
  console.log('predictions:', JSON.stringify(r.predictions, null, 2))
  console.log('realCost:', r.realCost)
  console.log('fitness:', r.fitness)
}

main().catch(e => console.error('错误:', e))
