const fs = require('fs').promises
const path = require('path')
const { read } = require('../../../workspace/readers/text')
const { WorkspaceError } = require('../../../workspace/WorkspaceError')

describe('text reader', () => {
  test('读取 .txt 文件直接返回原文', async () => {
    const fp = path.join(__dirname, 'fixtures/sample.txt')
    const result = await read(fp)
    expect(result.content).toBe('混凝土水胶比 0.42')
    expect(result.metadata).toEqual({ encoding: 'utf-8' })
  })

  test('读取 .csv 文件渲染为 markdown 表格', async () => {
    const fp = path.join(__dirname, 'fixtures/sample.csv')
    const result = await read(fp)
    // 第一行 header（材料/用量），共 3 行 2 列
    expect(result.content).toContain('| 材料 | 用量 |')
    expect(result.content).toContain('| --- | --- |')
    expect(result.content).toContain('| 水泥 | 350 |')
    expect(result.content).toContain('| 砂 | 750 |')
    expect(result.metadata.encoding).toBe('utf-8')
    expect(result.metadata.rowCount).toBe(3)
    expect(result.metadata.columnCount).toBe(2)
  })

  test('> 200MB 触发 SIZE_EXCEEDED', async () => {
    const spy = jest.spyOn(fs, 'stat').mockResolvedValueOnce({ size: 201 * 1024 * 1024 })
    try {
      await expect(read('huge.txt')).rejects.toMatchObject({
        code: 'SIZE_EXCEEDED'
      })
    } finally {
      spy.mockRestore()
    }
  })

  test('不存在的文件触发 READ_FAIL', async () => {
    const fp = path.join(__dirname, 'fixtures/__not_exists__.txt')
    try {
      await read(fp)
      throw new Error('expected to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(WorkspaceError)
      expect(err.code).toBe('READ_FAIL')
      expect(err.retryable).toBe(true)
    }
  })
})