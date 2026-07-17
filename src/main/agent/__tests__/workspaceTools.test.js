// workspaceTools.recordAnswer（v2026-07-17）测试
// - Skill 注册到 buildWorkspaceSkills 返回列表
// - 参数 schema 正确（question/answer 必填，refs 可选）
// - 成功调用 → WikiEngine.recordAnswer 被触发并返回 { status, answerPath }
// - 工作区未打开 → NOT_OPEN 错误被 Skill 层包装成 ErrorCodes 标准格式
const path = require('path')
const fs = require('fs').promises
const { buildWorkspaceSkills } = require('../workspaceTools')
const { WorkspaceManager } = require('../../workspace/WorkspaceManager')
const { WikiEngine } = require('../../workspace/WikiEngine')

describe('workspaceTools.workspace_recordAnswer (v2026-07-17)', () => {
  let mgr, wiki, testPath, skills

  beforeEach(async () => {
    testPath = path.join(__dirname, '__fixtures__/wiki-recordAnswer-skill-test')
    await fs.rm(testPath, { recursive: true, force: true }).catch(() => {})
    await fs.mkdir(testPath, { recursive: true })
    mgr = new WorkspaceManager()
    await mgr.open(testPath)
    wiki = new WikiEngine({ workspace: mgr })
    skills = buildWorkspaceSkills({ workspaceManager: mgr, wikiEngine: wiki })
  })

  afterEach(async () => {
    await mgr.close()
    await fs.rm(testPath, { recursive: true, force: true }).catch(() => {})
  })

  test('buildWorkspaceSkills 应注册 workspace_recordAnswer', () => {
    const found = skills.find(s => s.name === 'workspace_recordAnswer')
    expect(found).toBeDefined()
    expect(found.category).toBe('workspace')
    // 参数 schema 完整性
    expect(found.parameters.question.required).toBe(true)
    expect(found.parameters.answer.required).toBe(true)
    expect(found.parameters.refs.required).toBe(false)
    expect(found.parameters.refs.default).toEqual([])
  })

  test('成功调用 → wiki/answers/<ts>.md 被写入 + 返回 { status, answerPath }', async () => {
    const skill = skills.find(s => s.name === 'workspace_recordAnswer')
    const result = await skill.execute(
      { question: '抗渗混凝土水胶比上限？', answer: '不应大于 0.45。', refs: ['sources/jtg-3420-2020.md'] },
      {}
    )
    expect(result.status).toBe('ok')
    expect(result.answerPath).toMatch(/^answers\/\d{4}-\d{2}-\d{2}T[\d-]+Z\.md$/)

    // 文件确实落盘
    const answerAbs = path.join(testPath, 'wiki', result.answerPath)
    const raw = await fs.readFile(answerAbs, 'utf-8')
    expect(raw).toContain('question:')
    expect(raw).toContain('不应大于 0.45')
    expect(raw).toContain('sources/jtg-3420-2020')
  })

  test('refs 缺省 → 走默认空数组（不报错）', async () => {
    const skill = skills.find(s => s.name === 'workspace_recordAnswer')
    const result = await skill.execute(
      { question: '水胶比定义？', answer: '水与胶凝材料的质量比。' },
      {}
    )
    expect(result.status).toBe('ok')
    const raw = await fs.readFile(path.join(testPath, 'wiki', result.answerPath), 'utf-8')
    expect(raw).toContain('refs:')
  })

  test('工作区未打开 → WorkspaceError 被包装成 ErrorCodes 标准错误格式', async () => {
    await mgr.close()
    const skill = skills.find(s => s.name === 'workspace_recordAnswer')
    const result = await skill.execute(
      { question: 'q', answer: 'a', refs: [] },
      {}
    )
    // Skill 层不抛，转成 ErrorCodes.createError() 标准格式
    // （spec: code 而非 errorCode，title 而非 message）
    expect(result).toMatchObject({ success: false, code: 'NOT_OPEN' })
  })
})