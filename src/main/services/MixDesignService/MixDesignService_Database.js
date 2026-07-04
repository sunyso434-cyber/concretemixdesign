const { Op } = require('sequelize')
const MixDesign = require('../../db/models/MixDesign')
const MixDesignService_Strength = require('./MixDesignService_Strength')
const MixDesignService_WaterRatio = require('./MixDesignService_WaterRatio')
const MixDesignService_Aggregate = require('./MixDesignService_Aggregate')

class MixDesignService_Database {
  // 获取所有配合比方案（支持草稿过滤）
  async getAllMixDesigns(options = {}) {
    try {
      const where = {}
      if (options.excludeDrafts) {
        where.status = { [Op.ne]: '草稿' }
      }
      if (options.onlyDrafts) {
        where.status = '草稿'
      }
      return await MixDesign.findAll({ where, order: [['createdAt', 'DESC']] })
    } catch (error) {
      console.error('获取配合比方案列表失败:', error)
      throw error
    }
  }

  // v10.x：按 basicMixId 查引用此基准的方案（供 delete_basic_mix_design 引用检查用）
  async findByBasicMixId(basicMixId) {
    try {
      return await MixDesign.findAll({
        where: { basicMixId },
        attributes: ['id', 'name', 'status', 'createdAt']
      })
    } catch (error) {
      console.error('按 basicMixId 查方案失败:', error)
      return []
    }
  }

  // 清理过期草稿
  async cleanupDrafts(maxAgeDays = 7) {
    try {
      const cutoff = new Date(Date.now() - maxAgeDays * 86400000)
      const deleted = await MixDesign.destroy({
        where: { status: '草稿', createdAt: { [Op.lt]: cutoff } }
      })
      console.log(`[草稿清理] 已删除 ${deleted} 条超过 ${maxAgeDays} 天的草稿`)
      return { deleted }
    } catch (error) {
      console.error('清理草稿失败:', error)
      throw error
    }
  }

  // 根据ID获取配合比方案
  async getMixDesignById(id) {
    try {
      return await MixDesign.findByPk(id)
    } catch (error) {
      console.error('获取配合比方案详情失败:', error)
      throw error
    }
  }

  // 创建配合比方案
  async createMixDesign(data) {
    try {
      console.log('接收到的方案数据:', {
        hasMaterialDetails: !!data.materialDetails,
        hasMaterialCosts: !!data.materialCosts,
        hasTotalCost: !!data.totalCost,
        materialDetailsKeys: data.materialDetails ? Object.keys(data.materialDetails) : [],
        materialCostsKeys: data.materialCosts ? Object.keys(data.materialCosts) : []
      })

      return await MixDesign.create(data)
    } catch (error) {
      console.error('创建配合比方案失败:', error)
      throw error
    }
  }

  // 更新配合比方案
  async updateMixDesign(id, data) {
    try {
      const mixDesign = await MixDesign.findByPk(id)
      if (!mixDesign) {
        throw new Error('配合比方案不存在')
      }
      return await mixDesign.update(data)
    } catch (error) {
      console.error('更新配合比方案失败:', error)
      throw error
    }
  }

  // 删除配合比方案
  async deleteMixDesign(id) {
    try {
      const mixDesign = await MixDesign.findByPk(id)
      if (!mixDesign) {
        throw new Error('配合比方案不存在')
      }
      return await mixDesign.destroy()
    } catch (error) {
      console.error('删除配合比方案失败:', error)
      throw error
    }
  }

  // 计算配合比
  async calculateMixDesign(params) {
    try {
      const { strength, slump, tempSettings, materials, calculationMethod = 'mass', targetDensity = 2400, airContent, flyAshDosage, slagDosage, lithiumSlagDosage, compositePowderDosage, sandRatio, waterRatio: inputWaterRatio, _overrideBaseWaterAmount, _overrideSpDosage } = params

      console.log('开始JGJ 55标准配合比计算...')
      console.log('输入参数:', { strength, slump, tempSettings, calculationMethod, targetDensity, airContent, flyAshDosage, slagDosage, lithiumSlagDosage, compositePowderDosage, sandRatio })

      // 初始化计算步骤
      const calculationSteps = []

      // ========== 步骤1：基本参数 ==========
      const basicParams = [
        { label: '强度等级', value: strength, formula: `f_cu,k = ${parseInt(strength.replace('C', ''))} MPa` },
        { label: '坍落度', value: `${slump} mm` },
        { label: '计算方法', value: calculationMethod === 'mass' ? '质量法' : '绝对体积法' },
        { label: '粉煤灰掺量', value: `${flyAshDosage || 0}%` },
        { label: '矿渣粉掺量', value: `${slagDosage || 0}%` },
        { label: '锂渣掺量', value: `${lithiumSlagDosage || 0}%` },
        { label: '复合粉掺量', value: `${compositePowderDosage || 0}%` }
      ]
      if (calculationMethod === 'mass') {
        basicParams.push({ label: '目标容重', value: `${targetDensity || 2400} kg/m³` })
      } else {
        basicParams.push({ label: '含气量', value: `${airContent !== undefined && airContent !== null ? airContent : 1.0}%` })
      }
      if (sandRatio !== undefined && sandRatio !== null) {
        basicParams.push({ label: '砂率', value: `${sandRatio}%（用户输入）`, isUserInput: true })
      }
      calculationSteps.push({ step: 1, title: '基本参数', details: basicParams })

      // 1. 获取强度标准差σ
      const stdDev = await MixDesignService_Strength.getStrengthStdDev(strength, tempSettings)

      // 2. 计算配置强度 f_cu,0 = f_cu,k + 1.645 × σ
      const targetStrength = MixDesignService_Strength.calculateTargetStrength(strength, stdDev)
      const strengthNum = parseInt(strength.replace('C', ''))

      // ========== 步骤2：配置强度 ==========
      calculationSteps.push({
        step: 2,
        title: '配置强度计算',
        details: [
          { label: '强度标准差σ', value: `${stdDev} MPa` },
          { label: '公式', value: `f_cu,0 = f_cu,k + 1.645 × σ` },
          { label: '代入', value: `f_cu,0 = ${strengthNum} + 1.645 × ${stdDev}` },
          { label: '配置强度', value: `${targetStrength.toFixed(2)} MPa`, highlight: true }
        ]
      })

      // 计算并记录目标细度模数（根据强度等级调整）
      const targetFinenessModulus = MixDesignService_Strength.computeTargetFinenessModulus(strength, tempSettings)
      const userSpecifiedFm = tempSettings && tempSettings.targetFinenessModulusBase !== undefined && tempSettings.targetFinenessModulusBase !== null
      const baseFm = userSpecifiedFm ? tempSettings.targetFinenessModulusBase : 2.7

      // ========== 步骤3：回归系数 ==========
      const { alphaA, alphaB } = await MixDesignService_WaterRatio.getRegressionCoefficients(tempSettings)
      calculationSteps.push({
        step: 3,
        title: '回归系数',
        details: [
          { label: 'α_a', value: alphaA.toFixed(3) },
          { label: 'α_b', value: alphaB.toFixed(3) },
          { label: '来源', value: tempSettings?.regressionAlphaA !== undefined ? '高级设置' : '默认值（碎石）' }
        ]
      })

      // 4. 计算掺合料影响系数
      let flyAshInfluenceFactor = 1.0
      let slagInfluenceFactor = 1.0
      let lithiumSlagInfluenceFactor = 1.0
      let compositePowderInfluenceFactor = 1.0

      if (flyAshDosage && flyAshDosage > 0 && materials?.flyAsh) {
        flyAshInfluenceFactor = MixDesignService_WaterRatio.calculateInfluenceFactor(flyAshDosage, materials.flyAsh)
      }
      if (slagDosage && slagDosage > 0 && materials?.slag) {
        slagInfluenceFactor = MixDesignService_WaterRatio.calculateInfluenceFactor(slagDosage, materials.slag)
      }
      if (lithiumSlagDosage && lithiumSlagDosage > 0 && materials?.lithiumSlag) {
        lithiumSlagInfluenceFactor = MixDesignService_WaterRatio.calculateInfluenceFactor(lithiumSlagDosage, materials.lithiumSlag)
      }
      if (compositePowderDosage && compositePowderDosage > 0 && materials?.compositePowder) {
        compositePowderInfluenceFactor = MixDesignService_WaterRatio.calculateInfluenceFactor(compositePowderDosage, materials.compositePowder)
      }

      // 计算总掺量及组合影响系数（所有掺合料影响系数直接相乘）
      const totalAdmixtureDosage = (flyAshDosage || 0) + (slagDosage || 0) + (lithiumSlagDosage || 0) + (compositePowderDosage || 0)
      let influenceFactor = flyAshInfluenceFactor * slagInfluenceFactor * lithiumSlagInfluenceFactor * compositePowderInfluenceFactor

      // ========== 步骤4：掺合料影响系数 ==========
      const admixtureDetails = []
      if (flyAshDosage > 0 && materials?.flyAsh) {
        admixtureDetails.push({ label: `粉煤灰（${flyAshDosage}%）影响系数`, value: flyAshInfluenceFactor.toFixed(4) })
      }
      if (slagDosage > 0 && materials?.slag) {
        admixtureDetails.push({ label: `矿渣粉（${slagDosage}%）影响系数`, value: slagInfluenceFactor.toFixed(4) })
      }
      if (lithiumSlagDosage > 0 && materials?.lithiumSlag) {
        admixtureDetails.push({ label: `锂渣（${lithiumSlagDosage}%）影响系数`, value: lithiumSlagInfluenceFactor.toFixed(4) })
      }
      if (compositePowderDosage > 0 && materials?.compositePowder) {
        admixtureDetails.push({ label: `复合粉（${compositePowderDosage}%）影响系数`, value: compositePowderInfluenceFactor.toFixed(4) })
      }
      if (totalAdmixtureDosage > 0) {
        const activeFactors = []
        if (flyAshDosage > 0 && materials?.flyAsh) activeFactors.push(`${flyAshInfluenceFactor.toFixed(4)}`)
        if (slagDosage > 0 && materials?.slag) activeFactors.push(`${slagInfluenceFactor.toFixed(4)}`)
        if (lithiumSlagDosage > 0 && materials?.lithiumSlag) activeFactors.push(`${lithiumSlagInfluenceFactor.toFixed(4)}`)
        if (compositePowderDosage > 0 && materials?.compositePowder) activeFactors.push(`${compositePowderInfluenceFactor.toFixed(4)}`)
        if (activeFactors.length > 1) {
          admixtureDetails.push({ label: '组合影响系数γ_f', value: `${activeFactors.join(' × ')} = ${influenceFactor.toFixed(4)}`, highlight: true })
        } else {
          admixtureDetails.push({ label: '影响系数γ_f', value: influenceFactor.toFixed(4), highlight: true })
        }
      }
      if (admixtureDetails.length > 0) {
        calculationSteps.push({ step: 4, title: '掺合料影响系数', details: admixtureDetails })
      }

      // 5. 计算水胶比
      const cementMaterial = materials?.cement
      const cementStrength28d = cementMaterial?.compressiveStrength28d || 48.0
      const adjustedCementStrength = cementStrength28d * influenceFactor

      // ========== 步骤5：水胶比计算 ==========
      const waterRatio = MixDesignService_WaterRatio.calculateWaterRatio(targetStrength, adjustedCementStrength, alphaA, alphaB)
      calculationSteps.push({
        step: 5,
        title: '水胶比计算',
        details: [
          { label: '水泥28天强度f_ce', value: `${cementStrength28d} MPa` },
          { label: '胶凝材料强度f_b', value: `f_b = f_ce × γ_f = ${adjustedCementStrength.toFixed(2)} MPa` },
          { label: '公式', value: 'W/B = (α_a × f_b) / (f_cu,0 + α_a × α_b × f_b)' },
          { label: '代入', value: `W/B = (${alphaA} × ${adjustedCementStrength.toFixed(2)}) / (${targetStrength.toFixed(2)} + ${alphaA} × ${alphaB} × ${adjustedCementStrength.toFixed(2)})` },
          { label: '水胶比', value: waterRatio.toFixed(4), highlight: true }
        ]
      })

      // 6. 计算用水量
      let coarseAggregateMaterial = materials?.stone
      let maxSize = 25
      let aggregateType = '碎石'

      if (Array.isArray(coarseAggregateMaterial)) {
        let largestSize = 0
        for (const aggregate of coarseAggregateMaterial) {
          const size = MixDesignService_Aggregate.extractMaxAggregateSize(aggregate.specification)
          if (size > largestSize) {
            largestSize = size
            coarseAggregateMaterial = aggregate
          }
        }
        maxSize = largestSize
      }

      if (coarseAggregateMaterial) {
        maxSize = MixDesignService_Aggregate.extractMaxAggregateSize(coarseAggregateMaterial.specification)
        aggregateType = coarseAggregateMaterial.name?.includes('卵石') ? '卵石' : '碎石'
      }

      const baseWaterAmount = _overrideBaseWaterAmount !== undefined
        ? _overrideBaseWaterAmount
        : MixDesignService_Aggregate.getBaseWaterAmount(maxSize, slump, aggregateType)

      // 7. 计算减水剂掺量
      const fineAggregateMaterial = materials?.sand
      const superplasticizerResult = await MixDesignService_Aggregate.calculateSuperplasticizerDosage(strength, fineAggregateMaterial, tempSettings)
      const spDosageFromCalc = superplasticizerResult.finalDosage
      const superplasticizerDosage = _overrideSpDosage !== undefined ? _overrideSpDosage : spDosageFromCalc

      // 8. 计算减水率
      const superplasticizerMaterial = materials?.superplasticizer
      const baseDosage = superplasticizerMaterial?.recommendedDosage || 1.5
      const baseReducingRate = superplasticizerMaterial?.waterReducingRate || 25
      const waterReducingRate = await MixDesignService_Aggregate.calculateWaterReducingRate(baseReducingRate, baseDosage, superplasticizerResult.strengthDosage, tempSettings)

      // ========== 步骤6：减水剂计算 ==========
      const spDetails = [
        { label: '减水剂推荐掺量', value: `${baseDosage}%` },
        { label: '减水剂基准减水率', value: `${baseReducingRate}%` },
        { label: '强度等级调整掺量', value: `${superplasticizerResult.strengthDosage.toFixed(2)}%` }
      ]
      if (superplasticizerResult.mbAdjustment > 0 || superplasticizerResult.fmAdjustment > 0) {
        if (superplasticizerResult.mbAdjustment > 0) {
          spDetails.push({ label: 'MB值调整', value: `+${superplasticizerResult.mbAdjustment.toFixed(4)}%` })
        }
        if (superplasticizerResult.fmAdjustment > 0) {
          spDetails.push({ label: '细度模数调整', value: `+${superplasticizerResult.fmAdjustment.toFixed(4)}%` })
        }
      }
      spDetails.push({ label: '减水剂掺量', value: `${superplasticizerResult.finalDosage.toFixed(2)}%`, highlight: true })
      spDetails.push({ label: '减水率', value: `${waterReducingRate.toFixed(2)}%`, highlight: true })
      calculationSteps.push({ step: 6, title: '减水剂计算', details: spDetails })

      // 9. 计算实际用水量
      let waterAmount = baseWaterAmount * (1 - waterReducingRate / 100)
      const waterAdjustments = [{ label: '基准用水量', value: `${baseWaterAmount} kg/m³` }]

      if (flyAshDosage && flyAshDosage > 0 && materials?.flyAsh?.waterDemandRatio) {
        const flyAshWaterDemandRatio = materials.flyAsh.waterDemandRatio
        const flyAshInfluence = 1 - (100 - flyAshWaterDemandRatio) / 30 * (flyAshDosage / 100)
        waterAmount *= flyAshInfluence
        waterAdjustments.push({ label: `粉煤灰需水量比修正（${flyAshWaterDemandRatio}%）`, value: `× ${flyAshInfluence.toFixed(4)}` })
      }

      if (slagDosage && slagDosage > 0 && materials?.slag?.fluidityRatio) {
        const slagFluidityRatio = materials.slag.fluidityRatio
        const slagInfluence = 1 + (100 - slagFluidityRatio) / 50 * (slagDosage / 100)
        waterAmount *= slagInfluence
        waterAdjustments.push({ label: `矿渣粉流动度比修正（${slagFluidityRatio}%）`, value: `× ${slagInfluence.toFixed(4)}` })
      }

      if (lithiumSlagDosage && lithiumSlagDosage > 0 && materials?.lithiumSlag?.waterDemandRatio) {
        const lithiumSlagWaterDemandRatio = materials.lithiumSlag.waterDemandRatio
        const lithiumSlagInfluence = 1 - (100 - lithiumSlagWaterDemandRatio) / 30 * (lithiumSlagDosage / 100)
        waterAmount *= lithiumSlagInfluence
        waterAdjustments.push({ label: `锂渣需水量比修正（${lithiumSlagWaterDemandRatio}%）`, value: `× ${lithiumSlagInfluence.toFixed(4)}` })
      }

      if (compositePowderDosage && compositePowderDosage > 0 && materials?.compositePowder?.fluidityRatio) {
        const compositePowderFluidityRatio = materials.compositePowder.fluidityRatio
        const compositePowderInfluence = 1 + (100 - compositePowderFluidityRatio) / 50 * (compositePowderDosage / 100)
        waterAmount *= compositePowderInfluence
        waterAdjustments.push({ label: `复合粉流动度比修正（${compositePowderFluidityRatio}%）`, value: `× ${compositePowderInfluence.toFixed(4)}` })
      }

      waterAdjustments.push({ label: '减水率', value: `${waterReducingRate.toFixed(2)}%` })
      waterAdjustments.push({ label: '实际用水量', value: `${waterAmount.toFixed(2)} kg/m³`, highlight: true })

      // ========== 步骤7：用水量计算 ==========
      calculationSteps.push({ step: 6, title: '用水量计算', details: waterAdjustments })

      // 10. 计算胶凝材料总量
      const cementitiousAmount = waterAmount / waterRatio

      // 11. 计算砂率
      let finalSandRatio
      let sandRatioSource = ''
      if (sandRatio !== undefined && sandRatio !== null) {
        finalSandRatio = sandRatio / 100
        sandRatioSource = `${sandRatio}%（用户输入）`
      } else {
        // 从材料提取实际细度模数，不再用默认 2.8
        const sandFM = this._extractSandFM(materials?.sand)
        finalSandRatio = MixDesignService_Aggregate.calculateSandRatio(waterRatio, slump, sandFM)
        sandRatioSource = `${(finalSandRatio * 100).toFixed(1)}%（计算值，FM=${sandFM.toFixed(2)}）`
      }

      // ========== 步骤8：胶凝材料与砂率 ==========
      const flyAshPercentage = (flyAshDosage || 0) / 100
      const slagPercentage = (slagDosage || 0) / 100
      const lithiumSlagPercentage = (lithiumSlagDosage || 0) / 100
      const compositePowderPercentage = (compositePowderDosage || 0) / 100
      const cementPercentage = 1 - flyAshPercentage - slagPercentage - lithiumSlagPercentage - compositePowderPercentage
      calculationSteps.push({
        step: 7,
        title: '胶凝材料与砂率',
        details: [
          { label: '胶凝材料总量', value: `B = ${waterAmount.toFixed(2)} / ${waterRatio.toFixed(4)} = ${cementitiousAmount.toFixed(2)} kg/m³`, highlight: true },
          { label: '水泥用量', value: `${(cementitiousAmount * cementPercentage).toFixed(2)} kg/m³（${(cementPercentage * 100).toFixed(1)}%）` },
          flyAshDosage > 0 ? { label: '粉煤灰用量', value: `${(cementitiousAmount * flyAshPercentage).toFixed(2)} kg/m³（${flyAshDosage}%）` } : null,
          slagDosage > 0 ? { label: '矿渣粉用量', value: `${(cementitiousAmount * slagPercentage).toFixed(2)} kg/m³（${slagDosage}%）` } : null,
          lithiumSlagDosage > 0 ? { label: '锂渣用量', value: `${(cementitiousAmount * lithiumSlagPercentage).toFixed(2)} kg/m³（${lithiumSlagDosage}%）` } : null,
          compositePowderDosage > 0 ? { label: '复合粉用量', value: `${(cementitiousAmount * compositePowderPercentage).toFixed(2)} kg/m³（${compositePowderDosage}%）` } : null,
          { label: '砂率', value: sandRatioSource, highlight: true }
        ].filter(Boolean)
      })

      const materialAmounts = {
        water: waterAmount,
        cement: cementitiousAmount * Math.max(0, cementPercentage),
        flyAsh: cementitiousAmount * flyAshPercentage,
        slag: cementitiousAmount * slagPercentage,
        lithiumSlag: cementitiousAmount * lithiumSlagPercentage,
        compositePowder: cementitiousAmount * compositePowderPercentage,
        sand: 0,
        stone: 0,
        superplasticizer: cementitiousAmount * (superplasticizerDosage / 100)
      }

      console.log('掺合料分配:', {
        cementPercentage: (cementPercentage * 100).toFixed(1) + '%',
        flyAshPercentage: (flyAshPercentage * 100).toFixed(1) + '%',
        slagPercentage: (slagPercentage * 100).toFixed(1) + '%',
        lithiumSlagPercentage: (lithiumSlagPercentage * 100).toFixed(1) + '%',
        compositePowderPercentage: (compositePowderPercentage * 100).toFixed(1) + '%'
      })

      // 13. 根据计算方法选择计算骨料用量
      let sandAmount, stoneAmount
      const usedAirContent = airContent !== undefined && airContent !== null ? airContent : 1.0
      if (calculationMethod === 'mass') {
        // 质量法：根据目标容重计算骨料总量，再按砂率分配
        const density = targetDensity || 2400
        const aggregateAmount = density - waterAmount - cementitiousAmount - materialAmounts.superplasticizer
        sandAmount = aggregateAmount * finalSandRatio
        stoneAmount = aggregateAmount - sandAmount

        // 调整到目标容重
        const tempMaterialAmounts = {
          ...materialAmounts,
          sand: sandAmount,
          stone: stoneAmount
        }
        const massResult = MixDesignService_Aggregate.calculateByMassMethod(tempMaterialAmounts, density)
        if (massResult) {
          sandAmount = massResult.materialAmounts.sand
          stoneAmount = massResult.materialAmounts.stone
        }
      } else {
        // 绝对体积法：使用迭代反馈修正，确保总体积 = 1 m³
        // 获取各材料密度
        const cementDensity = materials?.cement?.density || 3.15
        const waterDensity = 1.0
        const spDensity = materials?.superplasticizer?.density || 1.05
        const flyAshDensity = materials?.flyAsh?.density || 2.20
        const slagDensity = materials?.slag?.density || 2.90
        const lithiumSlagDensity = materials?.lithiumSlag?.density || 2.20
        const compositePowderDensity = materials?.compositePowder?.density || 2.90
        const getSandDensity = () => {
          if (Array.isArray(materials.sand)) return materials.sand[0]?.density || 2.63
          return materials.sand?.density || 2.63
        }
        const getStoneDensity = () => {
          if (Array.isArray(materials.stone)) return materials.stone[0]?.density || 2.70
          return materials.stone?.density || 2.70
        }
        const sandDensity = getSandDensity()
        const stoneDensity = getStoneDensity()

        // 初始估算骨料总量（基于假设密度 2400 kg/m³）
        let aggregateAmount = 2400 - waterAmount - cementitiousAmount - materialAmounts.superplasticizer
        let currentSandAmount = aggregateAmount * finalSandRatio
        let currentStoneAmount = aggregateAmount - currentSandAmount

        // 迭代修正，使总体积 = 1 m³
        // 注意：单位必须统一 - 所有材料密度使用 g/cm³ (= kg/L = 1000 kg/m³)
        // 但这里 materialAmounts 是 kg/m³，密度是 g/cm³，需要换算
        // 实际上 density (g/cm³) × 1000 = density (kg/m³)，所以直接除是错的
        // 正确：体积(m³) = 质量(kg/m³) / (密度(g/cm³) × 1000)
        const toM3 = (kgPerM3, gPerCm3) => kgPerM3 / (gPerCm3 * 1000)

        for (let i = 0; i < 10; i++) {
          const cementVol = toM3(materialAmounts.cement, cementDensity)
          const waterVol = toM3(waterAmount, waterDensity)
          const spVol = toM3(materialAmounts.superplasticizer, spDensity)
          const flyAshVol = toM3(materialAmounts.flyAsh || 0, flyAshDensity)
          const slagVol = toM3(materialAmounts.slag || 0, slagDensity)
          const lithiumSlagVol = toM3(materialAmounts.lithiumSlag || 0, lithiumSlagDensity)
          const compositePowderVol = toM3(materialAmounts.compositePowder || 0, compositePowderDensity)
          const airVol = usedAirContent / 100

          const currentSandVol = toM3(currentSandAmount, sandDensity)
          const currentStoneVol = toM3(currentStoneAmount, stoneDensity)
          const totalVolume = cementVol + waterVol + spVol + flyAshVol + slagVol + lithiumSlagVol + compositePowderVol + currentSandVol + currentStoneVol + airVol

          // 目标骨料体积
          const targetAggVol = 1 - cementVol - waterVol - spVol - flyAshVol - slagVol - lithiumSlagVol - compositePowderVol - airVol

          // 当前骨料体积
          const currentAggVol = currentSandVol + currentStoneVol

          // 缩放比例
          const scaleFactor = currentAggVol > 0 ? targetAggVol / currentAggVol : 1

          if (Math.abs(scaleFactor - 1) < 1e-6) break

          currentSandAmount *= scaleFactor
          currentStoneAmount *= scaleFactor

          console.log('绝对体积法迭代' + i + ': scaleFactor=' + scaleFactor.toFixed(6) + ', totalVolume=' + totalVolume.toFixed(4) + ', sandAmount=' + currentSandAmount.toFixed(2) + ', stoneAmount=' + currentStoneAmount.toFixed(2))
        }

        sandAmount = currentSandAmount
        stoneAmount = currentStoneAmount

        // 验证最终结果
        const cementVol = toM3(materialAmounts.cement, cementDensity)
        const waterVol = toM3(waterAmount, waterDensity)
        const spVol = toM3(materialAmounts.superplasticizer, spDensity)
        const flyAshVol = toM3(materialAmounts.flyAsh || 0, flyAshDensity)
        const slagVol = toM3(materialAmounts.slag || 0, slagDensity)
        const lithiumSlagVol = toM3(materialAmounts.lithiumSlag || 0, lithiumSlagDensity)
        const compositePowderVol = toM3(materialAmounts.compositePowder || 0, compositePowderDensity)
        const airVol = usedAirContent / 100
        const sandVol = toM3(sandAmount, sandDensity)
        const stoneVol = toM3(stoneAmount, stoneDensity)
        const finalTotalVol = cementVol + waterVol + spVol + flyAshVol + slagVol + lithiumSlagVol + compositePowderVol + sandVol + stoneVol + airVol
        const finalDensity = materialAmounts.cement + waterAmount + materialAmounts.superplasticizer + (materialAmounts.flyAsh || 0) + (materialAmounts.slag || 0) + (materialAmounts.lithiumSlag || 0) + (materialAmounts.compositePowder || 0) + sandAmount + stoneAmount
        console.log('绝对体积法最终: cementVol=' + cementVol.toFixed(4) + ', waterVol=' + waterVol.toFixed(4) + ', spVol=' + spVol.toFixed(4) + ', flyAshVol=' + flyAshVol.toFixed(4) + ', slagVol=' + slagVol.toFixed(4) + ', lithiumSlagVol=' + lithiumSlagVol.toFixed(4) + ', compositePowderVol=' + compositePowderVol.toFixed(4) + ', sandVol=' + sandVol.toFixed(4) + ', stoneVol=' + stoneVol.toFixed(4) + ', airVol=' + airVol.toFixed(4) + ', totalVolume=' + finalTotalVol.toFixed(4) + ', finalDensity=' + finalDensity.toFixed(2))
      }

      // 处理多种骨料的情况
      let fineAggregateOptimalRatio = null
      if (Array.isArray(materials.sand)) {
        // 多种细骨料，使用最佳比例分配，按强度等级确定目标细度模数
        fineAggregateOptimalRatio = MixDesignService_Aggregate.calculateOptimalFineAggregateRatio(materials.sand, targetFinenessModulus)
        for (const item of fineAggregateOptimalRatio) {
          materialAmounts[`sand_${item.aggregate.id}`] = sandAmount * item.ratio
        }
        // 保留总砂量用于兼容性
        materialAmounts.sand = sandAmount
      } else {
        // 检查是否为混合砂对象
        if (materials.sand.originalRatios && materials.sand.originalAggregateIds) {
          // 混合砂，为密度计算添加各个单一砂的用量
          materials.sand.originalAggregateIds.forEach((aggId, i) => {
            materialAmounts[`sand_${aggId}`] = sandAmount * materials.sand.originalRatios[i]
          })
        }
        // 保留总砂量用于兼容性
        materialAmounts.sand = sandAmount
      }

      if (Array.isArray(materials.stone)) {
        // 多种粗骨料，按等比例分配
        const stoneRatio = 1 / materials.stone.length
        for (const stone of materials.stone) {
          materialAmounts[`stone_${stone.id}`] = stoneAmount * stoneRatio
        }
        // 保留总石量用于兼容性
        materialAmounts.stone = stoneAmount
      } else {
        // 单一粗骨料
        materialAmounts.stone = stoneAmount
      }

      // 准备细骨料和粗骨料的详细分配（复用之前计算的最佳比例）
      let fineAggregateBreakdown = []
      let coarseAggregateBreakdown = []

      if (Array.isArray(materials.sand) && fineAggregateOptimalRatio) {
        fineAggregateBreakdown = fineAggregateOptimalRatio.map(item => ({
          id: item.aggregate.id,
          name: item.aggregate.name,
          amount: sandAmount * item.ratio,
          ratio: item.ratio
        }))
      } else if (materials.sand) {
        // 检查是否为混合砂对象（包含 originalRatios）
        if (materials.sand.originalRatios && materials.sand.originalAggregateIds) {
          // 混合砂，展开为各个单一砂
          fineAggregateBreakdown = materials.sand.originalAggregateIds.map((aggId, i) => {
            return {
              id: aggId,
              name: materials.sand.originalAggregateNames ? materials.sand.originalAggregateNames[i] : `砂_${aggId}`,
              amount: sandAmount * materials.sand.originalRatios[i],
              ratio: materials.sand.originalRatios[i]
            }
          })
        } else {
          // 单一砂
          fineAggregateBreakdown = [{
            id: materials.sand.id,
            name: materials.sand.name,
            amount: sandAmount,
            ratio: 1
          }]
        }
      }

      if (Array.isArray(materials.stone)) {
        const stoneRatio = 1 / materials.stone.length
        coarseAggregateBreakdown = materials.stone.map(stone => ({
          id: stone.id,
          name: stone.name,
          amount: stoneAmount * stoneRatio,
          ratio: stoneRatio
        }))
      } else if (materials.stone) {
        coarseAggregateBreakdown = [{
          id: materials.stone.id,
          name: materials.stone.name,
          amount: stoneAmount,
          ratio: 1
        }]
      }

      console.log('材料用量:', materialAmounts)
      console.log('细骨料分配:', fineAggregateBreakdown)
      console.log('粗骨料分配:', coarseAggregateBreakdown)

      // ========== 步骤9：骨料用量计算 ==========
      const aggregateDetails = []
      if (calculationMethod === 'mass') {
        const targetD = targetDensity || 2400
        aggregateDetails.push({ label: '计算方法', value: '质量法' })
        aggregateDetails.push({ label: '公式', value: '骨料总量 = 目标容重 - 胶凝材料 - 水 - 外加剂' })
        aggregateDetails.push({ label: '代入', value: `= ${targetD} - ${cementitiousAmount.toFixed(2)} - ${waterAmount.toFixed(2)} - ${materialAmounts.superplasticizer.toFixed(2)}` })
        aggregateDetails.push({ label: '骨料总量', value: `${(targetD - cementitiousAmount - waterAmount - materialAmounts.superplasticizer).toFixed(2)} kg/m³` })
        aggregateDetails.push({ label: '砂率', value: `${(finalSandRatio * 100).toFixed(1)}%` })
        aggregateDetails.push({ label: '细骨料用量', value: `${sandAmount.toFixed(2)} kg/m³`, highlight: true })
        aggregateDetails.push({ label: '粗骨料用量', value: `${stoneAmount.toFixed(2)} kg/m³`, highlight: true })
      } else {
        aggregateDetails.push({ label: '计算方法', value: '绝对体积法' })
        aggregateDetails.push({ label: '总体积', value: '1 m³' })
        aggregateDetails.push({ label: '含气量', value: `${usedAirContent}%` })
        aggregateDetails.push({ label: '砂率', value: `${(finalSandRatio * 100).toFixed(1)}%` })
        aggregateDetails.push({ label: '细骨料用量', value: `${sandAmount.toFixed(2)} kg/m³`, highlight: true })
        aggregateDetails.push({ label: '粗骨料用量', value: `${stoneAmount.toFixed(2)} kg/m³`, highlight: true })
      }

      // 多骨料时添加比例分配信息
      const hasMultipleSand = Array.isArray(materials.sand) && materials.sand.length > 1
      const hasMultipleStone = Array.isArray(materials.stone) && materials.stone.length > 1

      if (hasMultipleSand && fineAggregateOptimalRatio) {
        const sandRatioDetails = fineAggregateOptimalRatio.map(item => ({
          label: `砂-${item.aggregate.name || item.aggregate.id}`,
          value: `用量: ${(sandAmount * item.ratio).toFixed(2)} kg/m³，比例: ${(item.ratio * 100).toFixed(1)}%`
        }))
        aggregateDetails.push({ label: '【细骨料组合】', value: `目标细度模数: ${targetFinenessModulus}` })
        aggregateDetails.push(...sandRatioDetails)
      }

      if (hasMultipleStone) {
        const stoneRatio = 1 / materials.stone.length
        const stoneRatioDetails = materials.stone.map(stone => ({
          label: `石-${stone.name || stone.id}`,
          value: `用量: ${(stoneAmount * stoneRatio).toFixed(2)} kg/m³，比例: ${(stoneRatio * 100).toFixed(1)}%`
        }))
        aggregateDetails.push({ label: '【粗骨料组合】', value: `${materials.stone.length}种粗骨料等比例分配` })
        aggregateDetails.push(...stoneRatioDetails)
      }

      calculationSteps.push({ step: 8, title: '骨料用量计算', details: aggregateDetails })

      // ========== 步骤9：目标细度模数（多种细骨料时） ==========
      if (hasMultipleSand) {
        calculationSteps.push({
          step: 10,
          title: '细骨料组合计算',
          details: [
            { label: '目标细度模数', value: targetFinenessModulus.toFixed(2), formula: userSpecifiedFm ? `用户指定: ${targetFinenessModulus.toFixed(2)}（当前强度等级最终目标）` : `C30基准${baseFm} + (${strengthNum} - 30) × 0.02` },
            { label: '组合方式', value: fineAggregateOptimalRatio?.combinedFinenessModulus !== undefined ? `组合细度模数: ${fineAggregateOptimalRatio.combinedFinenessModulus.toFixed(3)}` : '按比例分配' }
          ]
        })
      }

      // 14. 计算容重（kg/m³）
      // materialAmounts 中可能同时存在 sand/sand_<id>、stone/stone_<id>，需排除细分键避免重复
      const density = MixDesignService_Aggregate.calculateDensity(materialAmounts)
      console.log('容重:', density)

    // 15. 计算配合比成本
    const materialCosts = {}
    let totalCost = 0
    let cementitiousCost = 0
    // ponytail: 材料可能是数组（多候选，由 optimizer 选定单个）或单数
    // 数组场景下，MixDesignOptimizer 已在阶段 3-5 把 materials.cement 替换为选中的单个材料对象
    // 但如果传进来仍是数组，取第一个（计算 stage 2 用）
    const getMat = (m) => Array.isArray(m) ? m[0] : m
    const cementMat = getMat(materials?.cement)
    const flyAshMat = getMat(materials?.flyAsh)
    const slagMat = getMat(materials?.slag)
    const lithiumSlagMat = getMat(materials?.lithiumSlag)
    const compositePowderMat = getMat(materials?.compositePowder)
    const spMat = getMat(materials?.superplasticizer)
    // 计算每种材料的成本（用量单位：kg/m³，单价单位：元/吨，所以需要除以1000）
    const cementPrice = MixDesignService_Aggregate.toNumber(cementMat?.price)
    const flyAshPrice = MixDesignService_Aggregate.toNumber(flyAshMat?.price)
    const slagPrice = MixDesignService_Aggregate.toNumber(slagMat?.price)
    const lithiumSlagPrice = MixDesignService_Aggregate.toNumber(lithiumSlagMat?.price)
    const compositePowderPrice = MixDesignService_Aggregate.toNumber(compositePowderMat?.price)
    const spPrice = MixDesignService_Aggregate.toNumber(spMat?.price)

    console.log('成本计算调试 - 材料价格:')
    console.log('  水泥:', materials?.cement?.name, '价格:', cementPrice, '用量:', materialAmounts.cement)
    console.log('  粉煤灰:', materials?.flyAsh?.name, '价格:', flyAshPrice, '用量:', materialAmounts.flyAsh)
    console.log('  矿渣粉:', materials?.slag?.name, '价格:', slagPrice, '用量:', materialAmounts.slag)
    console.log('  锂渣:', materials?.lithiumSlag?.name, '价格:', lithiumSlagPrice, '用量:', materialAmounts.lithiumSlag)
    console.log('  复合粉:', materials?.compositePowder?.name, '价格:', compositePowderPrice, '用量:', materialAmounts.compositePowder)
    console.log('  减水剂:', materials?.superplasticizer?.name, '价格:', spPrice, '用量:', materialAmounts.superplasticizer)

    if (materials) {
      if (cementMat && cementPrice > 0) {
        materialCosts.cement = (materialAmounts.cement * cementPrice) / 1000
        totalCost += materialCosts.cement
      }
      if (flyAshMat && flyAshPrice > 0) {
        materialCosts.flyAsh = (materialAmounts.flyAsh * flyAshPrice) / 1000
        totalCost += materialCosts.flyAsh
      }
      if (slagMat && slagPrice > 0) {
        materialCosts.slag = (materialAmounts.slag * slagPrice) / 1000
        totalCost += materialCosts.slag
      }
      if (lithiumSlagMat && lithiumSlagPrice > 0) {
        materialCosts.lithiumSlag = (materialAmounts.lithiumSlag * lithiumSlagPrice) / 1000
        totalCost += materialCosts.lithiumSlag
      }
      if (compositePowderMat && compositePowderPrice > 0) {
        materialCosts.compositePowder = (materialAmounts.compositePowder * compositePowderPrice) / 1000
        totalCost += materialCosts.compositePowder
      }

      // 处理多种细骨料的成本
      let sandTotalCost = 0
      if (Array.isArray(materials.sand)) {
        materials.sand.forEach(sand => {
          const sandPrice = MixDesignService_Aggregate.toNumber(sand?.price)
          if (sand && sandPrice > 0) {
            const key = `sand_${sand.id}`
            if (Number.isFinite(materialAmounts[key]) && materialAmounts[key] > 0) {
              materialCosts[key] = (materialAmounts[key] * sandPrice) / 1000
              sandTotalCost += materialCosts[key]
              totalCost += materialCosts[key]
            }
          }
        })
        materialCosts.sand = sandTotalCost
      } else if (materials.sand) {
        const sandPrice = MixDesignService_Aggregate.toNumber(materials.sand.price)
        // 检查是否为混合砂对象（包含 originalRatios）
        if (materials.sand.originalRatios && materials.sand.originalAggregateIds) {
          // 混合砂，计算每个单一砂的成本
          const sandTotalCostMixed = (materialAmounts.sand * sandPrice) / 1000
          materials.sand.originalAggregateIds.forEach((aggId, i) => {
            const ratio = materials.sand.originalRatios[i]
            const sandKey = `sand_${aggId}`
            if (Number.isFinite(materialAmounts[sandKey]) && materialAmounts[sandKey] > 0) {
              // 混合砂中各砂的成本按比例分配
              materialCosts[sandKey] = sandTotalCostMixed * ratio
            }
          })
          materialCosts.sand = sandTotalCostMixed
          totalCost += sandTotalCostMixed
        } else if (sandPrice > 0) {
          // 单一砂
          materialCosts.sand = (materialAmounts.sand * sandPrice) / 1000
          totalCost += materialCosts.sand
        }
      }

      // 处理多种粗骨料的成本
      let stoneTotalCost = 0
      if (Array.isArray(materials.stone)) {
        materials.stone.forEach(stone => {
          const stonePrice = MixDesignService_Aggregate.toNumber(stone?.price)
          if (stone && stonePrice > 0) {
            const key = `stone_${stone.id}`
            if (materialAmounts[key]) {
              materialCosts[key] = (materialAmounts[key] * stonePrice) / 1000
              stoneTotalCost += materialCosts[key]
              totalCost += materialCosts[key]
            }
          }
        })
        materialCosts.stone = stoneTotalCost
      } else if (materials.stone) {
        const stonePrice = MixDesignService_Aggregate.toNumber(materials.stone.price)
        if (stonePrice > 0) {
          materialCosts.stone = (materialAmounts.stone * stonePrice) / 1000
          totalCost += materialCosts.stone
        }
      }

      if (spMat && spPrice > 0) {
        materialCosts.superplasticizer = (materialAmounts.superplasticizer * spPrice) / 1000
        totalCost += materialCosts.superplasticizer
      }

      // 计算胶凝材料成本（水泥+粉煤灰+矿渣粉+锂渣+复合粉）
      cementitiousCost = (materialCosts.cement || 0) + (materialCosts.flyAsh || 0) + (materialCosts.slag || 0) + (materialCosts.lithiumSlag || 0) + (materialCosts.compositePowder || 0)
    } else {
      cementitiousCost = 0
    }

    console.log('材料成本:', materialCosts)
    // 防止在同时存在细/粗骨料明细键 (sand_*/stone_*) 和聚合键 (sand/stone) 时重复计入
    try {
      const hasSandDetail = Object.keys(materialCosts).some(k => k.startsWith('sand_'))
      const hasStoneDetail = Object.keys(materialCosts).some(k => k.startsWith('stone_'))
      let normalizedTotal = 0
      for (const [k, v] of Object.entries(materialCosts)) {
        if (k === 'sand' && hasSandDetail) continue
        if (k === 'stone' && hasStoneDetail) continue
        if (!Number.isFinite(v)) {
          console.error(`[成本归一化] 检测到非数字成本项: key=${k}, value=${v}，跳过该项（可能是上游计算异常）`)
          continue
        }
        normalizedTotal += v
      }
      totalCost = normalizedTotal
    } catch (e) {
      // 如果规范化失败，保留原有的 totalCost
      console.error('规范化总成本失败:', e)
    }
    console.log('总成本:', totalCost)
    console.log('细骨料分配:', fineAggregateBreakdown)
    console.log('粗骨料分配:', coarseAggregateBreakdown)

    return {
      targetStrength,
      strengthStdDev: stdDev,
      waterRatio,
      sandRatio: finalSandRatio,
      density,
      materials: materialAmounts,
      materialCosts,
      totalCost,
      cementitiousCost,
      superplasticizerDosage,
      waterReducingRate,
      influenceFactor,
      calculationMethod: calculationMethod || 'absolute',
      targetDensity: calculationMethod === 'mass' ? (targetDensity || 2400) : undefined,
      airContent: calculationMethod === 'absolute' ? usedAirContent : undefined,
      slump, // 包含用户输入的坍落度值
      fineAggregateBreakdown,
      coarseAggregateBreakdown,
      calculationSteps, // 详细计算步骤
      // 保留原始简化计算结果，用于兼容性
      original: {
        waterRatio: waterRatio,
        sandRatio: finalSandRatio,
        density: density
      }
    };
  } catch (error) {
    console.error('计算配合比失败:', error)
    throw error
  }
}

  // 计算系列配合比（批量计算）
  async calculateSeriesMixDesign(baseParams, strengthRange = null) {
    try {
      const defaultStrengths = ['C15', 'C20', 'C25', 'C30', 'C35', 'C40', 'C45', 'C50', 'C55', 'C60']
      const strengths = strengthRange || defaultStrengths
      const results = []

      // 获取基准砂率
      const baseSandRatio = baseParams.sandRatio || 35

      console.log('[系列配合比] 开始计算，sandRatio=' + baseSandRatio + ', sandCount=' + (baseParams.materials?.sand?.length || 0) + ', sandInfo=' + JSON.stringify(baseParams.materials?.sand?.map(s => ({ id: s.id, name: s.name, fm: s.finenessModulus }))))

      for (const strength of strengths) {
        // 计算当前强度等级的砂率（以 C30 为基准，每增减 5MPa 调整 1%）
        const strengthNum = parseInt(strength.replace('C', ''))
        const sandRatioAdjustment = (30 - strengthNum) // C30 为基准，每增减 5MPa 调整 1%
        const currentSandRatio = baseSandRatio + sandRatioAdjustment / 5

        // 深度拷贝 baseParams，确保 materials 对象独立，避免多次计算时相互影响
        const params = {
          ...baseParams,
          strength: strength,
          sandRatio: currentSandRatio,
          materials: JSON.parse(JSON.stringify(baseParams.materials))
        }

        // 计算当前强度的目标细度模数
        const targetFM = MixDesignService_Strength.computeTargetFinenessModulus(strength, baseParams.tempSettings)

        console.log('[系列配合比] strength=' + strength + ', targetFM=' + targetFM + ', sandInfo=' + JSON.stringify(params.materials.sand?.map(s => ({ id: s.id, fm: s.finenessModulus }))))

        // 调用单个配合比计算方法
        const result = await this.calculateMixDesign(params)

        console.log('[系列配合比] strength=' + strength + ', fineAggregateBreakdown=' + JSON.stringify(result.fineAggregateBreakdown?.map(b => ({ id: b.id, ratio: b.ratio, amount: b.amount }))))

        // 添加目标细度模数信息
        result.targetFinenessModulus = targetFM

        results.push({
          strength: strength,
          data: result
        })
      }

      return results
    } catch (error) {
      console.error('计算系列配合比失败:', error)
      throw error
    }
  }
  /**
   * 从材料 sand 对象中提取实际细度模数
   * - 单一砂对象 → 取 finenessModulus
   * - 砂数组 → 加权平均（有比例用比例，无比例等权）
   * - 混合砂对象（有 originalRatios）→ 加权平均
   * - 回退默认 2.8
   * @param {Object|Array} sand - 细骨料材料
   * @returns {number} 细度模数
   */
  _extractSandFM(sand) {
    if (!sand) return 2.8

    // 单一砂对象
    if (!Array.isArray(sand) && !sand.originalRatios) {
      return sand.finenessModulus || 2.8
    }

    // 混合砂（有 originalRatios）
    if (sand.originalRatios && sand.originalAggregateIds) {
      // 混合砂对象本身已有 finenessModulus
      if (sand.finenessModulus != null) return sand.finenessModulus
      return 2.8
    }

    // 砂数组：加权平均
    if (Array.isArray(sand)) {
      if (sand.length === 0) return 2.8
      if (sand.length === 1) return sand[0]?.finenessModulus || 2.8
      // 等权平均
      const sum = sand.reduce((s, item) => s + (item?.finenessModulus || 2.8), 0)
      return sum / sand.length
    }

    return 2.8
  }
}

module.exports = new MixDesignService_Database()