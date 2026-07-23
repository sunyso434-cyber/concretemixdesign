/**
 * update_agent_rules Skill 单元测试
 *
 * 覆盖：
 * - skill 元数据 + schema
 * - addItem 到已有 section/subSection
 * - addItem 自动创建不存在的 section
 * - addItem 自动创建不存在的 subSection
 * - addItem 重复项返回 ITEM_EXISTS（不弹确认框）
 * - removeItem 已存在项
 * - removeItem section 不存在 → SECTION_NOT_FOUND
 * - removeItem subSection 不存在 → SUBSECTION_NOT_FOUND
 * - removeItem item 不存在 → ITEM_NOT_FOUND
 * - 用户同意写入 → saveToFile 被调用
 * - 用户取消 → saveToFile 不被调用
 * - 用户超时 → saveToFile 不被调用
 * - saveToFile 抛错 → WRITE_FAILED
 * - 无效 action → INVALID_ACTION
 */

const skill = require('../../skills/update-agent-rules')

// ===== mock 依赖 =====
// 变量名必须以 mock 开头，jest.mock 工厂才能引用（Jest 规则）
// mock ask-user：默认返回"同意写入"，个别用例覆盖
const mockAskUser = jest.fn()
jest.mock('../../skills/ask-user', () => ({
  execute: (...args) => mockAskUser(...args)
}))

// mock AgentMdParser：formatToMarkdown 透传便于断言
const mockFormatToMarkdown = jest.fn(md => md)
jest.mock('../../agent/agentMd/AgentMdParser', () => ({
  AgentMdParser: {
    formatToMarkdown: (...args) => mockFormatToMarkdown(...args)
  }
}))

// mock agentMd 模块：getInstance 返回可控 service
const mockGetCached = jest.fn()
const mockSaveToFile = jest.fn()
jest.mock('../../agent/agentMd', () => ({
  getInstance: () => ({
    getCached: (...args) => mockGetCached(...args),
    saveToFile: (...args) => mockSaveToFile(...args)
  })
}))

const _ctx = (overrides = {}) => ({
  orchestrator: {},
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  ...overrides
})

// 构造一个已存在的 agent.md parsed 结构
const _existingParsed = () => ({
  version: 2,
  sections: [
    {
      title: '业务规则',
      subSections: [
        {
          title: '材料',
          items: ['C30 用 P.O 42.5 水泥', '砂子用中砂'],
          rawText: ''
        },
        {
          title: '报告',
          items: ['报告用仿宋字体'],
          rawText: ''
        }
      ]
    },
    {
      title: '回复规范',
      subSections: [
        {
          title: null,
          items: ['全部使用中文回复'],
          rawText: ''
        }
      ]
    }
  ]
})

describe('update_agent_rules Skill - 元数据与 schema', () => {
  test('skill 元数据完整', () => {
    expect(skill.name).toBe('update_agent_rules')
    expect(skill.description).toBeTruthy()
    expect(skill.version).toBe('1.0.0')
    expect(skill.category).toBe('agent')
    expect(skill.services).toEqual([])
    expect(typeof skill.execute).toBe('function')
  })

  test('4 个参数全部必填', () => {
    expect(skill.parameters.section.required).toBe(true)
    expect(skill.parameters.subSection.required).toBe(true)
    expect(skill.parameters.action.required).toBe(true)
    expect(skill.parameters.item.required).toBe(true)
  })

  test('action 枚举只含 addItem / removeItem', () => {
    expect(skill.parameters.action.enum).toEqual(['addItem', 'removeItem'])
  })

  test('errors 定义了 7 个错误码', () => {
    const codes = Object.keys(skill.errors)
    expect(codes).toContain('ITEM_EXISTS')
    expect(codes).toContain('SECTION_NOT_FOUND')
    expect(codes).toContain('SUBSECTION_NOT_FOUND')
    expect(codes).toContain('ITEM_NOT_FOUND')
    expect(codes).toContain('INVALID_ACTION')
    expect(codes).toContain('USER_REJECTED')
    expect(codes).toContain('WRITE_FAILED')
  })
})

describe('update_agent_rules Skill - addItem 场景', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetCached.mockReturnValue({ raw: '', parsed: _existingParsed() })
    mockAskUser.mockResolvedValue({ success: true, answer: '同意写入' })
    mockSaveToFile.mockResolvedValue(undefined)
    mockFormatToMarkdown.mockImplementation(parsed => JSON.stringify(parsed))
  })

  test('addItem 到已有 section/subSection → 用户同意 → 写盘成功', async () => {
    const result = await skill.execute({
      section: '业务规则',
      subSection: '材料',
      action: 'addItem',
      item: '石子用 5-25mm 碎石'
    }, _ctx())

    expect(result.success).toBe(true)
    expect(result.written).toBe(true)
    expect(result.preview).toContain('新增列表项')
    expect(result.preview).toContain('石子用 5-25mm 碎石')
    expect(mockSaveToFile).toHaveBeenCalledTimes(1)
    // 验证 item 确实被加进去了
    const savedParsed = JSON.parse(mockSaveToFile.mock.calls[0][0])
    const matSub = savedParsed.sections[0].subSections.find(s => s.title === '材料')
    expect(matSub.items).toContain('石子用 5-25mm 碎石')
  })

  test('addItem 自动创建不存在的 section', async () => {
    const result = await skill.execute({
      section: '新业务段',
      subSection: '工艺',
      action: 'addItem',
      item: '养护 7 天'
    }, _ctx())

    expect(result.success).toBe(true)
    const savedParsed = JSON.parse(mockSaveToFile.mock.calls[0][0])
    const newSec = savedParsed.sections.find(s => s.title === '新业务段')
    expect(newSec).toBeDefined()
    expect(newSec.subSections[0].title).toBe('工艺')
    expect(newSec.subSections[0].items).toContain('养护 7 天')
  })

  test('addItem 自动创建不存在的 subSection', async () => {
    const result = await skill.execute({
      section: '业务规则',
      subSection: '新子段',
      action: 'addItem',
      item: '新规则条目'
    }, _ctx())

    expect(result.success).toBe(true)
    const savedParsed = JSON.parse(mockSaveToFile.mock.calls[0][0])
    const bizSec = savedParsed.sections.find(s => s.title === '业务规则')
    const newSub = bizSec.subSections.find(s => s.title === '新子段')
    expect(newSub).toBeDefined()
    expect(newSub.items).toContain('新规则条目')
  })

  test('addItem 重复项 → 返回 ITEM_EXISTS，不弹确认框不写盘', async () => {
    const result = await skill.execute({
      section: '业务规则',
      subSection: '材料',
      action: 'addItem',
      item: 'C30 用 P.O 42.5 水泥'  // 已存在
    }, _ctx())

    expect(result.success).toBe(false)
    expect(result.error.code).toBe('ITEM_EXISTS')
    expect(mockAskUser).not.toHaveBeenCalled()
    expect(mockSaveToFile).not.toHaveBeenCalled()
  })

  test('addItem 到 subSection.title 为 null 的段落也能正常加', async () => {
    // 回复规范段下的 subSection.title 是 null
    const result = await skill.execute({
      section: '回复规范',
      subSection: '称呼',
      action: 'addItem',
      item: '每次回复用"老板"开头'
    }, _ctx())

    expect(result.success).toBe(true)
    const savedParsed = JSON.parse(mockSaveToFile.mock.calls[0][0])
    const replySec = savedParsed.sections.find(s => s.title === '回复规范')
    // 应该新增了一个 title='称呼' 的 subSection（原来的 null title subSection 保留）
    const calledSub = replySec.subSections.find(s => s.title === '称呼')
    expect(calledSub).toBeDefined()
    expect(calledSub.items).toContain('每次回复用"老板"开头')
  })
})

describe('update_agent_rules Skill - removeItem 场景', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetCached.mockReturnValue({ raw: '', parsed: _existingParsed() })
    mockAskUser.mockResolvedValue({ success: true, answer: '同意写入' })
    mockSaveToFile.mockResolvedValue(undefined)
    mockFormatToMarkdown.mockImplementation(parsed => JSON.stringify(parsed))
  })

  test('removeItem 已存在项 → 用户同意 → 写盘成功', async () => {
    const result = await skill.execute({
      section: '业务规则',
      subSection: '材料',
      action: 'removeItem',
      item: '砂子用中砂'
    }, _ctx())

    expect(result.success).toBe(true)
    expect(result.preview).toContain('删除列表项')
    expect(mockSaveToFile).toHaveBeenCalledTimes(1)
    const savedParsed = JSON.parse(mockSaveToFile.mock.calls[0][0])
    const matSub = savedParsed.sections[0].subSections.find(s => s.title === '材料')
    expect(matSub.items).not.toContain('砂子用中砂')
    // 另一项应保留
    expect(matSub.items).toContain('C30 用 P.O 42.5 水泥')
  })

  test('removeItem section 不存在 → SECTION_NOT_FOUND，不弹确认不写盘', async () => {
    const result = await skill.execute({
      section: '不存在的段',
      subSection: '材料',
      action: 'removeItem',
      item: 'xxx'
    }, _ctx())

    expect(result.success).toBe(false)
    expect(result.error.code).toBe('SECTION_NOT_FOUND')
    expect(mockAskUser).not.toHaveBeenCalled()
    expect(mockSaveToFile).not.toHaveBeenCalled()
  })

  test('removeItem subSection 不存在 → SUBSECTION_NOT_FOUND', async () => {
    const result = await skill.execute({
      section: '业务规则',
      subSection: '不存在的子段',
      action: 'removeItem',
      item: 'xxx'
    }, _ctx())

    expect(result.success).toBe(false)
    expect(result.error.code).toBe('SUBSECTION_NOT_FOUND')
    expect(mockAskUser).not.toHaveBeenCalled()
  })

  test('removeItem item 不存在 → ITEM_NOT_FOUND', async () => {
    const result = await skill.execute({
      section: '业务规则',
      subSection: '材料',
      action: 'removeItem',
      item: '不存在的规则项'
    }, _ctx())

    expect(result.success).toBe(false)
    expect(result.error.code).toBe('ITEM_NOT_FOUND')
    expect(mockAskUser).not.toHaveBeenCalled()
  })
})

describe('update_agent_rules Skill - 用户确认流程', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetCached.mockReturnValue({ raw: '', parsed: _existingParsed() })
    mockFormatToMarkdown.mockImplementation(parsed => JSON.stringify(parsed))
  })

  test('用户点取消 → saveToFile 不被调用，返回 USER_REJECTED', async () => {
    mockAskUser.mockResolvedValue({ success: true, answer: '取消' })

    const result = await skill.execute({
      section: '业务规则',
      subSection: '材料',
      action: 'addItem',
      item: '新规则'
    }, _ctx())

    expect(result.success).toBe(false)
    expect(result.error.code).toBe('USER_REJECTED')
    expect(mockSaveToFile).not.toHaveBeenCalled()
  })

  test('用户超时（ask_user 返回 success:false）→ saveToFile 不被调用', async () => {
    mockAskUser.mockResolvedValue({ success: false, error: { code: 'E_ASK_USER_TIMEOUT' } })

    const result = await skill.execute({
      section: '业务规则',
      subSection: '材料',
      action: 'addItem',
      item: '新规则'
    }, _ctx())

    expect(result.success).toBe(false)
    expect(result.error.code).toBe('USER_REJECTED')
    expect(mockSaveToFile).not.toHaveBeenCalled()
  })

  test('确认框问题文本包含预览信息', async () => {
    mockAskUser.mockResolvedValue({ success: true, answer: '同意写入' })
    mockSaveToFile.mockResolvedValue(undefined)

    await skill.execute({
      section: '业务规则',
      subSection: '材料',
      action: 'addItem',
      item: '测试规则项'
    }, _ctx())

    expect(mockAskUser).toHaveBeenCalledTimes(1)
    const askArgs = mockAskUser.mock.calls[0][0]
    expect(askArgs.inputType).toBe('choice')
    expect(askArgs.options).toEqual(['同意写入', '取消'])
    expect(askArgs.question).toContain('业务规则')
    expect(askArgs.question).toContain('材料')
    expect(askArgs.question).toContain('测试规则项')
    expect(askArgs.question).toContain('新增列表项')
  })
})

describe('update_agent_rules Skill - 异常与边界', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetCached.mockReturnValue({ raw: '', parsed: _existingParsed() })
    mockAskUser.mockResolvedValue({ success: true, answer: '同意写入' })
    mockFormatToMarkdown.mockImplementation(parsed => JSON.stringify(parsed))
  })

  test('saveToFile 抛错 → 返回 WRITE_FAILED', async () => {
    mockSaveToFile.mockRejectedValue(new Error('磁盘已满'))

    const result = await skill.execute({
      section: '业务规则',
      subSection: '材料',
      action: 'addItem',
      item: '新规则'
    }, _ctx())

    expect(result.success).toBe(false)
    expect(result.error.code).toBe('WRITE_FAILED')
    expect(result.message).toContain('磁盘已满')
  })

  test('无效 action → 返回 INVALID_ACTION，不弹确认不写盘', async () => {
    const result = await skill.execute({
      section: '业务规则',
      subSection: '材料',
      action: 'replaceSection',
      item: 'xxx'
    }, _ctx())

    expect(result.success).toBe(false)
    expect(result.error.code).toBe('INVALID_ACTION')
    expect(mockAskUser).not.toHaveBeenCalled()
    expect(mockSaveToFile).not.toHaveBeenCalled()
  })

  test('agent.md 为空（getCached 返回空结构）→ addItem 自动建骨架', async () => {
    mockGetCached.mockReturnValue({
      raw: '',
      parsed: { version: 2, sections: [] }
    })
    mockSaveToFile.mockResolvedValue(undefined)

    const result = await skill.execute({
      section: '业务规则',
      subSection: '材料',
      action: 'addItem',
      item: '第一条规则'
    }, _ctx())

    expect(result.success).toBe(true)
    const savedParsed = JSON.parse(mockSaveToFile.mock.calls[0][0])
    expect(savedParsed.sections.length).toBe(1)
    expect(savedParsed.sections[0].title).toBe('业务规则')
    expect(savedParsed.sections[0].subSections[0].title).toBe('材料')
    expect(savedParsed.sections[0].subSections[0].items).toContain('第一条规则')
  })

  test('item 文本含特殊字符（# -）也能正常写入', async () => {
    mockSaveToFile.mockResolvedValue(undefined)

    const result = await skill.execute({
      section: '业务规则',
      subSection: '材料',
      action: 'addItem',
      item: 'C40-C50 高强混凝土 # 重要'
    }, _ctx())

    expect(result.success).toBe(true)
    const savedParsed = JSON.parse(mockSaveToFile.mock.calls[0][0])
    const matSub = savedParsed.sections[0].subSections.find(s => s.title === '材料')
    expect(matSub.items).toContain('C40-C50 高强混凝土 # 重要')
  })
})
