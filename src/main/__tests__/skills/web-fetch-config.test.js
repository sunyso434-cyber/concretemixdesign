const skills = require('../../skills/web-fetch-config')

const get = (name) => skills.find(s => s.name === name)

describe('web-fetch-config 技能组', () => {
  let ss, store

  beforeEach(() => {
    store = { enabled: true, provider: 'auto' }
    ss = {
      saveWebFetchConfig: jest.fn().mockImplementation(async (cfg) => { Object.assign(store, cfg) }),
      getWebFetchConfig: jest.fn().mockImplementation(async () => ({ ...store })),
      clearWebFetchConfig: jest.fn().mockImplementation(async () => { store = { enabled: true, provider: 'auto' } })
    }
  })

  test('导出 3 个技能', () => {
    expect(skills.map(s => s.name).sort()).toEqual(
      ['clear_web_fetch_config', 'configure_web_fetch', 'get_web_fetch_config']
    )
  })

  describe('configure_web_fetch', () => {
    test('缺 provider → PARAM_MISSING', async () => {
      const r = await get('configure_web_fetch').execute({}, { systemService: ss })
      expect(r.success).toBe(false)
      expect(r.code).toBe('PARAM_MISSING')
      expect(ss.saveWebFetchConfig).not.toHaveBeenCalled()
    })

    test('不支持的 provider → E-SEARCH-INVALID-PROVIDER', async () => {
      const r = await get('configure_web_fetch').execute({ provider: 'google' }, { systemService: ss })
      expect(r.code).toBe('E-SEARCH-INVALID-PROVIDER')
      expect(ss.saveWebFetchConfig).not.toHaveBeenCalled()
    })

    test('auto 正常保存（默认 enabled=true）', async () => {
      const r = await get('configure_web_fetch').execute({ provider: 'auto' }, { systemService: ss })
      expect(r.success).toBe(true)
      expect(ss.saveWebFetchConfig).toHaveBeenCalledWith({ provider: 'auto', enabled: true })
    })

    test('tinyfish 正常保存', async () => {
      const r = await get('configure_web_fetch').execute({ provider: 'tinyfish' }, { systemService: ss })
      expect(r.success).toBe(true)
      expect(ss.saveWebFetchConfig).toHaveBeenCalledWith({ provider: 'tinyfish', enabled: true })
    })

    test('jina + enabled=false 被尊重', async () => {
      await get('configure_web_fetch').execute({ provider: 'jina', enabled: false }, { systemService: ss })
      expect(ss.saveWebFetchConfig).toHaveBeenCalledWith({ provider: 'jina', enabled: false })
    })
  })

  describe('get_web_fetch_config', () => {
    test('返回 enabled + provider', async () => {
      store = { enabled: true, provider: 'tinyfish' }
      const r = await get('get_web_fetch_config').execute({}, { systemService: ss })
      expect(r.success).toBe(true)
      expect(r.enabled).toBe(true)
      expect(r.provider).toBe('tinyfish')
    })

    test('未配置 → 默认 auto + enabled=true', async () => {
      store = { enabled: true, provider: 'auto' }
      const r = await get('get_web_fetch_config').execute({}, { systemService: ss })
      expect(r.provider).toBe('auto')
      expect(r.enabled).toBe(true)
    })
  })

  test('clear_web_fetch_config 恢复默认', async () => {
    store = { enabled: false, provider: 'jina' }
    const r = await get('clear_web_fetch_config').execute({}, { systemService: ss })
    expect(r.success).toBe(true)
    expect(ss.clearWebFetchConfig).toHaveBeenCalled()
  })

  test('systemService 缺失 → E-SYS-999', async () => {
    const r = await get('configure_web_fetch').execute({ provider: 'auto' }, {})
    expect(r.code).toBe('E-SYS-999')
  })
})
