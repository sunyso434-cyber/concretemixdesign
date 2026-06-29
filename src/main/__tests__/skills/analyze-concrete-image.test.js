// Mock VisionService 类 — skill 内部 new VisionService(cfg) 走到 mock
// 使用 function 构造器语法（而非 mockImplementation），
// 因为 jest 的 mockImplementation 在 new 调用时返回的对象在 mock.instances 中
// 会表现为空 {}，用普通 function + this.analyze 才能正确填充 instance。
const mockAnalyze = jest.fn()
jest.mock('../../services/VisionService', () => {
  return jest.fn(function MockVisionService() {
    this.analyze = mockAnalyze
  })
})

const VisionService = require('../../services/VisionService')
const skills = require('../../skills/analyze-concrete-image')
const fs = require('fs')
const path = require('path')

describe('analyze_concrete_image', () => {
  let mockSystemService

  // 取最近一次 new VisionService() 返回的实例
  const getLastVisionInstance = () => {
    const instances = VisionService.mock.instances
    return instances[instances.length - 1]
  }

  beforeEach(() => {
    mockSystemService = {
      getVisionConfig: jest.fn().mockResolvedValue({
        enabled: true,
        apiUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        model: 'qwen-vl-plus',
        maxDimension: 1024,
        maxSizeMb: 10
      })
    }
    // 仅清空 analyze 的调用历史，不动 VisionService 实例本身（避免丢失 mock 实现）
    mockAnalyze.mockClear()
    mockAnalyze.mockResolvedValue({
      content: JSON.stringify({
        imageType: 'defect',
        description: '梁底有斜裂缝',
        details: { defects: [{ type: '裂缝', length: '约30cm', width: '约0.3mm', severity: '中等' }] },
        confidence: 0.92
      }),
      raw: {}
    })
  })

  test('未配置视觉模型返回 E-VISION-NOT-CONFIGURED 错误', async () => {
    mockSystemService.getVisionConfig.mockResolvedValue({ enabled: false, apiUrl: null, apiKey: null, model: null })
    const s = skills.find(x => x.name === 'analyze_concrete_image')
    const result = await s.execute({ imageBase64: 'data:image/jpeg;base64,xxx' }, {
      systemService: mockSystemService
    })
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('E-VISION-NOT-CONFIGURED')
    expect(result.hint).toContain('configure_vision_model')
    // 未配置时不应构造 VisionService
    expect(VisionService).not.toHaveBeenCalled()
  })

  test('传 base64 时直接调用 VisionService', async () => {
    const s = skills.find(x => x.name === 'analyze_concrete_image')
    const result = await s.execute({
      imageBase64: 'data:image/jpeg;base64,/9j/AAAA',
      question: '检查裂缝'
    }, { systemService: mockSystemService })

    // 验证用最新 cfg 构造了 VisionService（动态化核心断言）
    expect(VisionService).toHaveBeenCalledWith(expect.objectContaining({
      apiUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'qwen-vl-plus'
    }))

    const vision = getLastVisionInstance()
    expect(vision.analyze).toHaveBeenCalledWith(expect.objectContaining({
      base64: 'data:image/jpeg;base64,/9j/AAAA'
    }))
    expect(result.success).toBe(true)
    expect(result.imageType).toBe('defect')
    expect(result.details.defects[0].type).toBe('裂缝')
  })

  test('传 filePath 时读文件转 base64', async () => {
    const tmpFile = path.join(__dirname, 'fixture.jpg')
    fs.writeFileSync(tmpFile, Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]))  // JPEG magic
    try {
      const s = skills.find(x => x.name === 'analyze_concrete_image')
      const result = await s.execute({ imagePath: tmpFile }, {
        systemService: mockSystemService
      })
      const vision = getLastVisionInstance()
      expect(vision.analyze).toHaveBeenCalled()
      const callArgs = vision.analyze.mock.calls[0][0]
      expect(callArgs.base64).toMatch(/^data:image\/jpeg;base64,/)
      expect(result.success).toBe(true)
    } finally {
      fs.unlinkSync(tmpFile)
    }
  })

  test('filePath 不存在时返回 E-VISION-FILE-NOT-FOUND', async () => {
    const s = skills.find(x => x.name === 'analyze_concrete_image')
    const result = await s.execute({ imagePath: '/nonexistent/file.jpg' }, {
      systemService: mockSystemService
    })
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('E-VISION-FILE-NOT-FOUND')
  })

  test('视觉模型返回非 JSON 时降级为纯文本', async () => {
    // 覆盖默认返回值
    mockAnalyze.mockResolvedValue({ content: '图片里有一条裂缝', raw: {} })
    const s = skills.find(x => x.name === 'analyze_concrete_image')
    const result = await s.execute({ imageBase64: 'data:image/jpeg;base64,xxx' }, {
      systemService: mockSystemService
    })
    expect(result.success).toBe(true)
    expect(result.imageType).toBe('general')
    expect(result.description).toContain('裂缝')
  })

  test('传 imageBase64 和 imagePath 时优先使用 imageBase64', async () => {
    const s = skills.find(x => x.name === 'analyze_concrete_image')
    await s.execute({
      imageBase64: 'data:image/jpeg;base64,AAA',
      imagePath: '/tmp/x.jpg'
    }, { systemService: mockSystemService })
    const vision = getLastVisionInstance()
    const callArgs = vision.analyze.mock.calls[0][0]
    expect(callArgs.base64).toBe('data:image/jpeg;base64,AAA')
  })
})