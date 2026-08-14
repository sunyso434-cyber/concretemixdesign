/**
 * v0.9.x 输出优化：extractProducedFiles 单元测试
 */
const { extractProducedFiles } = require('../producedFiles')

describe('extractProducedFiles', () => {
  test('空 timeline 返回空数组', () => {
    expect(extractProducedFiles(null)).toEqual([])
    expect(extractProducedFiles(undefined)).toEqual([])
    expect(extractProducedFiles([])).toEqual([])
  })

  test('提取 workspace_writeFile 成功节点的产出文件', () => {
    const timeline = [
      { type: 'reasoning', status: 'done', content: '思考' },
      {
        type: 'tool',
        toolName: 'workspace_writeFile',
        status: 'done',
        result: { path: 'reports/配合比方案.md', size: 2048 },
      },
    ]
    expect(extractProducedFiles(timeline)).toEqual([
      { path: 'reports/配合比方案.md', size: 2048, type: 'md' },
    ])
  })

  test('跳过失败节点与非产出工具', () => {
    const timeline = [
      { type: 'tool', toolName: 'workspace_writeFile', status: 'error', result: { path: 'a.md' } },
      { type: 'tool', toolName: 'workspace_readFile', status: 'done', result: { path: 'b.md' } },
    ]
    expect(extractProducedFiles(timeline)).toEqual([])
  })

  test('同路径去重（多轮写同一文件只保留首个）', () => {
    const timeline = [
      { type: 'tool', toolName: 'workspace_writeFile', status: 'done', result: { path: 'reports/r.md' } },
      { type: 'tool', toolName: 'workspace_writeFile', status: 'done', result: { path: 'reports/r.md' } },
    ]
    const files = extractProducedFiles(timeline)
    expect(files).toHaveLength(1)
  })

  test('result 缺失或无 path 时安全跳过', () => {
    const timeline = [
      { type: 'tool', toolName: 'workspace_writeFile', status: 'done' },
      { type: 'tool', toolName: 'workspace_writeFile', status: 'done', result: {} },
    ]
    expect(extractProducedFiles(timeline)).toEqual([])
  })
})
