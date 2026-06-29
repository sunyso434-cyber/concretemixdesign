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
    expect(s.parameters.required).toEqual(expect.arrayContaining(['baseUrl', 'apiKey', 'model']))
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
