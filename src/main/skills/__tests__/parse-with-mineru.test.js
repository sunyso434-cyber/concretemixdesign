const fs = require('fs')
const path = require('path')
const os = require('os')

// mock 依赖
jest.mock('../../services/SystemService', () => ({
  getMineruConfig: jest.fn(),
  saveMineruConfig: jest.fn().mockResolvedValue()
}))
jest.mock('../../services/mineruBuiltinToken', () => ({
  hasBuiltinToken: jest.fn()
}))
jest.mock('../../workspace/readers/mineru', () => ({ read: jest.fn() }))

const SystemService = require('../../services/SystemService')
const { hasBuiltinToken } = require('../../services/mineruBuiltinToken')
const mineruReader = require('../../workspace/readers/mineru')
const { WorkspaceError } = require('../../workspace/WorkspaceError')

const skill = require('../parse-with-mineru')

let tmpWorkspace, origWM, origWiki

function makeCtx(confirmImpl) {
  return { orchestrator: { requestConfirmation: confirmImpl } }
}

// 工作区 current() 返回 {path, status}
function setupWorkspace() {
  tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mineru-ws-'))
  origWM = global.workspaceManager
  origWiki = global.wikiEngine
  global.workspaceManager = { current: () => ({ path: tmpWorkspace, status: 'ready' }) }
  global.wikiEngine = { ingest: jest.fn().mockResolvedValue({ pagesCreated: ['sources/x.md'] }) }
}

function teardownWorkspace() {
  global.workspaceManager = origWM
  global.wikiEngine = origWiki
  try { fs.rmSync(tmpWorkspace, { recursive: true, force: true }) } catch {}
}

describe('parse-with-mineru skill', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    SystemService.getMineruConfig.mockResolvedValue({ userToken: 'my-token' })  // 默认分支1
    hasBuiltinToken.mockReturnValue(true)
    mineruReader.read.mockResolvedValue({ content: '# 解析结果\n正文', metadata: { fileName: 'a.pdf' } })
  })

  test('元数据：isWrite=true, services=[]', () => {
    expect(skill.isWrite).toBe(true)
    expect(skill.services).toEqual([])
    expect(skill.name).toBe('parse_with_mineru')
  })

  test('正常流程：用户同意→三件套写入→ingest→返回 pagesCreated', async () => {
    setupWorkspace()
    try {
      const confirm = jest.fn()
        .mockResolvedValueOnce({ answer: '同意' })  // 上云确认
      const result = await skill.execute({ filePath: 'raw/test.pdf' }, makeCtx(confirm))
      expect(result.success).toBe(true)
      expect(result.writtenPath).toBe('raw/md/test.md')
      expect(result.pagesCreated).toEqual(['sources/x.md'])
      expect(mineruReader.read).toHaveBeenCalled()
      expect(global.wikiEngine.ingest).toHaveBeenCalledWith({ filename: 'raw/md/test.md' })
      // 文件已落盘
      expect(fs.existsSync(path.join(tmpWorkspace, 'raw/md/test.md'))).toBe(true)
      // tmp 已清理（rename 后无残留）
      const tmpFiles = fs.readdirSync(path.join(tmpWorkspace, 'raw/md/.tmp'))
      expect(tmpFiles.length).toBe(0)
    } finally { teardownWorkspace() }
  })

  test('用户拒绝上云→不调 reader', async () => {
    setupWorkspace()
    try {
      const confirm = jest.fn().mockResolvedValueOnce({ answer: '取消' })
      const result = await skill.execute({ filePath: 'raw/test.pdf' }, makeCtx(confirm))
      expect(result.success).toBe(false)
      expect(mineruReader.read).not.toHaveBeenCalled()
    } finally { teardownWorkspace() }
  })

  test('同名冲突→生成 _1 后缀，原文件内容不变（P0-2 防覆盖）', async () => {
    setupWorkspace()
    try {
      // 预置已有文件
      fs.mkdirSync(path.join(tmpWorkspace, 'raw/md'), { recursive: true })
      fs.writeFileSync(path.join(tmpWorkspace, 'raw/md/test.md'), '原有内容', 'utf8')
      const confirm = jest.fn().mockResolvedValueOnce({ answer: '同意' })
      const result = await skill.execute({ filePath: 'raw/test.pdf' }, makeCtx(confirm))
      expect(result.writtenPath).toBe('raw/md/test_1.md')
      // 原文件不变
      expect(fs.readFileSync(path.join(tmpWorkspace, 'raw/md/test.md'), 'utf8')).toBe('原有内容')
      // 新文件是解析结果
      expect(fs.readFileSync(path.join(tmpWorkspace, 'raw/md/test_1.md'), 'utf8')).toContain('解析结果')
    } finally { teardownWorkspace() }
  })

  test('无工作区（current 返回 null）→ E-SYS-999（硬伤1 验证）', async () => {
    origWM = global.workspaceManager
    global.workspaceManager = { current: () => null }
    try {
      const result = await skill.execute({ filePath: 'raw/test.pdf' }, makeCtx(jest.fn()))
      expect(result.success).toBe(false)
      expect(result.code).toBe('E-SYS-999')
      expect(mineruReader.read).not.toHaveBeenCalled()
    } finally {
      global.workspaceManager = origWM
    }
  })

  test('Token 分支2 选自配→form 收到后 saveMineruConfig 被调 + requestConfirmation 调用2次（P0-B）', async () => {
    setupWorkspace()
    SystemService.getMineruConfig.mockResolvedValue({ userToken: null })  // 无 userToken
    hasBuiltinToken.mockReturnValue(true)  // 有内置
    try {
      const confirm = jest.fn()
        .mockResolvedValueOnce({ answer: '2' })                    // choice 选自配
        .mockResolvedValueOnce({ values: { token: 'sk-newtoken' } })  // form 收集
        .mockResolvedValueOnce({ answer: '同意' })                 // 上云确认
      const result = await skill.execute({ filePath: 'raw/test.pdf' }, makeCtx(confirm))
      expect(result.success).toBe(true)
      expect(SystemService.saveMineruConfig).toHaveBeenCalledWith({ userToken: 'sk-newtoken' })
      expect(confirm).toHaveBeenCalledTimes(3)  // choice + form + 上云确认
    } finally { teardownWorkspace() }
  })

  test('Token 分支3（无userToken+无内置）→ form 收集后保存', async () => {
    setupWorkspace()
    SystemService.getMineruConfig.mockResolvedValue({ userToken: null })
    hasBuiltinToken.mockReturnValue(false)
    try {
      const confirm = jest.fn()
        .mockResolvedValueOnce({ values: { token: 'sk-mine' } })
        .mockResolvedValueOnce({ answer: '同意' })
      const result = await skill.execute({ filePath: 'raw/test.pdf' }, makeCtx(confirm))
      expect(result.success).toBe(true)
      expect(SystemService.saveMineruConfig).toHaveBeenCalledWith({ userToken: 'sk-mine' })
    } finally { teardownWorkspace() }
  })

  test('MineruService 抛 WorkspaceError→映射 E-MINERU-*', async () => {
    setupWorkspace()
    mineruReader.read.mockRejectedValue(new WorkspaceError('PARSE_FAIL', '解析失败', false))
    try {
      const confirm = jest.fn().mockResolvedValueOnce({ answer: '同意' })
      const result = await skill.execute({ filePath: 'raw/test.pdf' }, makeCtx(confirm))
      expect(result.success).toBe(false)
      expect(result.code).toBe('E-MINERU-PARSE-FAIL')
    } finally { teardownWorkspace() }
  })

  test('TIMEOUT 错误带 batch_id 透传到 details', async () => {
    setupWorkspace()
    const err = new WorkspaceError('TIMEOUT', '超时', true)
    err.batch_id = 'batch-xyz'
    mineruReader.read.mockRejectedValue(err)
    try {
      const confirm = jest.fn().mockResolvedValueOnce({ answer: '同意' })
      const result = await skill.execute({ filePath: 'raw/test.pdf' }, makeCtx(confirm))
      expect(result.code).toBe('E-MINERU-TIMEOUT')
      expect(result.details.batch_id).toBe('batch-xyz')
    } finally { teardownWorkspace() }
  })

  test('缺 filePath→PARAM_MISSING', async () => {
    const result = await skill.execute({}, makeCtx(jest.fn()))
    expect(result.success).toBe(false)
    expect(result.code).toBe('PARAM_MISSING')
  })
})
