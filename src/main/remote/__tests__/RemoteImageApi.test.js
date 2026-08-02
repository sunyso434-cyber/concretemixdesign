'use strict'

// RemoteImageApi 测试（R9）：
//   - 鉴权：token 无效/缺失 → { ok:false, error:'UNAUTHORIZED', status:401 }（不写文件）
//   - 大小限制：body > 10MB → { ok:false, error:'IMAGE_TOO_LARGE', status:413 }
//   - 扩展名白名单：jpg/jpeg/png/webp 通过；其他类型拒绝
//   - 保存：写入 当前工作区/raw/images/<name>（复用 visionHandler.saveImageToWorkspace），返回 { ok:true, path, name }
//   - 重名：已存在 → 时间戳后缀
//   - 路径安全：文件名中的目录成分被剥离（basename 防路径穿越）
//   - 无工作区 → { ok:false, error:'NO_WORKSPACE' }
// auth/workspaceManager 走构造注入（与 RemoteWorkspaceApi 同款）；fs/electron mock，
// saveImageToWorkspace 走 visionHandler 真实逻辑 + mock fs（不碰真实磁盘）。
// req 用 EventEmitter 替身（避免 require stream 引入 fs 内部依赖）。

jest.mock('electron', () => ({ ipcMain: { handle: jest.fn() } }))
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn().mockResolvedValue(undefined),
    access: jest.fn().mockRejectedValue(new Error('ENOENT')), // 默认：目标不存在 → 不重名
    writeFile: jest.fn().mockResolvedValue(undefined),
    copyFile: jest.fn().mockResolvedValue(undefined)
  }
}))

const { EventEmitter } = require('events')
const fs = require('fs')
const path = require('path')
const RemoteImageApi = require('../RemoteImageApi')

// 构造一个可读的假 HTTP 请求：nextTick 推 body 再 end（EventEmitter，不依赖 stream）
function makeReq({ headers = {}, url = '/api/image?name=a.jpg', body = Buffer.from('img') } = {}) {
  const req = new EventEmitter()
  req.headers = headers
  req.url = url
  req.method = 'POST'
  req.destroy = () => { req.destroyed = true }
  process.nextTick(() => {
    req.emit('data', body)
    req.emit('end')
  })
  return req
}

function createAuth() {
  return {
    verifyToken: jest.fn((t) => (t ? { ok: true, deviceId: 'dev_1' } : { ok: false }))
  }
}

function createManager() {
  return { current: jest.fn(() => ({ path: '/ws', status: 'ready' })) }
}

describe('RemoteImageApi', () => {
  let auth
  let manager

  beforeEach(() => {
    jest.clearAllMocks()
    delete global.workspaceManager // 不依赖 global 单例，避免跨文件污染
    auth = createAuth()
    manager = createManager()
  })

  describe('鉴权', () => {
    test('token 无效 → { ok:false, error:UNAUTHORIZED, status:401 }，不写入文件', async () => {
      auth.verifyToken.mockReturnValue({ ok: false })
      const api = new RemoteImageApi({ auth, workspaceManager: manager })
      const r = await api.handleUpload(makeReq(), { token: 'bad-token' })

      expect(auth.verifyToken).toHaveBeenCalledWith('bad-token')
      expect(r).toEqual({ ok: false, error: 'UNAUTHORIZED', status: 401 })
      expect(fs.promises.writeFile).not.toHaveBeenCalled()
    })

    test('token 缺失 → UNAUTHORIZED', async () => {
      const api = new RemoteImageApi({ auth, workspaceManager: manager })
      const r = await api.handleUpload(makeReq(), { token: null })

      expect(r.error).toBe('UNAUTHORIZED')
      expect(r.status).toBe(401)
    })

    test('未注入 auth → AUTH_NOT_CONFIGURED（防御：R11 未接线时明确报错）', async () => {
      const api = new RemoteImageApi({ workspaceManager: manager })
      const r = await api.handleUpload(makeReq(), { token: 'x' })

      expect(r.error).toBe('AUTH_NOT_CONFIGURED')
      expect(r.status).toBe(401)
    })
  })

  describe('大小限制', () => {
    test('body 超过 10MB → { ok:false, error:IMAGE_TOO_LARGE, status:413 }', async () => {
      const api = new RemoteImageApi({ auth, workspaceManager: manager })
      const big = Buffer.alloc(10 * 1024 * 1024 + 1, 1) // 10MB + 1
      const r = await api.handleUpload(makeReq({ body: big }), { token: 'ok-token' })

      expect(r).toEqual({ ok: false, error: 'IMAGE_TOO_LARGE', status: 413 })
      expect(fs.promises.writeFile).not.toHaveBeenCalled()
    })

    test('恰好 10MB 允许通过（边界）', async () => {
      const api = new RemoteImageApi({ auth, workspaceManager: manager })
      const exactly = Buffer.alloc(10 * 1024 * 1024, 1)
      const r = await api.handleUpload(makeReq({ body: exactly }), { token: 'ok-token' })

      expect(r.ok).toBe(true)
    })
  })

  describe('扩展名白名单', () => {
    test.each(['a.jpg', 'a.jpeg', 'a.png', 'a.webp'])('合法扩展名 %s → 保存成功', async (name) => {
      const api = new RemoteImageApi({ auth, workspaceManager: manager })
      const r = await api.handleUpload(makeReq({ url: `/api/image?name=${name}` }), { token: 'ok-token' })

      expect(r.ok).toBe(true)
      expect(r.name).toBe(name)
      expect(r.path).toBe(path.join('/ws', 'raw', 'images', name))
      expect(fs.promises.writeFile).toHaveBeenCalledWith(path.join('/ws', 'raw', 'images', name), expect.any(Buffer))
    })

    test.each(['a.gif', 'a.txt', 'a', 'a.JPG.'])('非法扩展名 %s → UNSUPPORTED_TYPE', async (name) => {
      const api = new RemoteImageApi({ auth, workspaceManager: manager })
      const r = await api.handleUpload(makeReq({ url: `/api/image?name=${name}` }), { token: 'ok-token' })

      expect(r.error).toBe('UNSUPPORTED_TYPE')
      expect(r.status).toBe(415)
      expect(fs.promises.writeFile).not.toHaveBeenCalled()
    })
  })

  describe('保存路径与返回', () => {
    test('成功：写入 工作区/raw/images/<name>，返回 { ok:true, path, name }', async () => {
      const api = new RemoteImageApi({ auth, workspaceManager: manager })
      const r = await api.handleUpload(makeReq({ url: '/api/image?name=photo.jpg' }), { token: 'ok-token' })

      expect(r).toEqual({
        ok: true,
        path: path.join('/ws', 'raw', 'images', 'photo.jpg'),
        name: 'photo.jpg'
      })
      expect(fs.promises.mkdir).toHaveBeenCalledWith(path.join('/ws', 'raw', 'images'), { recursive: true })
      expect(fs.promises.writeFile).toHaveBeenCalledWith(path.join('/ws', 'raw', 'images', 'photo.jpg'), expect.any(Buffer))
    })

    test('重名：同名文件已存在 → 加时间戳后缀', async () => {
      fs.promises.access.mockResolvedValueOnce() // 目标已存在 → 走重名分支
      const api = new RemoteImageApi({ auth, workspaceManager: manager })
      const r = await api.handleUpload(makeReq({ url: '/api/image?name=a.jpg' }), { token: 'ok-token' })

      expect(r.ok).toBe(true)
      expect(r.name).toMatch(/^a_\d{13}\.jpg$/)
      expect(fs.promises.writeFile).toHaveBeenCalledWith(path.join('/ws', 'raw', 'images', r.name), expect.any(Buffer))
    })

    test('路径安全：文件名含目录成分被剥离（防路径穿越）', async () => {
      const api = new RemoteImageApi({ auth, workspaceManager: manager })
      // URL 编码的 ../../evil.jpg
      const r = await api.handleUpload(makeReq({ url: '/api/image?name=..%2F..%2Fevil.jpg' }), { token: 'ok-token' })

      expect(r.ok).toBe(true)
      expect(r.name).toBe('evil.jpg')
      expect(fs.promises.writeFile).toHaveBeenCalledWith(path.join('/ws', 'raw', 'images', 'evil.jpg'), expect.any(Buffer))
    })

    test('无 query name 时回退 X-Filename 头', async () => {
      const api = new RemoteImageApi({ auth, workspaceManager: manager })
      const req = makeReq({ url: '/api/image', headers: { 'x-filename': 'photo.png' } })
      const r = await api.handleUpload(req, { token: 'ok-token' })

      expect(r.ok).toBe(true)
      expect(r.name).toBe('photo.png')
    })

    test('缺文件名 → { ok:false, error:MISSING_FILENAME, status:400 }', async () => {
      const api = new RemoteImageApi({ auth, workspaceManager: manager })
      const r = await api.handleUpload(makeReq({ url: '/api/image' }), { token: 'ok-token' })

      expect(r.error).toBe('MISSING_FILENAME')
      expect(r.status).toBe(400)
      expect(fs.promises.writeFile).not.toHaveBeenCalled()
    })

    test('空 body → { ok:false, error:EMPTY_BODY, status:400 }', async () => {
      const api = new RemoteImageApi({ auth, workspaceManager: manager })
      const r = await api.handleUpload(makeReq({ body: Buffer.alloc(0) }), { token: 'ok-token' })

      expect(r.error).toBe('EMPTY_BODY')
      expect(r.status).toBe(400)
    })

    test('writeFile 失败 → { ok:false, error:SAVE_FAILED, status:500 }', async () => {
      fs.promises.writeFile.mockRejectedValueOnce(new Error('EACCES'))
      const api = new RemoteImageApi({ auth, workspaceManager: manager })
      const r = await api.handleUpload(makeReq(), { token: 'ok-token' })

      expect(r.error).toBe('SAVE_FAILED')
      expect(r.status).toBe(500)
    })
  })

  describe('工作区', () => {
    test('无当前工作区 → { ok:false, error:NO_WORKSPACE }', async () => {
      manager.current.mockReturnValue(null)
      const api = new RemoteImageApi({ auth, workspaceManager: manager })
      const r = await api.handleUpload(makeReq(), { token: 'ok-token' })

      expect(r.error).toBe('NO_WORKSPACE')
      expect(fs.promises.writeFile).not.toHaveBeenCalled()
    })

    test('未注入 workspaceManager 且无 global 单例 → NO_WORKSPACE', async () => {
      const api = new RemoteImageApi({ auth })
      const r = await api.handleUpload(makeReq(), { token: 'ok-token' })

      expect(r.error).toBe('NO_WORKSPACE')
      expect(fs.promises.writeFile).not.toHaveBeenCalled()
    })
  })
})
