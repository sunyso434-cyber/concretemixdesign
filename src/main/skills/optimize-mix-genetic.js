/**
 * 遗传算法配合比优化 Skill
 *
 * 基于遗传算法（GA）对混凝土配合比进行全局优化。
 * 串联 CandidatePoolBuilder → ConcreteFitness → GeneticOptimizer → MixResultValidator
 *
 * 工作流程：
 *   1. 构建材料候选池快照
 *   2. 根据候选池动态构造基因编码规范（geneSpec）
 *   3. 运行 GA 搜索最优配合比（连续基因：SBX 交叉+高斯变异；离散基因：均匀交叉+整数变异）
 *   4. 支持全淘汰快速失败 + 自动降低 W/B 下限重试
 *   5. MixResultValidator 方案复核
 *   6. 按适应度取 Top-3
 */

const CandidatePoolBuilder = require('../services/CandidatePoolBuilder')
const GeneticOptimizer = require('../services/GeneticOptimizer')
const ConcreteFitness = require('../services/ConcreteFitness')
const MixResultValidator = require('../services/MixResultValidator')

module.exports = {
  name: 'optimize_mix_genetic',
  description: '遗传算法配合比优化。对给定材料候选和约束条件（目标强度/坍落度），使用遗传算法搜索全局最优配合比方案，返回 Top-3 推荐方案及复核结果。必传 cementIds/sandIds/stoneIds/spIds/waterIds + targetStrength + slump。可选 flyAshIds/slagIds/lithiumSlagIds/compositePowderIds 及掺量限制参数。',
  version: '1.0.0',
  category: 'optimization',

  parameters: {
    cementIds: {
      type: 'array',
      items: { type: 'integer' },
      description: '水泥候选ID列表（必填）',
      required: true,
      minItems: 1
    },
    flyAshIds: {
      type: 'array',
      items: { type: 'integer' },
      description: '粉煤灰候选ID列表（可选）',
      required: false
    },
    slagIds: {
      type: 'array',
      items: { type: 'integer' },
      description: '矿渣粉候选ID列表（可选）',
      required: false
    },
    lithiumSlagIds: {
      type: 'array',
      items: { type: 'integer' },
      description: '锂渣候选ID列表（可选）',
      required: false
    },
    compositePowderIds: {
      type: 'array',
      items: { type: 'integer' },
      description: '复合粉候选ID列表（可选）',
      required: false
    },
    sandIds: {
      type: 'array',
      items: { type: 'integer' },
      description: '细骨料候选ID列表（必填，最多2种）',
      required: true,
      minItems: 1,
      maxItems: 2
    },
    stoneIds: {
      type: 'array',
      items: { type: 'integer' },
      description: '粗骨料候选ID列表（必填，最多2种）',
      required: true,
      minItems: 1,
      maxItems: 2
    },
    spIds: {
      type: 'array',
      items: { type: 'integer' },
      description: '减水剂候选ID列表（必填）',
      required: true,
      minItems: 1
    },
    waterIds: {
      type: 'array',
      items: { type: 'integer' },
      description: '水候选ID列表（必填，且只能1种）',
      required: true,
      minItems: 1,
      maxItems: 1
    },
    targetStrength: {
      type: 'number',
      description: '目标强度（MPa），如 38',
      required: true
    },
    slump: {
      type: 'number',
      description: '坍落度（mm）',
      required: true,
      min: 10,
      max: 300
    },
    additiveTotalMax: {
      type: 'number',
      description: '掺合料总掺量上限（%），默认 50',
      default: 50
    },
    singleAdditiveMax: {
      type: 'number',
      description: '单一掺合料最大掺量（%），默认 30',
      default: 30
    },
    spDosageMin: {
      type: 'number',
      description: '减水剂最小掺量（%），默认 1.0',
      default: 1.0
    },
    spDosageMax: {
      type: 'number',
      description: '减水剂最大掺量（%），默认 5.0',
      default: 5.0
    },
    populationSize: {
      type: 'integer',
      description: 'GA 种群规模，默认 50',
      default: 50,
      min: 10,
      max: 500
    },
    generations: {
      type: 'integer',
      description: 'GA 迭代代数，默认 100',
      default: 100,
      min: 10,
      max: 1000
    }
  },

  errors: {
    OPTIMIZATION_FAILED: {
      code: 'OPTIMIZATION_FAILED',
      message: '遗传算法优化失败',
      hint: '请检查材料ID是否正确，或放宽约束条件',
      recovery: 'adjust_params'
    },
    MISSING_REQUIRED_PARAM: {
      code: 'MISSING_REQUIRED_PARAM',
      message: '缺少必要参数',
      hint: '请检查必填参数是否完整',
      recovery: 'add_param'
    },
    SNAPSHOT_FAILED: {
      code: 'SNAPSHOT_FAILED',
      message: '候选池构建失败',
      hint: '请检查材料ID是否存在',
      recovery: 'check_param'
    }
  },

  /**
   * 执行遗传算法配合比优化
   * @param {Object} args - 参数
   * @param {Object} context - 上下文（含 logger）
   * @returns {Promise<Object>} 优化结果
   */
  async execute(args, context) {
    const { logger } = context || {}

    // ===== 1. 入参校验 =====
    if (!args.cementIds || args.cementIds.length === 0) {
      return { success: false, error: '水泥候选不能为空' }
    }
    if (!args.sandIds || args.sandIds.length === 0) {
      return { success: false, error: '细骨料候选不能为空' }
    }
    if (!args.stoneIds || args.stoneIds.length === 0) {
      return { success: false, error: '粗骨料候选不能为空' }
    }
    if (!args.spIds || args.spIds.length === 0) {
      return { success: false, error: '减水剂候选不能为空' }
    }
    if (!args.waterIds || args.waterIds.length === 0) {
      return { success: false, error: '水候选不能为空' }
    }
    if (typeof args.targetStrength !== 'number') {
      return { success: false, error: '目标强度必填且为数字' }
    }
    if (typeof args.slump !== 'number') {
      return { success: false, error: '坍落度必填且为数字' }
    }

    if (logger) logger.info('开始遗传算法配合比优化')

    // ===== 2. 构建材料 ID 映射 =====
    const materialIds = {
      cementIds: args.cementIds,
      flyAshIds: args.flyAshIds || [],
      slagIds: args.slagIds || [],
      lithiumSlagIds: args.lithiumSlagIds || [],
      compositePowderIds: args.compositePowderIds || [],
      sandIds: args.sandIds,
      stoneIds: args.stoneIds,
      spIds: args.spIds,
      waterIds: args.waterIds
    }

    // ===== 3. 构建候选池快照 =====
    let snapshot
    try {
      snapshot = await CandidatePoolBuilder.buildSnapshot(materialIds)
    } catch (err) {
      if (logger) logger.error('候选池构建失败:', err.message)
      return { success: false, error: `候选池构建失败: ${err.message}` }
    }

    // ===== 4. 构建 ConcreteFitness =====
    const fitness = new ConcreteFitness(
      snapshot,
      args.targetStrength,
      args.slump
    )

    // ===== 5. 解析选项 =====
    const singleAdditiveMax = args.singleAdditiveMax ?? 30
    const spDosageMin = args.spDosageMin ?? 1.0
    const spDosageMax = args.spDosageMax ?? 5.0

    // ===== 6. 动态构造 geneSpec =====
    /**
     * 构建基因编码规范
     * @param {Object} snap - 材料快照
     * @param {Object} [opts] - 可选参数 { singleAdditiveMax, spDosageMin, spDosageMax, wbMin }
     * @returns {{ continuous: Array, discrete: Array }}
     */
    function buildGeneSpec(snap, opts = {}) {
      const wbMin = opts.wbMin ?? 0.30
      const smax = opts.singleAdditiveMax ?? 30
      const spMin = opts.spDosageMin ?? 1.0
      const spMax = opts.spDosageMax ?? 5.0
      const spec = { continuous: [], discrete: [] }

      // W/B（必有）
      spec.continuous.push({ name: 'wb', min: wbMin, max: 0.60 })

      // 水泥（必有）
      spec.discrete.push({
        name: 'cementGene',
        candidates: Array.from({ length: snap.candidatePools.cement.length }, (_, i) => i)
      })

      // 掺合料（池非空才加入）
      for (const admixture of ['flyAsh', 'slag', 'lithiumSlag', 'compositePowder']) {
        const pool = snap.candidatePools[admixture]
        if (pool && pool.length > 0) {
          spec.discrete.push({
            name: `${admixture}Gene`,
            candidates: Array.from({ length: pool.length }, (_, i) => i)
          })
          spec.continuous.push({ name: `${admixture}Dosage`, min: 0, max: smax })
        }
      }

      // 砂率（必有）
      spec.continuous.push({ name: 'sandRatio', min: 30, max: 55 })

      // 砂1（必有）
      spec.discrete.push({
        name: 'sand1Gene',
        candidates: Array.from({ length: snap.candidatePools.sand.length }, (_, i) => i)
      })

      // 第2种砂（pool.length > 1 才加入）
      if (snap.candidatePools.sand.length > 1) {
        spec.discrete.push({
          name: 'sand2Gene',
          candidates: Array.from({ length: snap.candidatePools.sand.length }, (_, i) => i)
        })
        spec.continuous.push({ name: 'sand2Proportion', min: 0, max: 100 })
      }

      // 石1（必有）
      spec.discrete.push({
        name: 'stone1Gene',
        candidates: Array.from({ length: snap.candidatePools.stone.length }, (_, i) => i)
      })

      // 第2种碎石（pool.length > 1 才加入）
      if (snap.candidatePools.stone.length > 1) {
        spec.discrete.push({
          name: 'stone2Gene',
          candidates: Array.from({ length: snap.candidatePools.stone.length }, (_, i) => i)
        })
        spec.continuous.push({ name: 'stone2Proportion', min: 0, max: 100 })
      }

      // 减水剂（必有）
      spec.discrete.push({
        name: 'spGene',
        candidates: Array.from({ length: snap.candidatePools.sp.length }, (_, i) => i)
      })
      spec.continuous.push({ name: 'spDosage', min: spMin, max: spMax })

      return spec
    }

    const geneSpec = buildGeneSpec(snapshot, { singleAdditiveMax, spDosageMin, spDosageMax })

    // ===== 7. 基因解码函数 =====
    /**
     * 将 GA 返回的原始基因（索引 + 连续值）解码为 ConcreteFitness.evaluate 所需的格式
     * @param {Object} rawGenes - 原始基因 { cementGene: 0, wb: 0.45, sand1Gene: 0, ... }
     * @param {Object} snap - 材料快照
     * @returns {Object} 解码后的基因（含实际材料对象）
     */
    function decodeGenes(rawGenes, snap) {
      // 处理砂数组（单种砂为单个对象，两种砂为数组 [sand1, sand2]）
      const sand = rawGenes.sand2Gene !== undefined
        ? [
            snap.candidatePools.sand[rawGenes.sand1Gene],
            snap.candidatePools.sand[rawGenes.sand2Gene]
          ]
        : snap.candidatePools.sand[rawGenes.sand1Gene]

      // 处理石数组
      const stone = rawGenes.stone2Gene !== undefined
        ? [
            snap.candidatePools.stone[rawGenes.stone1Gene],
            snap.candidatePools.stone[rawGenes.stone2Gene]
          ]
        : snap.candidatePools.stone[rawGenes.stone1Gene]

      const decoded = {
        cement: snap.candidatePools.cement[rawGenes.cementGene],
        sand,
        stone,
        sp: snap.candidatePools.sp[rawGenes.spGene],
        water: snap.candidatePools.water[0],
        wb: rawGenes.wb,
        sandRatio: rawGenes.sandRatio,
        spDosage: rawGenes.spDosage,
        sand2Proportion: rawGenes.sand2Proportion ?? 0,
        stone2Proportion: rawGenes.stone2Proportion ?? 0
      }

      // 可选矿物掺合料
      if (rawGenes.flyAshGene !== undefined) {
        decoded.flyAsh = snap.candidatePools.flyAsh[rawGenes.flyAshGene]
        decoded.flyAshDosage = rawGenes.flyAshDosage ?? 0
      }
      if (rawGenes.slagGene !== undefined) {
        decoded.slag = snap.candidatePools.slag[rawGenes.slagGene]
        decoded.slagDosage = rawGenes.slagDosage ?? 0
      }
      if (rawGenes.lithiumSlagGene !== undefined) {
        decoded.lithiumSlag = snap.candidatePools.lithiumSlag[rawGenes.lithiumSlagGene]
        decoded.lithiumSlagDosage = rawGenes.lithiumSlagDosage ?? 0
      }
      if (rawGenes.compositePowderGene !== undefined) {
        decoded.compositePowder = snap.candidatePools.compositePowder[rawGenes.compositePowderGene]
        decoded.compositePowderDosage = rawGenes.compositePowderDosage ?? 0
      }

      return decoded
    }

    // ===== 8. 适应度包装器 =====
    const fitnessWrapper = async (rawGenes) => {
      const decoded = decodeGenes(rawGenes, snapshot)
      return await fitness.evaluate(decoded)
    }

    // ===== 9. 运行 GA =====
    const populationSize = args.populationSize || 50
    const generations = args.generations || 100
    const optimizer = new GeneticOptimizer({ populationSize, generations })
    let result = await optimizer.run(fitnessWrapper, geneSpec)

    // ===== 10. 全淘汰重试 =====
    if (result.stats.allInvalid) {
      if (logger) logger.warn('初始种群全部不达标，降低 W/B 下限重试')
      const retryGeneSpec = buildGeneSpec(snapshot, { singleAdditiveMax, spDosageMin, spDosageMax, wbMin: 0.25 })
      result = await optimizer.run(fitnessWrapper, retryGeneSpec)

      if (result.stats.allInvalid) {
        if (logger) logger.error('降低 W/B 下限后仍全部不达标')
        return {
          success: false,
          error: '初始种群全部不达标，降低 W/B 下限后仍不达标，请放宽约束条件'
        }
      }
    }

    // ===== 11. MixResultValidator 复核 =====
    const validated = MixResultValidator.validate(result.bestSolutions, snapshot)

    // 按适应度（成本）升序排列
    validated.sort((a, b) => a.fitness - b.fitness)

    // ===== 12. 选 Top-3（按验证状态筛选，不凑数） =====
    const passed = validated.filter(s => s.validation.status === 'pass')
      .sort((a, b) => a.fitness - b.fitness)
    const warned = validated.filter(s => s.validation.status === 'warning')
      .sort((a, b) => a.fitness - b.fitness)
    // ❌ 直接排除，不参与筛选

    const top3 = []
    if (passed.length >= 3) {
      top3.push(...passed.slice(0, 3))
    } else {
      top3.push(...passed)
      const needed = 3 - top3.length
      top3.push(...warned.slice(0, needed))
    }
    // 不足 3 个不凑数

    return {
      success: true,
      data: {
        topSolutions: validated,
        top3,
        gaStats: result.stats
      }
    }
  }
}
