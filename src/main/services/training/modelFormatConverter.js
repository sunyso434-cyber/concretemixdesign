/**
 * modelFormatConverter.js
 * 将 XGBoost 原生 JSON（Booster.saveModel('json')）转换为自定义格式
 * 兼容 XGBoostPredictionService._predictOne 的节点遍历逻辑
 *
 * XGBoost 原生格式（saveModel('json')）使用数组索引表示树：
 *   left_children[i], right_children[i], split_indices[i],
 *   split_conditions[i], default_left[i], base_weights[i]
 *
 * 自定义格式每棵树为节点数组（按 nodeId 索引）：
 *   [{leaf: val} | {split_feature, split_condition, left, right, missing}]
 */

/**
 * 转换单颗树：从原生数组格式 → 自定义节点数组格式
 * @param {Object} nativeTree - XGBoost 原生树对象
 * @returns {Array} 节点数组（索引即 nodeId）
 */
function convertTree(nativeTree) {
  const numNodes = nativeTree.left_children.length
  const nodes = new Array(numNodes)

  for (let i = 0; i < numNodes; i++) {
    const isLeaf = nativeTree.left_children[i] === -1 && nativeTree.right_children[i] === -1

    if (isLeaf) {
      // 叶节点：base_weights[i] 即为叶子贡献值
      nodes[i] = { leaf: nativeTree.base_weights[i] }
    } else {
      // 决策节点
      // default_left[i] = 1 表示缺失值走左子，= 0 表示走右子
      nodes[i] = {
        split_feature: nativeTree.split_indices[i],
        split_condition: nativeTree.split_conditions[i],
        left: nativeTree.left_children[i],
        right: nativeTree.right_children[i],
        missing: nativeTree.default_left[i]
          ? nativeTree.left_children[i]
          : nativeTree.right_children[i]
      }
    }
  }

  return nodes
}

/**
 * 从原生 XGBoost JSON 提取 base_score
 * @param {Object} nativeJson - XGBoost 原生 JSON
 * @returns {number}
 */
function extractBaseScore(nativeJson) {
  const bsStr = nativeJson.learner?.learner_model_param?.base_score
  if (!bsStr) return 0.5
  const cleaned = String(bsStr).replace(/[\[\]]/g, '')
  const val = parseFloat(cleaned)
  return Number.isFinite(val) ? val : 0.5
}

/**
 * 主转换函数：将完整 XGBoost 原生 JSON 转为自定义模型格式
 *
 * @param {Object} nativeJson - Booster.saveModel('json') 的输出
 * @param {Object} options - 额外元数据
 * @param {string} options.target - 目标名称（如 'strength_28d'）
 * @param {string[]} options.feature_names - 特征名称列表
 * @param {number} options.learning_rate - 学习率（原生 JSON 不存储，需外部传入）
 * @param {Object} [options.feature_stats] - 训练集特征统计
 * @param {Object} [options.training_info] - 训练元信息
 * @returns {Object} 自定义格式模型对象
 */
function convertXGBoostModel(nativeJson, options) {
  const {
    target,
    feature_names,
    learning_rate,
    feature_stats,
    training_info
  } = options

  const nativeTrees = nativeJson.learner?.gradient_booster?.model?.trees
  if (!nativeTrees || !Array.isArray(nativeTrees)) {
    throw new Error('无效的 XGBoost 原生 JSON: 缺少 gradient_booster.model.trees')
  }

  const convertedTrees = nativeTrees.map(tree => convertTree(tree))

  const baseScore = extractBaseScore(nativeJson)

  const result = {
    model_version: '1.0',
    target,
    feature_config_version: '1.0',
    feature_names,
    trees: convertedTrees,
    learning_rate: learning_rate ?? 0.1,
    base_score: Math.round(baseScore * 10000) / 10000,
    feature_stats: feature_stats || {},
    training_info: training_info || {
      samples: 0,
      date: new Date().toISOString().split('T')[0]
    }
  }

  return result
}

/**
 * 验证转换后的模型是否能被 XGBoostPredictionService 正常加载
 * 检查：非叶节点必须都有 split_feature
 * @param {Object} model - 自定义格式模型
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateConvertedModel(model) {
  const errors = []

  if (!model.trees || !Array.isArray(model.trees)) {
    errors.push('模型缺少 trees 数组')
    return { valid: false, errors }
  }

  if (!Array.isArray(model.feature_names)) {
    errors.push('模型缺少 feature_names')
  }

  if (typeof model.base_score !== 'number') {
    errors.push('模型缺少 base_score')
  }

  for (let t = 0; t < model.trees.length; t++) {
    const tree = model.trees[t]
    for (let n = 0; n < tree.length; n++) {
      const node = tree[n]
      if (node.leaf === undefined && node.split_feature === undefined) {
        errors.push(`树[${t}]节点[${n}]既不是叶节点也没有 split_feature`)
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

module.exports = {
  convertXGBoostModel,
  validateConvertedModel
}
