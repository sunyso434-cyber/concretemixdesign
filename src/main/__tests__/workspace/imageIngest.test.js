const imageIngest = require('../../workspace/imageIngest')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const os = require('os')

describe('imageIngest', () => {
  let cacheDir, testFile

  beforeEach(() => {
    cacheDir = path.join(os.tmpdir(), `vision-cache-test-${Date.now()}`)
    testFile = path.join(cacheDir, 'test.jpg')
    fs.mkdirSync(cacheDir, { recursive: true })
    fs.writeFileSync(testFile, Buffer.from([0xFF, 0xD8, 0xFF]))
  })

  afterEach(() => {
    if (fs.existsSync(cacheDir)) fs.rmSync(cacheDir, { recursive: true })
  })

  test('isImageFile 识别图片扩展名', () => {
    expect(imageIngest.isImageFile('a.jpg')).toBe(true)
    expect(imageIngest.isImageFile('a.jpeg')).toBe(true)
    expect(imageIngest.isImageFile('a.png')).toBe(true)
    expect(imageIngest.isImageFile('a.webp')).toBe(true)
    expect(imageIngest.isImageFile('a.gif')).toBe(false)
    expect(imageIngest.isImageFile('a.pdf')).toBe(false)
  })

  test('getCachedDescription 文件未缓存返回 null', () => {
    const result = imageIngest.getCachedDescription(testFile, cacheDir)
    expect(result).toBeNull()
  })

  test('setCachedDescription + getCachedDescription 往返一致', () => {
    const data = { ocrText: 'C30 水泥用量 350kg', description: '混凝土配合比表' }
    imageIngest.setCachedDescription(testFile, data, cacheDir)
    const result = imageIngest.getCachedDescription(testFile, cacheDir)
    expect(result).toEqual(data)
  })

  test('setCachedDescription 文件 mtime 变化时缓存失效', async () => {
    const data1 = { ocrText: 'old', description: 'old' }
    imageIngest.setCachedDescription(testFile, data1, cacheDir)
    // 修改文件 mtime
    const future = new Date(Date.now() + 10000)
    fs.utimesSync(testFile, future, future)
    const result = imageIngest.getCachedDescription(testFile, cacheDir)
    expect(result).toBeNull()
  })
})
