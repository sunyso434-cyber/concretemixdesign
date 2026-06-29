const skills = require('../../skills/analyze-concrete-image')
const fs = require('fs')
const path = require('path')

describe('analyze_concrete_image', () => {
  let mockSystemService
  let mockVisionService

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
    mockVisionService = {
      analyze: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          imageType: 'defect',
          description: '梁底有斜裂缝',
          details: { defects: [{ type: '裂缝', length: '约30cm', width: '约0.3mm', severity: '中等' }] },
          confidence: 0.92
        }),
        raw: {}
      })
    }
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
  })

  test('传 base64 时直接调用 VisionService', async () => {
    const s = skills.find(x => x.name === 'analyze_concrete_image')
    const result = await s.execute({
      imageBase64: 'data:image/jpeg;base64,/9j/AAAA',
      question: '检查裂缝'
    }, { systemService: mockSystemService, visionService: mockVisionService })
    expect(mockVisionService.analyze).toHaveBeenCalledWith(expect.objectContaining({
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
        systemService: mockSystemService,
        visionService: mockVisionService
      })
      expect(mockVisionService.analyze).toHaveBeenCalled()
      const callArgs = mockVisionService.analyze.mock.calls[0][0]
      expect(callArgs.base64).toMatch(/^data:image\/jpeg;base64,/)
      expect(result.success).toBe(true)
    } finally {
      fs.unlinkSync(tmpFile)
    }
  })

  test('filePath 不存在时返回 E-VISION-FILE-NOT-FOUND', async () => {
    const s = skills.find(x => x.name === 'analyze_concrete_image')
    const result = await s.execute({ imagePath: '/nonexistent/file.jpg' }, {
      systemService: mockSystemService,
      visionService: mockVisionService
    })
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('E-VISION-FILE-NOT-FOUND')
  })

  test('视觉模型返回非 JSON 时降级为纯文本', async () => {
    mockVisionService.analyze.mockResolvedValue({ content: '图片里有一条裂缝', raw: {} })
    const s = skills.find(x => x.name === 'analyze_concrete_image')
    const result = await s.execute({ imageBase64: 'data:image/jpeg;base64,xxx' }, {
      systemService: mockSystemService,
      visionService: mockVisionService
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
    }, { systemService: mockSystemService, visionService: mockVisionService })
    const callArgs = mockVisionService.analyze.mock.calls[0][0]
    expect(callArgs.base64).toBe('data:image/jpeg;base64,AAA')
  })
})