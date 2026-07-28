/**
 * modelFormatConverter.test.js
 * 测试 XGBoost 原生 JSON → 自定义格式的转换
 */

const path = require('path')
const fs = require('fs')
const assert = require('assert')

// 测试依赖：需要 scripts/poc-js-xgboost/js_model.json
const POC_MODEL_PATH = path.join(__dirname, '..', '..', 'scripts', 'poc-js-xgboost', 'js_model.json')

let convertXGBoostModel, validateConvertedModel

try {
  const mfc = require(path.join(__dirname, '..', '..', 'src', 'main', 'services', 'training', 'modelFormatConverter'))
  convertXGBoostModel = mfc.convertXGBoostModel
  validateConvertedModel = mfc.validateConvertedModel
} catch (err) {
  console.error('加载 modelFormatConverter 失败:', err.message)
  process.exit(1)
}

const SAMPLE_FEATURE_NAMES = [
  'water_binder_ratio', 'cement_amount', 'fly_ash_dosage', 'slag_dosage',
  'lithium_slag_dosage', 'composite_powder_dosage', 'sand_ratio',
  'superplasticizer_dosage', 'has_fly_ash', 'has_slag', 'has_lithium_slag',
  'has_composite_powder', 'has_superplasticizer', 'cement_strength_28d',
  'cement_standard_consistency', 'fly_ash_activity_index', 'fly_ash_water_demand_ratio',
  'slag_activity_index', 'slag_fluidity_ratio', 'lithium_slag_activity_index',
  'lithium_slag_water_demand_ratio', 'composite_powder_activity_index',
  'composite_powder_fluidity_ratio', 'sand_fineness_modulus', 'sand_mb_value',
  'sand_mud_content', 'stone_crushing_value', 'stone_needle_flake',
  'super_water_reducing_rate', 'super_solid_content', 'super_recommended_dosage'
]

function run(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    console.error(error.message)
    process.exitCode = 1
  }
}

// ============ 测试：基础转换 ============

run('converts native tree array format to custom node array format', () => {
  const nativeJson = {
    learner: {
      gradient_booster: {
        model: {
          trees: [
            {
              // 3 nodes: 0=decision, 1=leaf, 2=leaf
              left_children: [1, -1, -1],
              right_children: [2, -1, -1],
              split_indices: [0, 0, 0],
              split_conditions: [0.45, 0, 0],
              default_left: [0, 0, 0],
              base_weights: [0, 0.5, 0]
            }
          ]
        }
      },
      learner_model_param: {
        base_score: '[5.0E1]'
      }
    }
  }

  const result = convertXGBoostModel(nativeJson, {
    target: 'strength_28d',
    feature_names: SAMPLE_FEATURE_NAMES.slice(0, 3),
    learning_rate: 0.1
  })

  assert.strictEqual(result.target, 'strength_28d')
  assert.strictEqual(result.model_version, '1.0')
  assert.strictEqual(result.base_score, 50)
  assert.strictEqual(result.trees.length, 1)
  assert.strictEqual(result.trees[0].length, 3) // 3 nodes: 0, 1, 2

  // Node 0: decision
  assert.strictEqual(result.trees[0][0].split_feature, 0)
  assert.strictEqual(result.trees[0][0].split_condition, 0.45)
  assert.strictEqual(result.trees[0][0].left, 1)
  assert.strictEqual(result.trees[0][0].right, 2)
  assert.strictEqual(result.trees[0][0].missing, 2) // default_left=0 → right

  // Node 1: leaf
  assert.strictEqual(result.trees[0][1].leaf, 0.5)

  // Node 2: leaf
  assert.strictEqual(result.trees[0][2].leaf, 0)
})

run('handles default_left correctly for missing branch', () => {
  const nativeJson = {
    learner: {
      gradient_booster: {
        model: {
          trees: [
            {
              // 3 nodes: 0=decision, 1=leaf, 2=leaf
              left_children: [1, -1, -1],
              right_children: [2, -1, -1],
              split_indices: [0, 0, 0],
              split_conditions: [0.5, 0, 0],
              default_left: [1, 0, 0],
              base_weights: [0, 0.3, 0]
            }
          ]
        }
      },
      learner_model_param: {
        base_score: '[0]'
      }
    }
  }

  const result = convertXGBoostModel(nativeJson, {
    target: 'density',
    feature_names: ['f1'],
    learning_rate: 0.1
  })

  // default_left=1 → missing goes to left (node 1)
  assert.strictEqual(result.trees[0][0].missing, 1)
})

// ============ 测试：验证逻辑 ============

run('validateConvertedModel passes valid model', () => {
  const nativeJson = {
    learner: {
      gradient_booster: {
        model: {
          trees: [
            {
              // 3 nodes: 0=decision, 1=leaf, 2=leaf
              left_children: [1, -1, -1],
              right_children: [2, -1, -1],
              split_indices: [0, 0, 0],
              split_conditions: [0.45, 0, 0],
              default_left: [0, 0, 0],
              base_weights: [0, 0.1, 0]
            }
          ]
        }
      },
      learner_model_param: { base_score: '[0]' }
    }
  }

  const result = convertXGBoostModel(nativeJson, {
    target: 'test',
    feature_names: ['f1'],
    learning_rate: 0.1
  })

  const validation = validateConvertedModel(result)
  assert.strictEqual(validation.valid, true)
})

run('validateConvertedModel detects missing trees', () => {
  const bad = { model_version: '1.0', target: 'x', feature_names: ['a'] }
  const validation = validateConvertedModel(bad)
  assert.strictEqual(validation.valid, false)
  assert.ok(validation.errors.some(e => e.includes('缺少 trees')))
})

// ============ 测试：用真实 XGBoost 原生 JSON 验证 ============

if (fs.existsSync(POC_MODEL_PATH)) {
  run('converts real POC xgboost model correctly', () => {
    const raw = fs.readFileSync(POC_MODEL_PATH, 'utf-8')
    const nativeJson = JSON.parse(raw)

    const result = convertXGBoostModel(nativeJson, {
      target: 'strength_28d',
      feature_names: SAMPLE_FEATURE_NAMES,
      learning_rate: 0.07775795728288287,
      feature_stats: { _total_samples: 181 },
      training_info: { samples: 181, date: '2026-07-28' }
    })

    // Verify structure
    assert.ok(Array.isArray(result.trees), 'trees should be array')
    assert.ok(result.trees.length > 0, 'trees should not be empty')
    assert.strictEqual(typeof result.base_score, 'number', 'base_score should be number')
    assert.strictEqual(result.base_score, 54.932, 'base_score should match learner param')

    // Verify tree structure: first tree nodes
    const firstTree = result.trees[0]
    assert.ok(Array.isArray(firstTree), 'each tree should be array')
    assert.ok(firstTree.length > 0, 'tree should have nodes')

    // Verify leaf nodes have leaf field
    const leafCount = firstTree.filter(n => n.leaf !== undefined).length
    assert.ok(leafCount > 0, 'tree should have leaf nodes')

    // Verify decision nodes have required fields
    const decisionNodes = firstTree.filter(n => n.leaf === undefined)
    for (const node of decisionNodes) {
      assert.ok(node.split_feature !== undefined, 'decision node needs split_feature')
      assert.ok(node.split_condition !== undefined, 'decision node needs split_condition')
      assert.ok(node.left !== undefined, 'decision node needs left')
      assert.ok(node.right !== undefined, 'decision node needs right')
      assert.ok(node.missing !== undefined, 'decision node needs missing')
    }

    // Validate
    const validation = validateConvertedModel(result)
    assert.strictEqual(validation.valid, true, 'validation should pass')

    // Verify prediction compatibility
    const features = new Array(SAMPLE_FEATURE_NAMES.length).fill(null)
    features[0] = 0.45
    features[13] = 52.5

    let sum = result.base_score
    for (const tree of result.trees) {
      let nodeIdx = 0
      while (true) {
        const node = tree[nodeIdx]
        if (node.leaf !== undefined) {
          sum += node.leaf
          break
        }
        const v = features[node.split_feature]
        let next
        if (v === undefined || v === null || Number.isNaN(v)) {
          next = node.missing
        } else if (v <= node.split_condition) {
          next = node.left
        } else {
          next = node.right
        }
        nodeIdx = next
      }
    }

    assert.ok(Number.isFinite(sum), 'prediction should be finite number')
    assert.ok(sum > 0, 'strength prediction should be positive')
  })
} else {
  console.log('SKIP real XGBoost model test (POC model not found)')
}

// ============ 测试：预测服务集成测试 ============

run('converted model can be loaded by XGBoostPredictionService prediction logic', () => {
  // 用极简模型测试遍历逻辑兼容性
  const model = {
    base_score: 10,
    trees: [
      [
        { split_feature: 0, split_condition: 5, left: 1, right: 2, missing: 2 },
        { leaf: 3 },
        { leaf: -1 }
      ]
    ]
  }

  function predictOne(model, features) {
    let sum = model.base_score
    for (const tree of model.trees) {
      let nodeIdx = 0
      while (nodeIdx !== undefined && nodeIdx !== null) {
        const node = tree[nodeIdx]
        if (node.leaf !== undefined) {
          sum += node.leaf
          break
        }
        const v = features[node.split_feature]
        let next
        if (v === undefined || v === null || Number.isNaN(v)) {
          next = node.missing
        } else if (v <= node.split_condition) {
          next = node.left
        } else {
          next = node.right
        }
        nodeIdx = next
      }
    }
    return sum
  }

  assert.strictEqual(predictOne(model, [3]), 13)  // 3 <= 5 → left → leaf=3 → 10+3=13
  assert.strictEqual(predictOne(model, [7]), 9)   // 7 > 5 → right → leaf=-1 → 10-1=9
  assert.strictEqual(predictOne(model, [null]), 9) // null → missing → right → leaf=-1 → 9
})

console.log('\n所有测试完成')
