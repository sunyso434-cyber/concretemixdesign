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
const standardKnowledgeService = require('../services/StandardKnowledgeService')
const BasicMixDesignService = require('../services/BasicMixDesignService')
const SalesQuoteRuleService = require('../services/SalesQuoteRuleService')
const SalesQuoteCalculationService = require('../services/SalesQuoteCalculationService')
const SalesQuoteToolGuard = require('../services/SalesQuoteToolGuard')

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

// 缓存最近一次计算/优化结果，供 save_mix_design / save_to_basic_mix_library 使用
const lastResultCache = new Map()

// 获取或创建DeepSeek服务实例
const getDeepSeekService = async () => {
  const apiKey = await getDeepSeekApiKey()
  if (!apiKey) {
    return null
  }
  if (!deepSeekService || cachedApiKey !== apiKey) {
    deepSeekService = new DeepSeekService(apiKey)
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
      // 缓存以供后续 save 工具使用
      lastResultCache.set('lastMixDesign', mixDesignResult)
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
      lastResultCache.set('lastMixDesign', optimizeResult)
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
      const predRequiredParams = ['cementId', 'sandId', 'stoneId']
      const predMissing = predRequiredParams.filter(p => args[p] === undefined || args[p] === null)
      if (predMissing.length > 0) {
        return { success: false, missingParams: predMissing, hint: `缺少必填参数: ${predMissing.join(', ')}，请向用户追问。` }
      }
      return await XGBoostPredictionService.predict(args)
    }

    case 'check_compliance': {
      const StandardComplianceService = require('../services/StandardComplianceService')
      const apiKey = await getDeepSeekApiKey()
      const dsService = apiKey ? new DeepSeekService(apiKey) : null
      const complianceService = new StandardComplianceService(dsService)

      // 方案A：根据材料ID自动查询材料库获取性能参数
      let mixDesign = args.mixDesign || args
      const materialIds = mixDesign.materialIds
      if (materialIds) {
        const materialProperties = {}
        const queries = []
        if (materialIds.cementId) {
          queries.push(
            MaterialService.getMaterialById(materialIds.cementId).then(m => { materialProperties.cement = m })
          )
        }
        if (materialIds.sandIds?.length) {
          queries.push(
            Promise.all(materialIds.sandIds.map(id => MaterialService.getMaterialById(id)))
              .then(list => { materialProperties.sands = list.filter(Boolean) })
          )
        }
        if (materialIds.stoneIds?.length) {
          queries.push(
            Promise.all(materialIds.stoneIds.map(id => MaterialService.getMaterialById(id)))
              .then(list => { materialProperties.stones = list.filter(Boolean) })
          )
        }
        if (materialIds.flyAshId) {
          queries.push(
            MaterialService.getMaterialById(materialIds.flyAshId).then(m => { materialProperties.flyAsh = m })
          )
        }
        if (materialIds.slagId) {
          queries.push(
            MaterialService.getMaterialById(materialIds.slagId).then(m => { materialProperties.slag = m })
          )
        }
        if (materialIds.lithiumSlagId) {
          queries.push(
            MaterialService.getMaterialById(materialIds.lithiumSlagId).then(m => { materialProperties.lithiumSlag = m })
          )
        }
        if (materialIds.compositePowderId) {
          queries.push(
            MaterialService.getMaterialById(materialIds.compositePowderId).then(m => { materialProperties.compositePowder = m })
          )
        }
        if (materialIds.superplasticizerId) {
          queries.push(
            MaterialService.getMaterialById(materialIds.superplasticizerId).then(m => { materialProperties.superplasticizer = m })
          )
        }
        await Promise.all(queries)
        mixDesign = { ...mixDesign, materialProperties }
      }

      const report = await complianceService.check(mixDesign, {
        standards: args.standards || [],
        standardNames: args.standardNames || [],
        standardCategories: args.standardCategories || []
      })
      return {
        success: true,
        type: 'compliance_check',
        data: report
      }
    }

    case 'prepare_sales_quote_draft': {
      const rule = await SalesQuoteRuleService.findRuleByType(args.concreteType)
      if (!rule) {
        return { success: false, error: `没有找到${args.concreteType}的销售报价规则` }
      }
      let basicMix = await BasicMixDesignService.findDefaultMix(args.strengthGrade, args.concreteType)
      if (!basicMix) {
        // Fallback：从最近设计结果缓存中取
        const cached = lastResultCache.get('lastMixDesign')
        if (cached?.data) {
          const d = cached.data
          const bestSol = d.bestSolution || {}
          const source = bestSol.materials ? bestSol : d
          const mats = source.materials || d.materials || {}
          const selected = source.selectedMaterials || d.selectedMaterials || {}

          // 将 materials 对象转换为数组格式
          const materialsArr = []
          const findId = (key) => selected[key]?.id || null
          const findName = (key, fallback) => selected[key]?.name || selected[key] || fallback || key

          if (mats.cement != null) materialsArr.push({ materialId: findId('cement'), materialType: '水泥', materialName: findName('cement', '水泥'), usage: mats.cement })
          if (mats.flyAsh > 0) materialsArr.push({ materialId: findId('flyAsh'), materialType: '粉煤灰', materialName: findName('flyAsh', '粉煤灰'), usage: mats.flyAsh })
          if (mats.slag > 0) materialsArr.push({ materialId: findId('slag'), materialType: '矿渣粉', materialName: findName('slag', '矿渣粉'), usage: mats.slag })
          if (mats.lithiumSlag > 0) materialsArr.push({ materialId: findId('lithiumSlag'), materialType: '锂渣', materialName: findName('lithiumSlag', '锂渣'), usage: mats.lithiumSlag })
          if (mats.compositePowder > 0) materialsArr.push({ materialId: findId('compositePowder'), materialType: '复合粉', materialName: findName('compositePowder', '复合粉'), usage: mats.compositePowder })
          if (mats.superplasticizer > 0) materialsArr.push({ materialId: findId('superplasticizer'), materialType: '减水剂', materialName: findName('superplasticizer', '减水剂'), usage: mats.superplasticizer })
          if (mats.sand > 0) materialsArr.push({ materialId: findId('sand'), materialType: '细骨料', materialName: findName('sand', '细骨料'), usage: mats.sand })
          if (mats.stone > 0) materialsArr.push({ materialId: findId('stone'), materialType: '粗骨料', materialName: findName('stone', '粗骨料'), usage: mats.stone })
          if (mats.water > 0) materialsArr.push({ materialId: null, materialType: '水', materialName: '水', usage: mats.water })

          basicMix = {
            strengthGrade: args.strengthGrade,
            concreteType: args.concreteType,
            slump: d.slump || source.slump || args.slump || 180,
            materials: materialsArr
          }
        }

        if (!basicMix) {
          return {
            success: false,
            type: 'sales_quote_action_required',
            requiresUserConfirmation: true,
            action: 'select_or_create_basic_mix',
            error: `没有找到${args.strengthGrade}${args.concreteType}基础配合比。`,
            hint: '请先让用户选择已有基础配合比，或明确授权生成新配合比并确认材料后，再进入配合比设计流程。不能自动调用配合比设计工具。'
          }
        }
      }
      return {
        success: true,
        type: 'sales_quote_draft',
        data: {
          strengthGrade: args.strengthGrade,
          concreteType: args.concreteType,
          slump: args.slump || rule.suggestedSlump,
          basicMix: basicMix.toJSON(),
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
      const basicMix = basicMixRow.toJSON()
      const quote = SalesQuoteCalculationService.calculate({
        basicMix: {
          strengthGrade: basicMix.strengthGrade,
          concreteType: basicMix.concreteType,
          slump: basicMix.slump,
          materials: basicMix.materials.map(item => ({ ...item, price: pricesById.get(item.materialId) }))
        },
        pricing: args.pricing
      })
      return { success: true, type: 'sales_quote', data: quote }
    }

    case 'save_mix_design': {
      const cached = lastResultCache.get('lastMixDesign')
      if (!cached || !cached.data) {
        return { success: false, error: '没有可保存的配合比方案。请先执行配合比计算或成本优化。' }
      }
      const d = cached.data
      const bestSol = d.bestSolution || {}
      const source = d.bestSolution ? bestSol : d
      const now = new Date()
      const timestamp = now.toLocaleString('zh-CN', { hour12: false })
      const saveData = {
        name: args.name || `${d.strength || 'AI'}${d.bestSolution ? '成本优化方案' : '智能设计方案'} - ${timestamp}`,
        projectName: args.projectName || 'AI智能设计',
        strength: d.strength || source.strength,
        slump: d.slump || source.slump,
        waterRatio: source.waterRatio || d.waterRatio || bestSol.waterRatio,
        sandRatio: source.sandRatio || d.sandRatio || bestSol.sandRatio,
        density: source.density || d.density || bestSol.density,
        materials: source.materials || d.materials || bestSol.materials,
        materialCosts: source.materialCosts || d.materialCosts || bestSol.materialCosts,
        totalCost: source.totalCost || d.totalCost || bestSol.totalCost,
        materialDetails: source.selectedMaterials || d.selectedMaterials || bestSol.selectedMaterials,
        fineAggregateBreakdown: source.fineAggregateBreakdown || d.fineAggregateBreakdown || bestSol.fineAggregateBreakdown,
        coarseAggregateBreakdown: source.coarseAggregateBreakdown || d.coarseAggregateBreakdown || bestSol.coarseAggregateBreakdown,
        status: 'AI生成'
      }
      try {
        const created = await MixDesignService.createMixDesign(saveData)
        return { success: true, type: 'save_result', message: `方案「${saveData.name}」已保存`, id: created.id }
      } catch (err) {
        return { success: false, error: `保存失败: ${err.message}` }
      }
    }

    case 'save_to_basic_mix_library': {
      const cached = lastResultCache.get('lastMixDesign')
      if (!cached || !cached.data) {
        return { success: false, error: '没有可保存的配合比方案。请先执行配合比计算或成本优化。' }
      }
      const d = cached.data
      const bestSol = d.bestSolution || {}
      const source = d.bestSolution ? bestSol : d
      const materials = source.materials || d.materials || bestSol.materials
      // 将 materials 对象转换为 BasicMixDesign 所需的数组格式
      const buildMaterialsArray = (mats, selected, fineBreakdown, coarseBreakdown) => {
        const arr = []
        const findName = (key, fallback) => {
          if (selected && selected[key] && typeof selected[key] === 'object') return selected[key].name || selected[key]
          if (selected && selected[key] && typeof selected[key] === 'string') return selected[key]
          return fallback || key
        }
        const findId = (key) => {
          if (selected && selected[key] && typeof selected[key] === 'object') return selected[key].id
          return null
        }
        if (mats.cement != null) arr.push({ materialId: findId('cement'), materialType: '水泥', materialName: findName('cement', '水泥'), usage: mats.cement })
        if (mats.flyAsh != null && mats.flyAsh > 0) arr.push({ materialId: findId('flyAsh'), materialType: '粉煤灰', materialName: findName('flyAsh', '粉煤灰'), usage: mats.flyAsh })
        if (mats.slag != null && mats.slag > 0) arr.push({ materialId: findId('slag'), materialType: '矿渣粉', materialName: findName('slag', '矿渣粉'), usage: mats.slag })
        if (mats.lithiumSlag != null && mats.lithiumSlag > 0) arr.push({ materialId: findId('lithiumSlag'), materialType: '锂渣', materialName: findName('lithiumSlag', '锂渣'), usage: mats.lithiumSlag })
        if (mats.compositePowder != null && mats.compositePowder > 0) arr.push({ materialId: findId('compositePowder'), materialType: '复合粉', materialName: findName('compositePowder', '复合粉'), usage: mats.compositePowder })
        if (mats.superplasticizer != null && mats.superplasticizer > 0) arr.push({ materialId: findId('superplasticizer'), materialType: '减水剂', materialName: findName('superplasticizer', '减水剂'), usage: mats.superplasticizer })
        // 细骨料
        if (fineBreakdown && fineBreakdown.length > 0) {
          fineBreakdown.forEach((f, i) => arr.push({ materialId: f.id || null, materialType: '细骨料', materialName: f.name || `细骨料${i + 1}`, usage: f.amount }))
        } else if (mats.sand != null && mats.sand > 0) {
          arr.push({ materialId: findId('sand'), materialType: '细骨料', materialName: findName('sand', '细骨料'), usage: mats.sand })
        }
        // 粗骨料
        if (coarseBreakdown && coarseBreakdown.length > 0) {
          coarseBreakdown.forEach((c, i) => arr.push({ materialId: c.id || null, materialType: '粗骨料', materialName: c.name || `粗骨料${i + 1}`, usage: c.amount }))
        } else if (mats.stone != null && mats.stone > 0) {
          arr.push({ materialId: findId('stone'), materialType: '粗骨料', materialName: findName('stone', '粗骨料'), usage: mats.stone })
        }
        if (mats.water != null && mats.water > 0) arr.push({ materialId: null, materialType: '水', materialName: '水', usage: mats.water })
        return arr
      }
      const strength = d.strength || source.strength || 'C30'
      const slump = d.slump || source.slump || 180
      try {
        const created = await BasicMixDesignService.createBasicMixDesign({
          name: args.name || `${strength}智能设计基准 - ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
          strengthGrade: args.strengthGrade || strength,
          concreteType: args.concreteType || '普通',
          slump: args.slump != null ? args.slump : slump,
          materials: buildMaterialsArray(materials, source.selectedMaterials || d.selectedMaterials, source.fineAggregateBreakdown || d.fineAggregateBreakdown, source.coarseAggregateBreakdown || d.coarseAggregateBreakdown),
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
 * 与AI对话
 */
const chatWithAI = async (event, { message, context }) => {
  const service = await getDeepSeekService()
  if (!service) {
    throw new Error('DeepSeek API未配置，请在系统设置中配置API密钥')
  }

  try {
    // 将配合比数据注入工具执行上下文（供 run_parameter_diagnosis 使用）
    const toolExecutorWithContext = (toolName, args) => {
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

    const result = await service.chat(message, context, {
      toolExecutor: toolExecutorWithContext
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
    const toolExecutorWithContext = (toolName, args) => {
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

    const result = await service.chatStream(message, context, {
      toolExecutor: toolExecutorWithContext,
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
  clearChatHistory
}
