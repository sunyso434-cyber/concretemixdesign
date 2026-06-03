/**
 * SkillCache 单测
 *
 * F2.1 任务：验证缓存核心能力 —— 异步加载、set/get、LRU 淘汰。
 *
 * 关键点：
 * - 构造函数不接 deferLoad（实际实现里构造纯同步，init() 才异步）
 * - 没有 load()，异步入口是 init()（从 SystemService 读 cfg + 从磁盘加载）
 * - 没有 size()，用 getStats().size 替代
 * - init() 内部会调 _loadFromDisk，因此 cacheDir 必须存在
 */

const SkillCache = require('../SkillCache')
const fs = require('fs')
const path = require('path')

describe('SkillCache', () => {
  const cacheDir = path.join(__dirname, '__fixtures__', 'cache')

  beforeEach(() => {
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true })
    }
    fs.mkdirSync(cacheDir, { recursive: true })
  })

  afterAll(() => {
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true })
    }
  })

  test('F2-cache-01: 异步加载，构造完立即 get 不应抛错', () => {
    const cache = new SkillCache({ cacheDir })
    // 未 await init()，get() 应安全返回 null，不阻塞构造
    expect(() => cache.get('foo')).not.toThrow()
    expect(cache.get('foo')).toBeNull()
  })

  test('F2-cache-02: set 后 get 应返回值', async () => {
    const cache = new SkillCache({ cacheDir })
    await cache.init()

    cache.set('key1', { data: 'value1' })
    const result = cache.get('key1')

    expect(result).not.toBeNull()
    expect(result.data).toBe('value1')
  })

  test('F2-cache-03: LRU 淘汰后 size 不超过 maxSize', async () => {
    const cache = new SkillCache({ cacheDir, maxSize: 3 })
    await cache.init()

    cache.set('a', { n: 1 })
    cache.set('b', { n: 2 })
    cache.set('c', { n: 3 })
    // 第 4 个写入触发 _evictOldEntries，淘汰最旧的 10%（即 1 个）
    cache.set('d', { n: 4 })

    const size = cache.getStats().size
    expect(size).toBeLessThanOrEqual(3)
    // 必须保留新写入的 d
    expect(cache.get('d')).toEqual({ n: 4 })
  })
})
