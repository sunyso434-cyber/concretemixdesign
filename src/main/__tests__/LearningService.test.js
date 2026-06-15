// 隔离 EventBus 单例
// 关键：jest.resetModules() 会清空 require 缓存，使 EventBus 单例重新生成。
// 因此测试里 emit 时必须用 resetModules 之后 fresh require 的那个实例，
// 不能用顶层 const 缓存的旧实例（否则 emit 不到 listener）。
const eventBusTop = require('../agent/EventBus')
const eventBusClear = () => eventBusTop.clear()

describe('LearningService 集成 PreferencePatternDetector', () => {
  beforeEach(() => eventBusClear())
  afterAll(() => eventBusClear())

  // 重置模块缓存以获取干净单例
  let svc
  let store
  let freshEventBus

  beforeEach(() => {
    jest.resetModules()
    // 用 jest.doMock 替换 MaterialService 模块，确保 LearningService 内部 require 拿到的也是 mock
    jest.doMock('../services/MaterialService', () => ({
      getMaterialById: jest.fn(async (id) => ({
        id,
        name: id === 1 ? '拉法基' : '粉煤灰'
      }))
    }))
    // 关键：resetModules 后重新 require EventBus，拿 fresh 单例
    // eslint-disable-next-line global-require
    freshEventBus = require('../agent/EventBus')
    // 动态 require 以便拿到 fresh 单例
    const LearningService = require('../services/LearningService')
    const { getSuggestionStore } = require('../agent/preferences')

    svc = LearningService
    // 强制重置 _initialized 标志（resetModules 后已是新实例，但保险起见）
    svc._initialized = false
    svc.init()
    store = getSuggestionStore()
    store._items = [] // 清空
  })

  test('应监听 tool:executed 事件并把 5 次相同材料写入 suggestionStore', () => {
    for (let i = 0; i < 5; i++) {
      freshEventBus.emitToolExecuted(
        'calculate_mix_design',
        { cementId: 1, flyAshId: 2, calculationMethod: 'absolute' },
        { success: true }
      )
    }

    // 异步等 microtask 跑完
    return new Promise(r => setTimeout(r, 100)).then(() => {
      const list = store.list()
      expect(list.length).toBeGreaterThanOrEqual(1)
      // cement 1 → '拉法基' 是 material_vendor 建议
      expect(
        list.some(s => s.type === 'material_vendor' && s.proposedYaml && s.proposedYaml.value === '拉法基')
      ).toBe(true)
    })
  })

  test('不应对非 calculate_mix_design 工具进行观察', () => {
    for (let i = 0; i < 5; i++) {
      freshEventBus.emitToolExecuted('other_tool', { cementId: 1 }, { success: true })
    }
    return new Promise(r => setTimeout(r, 100)).then(() => {
      expect(store.list()).toEqual([])
    })
  })

  test('不应在 result.success === false 时观察', () => {
    for (let i = 0; i < 5; i++) {
      freshEventBus.emitToolExecuted('calculate_mix_design', { cementId: 1 }, { success: false })
    }
    return new Promise(r => setTimeout(r, 100)).then(() => {
      expect(store.list()).toEqual([])
    })
  })
})

