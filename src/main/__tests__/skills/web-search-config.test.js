const skills = require('../../skills/web-search-config')

const get = (name) => skills.find(s => s.name === name)

describe('web-search-config 技能组', () => {
  let ss, store

  beforeEach(() => {
    store = { enabled: false, provider: 'bocha', apiKey: '' }
    ss = {
      saveWebSearchConfig: jest.fn().mockImplementation(async (cfg) => { Object.assign(store, cfg) }),
      getWebSearchConfig: jest.fn().mockImplementation(async () => ({ ...store })),
      clearWebSearchConfig: jest.fn().mockImplementation(async () => { store.enabled = false; store.apiKey = '' })
    }
  })

  test('导出 3 个技能', () => {
    expect(skills.map(s => s.name).sort()).toEqual(
      ['clear_web_search_config', 'configure_web_search', 'get_web_search_config']
    )
  })

  describe('configure_web_search', () => {
    test('缺 apiKey → PARAM_MISSING', async () => {
      const r = await get('configure_web_search').execute({ provider: 'bocha' }, { systemService: ss })
      expect(r.success).toBe(false)
      expect(r.code).toBe('PARAM_MISSING')
      expect(ss.saveWebSearchConfig).not.toHaveBeenCalled()
    })

    test('不支持的 provider → E-SEARCH-INVALID-PROVIDER', async () => {
      const r = await get('configure_web_search').execute({ provider: 'google', apiKey: 'x' }, { systemService: ss })
      expect(r.code).toBe('E-SEARCH-INVALID-PROVIDER')
      expect(ss.saveWebSearchConfig).not.toHaveBeenCalled()
    })

    test('正常保存（默认 enabled=true）', async () => {
      const r = await get('configure_web_search').execute({ provider: 'bocha', apiKey: 'sk-abc' }, { systemService: ss })
      expect(r.success).toBe(true)
      expect(ss.saveWebSearchConfig).toHaveBeenCalledWith({ provider: 'bocha', apiKey: 'sk-abc', enabled: true })
    })

    test('enabled=false 被尊重', async () => {
      await get('configure_web_search').execute({ provider: 'tavily', apiKey: 'tvly-x', enabled: false }, { systemService: ss })
      expect(ss.saveWebSearchConfig).toHaveBeenCalledWith({ provider: 'tavily', apiKey: 'tvly-x', enabled: false })
    })
  })

  describe('get_web_search_config', () => {
    test('已配置 → apiKey 脱敏', async () => {
      store = { enabled: true, provider: 'bocha', apiKey: 'sk-1234567890abcd' }
      const r = await get('get_web_search_config').execute({}, { systemService: ss })
      expect(r.configured).toBe(true)
      expect(r.provider).toBe('bocha')
      expect(r.apiKey).toMatch(/^sk-\*+abcd$/)
      expect(r.apiKey).not.toContain('1234567890')
    })

    test('未配置 → configured=false, apiKey=null', async () => {
      const r = await get('get_web_search_config').execute({}, { systemService: ss })
      expect(r.configured).toBe(false)
      expect(r.apiKey).toBeNull()
    })
  })

  test('clear_web_search_config 清除后 enabled=false', async () => {
    store = { enabled: true, provider: 'bocha', apiKey: 'sk-x' }
    const r = await get('clear_web_search_config').execute({}, { systemService: ss })
    expect(r.success).toBe(true)
    expect(ss.clearWebSearchConfig).toHaveBeenCalled()
    expect(store.enabled).toBe(false)
  })

  test('systemService 缺失 → E-SYS-999', async () => {
    const r = await get('configure_web_search').execute({ provider: 'bocha', apiKey: 'x' }, {})
    expect(r.code).toBe('E-SYS-999')
  })
})
