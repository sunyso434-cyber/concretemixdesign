/**
 * 真实 sequelize + sqlite 集成测试：验证视觉配置 save→get
 */
const path = require('path')
const fs = require('fs')
const os = require('os')

// 临时改写 sequelize 配置文件路径，让 sqlite 内存数据库生效
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-vision-test-'))
process.env.NODE_ENV = 'test'
const dbPath = path.join(tmpDir, 'test.sqlite')

// 直接 require（注意 order：先设好路径）
const { sequelize } = require('../../db/database')
const SystemParam = require('../../db/models/SystemParam')
const SystemService = require('../../services/SystemService')

jest.setTimeout(30000)

describe('SystemService 视觉配置 save→get', () => {
  beforeAll(async () => {
    await sequelize.sync({ force: true })
    await SystemService.initDefaultParams()
  })

  afterAll(async () => {
    await sequelize.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('saveVisionConfig 后 getVisionConfig 能拿到', async () => {
    await SystemService.saveVisionConfig({
      apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: 'sk-test1234567890abcdef',
      model: 'qwen-vl-plus',
      enabled: true
    })

    const cfg = await SystemService.getVisionConfig()
    console.log('读到的 cfg:', JSON.stringify({
      enabled: cfg.enabled,
      apiUrl: cfg.apiUrl,
      apiKey: cfg.apiKey?.slice(0, 6) + '...',
      model: cfg.model,
      maxDimension: cfg.maxDimension,
      maxSizeMb: cfg.maxSizeMb
    }))

    expect(cfg.enabled).toBe(true)
    expect(cfg.apiUrl).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
    expect(cfg.apiKey).toBe('sk-test1234567890abcdef')
    expect(cfg.model).toBe('qwen-vl-plus')
  })

  test('直接查 DB 表确认数据真的写进去了', async () => {
    const rows = await SystemParam.findAll({ where: { paramName: 'visionApiUrl' } })
    console.log('visionApiUrl 行:', JSON.stringify(rows.map(r => r.toJSON())))
    expect(rows.length).toBe(1)
    expect(rows[0].paramValue).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
  })

  test('initDefaultParams removes the legacy strengthStdDev_C25 parameter', async () => {
    await SystemParam.create({
      paramName: 'strengthStdDev_C25',
      paramValue: '4.5',
      paramType: 'jgj55'
    })

    await expect(SystemService.initDefaultParams()).resolves.toBeUndefined()
    await expect(SystemParam.findOne({
      where: { paramName: 'strengthStdDev_C25' }
    })).resolves.toBeNull()
  })

  test('saveVisionConfig 后 analyze_concrete_image 不报 E-VISION-NOT-CONFIGURED', async () => {
    const skills = require('../../skills/analyze-concrete-image')
    const skill = skills.find(s => s.name === 'analyze_concrete_image')
    const result = await skill.execute({ imageBase64: 'data:image/png;base64,AAAA' }, {
      systemService: SystemService
    })
    console.log('analyze_concrete_image 结果:', JSON.stringify({
      success: result.success,
      errorCode: result.errorCode || result.code,
      message: result.message
    }).slice(0, 300))
    // 应该不是 E-VISION-NOT-CONFIGURED
    if (result.errorCode === 'E-VISION-NOT-CONFIGURED' || result.code === 'E-VISION-NOT-CONFIGURED') {
      throw new Error('E-VISION-NOT-CONFIGURED 触发，配置没读到')
    }
  })
})
