'use strict'

// RemoteImageApi：远程图片上传（R9）。
//
// HTTP 端点 POST /api/image（RemoteServer 骨架转发 handleUpload(req, { token })）：
//   - 鉴权：token 由 RemoteServer 从 Authorization: Bearer 头提取，此处调 auth.verifyToken(token)
//   - 大小限制：≤10MB（流式读取超出即拒 → 413）
//   - 扩展名白名单：jpg/jpeg/png/webp
//   - 文件名来源：query ?name=（URL 编码）或 X-Filename 头；basename 剥离目录成分防路径穿越
//   - 保存：当前工作区 photos/（workspaceManager.current().path；构造注入，缺省回退 global.workspaceManager）
//   - 复用 visionHandler 抽出的 saveImageToWorkspace（buffer 写入 + 重名时间戳 + 确保目录）
//
// 响应对象可带数字 status 字段覆盖 HTTP 状态码（R5 骨架已留此接口）。
// 依赖注入 auth / workspaceManager（与 RemoteWorkspaceApi 同款）；纯 Node，不 require electron。

const path = require('path')
const { saveImageToWorkspace } = require('../ipcHandlers/visionHandler')

const MAX_IMAGE_BYTES = 10 * 1024 * 1024 // 10MB
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

class RemoteImageApi {
  constructor({ auth, workspaceManager } = {}) {
    this._auth = auth || null
    this._workspaceManager = workspaceManager || null
  }

  _resolveWorkspaceManager() {
    if (this._workspaceManager) return this._workspaceManager
    return global.workspaceManager || null
  }

  /**
   * 图片上传处理器（RemoteServer 调用：handleUpload(req, { token })）。
   * @param {object} req  原始 HTTP 请求（body 为图片原始字节；req.url 含 query）
   * @param {{ token: string|null }} ctx 鉴权上下文（Bearer token 已由 RemoteServer 提取）
   * @returns {Promise<{ ok: boolean, path?: string, name?: string, error?: string, status?: number }>}
   */
  async handleUpload(req, { token } = {}) {
    // 1. 鉴权（先于 body 读取：未授权不接收超大 payload）
    if (!this._auth || typeof this._auth.verifyToken !== 'function') {
      return { ok: false, error: 'AUTH_NOT_CONFIGURED', status: 401 }
    }
    const vt = this._auth.verifyToken(token)
    if (!vt || !vt.ok) {
      return { ok: false, error: 'UNAUTHORIZED', status: 401 }
    }

    // 2. 文件名 + 扩展名白名单（先于 body 读取，省带宽）
    const name = this._sanitizeFilename(this._resolveFilename(req))
    if (!name) {
      return { ok: false, error: 'MISSING_FILENAME', status: 400 }
    }
    const ext = path.extname(name).toLowerCase()
    if (!IMAGE_EXTENSIONS.has(ext)) {
      return { ok: false, error: 'UNSUPPORTED_TYPE', status: 415 }
    }

    // 3. 读取 body（流式，超 10MB 即拒）
    let buffer
    try {
      buffer = await this._readBody(req)
    } catch (err) {
      if (err && err.message === 'BODY_TOO_LARGE') {
        return { ok: false, error: 'IMAGE_TOO_LARGE', status: 413 }
      }
      return { ok: false, error: 'BAD_REQUEST', status: 400 }
    }
    if (!buffer || buffer.length === 0) {
      return { ok: false, error: 'EMPTY_BODY', status: 400 }
    }

    // 4. 当前工作区（无工作区 → 明确错误）
    const wm = this._resolveWorkspaceManager()
    const current = wm && typeof wm.current === 'function' ? wm.current() : null
    const workspacePath = current && current.path ? current.path : null
    if (!workspacePath) {
      return { ok: false, error: 'NO_WORKSPACE', status: 400 }
    }

    // 5. 保存到 <工作区>/photos/（复用 visionHandler.saveImageToWorkspace）
    try {
      const saved = await saveImageToWorkspace({ sourceBuffer: buffer, name, workspacePath })
      return { ok: true, path: saved.path, name: saved.name }
    } catch (err) {
      console.error('[RemoteImageApi] 保存失败:', err && err.message ? err.message : err)
      return { ok: false, error: 'SAVE_FAILED', status: 500 }
    }
  }

  /** 文件名来源：query ?name=（URL 解码）优先，其次 X-Filename 头。 */
  _resolveFilename(req) {
    try {
      const qs = new URL(req.url || '', 'http://127.0.0.1').searchParams
      const qName = qs.get('name')
      if (qName) return qName
    } catch (_) { /* URL 解析失败走 header 兜底 */ }
    const headerName = req.headers && req.headers['x-filename']
    if (headerName) return headerName
    return null
  }

  /** 剥离目录成分（防路径穿越）：仅保留最后一段文件名。 */
  _sanitizeFilename(name) {
    if (!name || typeof name !== 'string') return ''
    const seg = String(name).split(/[\\/]/).pop()
    return seg ? seg.trim() : ''
  }

  /** 流式读取请求 body，超过 10MB 即拒绝（不接收超大 payload）。 */
  _readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = []
      let total = 0
      req.on('data', (chunk) => {
        total += chunk.length
        if (total > MAX_IMAGE_BYTES) {
          reject(new Error('BODY_TOO_LARGE'))
          try { req.destroy() } catch (_) {}
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => resolve(Buffer.concat(chunks)))
      req.on('error', reject)
    })
  }
}

module.exports = RemoteImageApi
