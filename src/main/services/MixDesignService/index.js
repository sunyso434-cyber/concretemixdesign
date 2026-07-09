// MixDesignService 统一导出
// 将所有子模块的方法合并到主服务对象，保持原有API不变

const MixDesignService_Strength = require('./MixDesignService_Strength')
const MixDesignService_WaterRatio = require('./MixDesignService_WaterRatio')
const MixDesignService_Aggregate = require('./MixDesignService_Aggregate')
const MixDesignService_Validation = require('./MixDesignService_Validation')
const MixDesignService_Database = require('./MixDesignService_Database')

class MixDesignService {
  // === Strength 模块 ===
  async getStrengthStdDev(strength, tempSettings) {
    return MixDesignService_Strength.getStrengthStdDev(strength, tempSettings)
  }

  calculateTargetStrength(strength, stdDev) {
    return MixDesignService_Strength.calculateTargetStrength(strength, stdDev)
  }

  computeTargetFinenessModulus(strength, tempSettings) {
    return MixDesignService_Strength.computeTargetFinenessModulus(strength, tempSettings)
  }

  // === WaterRatio 模块 ===
  async getRegressionCoefficients(tempSettings) {
    return MixDesignService_WaterRatio.getRegressionCoefficients(tempSettings)
  }

  calculateWaterRatio(targetStrength, cementStrength, alphaA, alphaB) {
    return MixDesignService_WaterRatio.calculateWaterRatio(targetStrength, cementStrength, alphaA, alphaB)
  }

  async getSuperplasticizerDosageByStrength(strength, superplasticizerMaterial, tempSettings) {
    return MixDesignService_WaterRatio.getSuperplasticizerDosageByStrength(strength, superplasticizerMaterial, tempSettings)
  }

  async getWaterReducingRatePer01Dosage(superplasticizerMaterial, tempSettings) {
    return MixDesignService_WaterRatio.getWaterReducingRatePer01Dosage(superplasticizerMaterial, tempSettings)
  }

  async getC30Baseline(superplasticizerMaterial, tempSettings) {
    return MixDesignService_WaterRatio.getC30Baseline(superplasticizerMaterial, tempSettings)
  }

  calculateInfluenceFactor(admixtureDosage, admixtureMaterial) {
    return MixDesignService_WaterRatio.calculateInfluenceFactor(admixtureDosage, admixtureMaterial)
  }

  // === Aggregate 模块 ===
  toNumber(value) {
    return MixDesignService_Aggregate.toNumber(value)
  }

  extractMaxAggregateSize(specification) {
    return MixDesignService_Aggregate.extractMaxAggregateSize(specification)
  }

  calculateOptimalFineAggregateRatio(fineAggregates, targetFinenessModulus) {
    return MixDesignService_Aggregate.calculateOptimalFineAggregateRatio(fineAggregates, targetFinenessModulus)
  }

  calculateCombinedFineAggregateParams(fineAggregates, targetFinenessModulus) {
    return MixDesignService_Aggregate.calculateCombinedFineAggregateParams(fineAggregates, targetFinenessModulus)
  }

  // ponytail: thin pass-through — Aggregate submodule 已实现原方法（Task 1）
  preselectCoarseAggregate(stoneCandidates) {
    return MixDesignService_Aggregate.preselectCoarseAggregate(stoneCandidates)
  }

  targetFinenessModulusByStrength(strength) {
    return MixDesignService_Aggregate.targetFinenessModulusByStrength(strength)
  }

  // ponytail: thin pass-through — Aggregate submodule 已实现原方法（Task 2）
  computeCementitiousCost(params) {
    return MixDesignService_Aggregate.computeCementitiousCost(params)
  }

  getBaseWaterAmount(maxSize, slump, aggregateType) {
    return MixDesignService_Aggregate.getBaseWaterAmount(maxSize, slump, aggregateType)
  }

  async calculateSuperplasticizerDosage(strength, fineAggregateMaterial, superplasticizerMaterial, tempSettings) {
    return MixDesignService_Aggregate.calculateSuperplasticizerDosage(strength, fineAggregateMaterial, superplasticizerMaterial, tempSettings)
  }

  async calculateWaterReducingRate(baseReducingRate, baseDosage, strengthDosage, superplasticizerMaterial, tempSettings) {
    return MixDesignService_Aggregate.calculateWaterReducingRate(baseReducingRate, baseDosage, strengthDosage, superplasticizerMaterial, tempSettings)
  }

  calculateByAbsoluteVolume(materialAmounts, materials, airContent) {
    return MixDesignService_Aggregate.calculateByAbsoluteVolume(materialAmounts, materials, airContent)
  }

  calculateByMassMethod(materialAmounts, targetDensity) {
    return MixDesignService_Aggregate.calculateByMassMethod(materialAmounts, targetDensity)
  }

  calculateWaterAmount(slump) {
    return MixDesignService_Aggregate.calculateWaterAmount(slump)
  }

  calculateSandRatio(waterRatio, slump, finenessModulus, aggregateType) {
    return MixDesignService_Aggregate.calculateSandRatio(waterRatio, slump, finenessModulus, aggregateType)
  }

  // === Validation 模块 ===
  async validateMixDesign(mixDesign) {
    return MixDesignService_Validation.validateMixDesign(mixDesign)
  }

  async optimizeMixDesign(mixDesign) {
    return MixDesignService_Validation.optimizeMixDesign(mixDesign)
  }

  // === Database 模块 ===
  async getAllMixDesigns(options) {
    return MixDesignService_Database.getAllMixDesigns(options)
  }

  async getMixDesignById(id) {
    return MixDesignService_Database.getMixDesignById(id)
  }

  async createMixDesign(data) {
    return MixDesignService_Database.createMixDesign(data)
  }

  async updateMixDesign(id, data) {
    return MixDesignService_Database.updateMixDesign(id, data)
  }

  async deleteMixDesign(id) {
    return MixDesignService_Database.deleteMixDesign(id)
  }

  async cleanupDrafts(maxAgeDays) {
    return MixDesignService_Database.cleanupDrafts(maxAgeDays)
  }

  async calculateMixDesign(params) {
    return MixDesignService_Database.calculateMixDesign(params)
  }

  async calculateSeriesMixDesign(baseParams, strengthRange) {
    return MixDesignService_Database.calculateSeriesMixDesign(baseParams, strengthRange)
  }
}

module.exports = new MixDesignService()