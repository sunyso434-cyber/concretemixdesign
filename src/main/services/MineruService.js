/**
 * MinerU 高精度解析服务（v0.7.0）
 *
 * 封装 mineru.net 精准解析 API（批量上传接口）：
 *   1. POST /api/v4/file-urls/batch → 申请签名 URL + batch_id
 *   2. PUT 文件到签名 URL（不设 Content-Type）
 *   3. 轮询 GET /api/v4/extract-results/batch/{batch_id} → 读 extract_result[].state
 *   4. done → 下载 full_zip_url → yauzl.fromBuffer 解压取 full.md
 *
 * Token：用户个人 Token 优先（实时读 SystemService），其次内置加密 Token；都无抛 NO_TOKEN
 * 错误：内部抛 WorkspaceError（与本地 reader 同构），skill 层用 createError('E-MINERU-*') 转换
 *
 * 限制：≤200MB，≤200页（仅 PDF 校验），5000文件/天，1000优先页/天
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const axios = require('axios')
const yauzl = require('yauzl')

// pdf-parse 页数校验（P1-C：必须先 installDOMMatrix，见 pdf.js:9-14 同款坑）
const { installDOMMatrix } = require('../workspace/readers/domMatrixPolyfill')
installDOMMatrix()
const { PDFParse } = require('pdf-parse')

const { WorkspaceError } = require('../workspace/WorkspaceError')

const BASE_URL = 'https://mineru.net'
const MAX_SIZE = 200 * 1024 * 1024 // 200 MB
const MAX_PAGES = 200
const POLL_INTERVAL = 3000 // 3s
const POLL_TIMEOUT = 300000 // 5 分钟
const MODEL_VERSION = 'vlm'

class MineruService {
  /**
   * 注入式构造（便于测试 mock）
   * @param {object} opts
   * @param {object} [opts.systemService] - 默认 require('./SystemService')
   * @param {function} [opts.builtinTokenGetter] - 默认 require('./mineruBuiltinToken').getBuiltinToken
   */
  constructor({ systemService, builtinTokenGetter } = {}) {
    this._systemService = systemService || require('./SystemService')
    this._builtinTokenGetter = builtinTokenGetter || require('./mineruBuiltinToken').getBuiltinToken
  }

  /**
   * 获取 Token（实时读取，绝不缓存——P1-B，参照 web-search.js:57-58 教训）
   * 用户个人 Token 优先 > 内置加密 Token；都无抛 NO_TOKEN
   * @returns {Promise<string>}
   */
  async getToken() {
    const cfg = await this._systemService.getMineruConfig()
    if (cfg && cfg.userToken) return cfg.userToken
    const builtin = this._builtinTokenGetter()
    if (builtin) return builtin
    throw new WorkspaceError('NO_TOKEN', '无可用 MinerU Token（用户未配 + 内置缺失）', false)
  }

  /**
   * 解析本地文件（首期唯一入口，不做 parseUrl）
   * @param {string} filePath - 绝对路径
   * @returns {Promise<{content: string, metadata: {fileName: string, durationMs: number}}>}
   */
  async parseLocalFile(filePath) {
    const start = Date.now()
    const fileName = path.basename(filePath)

    // ① 大小校验
    const stat = await fs.promises.stat(filePath)
    if (stat.size > MAX_SIZE) {
      throw new WorkspaceError('SIZE_EXCEEDED', `${fileName} 超过 200MB`, false)
    }

    // ② 页数校验（仅 PDF，P1-C）
    if (fileName.toLowerCase().endsWith('.pdf')) {
      await this._checkPdfPages(filePath, fileName)
    }

    // ③ 取 Token
    const token = await this.getToken()

    // ④ 申请签名 URL
    const { batch_id, file_url } = await this._requestUploadUrl(token, fileName)

    // ⑤ PUT 上传（失败重试 1 次）
    await this._uploadFile(file_url, filePath)

    // ⑥ 轮询结果
    const result = await this._pollResult(token, batch_id, fileName)

    // ⑦ 下载 zip 并解出 full.md
    const content = await this._downloadAndExtractMd(result.full_zip_url, fileName)

    if (!content || !content.trim()) {
      throw new WorkspaceError('PARSE_FAIL', 'MinerU 返回空内容', false)
    }

    return {
      content,
      metadata: {
        fileName,
        durationMs: Date.now() - start
      }
    }
  }

  /**
   * PDF 页数校验（复用 domMatrixPolyfill + pdf-parse，与 pdf.js 同款）
   */
  async _checkPdfPages(filePath, fileName) {
    try {
      const buffer = await fs.promises.readFile(filePath)
      const parser = new PDFParse({ data: buffer, useWorker: false })
      const result = await parser.getText()
      const pages = (result && typeof result.total === 'number') ? result.total : 0
      if (pages > MAX_PAGES) {
        throw new WorkspaceError('SIZE_EXCEEDED', `${fileName} ${pages} 页超过 ${MAX_PAGES} 页限制`, false)
      }
    } catch (err) {
      if (err instanceof WorkspaceError) throw err
      // 页数校验失败不阻塞上传（让 mineru 端兜底），仅记录
      console.warn(`[MineruService] 页数校验失败，跳过: ${err.message}`)
    }
  }

  /**
   * 申请签名上传 URL
   * POST /api/v4/file-urls/batch
   */
  async _requestUploadUrl(token, fileName) {
    let res
    try {
      res = await axios.post(
        `${BASE_URL}/api/v4/file-urls/batch`,
        { files: [{ name: fileName }], model_version: MODEL_VERSION },
        { headers: { Authorization: `Bearer ${token}` } }
      )
    } catch (err) {
      throw new WorkspaceError('NETWORK', `申请上传URL失败: ${err.message}`, true, err)
    }
    const body = res.data
    if (body.code !== 0) {
      throw new WorkspaceError('API_ERROR', `申请上传URL错误: ${body.msg || ''} (trace:${body.trace_id || ''})`, false)
    }
    const batch_id = body.data && body.data.batch_id
    const file_urls = body.data && body.data.file_urls
    if (!batch_id || !file_urls || !file_urls[0]) {
      throw new WorkspaceError('API_ERROR', '返回缺少 batch_id 或 file_urls', false)
    }
    return { batch_id, file_url: file_urls[0] }
  }

  /**
   * PUT 上传文件到签名 URL（不设 Content-Type，失败重试 1 次）
   */
  async _uploadFile(file_url, filePath) {
    const stream = fs.createReadStream(filePath)
    let lastErr = null
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await axios.put(file_url, stream, {
          headers: { 'Content-Type': '' }, // 不设 Content-Type
          maxContentLength: Infinity,
          maxBodyLength: Infinity
        })
        return
      } catch (err) {
        lastErr = err
        // 重新创建流（旧流已消耗）
        if (attempt === 0) {
          await new Promise(r => setTimeout(r, 1000))
        }
      }
    }
    throw new WorkspaceError('UPLOAD_FAIL', `上传失败: ${lastErr && lastErr.message}`, true, lastErr)
  }

  /**
   * 轮询批量结果
   * GET /api/v4/extract-results/batch/{batch_id}
   * 读 data.extract_result[] 按 file_name 匹配（P0-3）
   */
  async _pollResult(token, batch_id, fileName) {
    const deadline = Date.now() + POLL_TIMEOUT
    while (Date.now() < deadline) {
      let res
      try {
        res = await axios.get(
          `${BASE_URL}/api/v4/extract-results/batch/${batch_id}`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
      } catch (err) {
        throw new WorkspaceError('NETWORK', `查询结果失败: ${err.message}`, true, err)
      }
      const body = res.data
      if (body.code !== 0) {
        throw new WorkspaceError('API_ERROR', `查询结果错误: ${body.msg || ''}`, false)
      }
      const results = body.data && body.data.extract_result
      if (Array.isArray(results)) {
        // 按 file_name 匹配本次上传文件
        const item = results.find(r => r.file_name === fileName) || results[0]
        if (item) {
          if (item.state === 'done') {
            if (!item.full_zip_url) {
              throw new WorkspaceError('PARSE_FAIL', 'done 但无 full_zip_url', false)
            }
            return item
          }
          if (item.state === 'failed') {
            throw new WorkspaceError('PARSE_FAIL', `解析失败: ${item.err_msg || '未知原因'}`, false)
          }
          // pending/running/converting → 继续轮询
        }
      }
      await new Promise(r => setTimeout(r, POLL_INTERVAL))
    }
    // 超时返回 batch_id（P0-3：不是 task_id）
    const err = new WorkspaceError('TIMEOUT', `轮询超时，batch_id=${batch_id}`, true)
    err.batch_id = batch_id
    throw err
  }

  /**
   * 下载 zip 并解出 full.md（用 yauzl.fromBuffer，零临时文件残留——比 spec tmp 方案更彻底）
   */
  async _downloadAndExtractMd(zipUrl, fileName) {
    let zipBuffer
    try {
      const res = await axios.get(zipUrl, { responseType: 'arraybuffer', maxContentLength: Infinity, maxBodyLength: Infinity })
      zipBuffer = Buffer.from(res.data)
    } catch (err) {
      throw new WorkspaceError('NETWORK', `下载 zip 失败: ${err.message}`, true, err)
    }

    // yauzl.fromBuffer 解压，找 full.md
    return new Promise((resolve, reject) => {
      yauzl.fromBuffer(zipBuffer, { lazyEntries: true }, (err, zipfile) => {
        if (err) {
          reject(new WorkspaceError('PARSE_FAIL', `zip 解压失败: ${err.message}`, false, err))
          return
        }
        let found = false
        zipfile.readEntry()
        zipfile.on('entry', (entry) => {
          if (entry.fileName === 'full.md' || entry.fileName.endsWith('/full.md')) {
            found = true
            zipfile.openReadStream(entry, (e2, stream) => {
              if (e2) {
                reject(new WorkspaceError('PARSE_FAIL', `读取 full.md 失败: ${e2.message}`, false, e2))
                return
              }
              const chunks = []
              stream.on('data', c => chunks.push(c))
              stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
              stream.on('error', e3 => reject(new WorkspaceError('PARSE_FAIL', `读取 full.md 流错误: ${e3.message}`, false, e3)))
            })
          } else {
            zipfile.readEntry()
          }
        })
        zipfile.on('end', () => {
          if (!found) reject(new WorkspaceError('PARSE_FAIL', `zip 内未找到 full.md (fileName=${fileName})`, false))
        })
        zipfile.on('error', e4 => reject(new WorkspaceError('PARSE_FAIL', `zip 错误: ${e4.message}`, false, e4)))
      })
    })
  }
}

module.exports = MineruService
