/**
 * parse-with-mineru skill（v0.7.0）
 *
 * 用 MinerU 云端高精度解析文档，适用于：扫描件 PDF（本地无法提取文字）、
 * 含复杂表格/公式/多栏版式的文档、图片、PPT/PPTX、HTML。输出 Markdown。
 * 会上传到 mineru 云端，需用户确认。本地 reader 能处理的普通文档无需调用此 skill。
 *
 * 关键设计（详见 spec §4.2.3/§4.3，三轮对抗性审查修正）：
 * - services: [] —— SystemService 直接 require，workspaceManager/wikiEngine 用 global 闭包
 *   （不靠 context 服务名：allServices 注册的是 workspace/wiki，不是 workspaceManager/wikiEngine）
 * - 工作区根路径：getWM().current()?.path（硬伤1：current() 返回 {path,status} 或 null，无 getPath()）
 * - 用户交互：context.orchestrator.requestConfirmation（硬伤3：skill 间不能互调，不调 ask_user skill）
 * - Token 三分支（P1-F）：userToken有/无+内置有/无+内置无，form 收集后 skill 直接调 saveMineruConfig
 * - 三件套（P0-1/P0-2/P1-E）：数同名→tmp+rename 原子落盘(try/finally)→显式 await ingest
 * - isWrite: true（写 raw/md/，影响 agent 记账）
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { createError } = require('../agent/ErrorCodes')

// ===== global 闭包（照抄 workspaceTools.js:26-27，不依赖 context 服务名）=====
const getWM = () => global.workspaceManager
const getWiki = () => global.wikiEngine

// ===== Token 加载（直接 require 单例，不靠 context）=====
const SystemService = require('../services/SystemService')
const { hasBuiltinToken } = require('../services/mineruBuiltinToken')

// ===== 错误映射：WorkspaceError → E-MINERU-* =====
const ERR_MAP = {
  NO_TOKEN: 'E-MINERU-NO-TOKEN',
  SIZE_EXCEEDED: 'E-MINERU-SIZE-EXCEEDED',
  UPLOAD_FAIL: 'E-MINERU-UPLOAD-FAIL',
  PARSE_FAIL: 'E-MINERU-PARSE-FAIL',
  TIMEOUT: 'E-MINERU-TIMEOUT',
  NETWORK: 'E-MINERU-NETWORK',
  API_ERROR: 'E-MINERU-API-ERROR'
}
function mapMineruError(err) {
  const code = ERR_MAP[err.code] || 'E-MINERU-API-ERROR'
  const e = createError(code, err.message)
  if (err.batch_id) e.details = { batch_id: err.batch_id }
  return e
}

// ===== 工具函数 =====
async function pathExists(p) {
  try { await fs.promises.access(p); return true } catch { return false }
}

// 三件套①：数同名，拿不冲突的目标路径（P0-2：buildTargetRelPath 是纯函数不碰磁盘，自己扫）
async function resolveTarget(rawMdDir, stem) {
  const base = `${stem}.md`
  let target = path.join(rawMdDir, base)
  if (!await pathExists(target)) return target
  let n = 1
  while (true) {
    const cand = path.join(rawMdDir, `${stem}_${n}.md`)
    if (!await pathExists(cand)) return cand
    n++
  }
}

// requestConfirmation 封装（choice/form，传参照抄 ask-user.js:192-200）
async function askChoice(orchestrator, question, options) {
  const result = await orchestrator.requestConfirmation({
    toolName: 'parse_with_mineru', question, inputType: 'choice', options
  })
  return (result && result.answer) || ''
}
async function askForm(orchestrator, question, fields) {
  const result = await orchestrator.requestConfirmation({
    toolName: 'parse_with_mineru', question, inputType: 'form', fields
  })
  return (result && result.values) || {}
}

const skill = {
  name: 'parse_with_mineru',
  description: '用 MinerU 云端高精度解析文档，适用于：扫描件 PDF（本地无法提取文字）、含复杂表格/公式/多栏版式的文档、图片（png/jpg等）、PPT/PPTX、HTML。输出 Markdown。会上传到 mineru 云端，需用户确认。本地 reader 能处理的普通文档无需调用此 skill。',
  version: '1.0.0',
  category: 'agent',
  isWrite: true,
  parameters: {
    filePath: { type: 'string', description: '工作区内文档的相对路径（如 raw/xxx.pdf）', required: true }
  },
  services: [],  // SystemService 直接 require，不靠 context；workspaceManager/wikiEngine 用 global

  async execute(args, context) {
    const { orchestrator } = context

    // ===== 1. 参数校验（先于工作区）=====
    if (!args.filePath || typeof args.filePath !== 'string') {
      return createError('PARAM_MISSING', '缺少 filePath 参数', '请提供工作区内文档的相对路径')
    }

    // ===== 2. 工作区（硬伤1：current() 取 path，无 getPath()）=====
    const wm = getWM()
    const ws = wm && wm.current()
    if (!ws || !ws.path) {
      return createError('E-SYS-999', '工作区未打开', '请先打开工作区后再用 MinerU 解析')
    }
    const workspaceRoot = ws.path
    const absPath = path.join(workspaceRoot, args.filePath)

    if (!orchestrator || typeof orchestrator.requestConfirmation !== 'function') {
      return createError('E-SYS-999', '交互服务不可用', '无法弹出确认对话')
    }

    // ===== 2. Token 三分支（P1-F 写死；P0-B：form 收集后 skill 直接保存）=====
    const cfg = await SystemService.getMineruConfig()
    const hasUser = !!cfg.userToken
    const hasBuiltin = hasBuiltinToken()

    if (!hasUser && hasBuiltin) {
      // 分支2：choice 选内置/自配
      const choice = await askChoice(
        orchestrator,
        '当前未配置个人 MinerU Token。\n1) 使用砼智内置 Token（共享每日额度）\n2) 我自己配置 Token\n请选择（输入 1 或 2）',
        ['1', '2']
      )
      if (choice === '2') {
        const form = await askForm(
          orchestrator,
          '请填写你的 MinerU Token（到 mineru.net 获取，sk- 开头）',
          [{ key: 'token', label: 'MinerU Token' }]
        )
        if (!form.token) return { success: false, message: '未提供 Token，已取消' }
        await SystemService.saveMineruConfig({ userToken: form.token })
      }
      // 选 1 继续
    } else if (!hasUser && !hasBuiltin) {
      // 分支3：form 收集
      const form = await askForm(
        orchestrator,
        '未配置 MinerU Token（内置 Token 也未注入），请填写你的 Token（到 mineru.net 获取，sk- 开头）',
        [{ key: 'token', label: 'MinerU Token' }]
      )
      if (!form.token) return { success: false, message: '未提供 Token，已取消' }
      await SystemService.saveMineruConfig({ userToken: form.token })
    }
    // 分支1：hasUser 直接继续

    // ===== 3. 上云确认 =====
    const confirm = await askChoice(
      orchestrator,
      `该文档将上传至 MinerU 云端解析，是否继续？\n文件: ${path.basename(args.filePath)}`,
      ['同意', '取消']
    )
    if (confirm !== '同意') {
      return { success: false, message: '用户取消上云，MinerU 未使用，文档未入库' }
    }

    // ===== 4. 调 mineru reader 解析 =====
    const mineruReader = require('../workspace/readers/mineru')
    let parseResult
    try {
      parseResult = await mineruReader.read(absPath)
    } catch (err) {
      return mapMineruError(err)
    }

    // ===== 5. 三件套写入 raw/md/ =====
    const stem = path.basename(args.filePath, path.extname(args.filePath))
    const rawMdDir = path.join(workspaceRoot, 'raw', 'md')
    const tmpDir = path.join(rawMdDir, '.tmp')  // chokidar ignored（.tmp/ + 隐藏文件双重忽略）
    await fs.promises.mkdir(rawMdDir, { recursive: true })
    await fs.promises.mkdir(tmpDir, { recursive: true })

    // ① 数同名（P0-2 防覆盖）
    const targetPath = await resolveTarget(rawMdDir, stem)
    const targetRel = path.relative(workspaceRoot, targetPath).replace(/\\/g, '/')  // raw/md/xxx.md
    const tmpFile = path.join(tmpDir, `${crypto.randomUUID()}.md`)

    // ② tmp + rename 原子落盘（P0-1 防 chokidar 读半截；P1-E try/finally 清残留）
    try {
      await fs.promises.writeFile(tmpFile, parseResult.content, 'utf8')
      await fs.promises.rename(tmpFile, targetPath)
    } catch (err) {
      try { await fs.promises.unlink(tmpFile) } catch { /* ignore */ }
      return createError('E-SYS-999', `写入文件失败: ${err.message}`)
    }
    // rename 成功后 tmpFile 已不存在，无需额外清理

    // ===== 6. 显式 await ingest（P0-1：不靠 chokidar 自动 ingest，它无完成回调）=====
    const wiki = getWiki()
    if (!wiki) {
      return {
        success: true,
        message: `已写入 ${targetRel}，但 wikiEngine 不可用，将由工作区监听自动入库`,
        writtenPath: targetRel,
        contentLength: parseResult.content.length
      }
    }
    let ingestResult
    try {
      ingestResult = await wiki.ingest({ filename: targetRel })
    } catch (err) {
      return {
        success: true,
        message: `已写入 ${targetRel}，但入库失败: ${err.message}（文件已落盘，可手动入库）`,
        writtenPath: targetRel,
        contentLength: parseResult.content.length
      }
    }
    // chokidar 二次 ingest 靠幂等兜底（rename 保证完整文件，不数据错误，P0-1 决策）

    return {
      success: true,
      message: 'MinerU 解析完成，已入库',
      writtenPath: targetRel,
      pagesCreated: (ingestResult && ingestResult.pagesCreated) || [],
      contentLength: parseResult.content.length
    }
  }
}

module.exports = skill
