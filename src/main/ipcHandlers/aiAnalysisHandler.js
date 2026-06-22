/**
 * AI配合比分析 IPC Handler
 * 处理前端发送的AI分析请求
 */

const DeepSeekService = require('../services/DeepSeekService')
const SystemService = require('../services/SystemService')
const MaterialService = require('../services/MaterialService')
const MixDesignService = require('../services/MixDesignService/index')
const MixDesignOptimizer = require('../services/MixDesignOptimizer')
const ParameterDiagnosisService = require('../services/ParameterDiagnosisService')
const AnalysisClassifier = require('../services/AnalysisClassifier')
const AnalysisPreprocessor = require('../services/AnalysisPreprocessor')
const BasicMixDesignService = require('../services/BasicMixDesignService')
const SalesQuoteRuleService = require('../services/SalesQuoteRuleService')
const SalesQuoteCalculationService = require('../services/SalesQuoteCalculationService')
const SalesQuoteToolGuard = require('../services/SalesQuoteToolGuard')
const { Material } = require('../db/database')

// 从系统参数获取API密钥
const getDeepSeekApiKey = async () => {
  try {
    const result = await SystemService.getParamByName('deepseekApiKey')
    if (result && result.value) {
      return result.value
    }
    return null
  } catch (error) {
    console.error('获取DeepSeek API密钥失败:', error)
    return null
  }
}

let deepSeekService = null
let cachedApiKey = null
const CHAT_STREAM_EVENT = 'aiAnalysis:chatStream:event'

// 获取或创建DeepSeek服务实例
const getDeepSeekService = async () => {
  const apiKey = await getDeepSeekApiKey()
  if (!apiKey) {
    return null
  }
  if (!deepSeekService || cachedApiKey !== apiKey) {
    deepSeekService = new DeepSeekService(apiKey, SystemService)
    cachedApiKey = apiKey
  }
  return deepSeekService
}

/**
 * 分析配合比数据
 */
const analyzeMixDesign = async (event, { data, customPrompt, analysisModes, preprocessedData }) => {
  const service = await getDeepSeekService()
  if (!service) {
    throw new Error('DeepSeek API未配置，请在系统设置中配置API密钥')
  }

  try {
    // 第一步：参数诊断
    let diagnosisResult = null
    try {
      const mixDesigns = data.mixDesigns || []
      if (mixDesigns.length > 0) {
        // 为每个 mixDesign 构建 materialMapping（从 data 中提取）
        const globalMapping = data.materialMapping || {}
        for (const mix of mixDesigns) {
          if (!mix.materialMapping) {
            mix.materialMapping = globalMapping[mix.id] || {}
          }
        }
        diagnosisResult = await ParameterDiagnosisService.diagnose(mixDesigns)
      }
    } catch (diagError) {
      console.error('参数诊断失败:', diagError)
      // 诊断失败不阻塞主流程
    }

    // 第二步：将诊断结果注入到分析数据中
    if (diagnosisResult) {
      data = { ...data, parameterDiagnosis: diagnosisResult }
    }

    // 注入分析模式数据
    if (analysisModes && analysisModes.length > 0) {
      data.analysisModes = analysisModes
    }
    if (preprocessedData) {
      data.preprocessedData = preprocessedData
    }

    // 第三步：AI 分析
    const result = await service.analyzeMixDesign(data, customPrompt || '')

    // 将诊断结果附加到返回结果中
    if (diagnosisResult) {
      result.parameterDiagnosis = diagnosisResult
    }

    return result
  } catch (error) {
    console.error('AI分析失败:', error)
    throw error
  }
}

/**
 * 检查API配置状态
 */
const checkApiStatus = async () => {
  const apiKey = await getDeepSeekApiKey()
  return {
    configured: !!apiKey,
    message: apiKey ? 'API已配置' : 'API未配置，请在系统设置中配置DeepSeek API密钥'
  }
}

/**
 * 执行 AI 调用的工具
 * @param {string} toolName - 工具名称
 * @param {object} args - 工具参数
 * @returns {Promise<object>} 执行结果
 */
const executeToolCall = async (toolName, args) => {
  if (SalesQuoteToolGuard.shouldBlockTool(toolName, args._salesQuoteGuard)) {
    return SalesQuoteToolGuard.buildBlockedToolResult(toolName)
  }

  switch (toolName) {
    case 'run_parameter_diagnosis': {
      const mixDesigns = args._mixDesigns || []
      if (mixDesigns.length === 0) {
        return { success: false, error: '没有配合比数据可供诊断。请先在智能解析中上传数据。' }
      }
      const diagnosisResult = await ParameterDiagnosisService.diagnose(mixDesigns)
      return {
        success: true,
        type: 'parameter_diagnosis',
        data: diagnosisResult
      }
    }

    case 'list_standards': {
      const standards = await standardKnowledgeService.listStandards()
      const category = args.category ? String(args.category).replace(/类$/, '') : ''
      const filtered = category
        ? standards.filter(s => String(s.category || '').includes(category))
        : standards
      return {
        success: true,
        type: 'standards_list',
        count: filtered.length,
        standards: filtered.map(s => ({
          id: s.id,
          name: s.name,
          version: s.version,
          category: s.category || '其他',
          aliases: s.aliases || [],
          totalClauses: s.totalClauses || 0,
          quality: s.quality || null
        }))
      }
    }

    case 'list_available_materials': {
      const materials = await MaterialService.getAllMaterials()
      if (args.type) {
        const filtered = materials.filter(m => m.type === args.type)
        return { success: true, count: filtered.length, materials: filtered }
      }
      return { success: true, count: materials.length, materials }
    }

    case 'calculate_mix_design': {
      const requiredParams = ['strength', 'slump', 'cementId', 'sandIds', 'stoneIds']
      const missing = requiredParams.filter(p => args[p] === undefined || args[p] === null)
      if (missing.length > 0) {
        return { success: false, missingParams: missing, hint: `缺少必填参数: ${missing.join(', ')}，请向用户追问。` }
      }

      const allMaterials = await MaterialService.getAllMaterials()
      const findById = (id) => allMaterials.find(m => m.id === id)

      const materials = {}
      materials.cement = findById(args.cementId)
      if (!materials.cement) return { success: false, error: `水泥(ID=${args.cementId})不存在` }

      materials.sand = args.sandIds.map(id => {
        const m = findById(id); if (!m) throw new Error(`细骨料(ID=${id})不存在`); return m
      })
      materials.stone = args.stoneIds.map(id => {
        const m = findById(id); if (!m) throw new Error(`粗骨料(ID=${id})不存在`); return m
      })

      if (args.flyAshId) materials.flyAsh = findById(args.flyAshId)
      if (args.slagId) materials.slag = findById(args.slagId)
      if (args.lithiumSlagId) materials.lithiumSlag = findById(args.lithiumSlagId)
      if (args.compositePowderId) materials.compositePowder = findById(args.compositePowderId)
      if (args.superplasticizerId) materials.superplasticizer = findById(args.superplasticizerId)

      const result = await MixDesignService.calculateMixDesign({
        strength: args.strength,
        slump: args.slump,
        materials,
        flyAshDosage: args.flyAshDosage || 0,
        slagDosage: args.slagDosage || 0,
        lithiumSlagDosage: args.lithiumSlagDosage || 0,
        compositePowderDosage: args.compositePowderDosage || 0,
        sandRatio: args.sandRatio,
        calculationMethod: args.calculationMethod || 'absolute',
        targetDensity: args.targetDensity,
        airContent: args.airContent,
        tempSettings: args.tempSettings
      })

      const mixDesignResult = {
        success: true,
        type: 'mix_design',
        data: {
          strength: args.strength,
          slump: args.slump,
          materials: result.materials,
          materialCosts: result.materialCosts,
          totalCost: result.totalCost,
          waterRatio: result.waterRatio,
          sandRatio: result.sandRatio,
          density: result.density,
          targetStrength: result.targetStrength,
          calculationSteps: result.calculationSteps,
          fineAggregateBreakdown: result.fineAggregateBreakdown,
          coarseAggregateBreakdown: result.coarseAggregateBreakdown,
          selectedMaterials: materials
        }
      }
      return mixDesignResult
    }

    case 'optimize_mix_cost': {
      const requiredParams = ['strength', 'slump', 'cementId', 'sandIds', 'stoneIds']
      const missing = requiredParams.filter(p => args[p] === undefined || args[p] === null)
      if (missing.length > 0) {
        return { success: false, missingParams: missing, hint: `缺少必填参数: ${missing.join(', ')}` }
      }

      const allMaterials = await MaterialService.getAllMaterials()
      const findById = (id) => allMaterials.find(m => m.id === id)

      const constraints = {
        strength: args.strength,
        slump: args.slump,
        materials: {}
      }

      constraints.materials.cement = findById(args.cementId)
      constraints.materials.sand = args.sandIds.map(id => findById(id)).filter(Boolean)
      constraints.materials.stone = args.stoneIds.map(id => findById(id)).filter(Boolean)
      if (args.flyAshIds) constraints.materials.flyAsh = args.flyAshIds.map(id => findById(id)).filter(Boolean)
      if (args.slagIds) constraints.materials.slag = args.slagIds.map(id => findById(id)).filter(Boolean)
      if (args.lithiumSlagIds) constraints.materials.lithiumSlag = args.lithiumSlagIds.map(id => findById(id)).filter(Boolean)
      if (args.compositePowderIds) constraints.materials.compositePowder = args.compositePowderIds.map(id => findById(id)).filter(Boolean)
      if (args.superplasticizerIds) constraints.materials.superplasticizer = args.superplasticizerIds.map(id => findById(id)).filter(Boolean)

      const userLimits = {}
      if (args.flyAshRange) userLimits.flyAshRange = args.flyAshRange
      if (args.slagRange) userLimits.slagRange = args.slagRange
      if (args.lithiumSlagRange) userLimits.lithiumSlagRange = args.lithiumSlagRange
      if (args.compositePowderRange) userLimits.compositePowderRange = args.compositePowderRange
      if (args.gridStep) userLimits.gridStep = args.gridStep
      if (args.waterRatioRange) userLimits.waterRatioRange = args.waterRatioRange

      if (args.tempSettings) {
        constraints.tempSettings = args.tempSettings
      }

      const optimizer = new MixDesignOptimizer()
      const result = await optimizer.optimizeMixDesign({ constraints, userLimits })

      const optimizeResult = {
        success: true,
        type: 'optimization',
        data: {
          strength: args.strength,
          slump: args.slump,
          bestSolution: {
            materials: result.bestSolution.materials,
            materialCosts: result.bestSolution.materialCosts,
            totalCost: result.bestSolution.totalCost,
            cementitiousCost: result.bestSolution.cementitiousCost,
            waterRatio: result.bestSolution.waterRatio,
            sandRatio: result.bestSolution.sandRatio,
            density: result.bestSolution.density,
            selectedMaterials: {
              cement: constraints.materials.cement,
              sand: constraints.materials.sand,
              stone: constraints.materials.stone,
              ...(result.bestSolution.selectedMaterials || {})
            },
            fineAggregateBreakdown: result.bestSolution.fineAggregateBreakdown,
            coarseAggregateBreakdown: result.bestSolution.coarseAggregateBreakdown,
            calculationSteps: result.bestSolution.calculationSteps,
            params: result.bestSolution.params
          },
          alternatives: (result.alternatives || []).map(alt => ({
            materials: alt.materials,
            materialCosts: alt.materialCosts,
            totalCost: alt.totalCost,
            waterRatio: alt.waterRatio,
            sandRatio: alt.sandRatio,
            params: alt.params
          })),
          totalEvaluated: result.totalEvaluated,
          historyId: result.historyId
        }
      }
      return optimizeResult
    }

    case 'compare_materials': {
      const requiredParams = ['strength', 'slump', 'compareType', 'baseParams', 'candidateIds']
      const missing = requiredParams.filter(p => args[p] === undefined || args[p] === null)
      if (missing.length > 0) {
        return { success: false, missingParams: missing, hint: `缺少必填参数: ${missing.join(', ')}` }
      }

      const allMaterials = await MaterialService.getAllMaterials()
      const findById = (id) => allMaterials.find(m => m.id === id)
      const bp = args.baseParams

      const compareKey = ({ cement: 'cement', flyAsh: 'flyAsh', slag: 'slag', lithiumSlag: 'lithiumSlag', compositePowder: 'compositePowder', superplasticizer: 'superplasticizer', sand: 'sand', stone: 'stone' })[args.compareType]

      const buildMaterials = (candidateId) => {
        const materials = {}

        if (compareKey === 'cement') {
          materials.cement = findById(candidateId)
        } else {
          materials.cement = bp.cementId ? findById(bp.cementId) : undefined
        }

        if (compareKey === 'sand') {
          materials.sand = [findById(candidateId)].filter(Boolean)
        } else {
          materials.sand = bp.sandIds ? bp.sandIds.map(id => findById(id)).filter(Boolean) : undefined
        }

        if (compareKey === 'stone') {
          materials.stone = [findById(candidateId)].filter(Boolean)
        } else {
          materials.stone = bp.stoneIds ? bp.stoneIds.map(id => findById(id)).filter(Boolean) : undefined
        }

        if (compareKey === 'flyAsh') materials.flyAsh = findById(candidateId)
        else if (bp.flyAshId) materials.flyAsh = findById(bp.flyAshId)

        if (compareKey === 'slag') materials.slag = findById(candidateId)
        else if (bp.slagId) materials.slag = findById(bp.slagId)

        if (compareKey === 'lithiumSlag') materials.lithiumSlag = findById(candidateId)
        else if (bp.lithiumSlagId) materials.lithiumSlag = findById(bp.lithiumSlagId)

        if (compareKey === 'compositePowder') materials.compositePowder = findById(candidateId)
        else if (bp.compositePowderId) materials.compositePowder = findById(bp.compositePowderId)

        if (compareKey === 'superplasticizer') materials.superplasticizer = findById(candidateId)
        else if (bp.superplasticizerId) materials.superplasticizer = findById(bp.superplasticizerId)

        return materials
      }

      const results = []
      for (const candidateId of args.candidateIds) {
        const materials = buildMaterials(candidateId)
        const result = await MixDesignService.calculateMixDesign({
          strength: args.strength,
          slump: args.slump,
          materials,
          flyAshDosage: bp.flyAshDosage || 0,
          slagDosage: bp.slagDosage || 0,
          lithiumSlagDosage: bp.lithiumSlagDosage || 0,
          compositePowderDosage: bp.compositePowderDosage || 0,
          sandRatio: bp.sandRatio,
          calculationMethod: bp.calculationMethod || 'absolute',
          tempSettings: bp.tempSettings
        })
        const candidateMaterial = findById(candidateId)
        results.push({
          materialId: candidateId,
          materialName: candidateMaterial?.name || `ID=${candidateId}`,
          targetStrength: result.targetStrength,
          totalCost: result.totalCost,
          waterRatio: result.waterRatio,
          sandRatio: result.sandRatio,
          cementitiousAmount: (result.materials?.cement || 0) + (result.materials?.flyAsh || 0) + (result.materials?.slag || 0) + (result.materials?.lithiumSlag || 0) + (result.materials?.compositePowder || 0)
        })
      }

      return { success: true, type: 'material_compare', data: { compareType: args.compareType, results } }
    }

    case 'predict_performance': {
      const XGBoostPredictionService = require('../services/XGBoostPredictionService')
      const MixFormatConverter = require('../services/MixFormatConverter')
      const predRequiredParams = ['cementId', 'sandId', 'stoneId']
      const predMissing = predRequiredParams.filter(p => args[p] === undefined || args[p] === null)
      if (predMissing.length > 0) {
        return { success: false, missingParams: predMissing, hint: `缺少必填参数: ${predMissing.join(', ')}，请向用户追问。` }
      }
      // 如果传入配合比计算结果的 materials 格式，自动转换为模型所需参数格式
      if (args.materials && !args.cementAmount) {
        const converted = MixFormatConverter.mixDesignResultToPredictionInput(args)
        args = { ...args, ...converted }
      }
      return await XGBoostPredictionService.predict(args)
    }

    case 'prepare_sales_quote_draft': {
      let rule = await SalesQuoteRuleService.findRuleByType(args.concreteType)
      if (!rule) {
        // 精确匹配失败，尝试关键词模糊匹配
        rule = await SalesQuoteRuleService.matchRuleByText(args.concreteType)
      }
      if (!rule) {
        return { success: false, error: `没有找到"${args.concreteType}"的销售报价规则，当前可用类型：普通、抗渗、早强` }
      }
      // 用 rule 中的 concreteType 去查找基准配合比（避免 Agent 传入 '普通混凝土' 等非标准值导致匹配失败）
      let basicMix = await BasicMixDesignService.findDefaultMix(args.strengthGrade, rule.concreteType)
      if (!basicMix) {
        // Fallback：从方案库中取最近一条已确认的方案
        try {
          const recentSchemes = await MixDesignService.getAllMixDesigns({ excludeDrafts: true })
          if (recentSchemes && recentSchemes.length > 0) {
            const d = recentSchemes[0].toJSON()
            const mats = d.materials || {}
            const selected = d.materialDetails || {}
            const materialsArr = []
            const findId = (key) => selected[key]?.id || null
            const findName = (key, fb) => selected[key]?.name || selected[key] || fb || key
            if (mats.cement != null) materialsArr.push({ materialId: findId('cement'), materialType: '水泥', materialName: findName('cement', '水泥'), usage: mats.cement })
            if (mats.flyAsh > 0) materialsArr.push({ materialId: findId('flyAsh'), materialType: '粉煤灰', materialName: findName('flyAsh', '粉煤灰'), usage: mats.flyAsh })
            if (mats.slag > 0) materialsArr.push({ materialId: findId('slag'), materialType: '矿渣粉', materialName: findName('slag', '矿渣粉'), usage: mats.slag })
            if (mats.lithiumSlag > 0) materialsArr.push({ materialId: findId('lithiumSlag'), materialType: '锂渣', materialName: findName('lithiumSlag', '锂渣'), usage: mats.lithiumSlag })
            if (mats.compositePowder > 0) materialsArr.push({ materialId: findId('compositePowder'), materialType: '复合粉', materialName: findName('compositePowder', '复合粉'), usage: mats.compositePowder })
            if (mats.superplasticizer > 0) materialsArr.push({ materialId: findId('superplasticizer'), materialType: '减水剂', materialName: findName('superplasticizer', '减水剂'), usage: mats.superplasticizer })
            if (mats.sand > 0) materialsArr.push({ materialId: findId('sand'), materialType: '细骨料', materialName: findName('sand', '细骨料'), usage: mats.sand })
            if (mats.stone > 0) materialsArr.push({ materialId: findId('stone'), materialType: '粗骨料', materialName: findName('stone', '粗骨料'), usage: mats.stone })
            if (mats.water > 0) materialsArr.push({ materialId: null, materialType: '水', materialName: '水', usage: mats.water })
            basicMix = { strengthGrade: args.strengthGrade, concreteType: rule.concreteType, slump: d.slump || args.slump || 180, materials: materialsArr, toJSON() { return this } }
          }
        } catch (e) {
          console.warn('[Fallback] 从方案库获取最近方案失败:', e.message)
        }
      }
      if (!basicMix) {
        return {
          success: false,
          type: 'sales_quote_action_required',
          requiresUserConfirmation: true,
          action: 'select_or_create_basic_mix',
          error: `没有找到${args.strengthGrade}${rule.concreteType}基础配合比。`,
          hint: '请先让用户选择已有基础配合比，或明确授权生成新配合比并确认材料后，再进入配合比设计流程。不能自动调用配合比设计工具。'
        }
      }

      // 补充材料ID和价格（处理旧数据中缺少这些信息的情况）
      const basicMixData = basicMix.toJSON()
      if (basicMixData.materials && Array.isArray(basicMixData.materials)) {
        const allMaterials = await MaterialService.getAllMaterials()
        const materialMap = new Map(allMaterials.map(m => [m.id, m]))
        const nameToMaterial = new Map()
        allMaterials.forEach(m => {
          nameToMaterial.set(m.name, m)
          if (m.type) nameToMaterial.set(`${m.type}_${m.name}`, m)
        })

        basicMixData.materials = basicMixData.materials.map(mat => {
          // 如果已经有materialId和price，直接返回
          if (mat.materialId && mat.price != null) return mat

          // 尝试通过materialId补充price
          if (mat.materialId && materialMap.has(mat.materialId)) {
            const fullMat = materialMap.get(mat.materialId)
            return { ...mat, price: fullMat.price }
          }

          // 尝试通过名称匹配补充ID和price
          const matched = nameToMaterial.get(mat.materialName) ||
                          nameToMaterial.get(`${mat.materialType}_${mat.materialName}`)
          if (matched) {
            return { ...mat, materialId: matched.id, price: matched.price }
          }

          return mat
        })
      }

      return {
        success: true,
        type: 'sales_quote_draft',
        data: {
          strengthGrade: args.strengthGrade,
          concreteType: args.concreteType,
          slump: args.slump || rule.suggestedSlump,
          basicMix: basicMixData,
          rule: rule.toJSON(),
          explanationPrompt: `请根据混凝土类型"${args.concreteType}"向客户解释报价构成，包括：1) 该类型混凝土的特点和适用场景；2) 成本主要提升点；3) 生产技术难点。需要通俗易懂，适合向客户说明。`,
          suggestedPricing: {
            marketAdjustmentRate: 0,
            manufacturingFee: rule.suggestedManufacturingFee,
            technicalServiceFee: rule.suggestedTechnicalServiceFee,
            profitRate: rule.suggestedProfitRate,
            transportDistance: rule.suggestedTransportDistance,
            transportUnitPrice: rule.suggestedTransportUnitPrice,
            vatRate: rule.vatRate || 0.13,
            quoteRangeDelta: rule.quoteRangeDelta
          }
        }
      }
    }

    case 'calculate_sales_quote': {
      const basicMixRow = await BasicMixDesignService.getBasicMixDesignById(args.basicMixId)
      if (!basicMixRow) return { success: false, error: '基础配合比不存在' }
      const allMaterials = await MaterialService.getAllMaterials()
      const pricesById = new Map(allMaterials.map(material => [material.id, material.price]))
      // 建立名称到材料的映射，用于补充缺失的materialId和price
      const nameToMaterial = new Map()
      allMaterials.forEach(m => {
        nameToMaterial.set(m.name, m)
        if (m.type) nameToMaterial.set(`${m.type}_${m.name}`, m)
      })
      // 水的 materialId 可能为 null，从材料库中查找默认水材料的价格
      const waterMaterial = allMaterials.find(m => m.type === '其他' && m.name === '水')
      const waterPrice = waterMaterial?.price ?? 0
      const basicMix = basicMixRow.toJSON()
      const quote = SalesQuoteCalculationService.calculate({
        basicMix: {
          strengthGrade: basicMix.strengthGrade,
          concreteType: basicMix.concreteType,
          slump: basicMix.slump,
          materials: basicMix.materials.map(item => {
            // 如果已经有price，直接返回
            if (item.price != null) return item

            // 通过materialId获取price
            if (item.materialId != null) {
              const lookedUpPrice = pricesById.get(item.materialId)
              if (lookedUpPrice != null) {
                return { ...item, price: lookedUpPrice }
              }
              // 查不到价，继续尝试名称匹配
            }

            // 水特殊处理
            if (item.materialType === '水') {
              return { ...item, price: waterPrice }
            }

            // 通过名称匹配补充materialId和price
            const matched = nameToMaterial.get(item.materialName) ||
                            nameToMaterial.get(`${item.materialType}_${item.materialName}`)
            if (matched) {
              return { ...item, materialId: matched.id, price: matched.price }
            }

            return item
          })
        },
        pricing: args.pricing
      })
      return { success: true, type: 'sales_quote', data: quote }
    }

    case 'save_mix_design': {
      // 从方案ID确认方案（新逻辑：草稿确认模式）
      if (args.schemeId) {
        try {
          const existing = await MixDesignService.getMixDesignById(args.schemeId)
          if (!existing) {
            return { success: false, error: `方案ID ${args.schemeId} 不存在` }
          }
          const updateData = { status: '已确认' }
          if (args.name) updateData.name = args.name
          if (args.projectName) updateData.projectName = args.projectName
          await MixDesignService.updateMixDesign(args.schemeId, updateData)
          return { success: true, type: 'save_result', message: `方案「${args.name || existing.name}」已确认保存`, id: args.schemeId }
        } catch (err) {
          return { success: false, error: `确认失败: ${err.message}` }
        }
      }
      // 兼容旧路径：如果没有schemeId，尝试从方案库取最近的草稿确认
      try {
        const drafts = await MixDesignService.getAllMixDesigns({ onlyDrafts: true })
        if (drafts && drafts.length > 0) {
          const latest = drafts[0]
          const updateData = { status: '已确认' }
          if (args.name) updateData.name = args.name
          if (args.projectName) updateData.projectName = args.projectName
          await MixDesignService.updateMixDesign(latest.id, updateData)
          return { success: true, type: 'save_result', message: `方案「${args.name || latest.name}」已确认保存`, id: latest.id }
        }
      } catch (e) {
        console.warn('[save_mix_design] 兼容路径失败:', e.message)
      }
      return { success: false, error: '没有可保存的配合比方案。请先执行配合比计算。' }
    }

    case 'save_to_basic_mix_library': {
      // 从方案ID读取方案数据（从数据库读取，不再依赖缓存）
      let scheme = null
      if (args.schemeId) {
        scheme = await MixDesignService.getMixDesignById(args.schemeId)
      } else {
        // 兼容：取最近一条已确认的方案
        const recent = await MixDesignService.getAllMixDesigns({ excludeDrafts: true })
        if (recent && recent.length > 0) scheme = recent[0]
      }
      if (!scheme) {
        return { success: false, error: '没有可推广的配合比方案。请先执行配合比计算并确认。' }
      }
      const d = scheme.toJSON ? scheme.toJSON() : scheme
      const materials = d.materials || {}
      const selected = d.materialDetails || {}
      const fineBreakdown = d.fineAggregateBreakdown || []
      const coarseBreakdown = d.coarseAggregateBreakdown || []
      // 细/粗骨料价格辅助查询（materialDetails中sand/stone可能是数组）
      const findAggPrice = (key, aggId) => {
        const val = selected[key]
        if (!val || aggId == null) return undefined
        const arr = Array.isArray(val) ? val : [val]
        const found = arr.find(a => String(a.id) === String(aggId))
        return found ?.price
      }
      const findMatPrice = (key) => {
        if (selected && selected[key] && typeof selected[key] === 'object') return selected[key].price
        return undefined
      }
      // 将 materials 对象转换为 BasicMixDesign 所需的数组格式
      const buildMaterialsArray = async (mats, sel, fineBd, coarseBd) => {
        const arr = []
        const findName = (key, fallback) => {
          if (sel && sel[key] && typeof sel[key] === 'object') return sel[key].name || sel[key]
          if (sel && sel[key] && typeof sel[key] === 'string') return sel[key]
          return fallback || key
        }
        const findId = (key) => {
          if (sel && sel[key] && typeof sel[key] === 'object') return sel[key].id
          return null
        }
        if (mats.cement != null) arr.push({ materialId: findId('cement'), materialType: '水泥', materialName: findName('cement', '水泥'), usage: mats.cement, price: findMatPrice('cement') })
        if (mats.flyAsh != null && mats.flyAsh > 0) arr.push({ materialId: findId('flyAsh'), materialType: '粉煤灰', materialName: findName('flyAsh', '粉煤灰'), usage: mats.flyAsh, price: findMatPrice('flyAsh') })
        if (mats.slag != null && mats.slag > 0) arr.push({ materialId: findId('slag'), materialType: '矿渣粉', materialName: findName('slag', '矿渣粉'), usage: mats.slag, price: findMatPrice('slag') })
        if (mats.lithiumSlag != null && mats.lithiumSlag > 0) arr.push({ materialId: findId('lithiumSlag'), materialType: '锂渣', materialName: findName('lithiumSlag', '锂渣'), usage: mats.lithiumSlag, price: findMatPrice('lithiumSlag') })
        if (mats.compositePowder != null && mats.compositePowder > 0) arr.push({ materialId: findId('compositePowder'), materialType: '复合粉', materialName: findName('compositePowder', '复合粉'), usage: mats.compositePowder, price: findMatPrice('compositePowder') })
        if (mats.superplasticizer != null && mats.superplasticizer > 0) arr.push({ materialId: findId('superplasticizer'), materialType: '减水剂', materialName: findName('superplasticizer', '减水剂'), usage: mats.superplasticizer, price: findMatPrice('superplasticizer') })
        // 细骨料
        if (fineBd && fineBd.length > 0) {
          fineBd.forEach((f, i) => arr.push({ materialId: f.id || null, materialType: '细骨料', materialName: f.name || `细骨料${i + 1}`, usage: f.amount, price: findAggPrice('sand', f.id) }))
        } else if (mats.sand != null && mats.sand > 0) {
          arr.push({ materialId: findId('sand'), materialType: '细骨料', materialName: findName('sand', '细骨料'), usage: mats.sand, price: findAggPrice('sand', findId('sand')) })
        }
        // 粗骨料
        if (coarseBd && coarseBd.length > 0) {
          coarseBd.forEach((c, i) => arr.push({ materialId: c.id || null, materialType: '粗骨料', materialName: c.name || `粗骨料${i + 1}`, usage: c.amount, price: findAggPrice('stone', c.id) }))
        } else if (mats.stone != null && mats.stone > 0) {
          arr.push({ materialId: findId('stone'), materialType: '粗骨料', materialName: findName('stone', '粗骨料'), usage: mats.stone, price: findAggPrice('stone', findId('stone')) })
        }
        if (mats.water != null && mats.water > 0) {
          const waterMat = await Material.findOne({ where: { type: '其他', name: '水' } })
          arr.push({ materialId: waterMat?.id || null, materialType: '水', materialName: '水', usage: mats.water, price: waterMat?.price })
        }
        return arr
      }
      const strength = d.strength || 'C30'
      const slump = d.slump || 180
      try {
        const created = await BasicMixDesignService.createBasicMixDesign({
          name: args.name || `${strength}智能设计基准 - ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
          strengthGrade: args.strengthGrade || strength,
          concreteType: args.concreteType || '普通',
          slump: args.slump != null ? args.slump : slump,
          materials: await buildMaterialsArray(materials, selected, fineBreakdown, coarseBreakdown),
          isDefault: args.isDefault || false,
          remarks: args.remarks || '',
          source: '智能设计保存'
        })
        return { success: true, type: 'save_result', message: `方案「${args.name || strength}」已保存到基础配合比库`, id: created.id }
      } catch (err) {
        return { success: false, error: `保存到基础配合比库失败: ${err.message}` }
      }
    }

    case 'create_sales_quote_rule': {
      const rule = await SalesQuoteRuleService.createRule(args)
      return { success: true, data: rule }
    }

    default:
      return { success: false, error: `未知工具: ${toolName}` }
  }
}

/**
 * 创建工具执行器（优先使用 SkillExecutor）
 * @param {string} message - 用户消息
 * @param {object} context - 上下文
 * @returns {Function} 工具执行函数
 */
const createToolExecutor = (message, context) => {
  const skillExecutor = DeepSeekService.getSkillExecutor()

  // 如果有 SkillExecutor，使用它
  if (skillExecutor) {
    return async (toolName, args) => {
      // 注入额外上下文
      const enrichedArgs = { ...args }
      enrichedArgs._salesQuoteGuard = {
        isSalesQuoteIntent: SalesQuoteToolGuard.isSalesQuoteIntent(message),
        userApprovedMixDesignForQuote: SalesQuoteToolGuard.hasExplicitMixDesignAuthorization(message)
      }
      if (context && context.mixDesigns) {
        enrichedArgs._mixDesigns = context.mixDesigns
      }

      // 使用 SkillExecutor 执行
      return skillExecutor.execute(toolName, enrichedArgs)
    }
  }

  // 否则使用旧的 executeToolCall
  return (toolName, args) => {
    const enrichedArgs = { ...args }
    enrichedArgs._salesQuoteGuard = {
      isSalesQuoteIntent: SalesQuoteToolGuard.isSalesQuoteIntent(message),
      userApprovedMixDesignForQuote: SalesQuoteToolGuard.hasExplicitMixDesignAuthorization(message)
    }
    if (context && context.mixDesigns) {
      enrichedArgs._mixDesigns = context.mixDesigns
    }
    return executeToolCall(toolName, enrichedArgs)
  }
}

/**
 * 与AI对话
 */
const chatWithAI = async (event, { message, context }) => {
  const service = await getDeepSeekService()
  if (!service) {
    throw new Error('DeepSeek API未配置，请在系统设置中配置API密钥')
  }

  try {
    const toolExecutor = createToolExecutor(message, context)
    const result = await service.chat(message, context, {
      toolExecutor
    })
    return result
  } catch (error) {
    console.error('AI对话失败:', error)
    throw error
  }
}

const chatWithAIStream = async (event, { requestId, message, context }) => {
  const service = await getDeepSeekService()
  if (!service) {
    throw new Error('DeepSeek API鏈厤缃紝璇峰湪绯荤粺璁剧疆涓厤缃瓵PI瀵嗛挜')
  }

  const sendStreamEvent = (payload) => {
    event.sender.send(CHAT_STREAM_EVENT, {
      requestId,
      ...payload
    })
  }

  try {
    const toolExecutor = createToolExecutor(message, context)
    const result = await service.chatStream(message, context, {
      toolExecutor,
      onEvent: sendStreamEvent
    })

    sendStreamEvent({ type: 'done', result })
    return result
  } catch (error) {
    sendStreamEvent({ type: 'error', error: error.message })
    console.error('AI娴佸紡瀵硅瘽澶辫触:', error)
    throw error
  }
}

/**
 * 清空对话历史
 */
const clearChatHistory = async () => {
  const service = await getDeepSeekService()
  if (service) {
    service.clearHistory()
  }
  return { success: true }
}

/**
 * 分析预处理：识别分析类型 + 数值预处理
 */
const prepareAnalysis = async (event, { data, customPrompt, selectedContrastMaterials }) => {
  const mixDesigns = data.mixDesigns || []
  const materialMapping = data.materialMapping || {}

  if (mixDesigns.length < 2) {
    return { modes: [], preprocessedData: null }
  }

  const classifier = new AnalysisClassifier()
  const classification = classifier.classify(mixDesigns, materialMapping, customPrompt || '', {
    selectedContrastMaterials
  })

  let preprocessedData = null
  if (classification.modes.length > 0) {
    const preprocessor = new AnalysisPreprocessor()
    preprocessedData = await preprocessor.preprocess(classification, mixDesigns, materialMapping)
  }

  return {
    modes: classification.modes,
    param_trend: classification.param_trend,
    material_contrast: classification.material_contrast,
    preprocessedData
  }
}

/**
 * 注册IPC处理器
 */
const registerHandlers = (ipcMain) => {
  ipcMain.handle('aiAnalysis:analyze', analyzeMixDesign)
  ipcMain.handle('analysis:prepare', prepareAnalysis)
  ipcMain.handle('aiAnalysis:checkStatus', checkApiStatus)
  ipcMain.handle('aiAnalysis:chat', chatWithAI)
  ipcMain.handle('aiAnalysis:chatStream', chatWithAIStream)
  ipcMain.handle('aiAnalysis:clearHistory', clearChatHistory)
  console.log('AI Analysis IPC handlers registered')
}

// 自动注册处理器
const { ipcMain } = require('electron')
registerHandlers(ipcMain)

module.exports = {
  register: registerHandlers,
  analyzeMixDesign,
  checkApiStatus,
  chatWithAI,
  chatWithAIStream,
  clearChatHistory,
  executeToolCall
}
