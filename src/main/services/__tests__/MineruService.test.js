const path = require('path')

// mock 依赖（在 require MineruService 之前）
jest.mock('axios')
jest.mock('yauzl')
jest.mock('pdf-parse', () => ({ PDFParse: jest.fn() }))

const axios = require('axios')
const yauzl = require('yauzl')
const { PDFParse } = require('pdf-parse')
const fs = require('fs')

const MineruService = require('../MineruService')

// 构造 mock systemService + builtinTokenGetter（避开真实 DB）
function makeSvc({ userToken = null, builtinToken = 'builtin-token' } = {}) {
  return new MineruService({
    systemService: { async getMineruConfig() { return { userToken } } },
    builtinTokenGetter: () => builtinToken
  })
}

// 构造 fake yauzl zipfile（含 full.md entry，流式吐内容）
function fakeZipfile(content) {
  const entries = [{ fileName: 'full.md' }]
  const handlers = {}
  let idx = 0
  return {
    readEntry: () => {
      if (idx < entries.length) setTimeout(() => handlers.entry && handlers.entry(entries[idx++]), 0)
      else setTimeout(() => handlers.end && handlers.end(), 0)
    },
    on: jest.fn((event, cb) => { handlers[event] = cb }),
    openReadStream: jest.fn((entry, cb) => {
      const listeners = {}
      const stream = { on: jest.fn((ev, c) => { listeners[ev] = c }) }
      cb(null, stream)
      setTimeout(() => {
        if (listeners.data) listeners.data(Buffer.from(content))
        if (listeners.end) listeners.end()
      }, 0)
    })
  }
}

describe('MineruService', () => {
  let statSpy, readFileSpy, createReadStreamSpy

  beforeEach(() => {
    jest.clearAllMocks()
    statSpy = jest.spyOn(fs.promises, 'stat')
    readFileSpy = jest.spyOn(fs.promises, 'readFile')
    createReadStreamSpy = jest.spyOn(fs, 'createReadStream')
  })
  afterEach(() => { statSpy.mockRestore(); readFileSpy.mockRestore(); createReadStreamSpy.mockRestore() })

  function mockStatSize(size) {
    statSpy.mockResolvedValue({ size })
    createReadStreamSpy.mockReturnValue({ pipe: () => {} })
    readFileSpy.mockResolvedValue(Buffer.from('pdfbytes'))
  }

  test('正常流程：申请URL→上传→轮询done→解压full.md', async () => {
    mockStatSize(1000)
    axios.post.mockResolvedValue({ data: { code: 0, data: { batch_id: 'b1', file_urls: ['https://oss/url'] } } })
    axios.put.mockResolvedValue({})
    axios.get.mockImplementationOnce(() => Promise.resolve({ data: { code: 0, data: { extract_result: [{ file_name: 'a.pdf', state: 'done', full_zip_url: 'https://cdn/zip' }] } } }))
    axios.get.mockImplementationOnce(() => Promise.resolve({ data: Buffer.from('zipbytes') }))
    yauzl.fromBuffer.mockImplementation((buf, opts, cb) => cb(null, fakeZipfile('# 标题\n正文内容')))

    const svc = makeSvc()
    const result = await svc.parseLocalFile('/tmp/a.pdf')
    expect(result.content).toBe('# 标题\n正文内容')
    expect(result.metadata.fileName).toBe('a.pdf')
    expect(axios.put).toHaveBeenCalledWith('https://oss/url', expect.anything(), expect.objectContaining({ headers: { 'Content-Type': '' } }))
  })

  test('Token 优先级：userToken > 内置', async () => {
    expect(await makeSvc({ userToken: 'my-token', builtinToken: 'builtin' }).getToken()).toBe('my-token')
  })

  test('Token 无 userToken 用内置', async () => {
    expect(await makeSvc({ userToken: null, builtinToken: 'builtin' }).getToken()).toBe('builtin')
  })

  test('Token 都无抛 NO_TOKEN', async () => {
    await expect(makeSvc({ userToken: null, builtinToken: null }).getToken()).rejects.toMatchObject({ code: 'NO_TOKEN' })
  })

  test('超大文件抛 SIZE_EXCEEDED', async () => {
    mockStatSize(300 * 1024 * 1024)
    await expect(makeSvc().parseLocalFile('/tmp/big.pdf')).rejects.toMatchObject({ code: 'SIZE_EXCEEDED' })
  })

  test('PDF 超页抛 SIZE_EXCEEDED', async () => {
    mockStatSize(1000)
    PDFParse.mockImplementation(() => ({ getText: () => Promise.resolve({ total: 250, text: 'x' }) }))
    await expect(makeSvc().parseLocalFile('/tmp/many.pdf')).rejects.toMatchObject({ code: 'SIZE_EXCEEDED' })
  })

  test('PUT 失败重试 1 次后仍失败抛 UPLOAD_FAIL', async () => {
    mockStatSize(1000)
    axios.post.mockResolvedValue({ data: { code: 0, data: { batch_id: 'b1', file_urls: ['https://oss/url'] } } })
    axios.put.mockRejectedValue(new Error('put fail'))
    await expect(makeSvc().parseLocalFile('/tmp/a.txt')).rejects.toMatchObject({ code: 'UPLOAD_FAIL' })
    expect(axios.put).toHaveBeenCalledTimes(2)
  })

  test('state=failed 抛 PARSE_FAIL', async () => {
    mockStatSize(1000)
    axios.post.mockResolvedValue({ data: { code: 0, data: { batch_id: 'b1', file_urls: ['https://oss/url'] } } })
    axios.put.mockResolvedValue({})
    axios.get.mockResolvedValue({ data: { code: 0, data: { extract_result: [{ file_name: 'a.txt', state: 'failed', err_msg: '损坏' }] } } })
    await expect(makeSvc().parseLocalFile('/tmp/a.txt')).rejects.toMatchObject({ code: 'PARSE_FAIL' })
  })

  test('_pollResult state=done 正常返回', async () => {
    axios.get.mockResolvedValue({ data: { code: 0, data: { extract_result: [{ file_name: 'a', state: 'done', full_zip_url: 'https://cdn/x' }] } } })
    const r = await makeSvc()._pollResult('tok', 'batch-1', 'a')
    expect(r.full_zip_url).toBe('https://cdn/x')
  })

  test('_pollResult state=failed 抛 PARSE_FAIL', async () => {
    axios.get.mockResolvedValue({ data: { code: 0, data: { extract_result: [{ file_name: 'a', state: 'failed', err_msg: '坏' }] } } })
    await expect(makeSvc()._pollResult('tok', 'b', 'a')).rejects.toMatchObject({ code: 'PARSE_FAIL' })
  })

  test('API code≠0 抛 API_ERROR', async () => {
    mockStatSize(1000)
    axios.post.mockResolvedValue({ data: { code: -60018, msg: 'token invalid', trace_id: 't1' } })
    await expect(makeSvc().parseLocalFile('/tmp/a.txt')).rejects.toMatchObject({ code: 'API_ERROR' })
  })

  test('网络错误抛 NETWORK', async () => {
    mockStatSize(1000)
    axios.post.mockRejectedValue(new Error('network down'))
    await expect(makeSvc().parseLocalFile('/tmp/a.txt')).rejects.toMatchObject({ code: 'NETWORK' })
  })

  test('full.md 为空抛 PARSE_FAIL', async () => {
    mockStatSize(1000)
    axios.post.mockResolvedValue({ data: { code: 0, data: { batch_id: 'b1', file_urls: ['https://oss/url'] } } })
    axios.put.mockResolvedValue({})
    axios.get.mockImplementationOnce(() => Promise.resolve({ data: { code: 0, data: { extract_result: [{ file_name: 'a.txt', state: 'done', full_zip_url: 'https://cdn/zip' }] } } }))
    axios.get.mockImplementationOnce(() => Promise.resolve({ data: Buffer.from('zip') }))
    yauzl.fromBuffer.mockImplementation((buf, opts, cb) => cb(null, fakeZipfile('   ')))
    await expect(makeSvc().parseLocalFile('/tmp/a.txt')).rejects.toMatchObject({ code: 'PARSE_FAIL' })
  })
})
