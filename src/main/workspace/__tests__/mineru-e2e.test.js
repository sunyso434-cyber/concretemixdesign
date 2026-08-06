/**
 * MinerU e2e 集成测试（v0.7.0 T9）
 *
 * 目标：验证"扫描件 → mineru → raw/md/ 落盘 + wiki/sources/ 有 slug 页面"端到端链路。
 * 增量价值（vs parse-with-mineru.test.js）：用真实工作区目录 + mock ingest 真的创建
 * wiki/sources/<slug>.md 文件，断言最终文件状态（不止断言 ingest 被调）。
 *
 * mock 策略（按 plan T9：mock mineru reader，不真实调云端）：
 * - mineruReader.read：mock 返回 md 内容
 * - wikiEngine.ingest：mock 实现，真的创建 wiki/sources/<slug>.md（模拟真实 ingest 行为）
 * - orchestrator.requestConfirmation：mock 返回同意
 * - SystemService.getMineruConfig：mock 分支1（userToken 已配）
 *
 * 不重复覆盖：分支2/3/拒绝已在 parse-with-mineru.test.js 覆盖
 */
const fs = require('fs')
const path = require('path')
const os = require('os')

// mock 依赖（同 parse-with-mineru.test.js）
jest.mock('../../services/SystemService', () => ({
  getMineruConfig: jest.fn(),
  saveMineruConfig: jest.fn().mockResolvedValue()
}))
jest.mock('../../services/mineruBuiltinToken', () => ({
  hasBuiltinToken: jest.fn()
}))
jest.mock('../readers/mineru', () => ({ read: jest.fn() }))

const SystemService = require('../../services/SystemService')
const { hasBuiltinToken } = require('../../services/mineruBuiltinToken')
const mineruReader = require('../readers/mineru')
const skill = require('../../skills/parse-with-mineru')

let tmpWorkspace, origWM, origWiki

function makeCtx(confirmImpl) {
  return { orchestrator: { requestConfirmation: confirmImpl } }
}

/**
 * setupWorkspace：建真实临时工作区目录 + mock global.workspaceManager/wikiEngine
 * - wikiEngine.ingest mock 实现：读 raw/md/<文件> 内容，写 wiki/sources/<slug>.md
 *   模拟真实 WikiEngine._buildSlug 对纯英文文件名的行为（slug = basename 去 .md）
 */
function setupWorkspace() {
  tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mineru-e2e-'))
  fs.mkdirSync(path.join(tmpWorkspace, 'raw', 'pdf'), { recursive: true })
  fs.mkdirSync(path.join(tmpWorkspace, 'raw', 'md'), { recursive: true })
  fs.mkdirSync(path.join(tmpWorkspace, 'wiki', 'sources'), { recursive: true })
  // 放一个假的扫描件 PDF（mineru reader 是 mock 的，不真读，文件只是占位）
  fs.writeFileSync(path.join(tmpWorkspace, 'raw', 'pdf', 'scan.pdf'), 'fake scanned pdf')

  origWM = global.workspaceManager
  origWiki = global.wikiEngine
  global.workspaceManager = { current: () => ({ path: tmpWorkspace, status: 'ready' }) }
  // mock ingest：真的创建 wiki/sources/<slug>.md 文件（模拟真实 ingest 落盘）
  global.wikiEngine = {
    ingest: jest.fn(async ({ filename }) => {
      const srcAbs = path.join(tmpWorkspace, filename)
      const slug = path.basename(filename, '.md').toLowerCase().replace(/\s+/g, '-')
      const wikiPage = path.join(tmpWorkspace, 'wiki', 'sources', `${slug}.md`)
      const content = fs.readFileSync(srcAbs, 'utf8')
      fs.writeFileSync(wikiPage, `# ${slug}\n\n${content}\n`, 'utf8')
      return { pagesCreated: [`sources/${slug}.md`] }
    })
  }
}

function teardownWorkspace() {
  global.workspaceManager = origWM
  global.wikiEngine = origWiki
  try { fs.rmSync(tmpWorkspace, { recursive: true, force: true }) } catch { /* ignore */ }
}

describe('MinerU e2e 集成测试 (T9)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // 分支1：userToken 已配，只走上云确认（requestConfirmation 调用 1 次）
    SystemService.getMineruConfig.mockResolvedValue({ userToken: 'my-token' })
    hasBuiltinToken.mockReturnValue(true)
    mineruReader.read.mockResolvedValue({
      content: '# 扫描件解析结果\n\n这是 mineru 解析出的内容。',
      metadata: { fileName: 'scan.pdf' }
    })
  })

  test('e2e: 扫描件 → mineru → raw/md/ 落盘 + wiki/sources/ 有 slug 页面（分支1，确认1次）', async () => {
    setupWorkspace()
    try {
      const confirm = jest.fn().mockResolvedValueOnce({ answer: '同意' })
      const result = await skill.execute({ filePath: 'raw/pdf/scan.pdf' }, makeCtx(confirm))

      // 成功
      expect(result.success).toBe(true)
      expect(result.writtenPath).toBe('raw/md/scan.md')

      // 分支1：userToken 已配，只走上云确认，requestConfirmation 只调 1 次
      expect(confirm).toHaveBeenCalledTimes(1)

      // raw/md/scan.md 文件落盘 + 内容正确
      const mdPath = path.join(tmpWorkspace, 'raw', 'md', 'scan.md')
      expect(fs.existsSync(mdPath)).toBe(true)
      expect(fs.readFileSync(mdPath, 'utf8')).toContain('扫描件解析结果')

      // wiki/sources/ 有 slug 页面（由 ingest mock 真实创建）
      const wikiPage = path.join(tmpWorkspace, 'wiki', 'sources', 'scan.md')
      expect(fs.existsSync(wikiPage)).toBe(true)
      expect(fs.readFileSync(wikiPage, 'utf8')).toContain('扫描件解析结果')

      // ingest 被调用，参数正确
      expect(global.wikiEngine.ingest).toHaveBeenCalledWith({ filename: 'raw/md/scan.md' })
      expect(result.pagesCreated).toEqual(['sources/scan.md'])

      // tmp 已清理（rename 后无残留）
      const tmpFiles = fs.readdirSync(path.join(tmpWorkspace, 'raw', 'md', '.tmp'))
      expect(tmpFiles.length).toBe(0)
    } finally { teardownWorkspace() }
  })

  test('e2e: 同名冲突 → _1 后缀，原 raw/md 与 wiki/sources slug 都不覆盖', async () => {
    setupWorkspace()
    try {
      // 预置已有文件（raw/md/scan.md + wiki/sources/scan.md）
      fs.writeFileSync(path.join(tmpWorkspace, 'raw', 'md', 'scan.md'), '原有 md 内容', 'utf8')
      fs.writeFileSync(path.join(tmpWorkspace, 'wiki', 'sources', 'scan.md'), '原有 wiki 页', 'utf8')

      const confirm = jest.fn().mockResolvedValueOnce({ answer: '同意' })
      const result = await skill.execute({ filePath: 'raw/pdf/scan.pdf' }, makeCtx(confirm))

      expect(result.success).toBe(true)
      expect(result.writtenPath).toBe('raw/md/scan_1.md')

      // 原 raw/md/scan.md 不变
      expect(fs.readFileSync(path.join(tmpWorkspace, 'raw', 'md', 'scan.md'), 'utf8')).toBe('原有 md 内容')
      // 新 raw/md/scan_1.md 是解析结果
      expect(fs.readFileSync(path.join(tmpWorkspace, 'raw', 'md', 'scan_1.md'), 'utf8')).toContain('扫描件解析结果')

      // wiki/sources/ 新增 scan_1 slug，原 scan 不覆盖
      expect(fs.existsSync(path.join(tmpWorkspace, 'wiki', 'sources', 'scan_1.md'))).toBe(true)
      expect(fs.readFileSync(path.join(tmpWorkspace, 'wiki', 'sources', 'scan.md'), 'utf8')).toBe('原有 wiki 页')
      expect(fs.readFileSync(path.join(tmpWorkspace, 'wiki', 'sources', 'scan_1.md'), 'utf8')).toContain('扫描件解析结果')

      // ingest 用的是 scan_1.md（不冲突的目标路径）
      expect(global.wikiEngine.ingest).toHaveBeenCalledWith({ filename: 'raw/md/scan_1.md' })
      expect(result.pagesCreated).toEqual(['sources/scan_1.md'])
    } finally { teardownWorkspace() }
  })
})
