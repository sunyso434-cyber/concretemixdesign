const path = require('path')
const assert = require('assert')

process.env.USER_DATA_PATH = path.join(__dirname, '..', '..', 'src', 'test-user-data')

const XGBoostPredictionService = require(path.join(
  __dirname,
  '..',
  '..',
  'src',
  'main',
  'services',
  'XGBoostPredictionService'
))
const MixFormatConverter = require(path.join(
  __dirname,
  '..',
  '..',
  'src',
  'main',
  'services',
  'MixFormatConverter'
))

function run(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    console.error(error)
    process.exitCode = 1
  }
}

run('uses exported XGBoost leaf values without applying learning_rate again', () => {
  const model = {
    base_score: 10,
    learning_rate: 0.1,
    trees: [
      [{ leaf: 5 }],
      [{ leaf: -2 }]
    ]
  }

  const result = XGBoostPredictionService._predictOne(model, [])

  assert.strictEqual(result.value, 13)
})

run('traverses split nodes and missing branches before summing leaves', () => {
  const model = {
    base_score: 20,
    learning_rate: 0.1,
    trees: [
      [
        { split_feature: 0, split_condition: 0.45, left: 1, right: 2, missing: 3 },
        { leaf: 4 },
        { leaf: -3 },
        { leaf: 7 }
      ]
    ]
  }

  assert.strictEqual(XGBoostPredictionService._predictOne(model, [0.4]).value, 24)
  assert.strictEqual(XGBoostPredictionService._predictOne(model, [0.5]).value, 17)
  assert.strictEqual(XGBoostPredictionService._predictOne(model, [-1]).value, 27)
})

run('rejects incomplete performance prediction inputs', () => {
  const noWaterBinder = XGBoostPredictionService._validateInputParams({ cementAmount: 320 })
  assert.strictEqual(noWaterBinder.success, false)
  assert.ok(noWaterBinder.missingParams.includes('waterBinderRatio 或 waterAmount+胶凝材料用量'))

  const noCement = XGBoostPredictionService._validateInputParams({ waterBinderRatio: 0.45 })
  assert.strictEqual(noCement.success, false)
  assert.ok(noCement.missingParams.includes('cementAmount'))
})

run('marks models without feature range metadata as medium confidence', () => {
  const model = {
    target: 'strength28d',
    feature_names: ['water_binder_ratio', 'cement_amount'],
    feature_stats: { _total_samples: 105 }
  }

  const result = XGBoostPredictionService._checkFeatureRange(model, [0.45, 320])

  assert.strictEqual(result.confidence, 'medium')
  assert.ok(result.warnings.some(item => item.includes('缺少训练特征范围')))
})

run('downgrades low quality models by training R squared', () => {
  const model = {
    target: 'slump',
    feature_names: ['water_binder_ratio'],
    feature_stats: {
      water_binder_ratio: { min: 0.3, max: 0.6, mean: 0.45 }
    },
    training_info: { r_squared: 0.0151 }
  }

  const result = XGBoostPredictionService._checkFeatureRange(model, [0.45])

  assert.strictEqual(result.confidence, 'low')
  assert.ok(result.warnings.some(item => item.includes('预测解释能力较弱')))
})

run('returns range warnings for out of training range inputs', () => {
  const model = {
    target: 'strength28d',
    feature_names: ['water_binder_ratio'],
    feature_stats: {
      water_binder_ratio: { min: 0.3, max: 0.6, mean: 0.45 }
    }
  }

  const result = XGBoostPredictionService._checkFeatureRange(model, [0.9])

  assert.strictEqual(result.confidence, 'medium')
  assert.ok(result.warnings.some(item => item.includes('超出训练数据范围')))
})

run('does not invent zero water binder ratio when water mass is absent', () => {
  const converted = MixFormatConverter.massToPercent({ cementAmount: 320 })

  assert.strictEqual(converted.waterBinderRatio, undefined)
})
