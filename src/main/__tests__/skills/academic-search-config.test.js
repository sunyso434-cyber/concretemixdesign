const skills = require('../../skills/academic-search-config')
const get = (name) => skills.find(s => s.name === name)

describe('academic-search-config 技能组', () => {
  let ss, store

  beforeEach(() => {
    store = { provider: 'semantic_scholar', arxivFallback: true }
    ss = {
      getAcademicSearchConfig: jest.fn().mockImplementation(async () => ({ ...store })),
      saveAcademicSearchConfig: jest.fn().mockImplementation(async (cfg) => {
        if (cfg.provider !== undefined) store.provider = cfg.provider
        if (cfg.arxivFallback !== undefined) store.arxivFallback = cfg.arxivFallback
        return { ...store }
      }),
      clearAcademicSearchConfig: jest.fn().mockImplementation(async () => {
        store = { provider: 'semantic_scholar', arxivFallback: true }
        return { ...store }
      })
    }
  })

  test('导出 3 个技能', () => {
    expect(skills.map(s => s.name).sort()).toEqual([
      'clear_academic_search_config',
      'configure_academic_search',
      'get_academic_search_config'
    ])
  })

  describe('configure_academic_search', () => {
    test('不传任何参数 → PARAM_MISSING', async () => {
      const r = await get('configure_academic_search').execute({}, { systemService: ss })
      expect(r.success).toBe(false)
      expect(r.code).toBe('PARAM_MISSING')
      expect(ss.saveAcademicSearchConfig).not.toHaveBeenCalled()
    })

    test('非法 provider → E-SEARCH-INVALID-ACADEMIC-PROVIDER', async () => {
      const r = await get('configure_academic_search').execute({ provider: 'baidu' }, { systemService: ss })
      expect(r.code).toBe('E-SEARCH-INVALID-ACADEMIC-PROVIDER')
      expect(r.hint).toContain('semantic_scholar')
      expect(ss.saveAcademicSearchConfig).not.toHaveBeenCalled()
    })

    test('合法 provider → 保存并回显当前完整 config', async () => {
      const r = await get('configure_academic_search').execute({ provider: 'openalex' }, { systemService: ss })
      expect(r.success).toBe(true)
      expect(r.config.provider).toBe('openalex')
      expect(ss.saveAcademicSearchConfig).toHaveBeenCalledWith({ provider: 'openalex', arxivFallback: undefined })
    })

    test('只传 arxivFallback=false → 只更新兜底开关', async () => {
      const r = await get('configure_academic_search').execute({ arxivFallback: false }, { systemService: ss })
      expect(r.success).toBe(true)
      expect(r.config.arxivFallback).toBe(false)
      expect(r.config.provider).toBe('semantic_scholar')  // provider 不变
    })

    test('同时传 provider + arxivFallback → 都更新', async () => {
      const r = await get('configure_academic_search').execute({ provider: 'openalex', arxivFallback: false }, { systemService: ss })
      expect(r.config).toEqual({ provider: 'openalex', arxivFallback: false })
    })
  })

  describe('get_academic_search_config', () => {
    test('返回当前 config（不脱敏，无 apiKey）', async () => {
      store = { provider: 'openalex', arxivFallback: false }
      const r = await get('get_academic_search_config').execute({}, { systemService: ss })
      expect(r.success).toBe(true)
      expect(r.config).toEqual({ provider: 'openalex', arxivFallback: false })
    })

    test('默认配置：semantic_scholar + arxivFallback=true', async () => {
      const r = await get('get_academic_search_config').execute({}, { systemService: ss })
      expect(r.config).toEqual({ provider: 'semantic_scholar', arxivFallback: true })
    })
  })

  describe('clear_academic_search_config', () => {
    test('清除后恢复默认 + 返回成功', async () => {
      store = { provider: 'openalex', arxivFallback: false }
      const r = await get('clear_academic_search_config').execute({}, { systemService: ss })
      expect(r.success).toBe(true)
      expect(r.message).toContain('默认')
      expect(r.config).toEqual({ provider: 'semantic_scholar', arxivFallback: true })
      expect(ss.clearAcademicSearchConfig).toHaveBeenCalled()
    })
  })

  test('systemService 缺失 → E-SYS-999', async () => {
    const r = await get('configure_academic_search').execute({ provider: 'openalex' }, {})
    expect(r.code).toBe('E-SYS-999')
  })
})