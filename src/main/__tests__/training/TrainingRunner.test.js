/**
 * TrainingRunner.test.js
 * 测试 TrainingRunner：训练锁 / 空数据 / nTrials 校验 / 返回契约 / 进度透传
 *
 * 全部 mock：XGBoostTrainingService / XGBoostPredictionService / TrainingDataBuilder / electron
 */

const path = require('path')
const os = require('os')
const fs = require('fs')

// userData 指向临时目录（变量名以 mock 开头，符合 jest.mock 工厂作用域规则）
const mockUserData = path.join(os.tmpdir(), 'training-runner-test-' + Date.now())

jest.mock('electron', () => ({
  app: { getPath: jest.fn(() => mockUserData) }
}))

jest.mock('../../services/XGBoostTrainingService', () => ({
  trainWithWorker: jest.fn(),
  activeCount: 0
}))

jest.mock('../../services/XGBoostPredictionService', () => ({
  clearCache: jest.fn()
}))

// TrainingDataBuilder：每次 new 返回同一共享实例，测试与 Runner 拿到同一个
const mockBuilderInstance = {
  buildFromTrialRecords: jest.fn()
}
jest.mock('../../services/training/TrainingDataBuilder', () =>
  jest.fn(() => mockBuilderInstance)
)

const TrainingRunner = require('../../services/training/TrainingRunner')
const XGBoostTrainingService = require('../../services/XGBoostTrainingService')

// ============ 辅助 ============

/** 构造 buildFromTrialRecords 成功返回 */
function mockBuildResult(overrides = {}) {
  mockBuilderInstance.buildFromTrialRecords.mockResolvedValue({
    csv: 'col1,col2\n1,2',
    totalRows: 200,
    baseRows: 181,
    userRows: 95,
    version: '20260731_000000',
    ...overrides
  })
}

// ============ 测试 ============

beforeEach(() => {
  jest.clearAllMocks()
})

afterAll(() => {
  try { fs.rmSync(mockUserData, { recursive: true, force: true }) } catch {}
})

describe('TrainingRunner.sanitizeNTrials', () => {
  test('clamps to [1,200] and defaults invalid to 50', () => {
    expect(TrainingRunner.sanitizeNTrials(undefined)).toBe(50)
    expect(TrainingRunner.sanitizeNTrials(50)).toBe(50)
    expect(TrainingRunner.sanitizeNTrials(0)).toBe(1)       // 0 不再等于「跳过调参」
    expect(TrainingRunner.sanitizeNTrials(-5)).toBe(1)
    expect(TrainingRunner.sanitizeNTrials(100000)).toBe(200)
    expect(TrainingRunner.sanitizeNTrials('abc')).toBe(50)
  })
})

describe('TrainingRunner.runTraining', () => {
  test('succeeds and returns full contract + structured progress', async () => {
    mockBuildResult()
    XGBoostTrainingService.trainWithWorker.mockImplementation(async (opts, onProgress) => {
      expect(opts.nTrials).toBe(50)
      onProgress({ message: 'TPE 调参开始: strength_28d', percent: 15 })
      return {
        reports: { strength_28d: { rmse: 3.2 } },
        summary: { totalSamples: 200, targets: 3 }
      }
    })

    const onProgress = jest.fn()
    const result = await TrainingRunner.runTraining({}, onProgress)

    expect(result.success).toBe(true)
    // 返回契约字段齐全
    expect(result.results).toBeDefined()
    expect(result.modelVersion).toBeDefined()
    expect('archivedVersion' in result).toBe(true)
    expect(result.reports).toBeDefined()
    expect(result.summary).toBeDefined()
    expect(result.totalRows).toBe(200)
    expect(result.baseRows).toBe(181)
    expect(result.userRows).toBe(95)

    // 进度透传 {message, percent, timestamp}
    expect(onProgress).toHaveBeenCalled()
    const p = onProgress.mock.calls[0][0]
    expect(p.message).toBe('TPE 调参开始: strength_28d')
    expect(p.percent).toBe(15)
    expect(typeof p.timestamp).toBe('number')
  })

  test('returns error when no training data (totalRows=0)', async () => {
    mockBuildResult({ totalRows: 0 })
    const result = await TrainingRunner.runTraining({})
    expect(result.success).toBe(false)
    expect(result.error).toContain('没有可用的训练数据')
    // 不应启动 worker
    expect(XGBoostTrainingService.trainWithWorker).not.toHaveBeenCalled()
  })

  test('training lock blocks concurrent run, releases after failure', async () => {
    mockBuildResult({ totalRows: 10 })

    // 第一次调用：worker 挂起
    let resolveWorker
    XGBoostTrainingService.trainWithWorker.mockReturnValue(
      new Promise((res) => { resolveWorker = res })
    )

    const p1 = TrainingRunner.runTraining({})
    // 第二次调用应被锁拦截
    const blocked = await TrainingRunner.runTraining({})
    expect(blocked.success).toBe(false)
    expect(blocked.error).toContain('训练进行中')

    // 放行第一次
    resolveWorker({ reports: {}, summary: {} })
    const r1 = await p1
    expect(r1.success).toBe(true)

    // 失败路径：锁释放
    XGBoostTrainingService.trainWithWorker.mockRejectedValue(new Error('boom'))
    const failed = await TrainingRunner.runTraining({})
    expect(failed.success).toBe(false)
    expect(failed.error).toBe('boom')

    // 锁已释放：再次调用能进（成功）
    XGBoostTrainingService.trainWithWorker.mockResolvedValue({ reports: {}, summary: {} })
    const after = await TrainingRunner.runTraining({})
    expect(after.success).toBe(true)
  })

  test('nTrials clamp is passed to worker', async () => {
    mockBuildResult({ totalRows: 10 })
    XGBoostTrainingService.trainWithWorker.mockResolvedValue({ reports: {}, summary: {} })

    await TrainingRunner.runTraining({ nTrials: 100000 })
    expect(XGBoostTrainingService.trainWithWorker).toHaveBeenLastCalledWith(
      expect.objectContaining({ nTrials: 200 }), expect.any(Function)
    )

    await TrainingRunner.runTraining({ nTrials: 0 })
    expect(XGBoostTrainingService.trainWithWorker).toHaveBeenLastCalledWith(
      expect.objectContaining({ nTrials: 1 }), expect.any(Function)
    )

    await TrainingRunner.runTraining({})
    expect(XGBoostTrainingService.trainWithWorker).toHaveBeenLastCalledWith(
      expect.objectContaining({ nTrials: 50 }), expect.any(Function)
    )
  })
})
