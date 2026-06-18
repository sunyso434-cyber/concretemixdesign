const path = require('path')
const fs = require('fs').promises
const { loadIndex, saveIndex } = require('../../workspace/index-store')

describe('index-store', () => {
  const testPath = path.join(__dirname, 'fixtures/index-test')

  beforeEach(async () => {
    await fs.mkdir(testPath, { recursive: true })
  })
  afterEach(async () => {
    await fs.rm(testPath, { recursive: true, force: true })
  })

  test('loadIndex 不存在返回默认', async () => {
    const idx = await loadIndex(testPath)
    expect(idx.version).toBe(1)
    expect(idx.files).toEqual({})
    expect(idx.bm25Index.vocabulary).toEqual({})
  })

  test('saveIndex + loadIndex 往返一致', async () => {
    const idx = {
      version: 1,
      workspacePath: testPath.replace(/\\/g, '/'),
      createdAt: '2026-06-17T10:00:00Z',
      updatedAt: '2026-06-17T10:00:00Z',
      lastFullRebuild: '2026-06-17T10:00:00Z',
      files: { 'test.pdf': { hash: 'sha256:abc', mtime: 123, size: 100, wikiPage: 'sources/test.md', lastIngestAt: 123, quality: 'high', ingestVersion: 1 } },
      bm25Index: { vocabulary: {}, postings: {}, docLengths: {}, avgDocLength: 0, totalDocs: 0 }
    }
    await saveIndex(testPath, idx)
    const loaded = await loadIndex(testPath)
    expect(loaded.files['test.pdf'].hash).toBe('sha256:abc')
  })
})
