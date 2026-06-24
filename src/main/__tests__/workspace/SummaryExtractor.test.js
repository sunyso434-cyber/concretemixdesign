// src/main/__tests__/workspace/SummaryExtractor.test.js
// SummaryExtractor 单元测试（红线，Task 2 写实现后转绿）

const { SummaryExtractor } = require('../../workspace/SummaryExtractor')

describe('SummaryExtractor.extract', () => {
  test('正常输入 → 返回 summary + keyPoints + relatedLinks + confidence', async () => {
    const mockLLM = {
      invoke: jest.fn().mockResolvedValue(JSON.stringify({
        summary: '本报告检测了 P.O 42.5 水泥的强度、凝结时间、安定性等指标',
        keyPoints: [
          '28d 抗压强度 48.6MPa，超过标准 42.5MPa',
          '初凝时间 185min，终凝时间 245min'
        ],
        tags: ['水泥', '强度检测'],
        confidence: 0.92,
        relatedLinks: [
          { page: 'sources/jgj55-2011.md', relation: '引用', confidence: 0.9 },
          { page: 'sources/粉煤灰检测报告.md', relation: '对比', confidence: 0.85 }
        ]
      }))
    }
    const extractor = new SummaryExtractor({ deepseekService: mockLLM })
    const existingPages = [
      { title: 'JGJ55-2011', path: 'sources/jgj55-2011.md' },
      { title: '粉煤灰检测报告', path: 'sources/粉煤灰检测报告.md' }
    ]
    const result = await extractor.extract('硅灰能提高混凝土 28d 抗压强度', 'test.pdf', existingPages)

    expect(result).not.toBeNull()
    expect(result.summary).toContain('P.O 42.5')
    expect(result.keyPoints).toHaveLength(2)
    expect(result.relatedLinks).toHaveLength(2)
    expect(result.confidence).toBe(0.92)
    // relation 不硬编码中文字符串，只断言在白名单内
    expect(['引用', '对比', '补充', '反驳']).toContain(result.relatedLinks[0].relation)
    expect(result.relatedLinks[0].confidence).toBeGreaterThanOrEqual(0.6)
    expect(result.quality).toBe('high')
  })

  test('relatedLinks confidence < 0.6 → 过滤', async () => {
    const mockLLM = {
      invoke: jest.fn().mockResolvedValue(JSON.stringify({
        summary: '测试', keyPoints: ['测试'], confidence: 0.8,
        relatedLinks: [
          { page: 'sources/keep.md', relation: '引用', confidence: 0.9 },
          { page: 'sources/drop.md', relation: '相关', confidence: 0.3 }
        ]
      }))
    }
    const extractor = new SummaryExtractor({ deepseekService: mockLLM })
    const result = await extractor.extract('test', 'test.pdf', [
      { title: 'keep', path: 'sources/keep.md' },
      { title: 'drop', path: 'sources/drop.md' }
    ])
    expect(result.relatedLinks).toHaveLength(1)
    expect(result.relatedLinks[0].page).toBe('sources/keep.md')
  })

  test('relatedLinks 自创的页面名 → 过滤（防 hallucination）', async () => {
    const mockLLM = {
      invoke: jest.fn().mockResolvedValue(JSON.stringify({
        summary: '测试', keyPoints: ['测试'], confidence: 0.8,
        relatedLinks: [
          { page: 'sources/existing.md', relation: '引用', confidence: 0.8 },
          { page: 'sources/hallucinated.md', relation: '引用', confidence: 0.8 }
        ]
      }))
    }
    const extractor = new SummaryExtractor({ deepseekService: mockLLM })
    const result = await extractor.extract('test', 'test.pdf', [
      { title: 'existing', path: 'sources/existing.md' }
    ])
    expect(result.relatedLinks).toHaveLength(1)
  })

  test('relatedLinks relation 不在白名单 → 过滤', async () => {
    const mockLLM = {
      invoke: jest.fn().mockResolvedValue(JSON.stringify({
        summary: '测试', keyPoints: ['测试'], confidence: 0.8,
        relatedLinks: [
          { page: 'sources/keep.md', relation: '引用', confidence: 0.9 },
          { page: 'sources/drop.md', relation: '随便编的', confidence: 0.9 }
        ]
      }))
    }
    const extractor = new SummaryExtractor({ deepseekService: mockLLM })
    const result = await extractor.extract('test', 'test.pdf', [
      { title: 'keep', path: 'sources/keep.md' },
      { title: 'drop', path: 'sources/drop.md' }
    ])
    expect(result.relatedLinks).toHaveLength(1)
    expect(result.relatedLinks[0].page).toBe('sources/keep.md')
  })

  test('LLM 超时/网络错误 → 返回 null', async () => {
    const extractor = new SummaryExtractor({
      deepseekService: { invoke: jest.fn().mockRejectedValue(new Error('TIMEOUT')) }
    })
    const result = await extractor.extract('test', 'test.pdf', [])
    expect(result).toBeNull()
  })

  test('LLM 返回非 JSON → 返回 null', async () => {
    const extractor = new SummaryExtractor({
      deepseekService: { invoke: jest.fn().mockResolvedValue('这不是 JSON') }
    })
    const result = await extractor.extract('test', 'test.pdf', [])
    expect(result).toBeNull()
  })

  test('LLM 返回合法 JSON 但缺 summary 和 keyPoints → 返回 null', async () => {
    const extractor = new SummaryExtractor({
      deepseekService: { invoke: jest.fn().mockResolvedValue(JSON.stringify({ unrelated: 1 })) }
    })
    const result = await extractor.extract('test', 'test.pdf', [])
    expect(result).toBeNull()
  })

  test('空内容 → 返回 null（不调 LLM）', async () => {
    const mockLLM = { invoke: jest.fn() }
    const extractor = new SummaryExtractor({ deepseekService: mockLLM })
    const result = await extractor.extract('', 'empty.pdf', [])
    expect(result).toBeNull()
    expect(mockLLM.invoke).not.toHaveBeenCalled()
  })

  test('无 deepseekService → 返回 null', async () => {
    const extractor = new SummaryExtractor({})
    const result = await extractor.extract('test', 'test.pdf', [])
    expect(result).toBeNull()
  })

  test('LLM prompt 含语言要求（中文 + 保留英文术语）', async () => {
    const mockLLM = {
      invoke: jest.fn().mockResolvedValue(JSON.stringify({
        summary: 'compressive strength（抗压强度）达到 48.6MPa',
        keyPoints: ['28d compressive strength（抗压强度）48.6MPa'],
        confidence: 0.85,
        relatedLinks: []
      }))
    }
    const extractor = new SummaryExtractor({ deepseekService: mockLLM })
    await extractor.extract('test content', 'test.pdf', [])
    const prompt = mockLLM.invoke.mock.calls[0][0]
    expect(prompt).toContain('保留关键术语原文')
  })

  test('LLM 返回 markdown 包裹的 JSON → 正确解析', async () => {
    const wrapped = '```json\n' + JSON.stringify({
      summary: '测试摘要',
      keyPoints: ['关键点 1', '关键点 2'],
      tags: ['水泥'],
      confidence: 0.85,
      relatedLinks: []
    }) + '\n```'
    const mockLLM = { invoke: jest.fn().mockResolvedValue(wrapped) }
    const extractor = new SummaryExtractor({ deepseekService: mockLLM })
    const result = await extractor.extract('test', 'test.pdf', [])
    expect(result).not.toBeNull()
    expect(result.summary).toBe('测试摘要')
    expect(result.keyPoints).toHaveLength(2)
  })
})
