/**
 * 读图核心技能 - analyze_concrete_image
 *
 * 单一职责：调视觉 API 抽取图片中的客观信息（缺陷 / 试块外观 / OCR 等），
 * 不做诊断、调参、报告生成（这些由 Agent 层用其他技能组合完成）。
 *
 * 来源支持：
 * - imageBase64: 聊天框粘贴（优先）
 * - imagePath: 工作区文件路径（fallback）
 */

const fs = require('fs').promises
const path = require('path')
const { createError } = require('../agent/ErrorCodes')
const VisionService = require('../services/VisionService')

const SYSTEM_PROMPT = `你是混凝土视觉分析助手。分析用户提供的图片，输出严格的 JSON 格式：
{
  "imageType": "defect" | "specimen" | "table" | "gauge" | "general",
  "description": "整体描述（自然语言）",
  "details": {
    // imageType=defect
    "defects": [{ "type": "缺陷类型", "location": "位置", "size": "尺寸", "severity": "严重程度", "confidence": 0.0-1.0 }],
    // imageType=table 或 gauge
    "ocrText": "完整 OCR 文本",
    "ocrData": { "字段名": "值" },
    // imageType=specimen
    "specimenFeatures": { "shape": "...", "color": "...", "surface": "...", "defects": [] }
  },
  "confidence": 0.0-1.0
}
只输出 JSON，不要 markdown 代码块。`

async function readImageAsBase64(imagePath) {
  try {
    await fs.access(imagePath)
  } catch {
    throw createError('E-VISION-FILE-NOT-FOUND', '图片文件不存在', '请检查文件路径', { path: imagePath })
  }
  const buf = await fs.readFile(imagePath)
  const ext = path.extname(imagePath).toLowerCase().replace('.', '') || 'jpeg'
  const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
  return `data:${mime};base64,${buf.toString('base64')}`
}

function safeParseJSON(text) {
  try {
    return JSON.parse(text)
  } catch {
    // 尝试提取 markdown 代码块
    const m = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (m) {
      try { return JSON.parse(m[1].trim()) } catch {}
    }
    return null
  }
}

/**
 * 解析图片路径：支持绝对路径，或相对于当前工作区根目录的相对路径。
 * workspace_listFiles 返回的路径带 root/ 前缀，这里做兼容处理。
 */
function resolveImagePath(imagePath, workspaceManager) {
  if (!imagePath) return imagePath

  // 绝对路径直接使用（Windows 盘符或 POSIX / 开头）
  if (path.isAbsolute(imagePath)) return imagePath

  // 相对路径需要工作区上下文
  if (!workspaceManager) {
    throw createError(
      'E-VISION-MISSING-WORKSPACE',
      '工作区未打开，无法解析相对图片路径',
      '请先打开工作区，或传入图片的绝对路径'
    )
  }

  const current = workspaceManager.current()
  if (!current || !current.path) {
    throw createError(
      'E-VISION-MISSING-WORKSPACE',
      '工作区未打开，无法解析相对图片路径',
      '请先打开工作区，或传入图片的绝对路径'
    )
  }

  let relPath = imagePath.replace(/\\/g, '/')
  if (relPath.startsWith('root/')) {
    relPath = relPath.slice(5)
  }

  return path.posix.join(current.path.replace(/\\/g, '/'), relPath)
}

/**
 * 把 createError 的标准返回结果补上 errorCode 别名，
 * 让 brief 约定（result.errorCode）的调用方也能识别。
 */
function withErrorCodeAlias(err) {
  if (err && err.code && !err.errorCode) {
    return { ...err, errorCode: err.code }
  }
  return err
}

const skills = [
  {
    name: 'analyze_concrete_image',
    description: '读取图片内容并返回结构化描述。支持混凝土缺陷照片、试块外观、配合比表 OCR、仪表读数 OCR 等。**单一职责**：只做客观信息抽取，不做诊断、调参、报告。',
    version: '1.0.0',
    category: 'vision',
    parameters: {
      imageBase64: {
        type: 'string',
        description: '图片的 base64 编码（含 data:image/...;base64, 前缀）。与 imagePath 二选一，优先使用此参数。',
        required: false
      },
      imagePath: {
        type: 'string',
        description: '图片文件路径。支持绝对路径，或相对于当前工作区根目录的相对路径（如 "cement-report-jc003.jpg" 或 "root/cement-report-jc003.jpg"）。',
        required: false
      },
      question: {
        type: 'string',
        description: '用户想从图中了解什么（如"裂缝宽度是多少"），可选',
        required: false
      },
      context: {
        type: 'object',
        description: '可选上下文（如当前配合比参数）',
        required: false
      }
    },
    services: ['systemService', 'workspace'],
    async execute(args, ctx) {
      const ss = ctx.systemService
      if (!ss) {
        return withErrorCodeAlias(createError('E-SYS-999', '系统服务不可用', '请稍后重试'))
      }

      // 未配置 → 引导调用 configure_vision_model
      let cfg = null
      try {
        cfg = await ss.getVisionConfig()
      } catch (_) { /* ignore */ }
      if (!cfg || !cfg.enabled || !cfg.apiUrl || !cfg.apiKey || !cfg.model) {
        return withErrorCodeAlias(createError(
          'E-VISION-NOT-CONFIGURED',
          '视觉模型未配置',
          '请先调用 configure_vision_model 配置 base url、api key 和 model',
          { hint: 'configure_vision_model' }
        ))
      }

      // 每次执行都用最新 cfg 临时构造 VisionService，避免 ctx 中复用的实例配置陈旧
      const vision = new VisionService({
        apiUrl: cfg.apiUrl,
        apiKey: cfg.apiKey,
        model: cfg.model,
        maxDimension: cfg.maxDimension,
        maxSizeMb: cfg.maxSizeMb
      })

      // 1. 确定 base64 来源
      let base64 = args.imageBase64
      let source = { type: 'pasted' }
      if (!base64 && args.imagePath) {
        let resolvedPath
        try {
          // 运行时动态读 global.workspaceManager，绕过 DynamicContextProvider
          // 启动时快照失效问题（与 workspaceTools.js 做法一致）
          const wm = ctx.workspace || global.workspaceManager
          resolvedPath = resolveImagePath(args.imagePath, wm)
        } catch (err) {
          if (err.code) return withErrorCodeAlias(err)
          throw err
        }
        try {
          base64 = await readImageAsBase64(resolvedPath)
          source = { type: 'workspace', path: resolvedPath }
        } catch (err) {
          if (err.code) return withErrorCodeAlias(err)  // E-VISION-FILE-NOT-FOUND
          throw err
        }
      }
      if (!base64) {
        return withErrorCodeAlias(createError(
          'E-VISION-MISSING-IMAGE',
          '缺少图片数据',
          '请提供 imageBase64 或 imagePath',
          { received: Object.keys(args) }
        ))
      }

      // 2. 构造 prompt
      const userPrompt = args.question
        ? `用户问题：${args.question}\n\n${args.context ? `上下文：${JSON.stringify(args.context)}\n\n` : ''}请分析图片。`
        : `请分析这张混凝土相关的图片。${args.context ? `\n\n上下文：${JSON.stringify(args.context)}` : ''}`

      // 3. 调用视觉 API
      try {
        const result = await vision.analyze({
          base64,
          systemPrompt: SYSTEM_PROMPT,
          userPrompt
        })
        // 4. 解析 JSON（容错）
        const parsed = safeParseJSON(result.content)
        if (parsed) {
          return {
            success: true,
            ...parsed,
            source
          }
        }
        // 降级：返回纯文本
        return {
          success: true,
          imageType: 'general',
          description: result.content,
          details: {},
          confidence: 0.5,
          source,
          rawText: result.content
        }
      } catch (err) {
        if (err.code) return withErrorCodeAlias(err)  // 已是标准错误
        throw err
      }
    }
  }
]

module.exports = skills