const skills = require('../../skills/vision-config')

describe('视觉配置技能', () => {
  let mockSystemService

  beforeEach(() => {
    mockSystemService = {
      getVisionConfig: jest.fn(),
      saveVisionConfig: jest.fn(),
      clearVisionConfig: jest.fn()
    }
  })

  test('configure_vision_model schema 包含必要参数', () => {
    const s = skills.find(s => s.name === 'configure_vision_model')
    expect(s).toBeDefined()
    // v9.1.0 修复后改用 flat schema：直接在字段定义上写 required: true
    expect(s.parameters.baseUrl.required).toBe(true)
    expect(s.parameters.apiKey.required).toBe(true)
    expect(s.parameters.model.required).toBe(true)
  })

  // v9.1.0 新增：老板历史 bug 复现 — 只传 enabled 时必须返回错误，不写入
  test('只传 enabled 时返回 E-PARAM-MISSING 错误，不写入', async () => {
    const saveCalled = jest.fn()
    const ss = {
      getVisionConfig: jest.fn(),
      saveVisionConfig: saveCalled,
      clearVisionConfig: jest.fn()
    }
    const s = skills.find(s => s.name === 'configure_vision_model')
    const result = await s.execute({ enabled: true }, { systemService: ss })
    expect(result.success).toBeFalsy()
    expect(result.code || result.errorCode).toBe('E-PARAM-MISSING')
    expect(saveCalled).not.toHaveBeenCalled()  // 关键：必须不调用 saveVisionConfig
  })

  // v9.1.0 新增：LLM 把 skill schema 当成参数传时（即嵌套格式），也应被拦截
  test('LLM 传嵌套 JSON Schema 格式时返回错误，不写入', async () => {
    const saveCalled = jest.fn()
    const ss = {
      getVisionConfig: jest.fn(),
      saveVisionConfig: saveCalled,
      clearVisionConfig: jest.fn()
    }
    const s = skills.find(s => s.name === 'configure_vision_model')
    const result = await s.execute({
      type: 'openai',
      properties: { apiKey: 'sk-x', baseUrl: 'https://x', modelId: 'm' },
      required: ['apiKey', 'baseUrl', 'modelId']
    }, { systemService: ss })
    expect(result.success).toBeFalsy()
    expect(saveCalled).not.toHaveBeenCalled()
  })

  // v9.1.0 新增：baseUrl 传空字符串时也应被拦截
  test('必填字段传空字符串时返回 E-PARAM-MISSING', async () => {
    const saveCalled = jest.fn()
    const ss = {
      getVisionConfig: jest.fn(),
      saveVisionConfig: saveCalled,
      clearVisionConfig: jest.fn()
    }
    const s = skills.find(s => s.name === 'configure_vision_model')
    const result = await s.execute({
      baseUrl: '',
      apiKey: 'sk-test',
      model: 'qwen-vl-plus'
    }, { systemService: ss })
    expect(result.success).toBeFalsy()
    expect(saveCalled).not.toHaveBeenCalled()
  })

  test('configure_vision_model 调用 saveVisionConfig', async () => {
    const s = skills.find(s => s.name === 'configure_vision_model')
    await s.execute({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'qwen-vl-plus'
    }, { systemService: mockSystemService })
    expect(mockSystemService.saveVisionConfig).toHaveBeenCalledWith(expect.objectContaining({
      apiUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'qwen-vl-plus',
      enabled: true
    }))
  })

  test('get_vision_config 返回脱敏后的 apiKey', async () => {
    mockSystemService.getVisionConfig.mockResolvedValue({
      enabled: true,
      apiUrl: 'https://api.example.com/v1',
      apiKey: 'sk-abcdefghijklmnop',
      model: 'qwen-vl-plus',
      maxDimension: 1024,
      maxSizeMb: 10
    })
    const s = skills.find(s => s.name === 'get_vision_config')
    const result = await s.execute({}, { systemService: mockSystemService })
    expect(result.success).toBe(true)
    expect(result.apiKey).toMatch(/^sk-\*+/)
    expect(result.apiKey).not.toContain('abcdefghijklmnop')
  })

  test('get_vision_config 未配置时返回 success=false', async () => {
    mockSystemService.getVisionConfig.mockResolvedValue({
      enabled: false, apiUrl: null, apiKey: null, model: null, maxDimension: 1024, maxSizeMb: 10
    })
    const s = skills.find(s => s.name === 'get_vision_config')
    const result = await s.execute({}, { systemService: mockSystemService })
    expect(result.configured).toBe(false)
  })

  test('clear_vision_config 调用 clearVisionConfig', async () => {
    const s = skills.find(s => s.name === 'clear_vision_config')
    await s.execute({}, { systemService: mockSystemService })
    expect(mockSystemService.clearVisionConfig).toHaveBeenCalled()
  })
})
