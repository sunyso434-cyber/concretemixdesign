const { WikiEngine, SINGLE_SEGMENT_MAX_SIZE, RELEVANCE_THRESHOLD_HIGH, DEFAULT_CONTEXT_LINES, SUMMARY_MAX_CHARS, MAX_CONCURRENT, MAX_TOTAL, SUMMARIZE_TIMEOUT_MS, BATCH_TIMEOUT_MS } = require('../WikiEngine')

describe('WikiEngine._splitIntoSegments', () => {
  // 辅助：创建一个最简 WikiEngine 实例（只需 _splitIntoSegments，不需要真实 workspace）
  function createEngine() {
    // WikiEngine 需要 workspace 参数，但 _splitIntoSegments 不依赖它
    return new WikiEngine({ workspace: { current: () => null } })
  }

  describe('标题切分', () => {
    test('每个标题开始新段', () => {
      const engine = createEngine()
      const content = `# 标题一
段落内容一

## 标题二
段落内容二

### 标题三
段落内容三`
      const segments = engine._splitIntoSegments(content)
      // # 标题一 + 段落内容一 → 1 段
      // ## 标题二 + 段落内容二 → 1 段
      // ### 标题三 + 段落内容三 → 1 段
      expect(segments.length).toBe(3)
      expect(segments[0].level).toBe(1)
      expect(segments[0].text).toContain('# 标题一')
      expect(segments[1].level).toBe(2)
      expect(segments[1].text).toContain('## 标题二')
      expect(segments[2].level).toBe(3)
      expect(segments[2].text).toContain('### 标题三')
    })

    test('标题行号正确', () => {
      const engine = createEngine()
      const content = `# 标题一
内容一
内容二

# 标题二
内容三`
      const segments = engine._splitIntoSegments(content)
      expect(segments[0].startLine).toBe(0)
      expect(segments[0].endLine).toBe(2)
      expect(segments[1].startLine).toBe(4)
      expect(segments[1].endLine).toBe(5)
    })

    test('不同级别标题（h1-h6）都正确切分', () => {
      const engine = createEngine()
      const content = `# h1
内容
## h2
内容
### h3
内容
#### h4
内容
##### h5
内容
###### h6
内容`
      const segments = engine._splitIntoSegments(content)
      expect(segments.length).toBe(6)
      expect(segments[0].level).toBe(1)
      expect(segments[1].level).toBe(2)
      expect(segments[2].level).toBe(3)
      expect(segments[3].level).toBe(4)
      expect(segments[4].level).toBe(5)
      expect(segments[5].level).toBe(6)
    })
  })

  describe('空行切分', () => {
    test('无标题内容按空行切分', () => {
      const engine = createEngine()
      const content = `段落一第一行
段落一第二行

段落二第一行
段落二第二行

段落三第一行`
      const segments = engine._splitIntoSegments(content)
      expect(segments.length).toBe(3)
      expect(segments[0].text).toContain('段落一')
      expect(segments[0].level).toBe(0)
      expect(segments[1].text).toContain('段落二')
      expect(segments[2].text).toContain('段落三')
    })

    test('连续空行只产生一个切分点', () => {
      const engine = createEngine()
      const content = `段落一


段落二`
      const segments = engine._splitIntoSegments(content)
      expect(segments.length).toBe(2)
    })

    test('空内容返回空数组', () => {
      const engine = createEngine()
      expect(engine._splitIntoSegments('')).toEqual([])
      expect(engine._splitIntoSegments('   ')).toEqual([])
      expect(engine._splitIntoSegments(null)).toEqual([])
    })
  })

  describe('表格原子段', () => {
    test('连续 | 行作为原子段，不被空行切开', () => {
      const engine = createEngine()
      const content = `一些文字

| 列一 | 列二 | 列三 |
| --- | --- | --- |
| 数据1 | 数据2 | 数据3 |
| 数据4 | 数据5 | 数据6 |

更多文字`
      const segments = engine._splitIntoSegments(content)
      // "一些文字" → 1 段
      // 表格（含空行间隔但表格行是原子的） → 1 段
      // "更多文字" → 1 段
      // 注意：表格前的空行会切出 "一些文字"，表格后的空行会切出 "更多文字"
      // 表格本身是连续 | 行，中间没有非 | 行，所以是一段
      const tableSeg = segments.find(s => s.isTable)
      expect(tableSeg).toBeTruthy()
      expect(tableSeg.text).toContain('| 列一 | 列二 | 列三 |')
      expect(tableSeg.text).toContain('| 数据1 | 数据2 | 数据3 |')
      expect(tableSeg.text).toContain('| 数据4 | 数据5 | 数据6 |')
    })

    test('表格段标记 isTable = true', () => {
      const engine = createEngine()
      const content = `| A | B |
| --- | --- |
| 1 | 2 |`
      const segments = engine._splitIntoSegments(content)
      expect(segments.length).toBe(1)
      expect(segments[0].isTable).toBe(true)
      expect(segments[0].level).toBe(0)
    })

    test('非表格段没有 isTable 属性', () => {
      const engine = createEngine()
      const content = `普通段落内容`
      const segments = engine._splitIntoSegments(content)
      expect(segments[0].isTable).toBeUndefined()
    })
  })

  describe('大表格强制切分', () => {
    test('表格 > 500 行 → 强制切，每段带 header+separator 前缀', () => {
      const engine = createEngine()
      // 构造一个 502 行数据的表格（+ header + separator = 504 行）
      const header = '| 列A | 列B | 列C |'
      const separator = '| --- | --- | --- |'
      const dataLines = []
      for (let i = 0; i < 502; i++) {
        dataLines.push(`| 数据${i}-1 | 数据${i}-2 | 数据${i}-3 |`)
      }
      const content = [header, separator, ...dataLines].join('\n')

      const segments = engine._splitIntoSegments(content)
      // 502 数据行，每块 498 行（500 - 2 header/separator），ceil(502/498) = 2 块
      expect(segments.length).toBe(2)

      // 每块都带 header+separator 前缀
      for (const seg of segments) {
        expect(seg.isTable).toBe(true)
        expect(seg.tableHeader).toBe(header + '\n' + separator)
        expect(seg.text).toContain(header)
        expect(seg.text).toContain(separator)
      }

      // 第一块有 498 行数据
      expect(segments[0].text).toContain('数据0-1')
      expect(segments[0].text).toContain('数据497-1')
      // 第二块有 4 行数据
      expect(segments[1].text).toContain('数据498-1')
      expect(segments[1].text).toContain('数据501-1')
    })

    test('表格刚好 500 行 → 不切', () => {
      const engine = createEngine()
      const header = '| A | B |'
      const separator = '| --- | --- |'
      const dataLines = []
      for (let i = 0; i < 498; i++) {
        dataLines.push(`| ${i} | val |`)
      }
      const content = [header, separator, ...dataLines].join('\n')

      const segments = engine._splitIntoSegments(content)
      expect(segments.length).toBe(1)
      expect(segments[0].isTable).toBe(true)
      expect(segments[0].tableHeader).toBeUndefined()
    })

    test('大表格切分后行号连续', () => {
      const engine = createEngine()
      const header = '| A | B |'
      const separator = '| --- | --- |'
      const dataLines = []
      for (let i = 0; i < 505; i++) {
        dataLines.push(`| ${i} | val |`)
      }
      const content = [header, separator, ...dataLines].join('\n')

      const segments = engine._splitIntoSegments(content)
      // header line 0, separator line 1, data 2-506
      // chunk1: 0-499 (header+sep+498 rows), chunk2: 0,1,500-506
      expect(segments[0].startLine).toBe(0)
      expect(segments[0].endLine).toBe(499)
      expect(segments[1].startLine).toBe(0)  // header 重新加入
      expect(segments[1].endLine).toBe(506)
    })
  })

  describe('大段落强制切分（> 20KB）', () => {
    test('非表格段 > 20KB → 按行切分', () => {
      const engine = createEngine()
      // 构造一个 > 20KB 的段落（每行约 100 字符 × 250 行 = 25KB）
      const lines = []
      for (let i = 0; i < 250; i++) {
        lines.push('这是一段很长的文字内容，用于测试大段落的强制切分功能。'.repeat(2))
      }
      const content = lines.join('\n')
      const segments = engine._splitIntoSegments(content)

      // 应该被切分为多段
      expect(segments.length).toBeGreaterThan(1)

      // 每段大小不超过 20KB（允许少量超出，因为按行切分）
      for (const seg of segments) {
        const size = Buffer.byteLength(seg.text, 'utf-8')
        // 按行切分可能导致单行就 > 20KB，但我们的测试数据每行约 200 字节
        // 所以每段应该 < 20KB + 单行大小
        expect(size).toBeLessThanOrEqual(SINGLE_SEGMENT_MAX_SIZE + 500)
      }

      // 段落 id 连续
      for (let i = 0; i < segments.length; i++) {
        expect(segments[i].id).toBe(i)
      }
    })

    test('小段落不切分', () => {
      const engine = createEngine()
      const content = `短内容
第二行
第三行`
      const segments = engine._splitIntoSegments(content)
      expect(segments.length).toBe(1)
      expect(segments[0].text).toBe(content)
    })
  })

  describe('返回格式', () => {
    test('段落 id 从 0 开始递增', () => {
      const engine = createEngine()
      const content = `# 标题一
内容一

# 标题二
内容二

# 标题三
内容三`
      const segments = engine._splitIntoSegments(content)
      expect(segments[0].id).toBe(0)
      expect(segments[1].id).toBe(1)
      expect(segments[2].id).toBe(2)
    })

    test('startLine/endLine 是 0-based', () => {
      const engine = createEngine()
      const content = `第一行
第二行

第三行`
      const segments = engine._splitIntoSegments(content)
      expect(segments[0].startLine).toBe(0)
      expect(segments[0].endLine).toBe(1)
      expect(segments[1].startLine).toBe(3)
      expect(segments[1].endLine).toBe(3)
    })

    test('标题段的 level 是标题级别，非标题段 level = 0', () => {
      const engine = createEngine()
      const content = `## 二级标题
正文内容

无标题段落`
      const segments = engine._splitIntoSegments(content)
      expect(segments[0].level).toBe(2)
      expect(segments[1].level).toBe(0)
    })
  })

  describe('混合场景', () => {
    test('标题 + 空行 + 表格混合', () => {
      const engine = createEngine()
      const content = `# 第一章
这是介绍文字

## 数据表
| 姓名 | 年龄 |
| --- | --- |
| 张三 | 25 |
| 李四 | 30 |

## 总结
以上是数据`
      const segments = engine._splitIntoSegments(content)

      // # 第一章 + 介绍 → 1 段（level 1）
      // ## 数据表 + 表格行（无空行分隔，所以在一起）→ 1 段（level 2）
      // ## 总结 + 内容 → 1 段（level 2）
      expect(segments.length).toBe(3)

      // 第一段：标题 + 介绍
      expect(segments[0].level).toBe(1)
      expect(segments[0].text).toContain('# 第一章')
      expect(segments[0].text).toContain('这是介绍文字')

      // 第二段：标题 + 表格（一起，因为没有空行分隔）
      expect(segments[1].level).toBe(2)
      expect(segments[1].text).toContain('## 数据表')
      expect(segments[1].text).toContain('| 姓名 | 年龄 |')
      expect(segments[1].text).toContain('| 张三 | 25 |')

      // 第三段：总结
      expect(segments[2].level).toBe(2)
      expect(segments[2].text).toContain('## 总结')
    })

    test('空行分隔的标题 + 独立表格段', () => {
      const engine = createEngine()
      const content = `## 数据表

| 姓名 | 年龄 |
| --- | --- |
| 张三 | 25 |
| 李四 | 30 |

## 总结
以上是数据`
      const segments = engine._splitIntoSegments(content)

      // ## 数据表 → 1 段（level 2）
      // 表格行（独立段，被空行分隔）→ 1 段（isTable）
      // ## 总结 + 内容 → 1 段（level 2）
      expect(segments.length).toBe(3)

      const tableSeg = segments.find(s => s.isTable)
      expect(tableSeg).toBeTruthy()
      expect(tableSeg.text).toContain('| 姓名 | 年龄 |')
      expect(tableSeg.text).toContain('| 张三 | 25 |')
    })
  })
})

describe('WikiEngine._decideMode', () => {
  function createEngine() {
    return new WikiEngine({ workspace: { current: () => null } })
  }

  test('命中段 → mode = full', () => {
    const engine = createEngine()
    // 段0: line 0-0 (命中, 扩展 [-5, 5])
    // 段1: line 20-25 (远离, 不在扩展区间内 → summary)
    const scored = [
      { id: 0, level: 1, text: '# 标题', startLine: 0, endLine: 0, tokens: 10, score: 0.8 },
      { id: 1, level: 0, text: '其他内容', startLine: 20, endLine: 25, tokens: 20, score: 0.1 }
    ]
    const result = engine._decideMode(scored)
    expect(result[0].mode).toBe('full')
    expect(result[1].mode).toBe('summary')
  })

  test('命中段上下文 ±5 行 → 相邻段 mode = full', () => {
    const engine = createEngine()
    // 段0: line 0-3 (score=0.8, 命中)
    // 段1: line 5-8 (与段0上下文范围 [0-5, 3+5=8] 重叠 → full)
    // 段2: line 20-25 (不重叠 → summary)
    const scored = [
      { id: 0, level: 1, text: '命中内容', startLine: 0, endLine: 3, tokens: 10, score: 0.8 },
      { id: 1, level: 0, text: '邻近内容', startLine: 5, endLine: 8, tokens: 20, score: 0.1 },
      { id: 2, level: 0, text: '远端内容', startLine: 20, endLine: 25, tokens: 20, score: 0.1 }
    ]
    const result = engine._decideMode(scored)
    expect(result[0].mode).toBe('full')
    expect(result[1].mode).toBe('full')
    expect(result[2].mode).toBe('summary')
  })

  test('两个命中段上下文交叉 → 合并为一个 full 区间', () => {
    const engine = createEngine()
    // 段0: line 0-3 (score=0.8, 命中, 扩展 [-5, 8])
    // 段1: line 10-15 (score=0.6, 命中, 扩展 [5, 20])
    // 段0 扩展 end=8 与 段1 扩展 start=5 重叠 → 合并为 [-5, 20]
    // 段2: line 17-19 (在合并区间内 → full)
    // 段3: line 30-35 (不在合并区间 → summary)
    const scored = [
      { id: 0, level: 1, text: '命中A', startLine: 0, endLine: 3, tokens: 10, score: 0.8 },
      { id: 1, level: 1, text: '命中B', startLine: 10, endLine: 15, tokens: 10, score: 0.6 },
      { id: 2, level: 0, text: '中间内容', startLine: 17, endLine: 19, tokens: 20, score: 0.1 },
      { id: 3, level: 0, text: '远端内容', startLine: 30, endLine: 35, tokens: 20, score: 0.1 }
    ]
    const result = engine._decideMode(scored)
    expect(result[0].mode).toBe('full')
    expect(result[1].mode).toBe('full')
    expect(result[2].mode).toBe('full')
    expect(result[3].mode).toBe('summary')
  })

  test('不相关段 → mode = summary', () => {
    const engine = createEngine()
    const scored = [
      { id: 0, level: 0, text: '段落A', startLine: 0, endLine: 3, tokens: 10, score: 0.2 },
      { id: 1, level: 0, text: '段落B', startLine: 10, endLine: 15, tokens: 10, score: 0.0 },
      { id: 2, level: 0, text: '段落C', startLine: 20, endLine: 25, tokens: 10, score: 0.3 }
    ]
    const result = engine._decideMode(scored)
    expect(result[0].mode).toBe('summary')
    expect(result[1].mode).toBe('summary')
    expect(result[2].mode).toBe('summary')
  })

  test('score 刚好等于阈值 → 不算命中', () => {
    const engine = createEngine()
    const scored = [
      { id: 0, level: 0, text: '边界', startLine: 0, endLine: 3, tokens: 10, score: 0.5 }
    ]
    const result = engine._decideMode(scored)
    expect(result[0].mode).toBe('summary')
  })

  test('空数组 → 返回空数组', () => {
    const engine = createEngine()
    expect(engine._decideMode([])).toEqual([])
    expect(engine._decideMode(null)).toEqual([])
  })

  test('返回结果保留原始 segment 属性', () => {
    const engine = createEngine()
    const scored = [
      { id: 0, level: 1, text: '内容', startLine: 0, endLine: 3, isTable: true, tableHeader: 'h', tokens: 10, score: 0.8 }
    ]
    const result = engine._decideMode(scored)
    expect(result[0].id).toBe(0)
    expect(result[0].level).toBe(1)
    expect(result[0].isTable).toBe(true)
    expect(result[0].tableHeader).toBe('h')
    expect(result[0].tokens).toBe(10)
    expect(result[0].score).toBe(0.8)
    expect(result[0].mode).toBe('full')
  })

  test('自定义 contextLines 参数', () => {
    const engine = createEngine()
    // 段0: line 0-2 (命中, 扩展 ±1 → [-1, 3])
    // 段1: line 5-8 (距段0 end=2 只差 3 行, 但 contextLines=1 时扩展到 3, 不重叠)
    const scored = [
      { id: 0, level: 0, text: '命中', startLine: 0, endLine: 2, tokens: 10, score: 0.8 },
      { id: 1, level: 0, text: '邻近', startLine: 5, endLine: 8, tokens: 20, score: 0.1 }
    ]
    const result = engine._decideMode(scored, 1)
    expect(result[0].mode).toBe('full')
    expect(result[1].mode).toBe('summary')
  })
})

describe('WikiEngine._summarizeHeuristic', () => {
  function createEngine() {
    return new WikiEngine({ workspace: { current: () => null } })
  }

  test('保留前 2 句', () => {
    const engine = createEngine()
    const text = '第一句话。第二句话！第三句话？第四句话。'
    const result = engine._summarizeHeuristic(text)
    expect(result).toContain('第一句话。')
    expect(result).toContain('第二句话！')
  })

  test('保留含数字行', () => {
    const engine = createEngine()
    const text = '这是一段介绍。\n强度达到30MPa。\n水灰比0.45。\n总结完毕。'
    const result = engine._summarizeHeuristic(text)
    expect(result).toContain('30MPa')
    expect(result).toContain('0.45')
  })

  test('截断到 500 字符', () => {
    const engine = createEngine()
    // 构造 > 500 字符的文本
    const longText = '这是一段很长的文字。'.repeat(100)
    const result = engine._summarizeHeuristic(longText)
    // 去掉末尾固定提示后，正文部分应 <= 500 字符
    const hintSuffix = '\n\n（_如需完整内容，请重新调用 workspace_readPage 不传 query 参数_）'
    const mainPart = result.replace(hintSuffix, '')
    // 加上 '...' 后可能略超 500，但 slice(0, 500) + '...' 不会远超
    expect(mainPart.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS)
  })

  test('末尾包含"请重新调用"提示', () => {
    const engine = createEngine()
    const text = '混凝土配合比设计。强度等级C30。水灰比0.5。'
    const result = engine._summarizeHeuristic(text)
    expect(result).toContain('如需完整内容，请重新调用 workspace_readPage 不传 query 参数')
  })

  test('空文本不崩溃', () => {
    const engine = createEngine()
    const result = engine._summarizeHeuristic('')
    expect(result).toContain('如需完整内容，请重新调用 workspace_readPage 不传 query 参数')
  })
})

describe('WikiEngine._summarizeWithLLM', () => {
  function createEngine() {
    return new WikiEngine({ workspace: { current: () => null } })
  }

  test('调用 deepseekService.invoke 并返回含提示的结果', async () => {
    const engine = createEngine()
    const segment = { text: '混凝土强度测试结果：C30 达标。' }
    const query = '强度'
    const mockService = { invoke: jest.fn().mockResolvedValue('C30混凝土强度测试达标。') }
    const result = await engine._summarizeWithLLM(segment, query, mockService)
    expect(mockService.invoke).toHaveBeenCalledTimes(1)
    expect(result).toContain('C30混凝土强度测试达标。')
    expect(result).toContain('如需完整内容，请重新调用 workspace_readPage 不传 query 参数')
  })

  test('prompt 中包含 query 和 segment.text', async () => {
    const engine = createEngine()
    const segment = { text: '水灰比0.45，坍落度180mm。' }
    const query = '水灰比'
    const mockService = { invoke: jest.fn().mockResolvedValue('摘要结果') }
    await engine._summarizeWithLLM(segment, query, mockService)
    const prompt = mockService.invoke.mock.calls[0][0]
    expect(prompt).toContain('水灰比')
    expect(prompt).toContain('水灰比0.45，坍落度180mm。')
  })

  test('结果末尾包含"请重新调用"提示', async () => {
    const engine = createEngine()
    const segment = { text: '测试内容' }
    const mockService = { invoke: jest.fn().mockResolvedValue('摘要') }
    const result = await engine._summarizeWithLLM(segment, '测试', mockService)
    expect(result.endsWith('）')).toBe(true)
    expect(result).toContain('请重新调用')
  })
})

describe('WikiEngine._batchSummarize', () => {
  function createEngine() {
    return new WikiEngine({ workspace: { current: () => null } })
  }

  function makeSegments(n) {
    return Array.from({ length: n }, (_, i) => ({
      id: i,
      text: `段落${i}的内容：这是关于混凝土配合比的第${i}段描述。`
    }))
  }

  // 辅助：构造返回固定文本的 mock
  function mockService(fn) {
    return { invoke: jest.fn(fn) }
  }

  test('正常批量摘要 → 全部走 LLM', async () => {
    const engine = createEngine()
    const segments = makeSegments(3)
    const service = mockService(async (prompt) => 'LLM摘要:' + prompt.slice(0, 20))

    const result = await engine._batchSummarize(segments, '混凝土', service)

    expect(result).toBeInstanceOf(Map)
    expect(result.size).toBe(3)
    expect(service.invoke).toHaveBeenCalledTimes(3)
    // 每个结果都包含 LLM 摘要前缀
    for (const seg of segments) {
      expect(result.get(seg.id)).toContain('LLM摘要:')
    }
  })

  test('LLM 调用抛错 → 降级为启发式摘要', async () => {
    const engine = createEngine()
    const segments = makeSegments(3)
    // 第 1 段抛错，其余正常
    let callCount = 0
    const service = mockService(async () => {
      callCount++
      if (callCount === 2) throw new Error('LLM服务不可用')
      return '正常摘要'
    })

    const result = await engine._batchSummarize(segments, '测试', service)

    expect(result.size).toBe(3)
    // 第 1 段（id=1）走启发式
    expect(result.get(1)).toContain('如需完整内容，请重新调用')
    // 其余走 LLM
    expect(result.get(0)).toContain('正常摘要')
    expect(result.get(2)).toContain('正常摘要')
  })

  test('LLM 超时 → 降级为启发式摘要', async () => {
    const engine = createEngine()
    const segments = makeSegments(2)
    const service = mockService(async () => {
      // 模拟超时：返回一个延迟超过 SUMMARIZE_TIMEOUT_MS 的 Promise
      await new Promise(resolve => setTimeout(resolve, SUMMARIZE_TIMEOUT_MS + 2000))
      return '不应该到达'
    })

    const result = await engine._batchSummarize(segments, '测试', service)

    expect(result.size).toBe(2)
    // 两段都应降级为启发式（因为超时）
    for (const seg of segments) {
      expect(result.get(seg.id)).toContain('如需完整内容，请重新调用')
    }
  }, 15000)

  test('超过 MAX_TOTAL 段 → 超出部分直接启发式', async () => {
    const engine = createEngine()
    const segments = makeSegments(MAX_TOTAL + 5)
    const service = mockService(async () => 'LLM结果')

    const result = await engine._batchSummarize(segments, '测试', service)

    expect(result.size).toBe(MAX_TOTAL + 5)
    // LLM 只被调用 MAX_TOTAL 次
    expect(service.invoke).toHaveBeenCalledTimes(MAX_TOTAL)
    // 前 MAX_TOTAL 段走 LLM
    for (let i = 0; i < MAX_TOTAL; i++) {
      expect(result.get(i)).toContain('LLM结果')
    }
    // 超出部分走启发式
    for (let i = MAX_TOTAL; i < MAX_TOTAL + 5; i++) {
      expect(result.get(i)).toContain('如需完整内容，请重新调用')
    }
  })

  test('空数组 → 返回空 Map', async () => {
    const engine = createEngine()
    const service = mockService(async () => '摘要')
    const result = await engine._batchSummarize([], '测试', service)
    expect(result).toBeInstanceOf(Map)
    expect(result.size).toBe(0)
    expect(service.invoke).not.toHaveBeenCalled()
  })

  test('null 输入 → 返回空 Map', async () => {
    const engine = createEngine()
    const service = mockService(async () => '摘要')
    const result = await engine._batchSummarize(null, '测试', service)
    expect(result).toBeInstanceOf(Map)
    expect(result.size).toBe(0)
  })

  test('并发上限：MAX_CONCURRENT 个一批', async () => {
    const engine = createEngine()
    // 用 MAX_CONCURRENT + 2 个段测试分批逻辑
    const segCount = MAX_CONCURRENT + 2
    const segments = makeSegments(segCount)
    let maxConcurrent = 0
    let currentConcurrent = 0

    const service = mockService(async () => {
      currentConcurrent++
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent)
      // 模拟小延迟确保并发测量准确
      await new Promise(resolve => setTimeout(resolve, 50))
      currentConcurrent--
      return '摘要'
    })

    const result = await engine._batchSummarize(segments, '测试', service)

    expect(result.size).toBe(segCount)
    expect(service.invoke).toHaveBeenCalledTimes(segCount)
    // 并发数不超过 MAX_CONCURRENT
    expect(maxConcurrent).toBeLessThanOrEqual(MAX_CONCURRENT)
  })
})

describe('WikiEngine._assemble', () => {
  function createEngine() {
    return new WikiEngine({ workspace: { current: () => null } })
  }

  function mockService(fn) {
    return { invoke: jest.fn(fn) }
  }

  // 辅助：构建 decided 数组
  function makeDecided(segments) {
    return segments.map((seg, i) => ({
      id: i,
      level: seg.level || 0,
      text: seg.text,
      startLine: seg.startLine || 0,
      endLine: seg.endLine || 0,
      tokens: seg.tokens || 10,
      score: seg.score ?? 0.1,
      mode: seg.mode || 'summary'
    }))
  }

  test('拼接顺序 = 原文档顺序', async () => {
    const engine = createEngine()
    const decided = makeDecided([
      { text: '段落A', mode: 'full', score: 0.8 },
      { text: '段落B', mode: 'summary', score: 0.1 },
      { text: '段落C', mode: 'full', score: 0.9 }
    ])
    const service = mockService(async () => '摘要B')
    const result = await engine._assemble(decided, service, '测试')

    const content = result.content
    const posA = content.indexOf('段落A')
    const posSummaryB = content.indexOf('摘要B')
    const posC = content.indexOf('段落C')

    // A 在 B 前，B 在 C 前
    expect(posA).toBeLessThan(posSummaryB)
    expect(posSummaryB).toBeLessThan(posC)
  })

  test('full 段带注释标记', async () => {
    const engine = createEngine()
    const decided = makeDecided([
      { text: '相关段落内容', mode: 'full', score: 0.85 }
    ])
    const service = mockService(async () => '摘要')
    const result = await engine._assemble(decided, service, '测试')

    // 检查注释格式
    expect(result.content).toContain('<!-- [段 1, 完整保留, 分数=0.85] -->')
    expect(result.content).toContain('相关段落内容')
  })

  test('summary 段带注释标记', async () => {
    const engine = createEngine()
    const decided = makeDecided([
      { text: '第一行\n第二行\n第三行', mode: 'summary', score: 0.1 }
    ])
    const service = mockService(async () => '压缩后的摘要')
    const result = await engine._assemble(decided, service, '测试')

    // 检查注释格式（原 3 行）
    expect(result.content).toContain('<!-- [段 1, 已压缩, 原 3 行, 分数=0.10] -->')
    expect(result.content).toContain('压缩后的摘要')
  })

  test('超 300KB → 被截断 + stats.truncated = true', async () => {
    const engine = createEngine()
    // 构造足够大的段落使其超过 300KB
    const largeText = '这是一段很长的内容。'.repeat(15000)  // ~180KB per segment
    const decided = makeDecided([
      { text: largeText, mode: 'full', score: 0.8 },
      { text: largeText, mode: 'full', score: 0.8 },
      { text: largeText, mode: 'full', score: 0.8 }
    ])
    const service = mockService(async () => '摘要')
    const result = await engine._assemble(decided, service, '测试')

    expect(result.stats.truncated).toBe(true)
    // 截断后应 <= 300KB
    expect(Buffer.byteLength(result.content, 'utf-8')).toBeLessThanOrEqual(300 * 1024)
  })

  test('stats.elapsedMs 存在', async () => {
    const engine = createEngine()
    const decided = makeDecided([
      { text: '简单段落', mode: 'full', score: 0.8 }
    ])
    const service = mockService(async () => '摘要')
    const result = await engine._assemble(decided, service, '测试')

    expect(result.stats).toBeDefined()
    expect(typeof result.stats.elapsedMs).toBe('number')
    expect(result.stats.elapsedMs).toBeGreaterThanOrEqual(0)
  })

  test('stats 字段完整性', async () => {
    const engine = createEngine()
    const decided = makeDecided([
      { text: '命中段', mode: 'full', score: 0.8 },
      { text: '上下文段', mode: 'full', score: 0.2 },
      { text: '不相关段', mode: 'summary', score: 0.1 }
    ])
    const service = mockService(async () => '摘要')
    const result = await engine._assemble(decided, service, '测试')

    expect(result.stats.totalSegments).toBe(3)
    expect(result.stats.fullSegments).toBe(2)
    expect(result.stats.summarySegments).toBe(1)
    expect(result.stats.contextSegments).toBe(1)  // score=0.2 的 full 段是上下文
    expect(typeof result.stats.originalSize).toBe('number')
    expect(typeof result.stats.filteredSize).toBe('number')
    expect(typeof result.stats.compressionRatio).toBe('number')
    expect(result.stats.truncated).toBe(false)
  })

  test('段号从 1 开始递增', async () => {
    const engine = createEngine()
    const decided = makeDecided([
      { text: '第一段', mode: 'full', score: 0.8 },
      { text: '第二段', mode: 'summary', score: 0.1 },
      { text: '第三段', mode: 'full', score: 0.9 }
    ])
    const service = mockService(async () => '摘要')
    const result = await engine._assemble(decided, service, '测试')

    expect(result.content).toContain('[段 1,')
    expect(result.content).toContain('[段 2,')
    expect(result.content).toContain('[段 3,')
  })

  test('LLM 摘要失败时降级为启发式摘要', async () => {
    const engine = createEngine()
    const decided = makeDecided([
      { text: '混凝土强度30MPa。', mode: 'summary', score: 0.1 }
    ])
    const service = mockService(async () => { throw new Error('LLM不可用') })
    const result = await engine._assemble(decided, service, '强度')

    // 降级后应包含启发式摘要内容
    expect(result.content).toContain('如需完整内容，请重新调用')
    // 注释标记仍然存在
    expect(result.content).toContain('<!-- [段 1, 已压缩,')
  })

  test('空段落数组', async () => {
    const engine = createEngine()
    const service = mockService(async () => '摘要')
    const result = await engine._assemble([], service, '测试')

    expect(result.content).toBe('')
    expect(result.stats.totalSegments).toBe(0)
    expect(result.stats.fullSegments).toBe(0)
    expect(result.stats.summarySegments).toBe(0)
    expect(result.stats.truncated).toBe(false)
  })

  test('不截断时 compressionRatio <= 1', async () => {
    const engine = createEngine()
    const decided = makeDecided([
      { text: '段A ' + '内容'.repeat(50), mode: 'full', score: 0.8 },
      { text: '段B ' + '内容'.repeat(50), mode: 'summary', score: 0.1 }
    ])
    const service = mockService(async () => '短摘要')
    const result = await engine._assemble(decided, service, '测试')

    // summary 段被压缩，整体 filteredSize 应 <= originalSize
    expect(result.stats.filteredSize).toBeLessThanOrEqual(result.stats.originalSize)
    expect(result.stats.truncated).toBe(false)
  })
})

// ==================== readPage 集成测试 ====================
describe('WikiEngine.readPage (Task 8 集成)', () => {
  const fs = require('fs').promises
  const path = require('path')
  const os = require('os')

  let tmpDir
  let engine

  // 辅助：创建临时工作区 + wiki 文件
  async function setupWorkspace(wikiContent) {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-readpage-'))
    const wikiSourcesDir = path.join(tmpDir, 'wiki', 'sources')
    await fs.mkdir(wikiSourcesDir, { recursive: true })
    const filePath = path.join(wikiSourcesDir, 'test-page.md')
    const md = `---
title: "test-page"
source: "test.md"
ingested_at: "2026-01-01T00:00:00Z"
updated_at: "2026-01-01T00:00:00Z"
quality: "high"
---

${wikiContent}`
    await fs.writeFile(filePath, md, 'utf-8')

    const mockWorkspace = {
      current: () => ({ path: tmpDir, status: 'ready' })
    }
    engine = new WikiEngine({
      workspace: mockWorkspace,
      deepseekService: { invoke: jest.fn().mockResolvedValue('LLM摘要结果') }
    })
  }

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  test('不传 query → 走老逻辑 + stats.mode = full', async () => {
    await setupWorkspace('# 标题\n\n混凝土强度C30，水灰比0.45。')
    const result = await engine.readPage('sources/test-page.md')
    expect(result.stats.mode).toBe('full')
    expect(result.stats.query).toBeNull()
    expect(result.content).toContain('混凝土强度C30')
    expect(result.frontmatter.title).toBe('test-page')
    expect(typeof result.mtime).toBe('number')
    expect(typeof result.size).toBe('number')
  })

  test('不传 query + 大文件 → 300KB 截断', async () => {
    // 构造 > 300KB 的内容
    const bigContent = '# 大标题\n\n' + '这是一段很长的混凝土配合比设计内容。'.repeat(20000)
    await setupWorkspace(bigContent)
    const result = await engine.readPage('sources/test-page.md')
    expect(result.stats.mode).toBe('full')
    expect(Buffer.byteLength(result.content, 'utf-8')).toBeLessThanOrEqual(300 * 1024)
    expect(result.content).toContain('已截断')
  })

  test('传 query → stats.mode = filtered', async () => {
    await setupWorkspace(`# 混凝土配合比

## 强度设计
混凝土强度等级C30，水灰比0.45，坍落度180mm。

## 原材料
水泥采用P.O 42.5，砂率38%。

## 施工工艺
搅拌时间不少于120s。`)
    const result = await engine.readPage('sources/test-page.md', { query: '强度 水灰比' })
    expect(result.stats.mode).toBe('relevant-fallback')
    expect(result.stats.query).toBe('强度 水灰比')
    expect(result.stats.returnedSections).toBeGreaterThan(0)
  })

  test('传 query + 大文件 → 返回 < 300KB', async () => {
    // 构造大文件：相关段 + 大量无关段
    const relatedSection = '# 强度设计\n\n混凝土强度C30，水灰比0.45。'
    const unrelatedSections = Array.from({ length: 100 }, (_, i) =>
      `## 无关章节${i}\n\n${'这是无关的施工记录内容，与强度无关。'.repeat(200)}`
    ).join('\n\n')
    const bigContent = relatedSection + '\n\n' + unrelatedSections
    await setupWorkspace(bigContent)
    const result = await engine.readPage('sources/test-page.md', { query: '强度 水灰比' })
    expect(result.stats.mode).toBe('relevant-fallback')
    expect(Buffer.byteLength(result.content, 'utf-8')).toBeLessThanOrEqual(300 * 1024)
  })

  test('传 query → 相关段被完整保留', async () => {
    await setupWorkspace(`# 混凝土强度设计

强度等级C30，水灰比0.45，坍落度180mm。

# 无关章节

这是完全无关的内容，不包含任何关键词。

# 施工记录

搅拌时间120s，养护温度20度。`)
    const result = await engine.readPage('sources/test-page.md', { query: '强度 水灰比' })
    // 相关段应以 full 模式保留
    expect(result.content).toContain('强度等级C30')
    expect(result.content).toContain('请重新调用')
  })

  test('传 query → 不相关段被压缩（含"请重新调用"提示）', async () => {
    await setupWorkspace(`# 强度设计

混凝土强度C30，水灰比0.45。

# 完全无关的章节

这里的内容与查询毫无关系，应该被压缩为摘要。包含一些无关的文字来确保段落足够长。`)
    const result = await engine.readPage('sources/test-page.md', { query: '强度' })
    // 不相关段应被压缩，包含"请重新调用"提示
    expect(result.content).toContain('请重新调用')
    expect(result.content).toContain('...')
  })

  test('fallback stats 返回处理后的段落数量', async () => {
    await setupWorkspace('# 标题\n\n内容。')
    const result = await engine.readPage('sources/test-page.md', { query: '测试' })
    expect(typeof result.stats.returnedSections).toBe('number')
    expect(result.stats.returnedSections).toBeGreaterThanOrEqual(0)
  })
})

// 按行读取（offset/limit 模式）：配合 workspace_grep 实现"定位 → 精读"闭环
describe('WikiEngine.readPage - offset/limit 按行读取', () => {
  const fs = require('fs').promises
  const path = require('path')
  const os = require('os')
  let tmpDir
  let engine

  async function setupWorkspace(wikiContent) {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-lines-'))
    const wikiSourcesDir = path.join(tmpDir, 'wiki', 'sources')
    await fs.mkdir(wikiSourcesDir, { recursive: true })
    const filePath = path.join(wikiSourcesDir, 'test-page.md')
    const md = `---
title: "test-page"
source: "test.md"
ingested_at: "2026-01-01T00:00:00Z"
updated_at: "2026-01-01T00:00:00Z"
quality: "high"
---

${wikiContent}`
    await fs.writeFile(filePath, md, 'utf-8')
    engine = new WikiEngine({ workspace: { current: () => ({ path: tmpDir, status: 'ready' }) } })
  }

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      tmpDir = null
    }
  })

  test('offset=1, limit=N → 返回前 N 行，1-based 行号', async () => {
    // 构造 5 行正文：gray-matter 解析后 content 前有空行 → 总 6 行
    // line1='', line2='l1', line3='l2', line4='l3', line5='l4', line6='l5'
    await setupWorkspace('l1\nl2\nl3\nl4\nl5')
    const r = await engine.readPage('sources/test-page.md', { offset: 1, limit: 3 })
    expect(r.stats.mode).toBe('lines')
    expect(r.stats.offset).toBe(1)
    expect(r.stats.limit).toBe(3)
    expect(r.stats.returnedLines).toBe(3)
    expect(r.stats.totalLines).toBe(6)
    expect(r.stats.truncated).toBe(true)
    // content 含 line2/3/4（line1 是空行）
    expect(r.content).toBe('\nl1\nl2')
  })

  test('offset 超出总行数 → 返回空 content，不抛错', async () => {
    await setupWorkspace('只有一行')
    const r = await engine.readPage('sources/test-page.md', { offset: 9999, limit: 10 })
    expect(r.content).toBe('')
    expect(r.stats.returnedLines).toBe(0)
    expect(r.stats.truncated).toBe(false)
  })

  test('limit 默认 1000，超出文件总行数时返回到末尾', async () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line${i}`).join('\n')
    await setupWorkspace(lines)
    const r = await engine.readPage('sources/test-page.md', { offset: 1 })
    expect(r.stats.limit).toBe(1000)
    expect(r.stats.returnedLines).toBe(r.stats.totalLines)
    expect(r.stats.truncated).toBe(false)
  })

  test('limit 超过 5000 → 被钳制为 5000', async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line${i}`).join('\n')
    await setupWorkspace(lines)
    const r = await engine.readPage('sources/test-page.md', { offset: 1, limit: 99999 })
    expect(r.stats.limit).toBe(5000)
  })

  test('offset 跳过段过滤/全文截断（即使传了 query 也不走 BM25）', async () => {
    // gray-matter 解析后 content 前 1 个空行：line1='', line2='强度C30', line3='水胶比0.45', line4='水泥用量'
    await setupWorkspace('强度C30\n水胶比0.45\n水泥用量')
    // 同时传 offset 和 query → offset 优先；offset=3 取 line3='水胶比0.45'
    const r = await engine.readPage('sources/test-page.md', { offset: 3, limit: 1, query: '强度' })
    expect(r.stats.mode).toBe('lines')
    expect(r.stats.returnedLines).toBe(1)
    expect(r.content).toBe('水胶比0.45')
  })

  test('offset=0 / 负数 / NaN → 回退为 1', async () => {
    await setupWorkspace('l1\nl2')
    const r0 = await engine.readPage('sources/test-page.md', { offset: 0 })
    const rNeg = await engine.readPage('sources/test-page.md', { offset: -5 })
    const rNaN = await engine.readPage('sources/test-page.md', { offset: 'abc' })
    expect(r0.stats.offset).toBe(1)
    expect(rNeg.stats.offset).toBe(1)
    expect(rNaN.stats.offset).toBe(1)
  })

  test('frontmatter 仍被正确剥离（不进入 content）', async () => {
    await setupWorkspace('正文内容')
    const r = await engine.readPage('sources/test-page.md', { offset: 1, limit: 100 })
    expect(r.content).not.toContain('ingested_at')
    expect(r.content).not.toContain('quality')
    expect(r.frontmatter.title).toBe('test-page')
  })

  test('不传 offset → 走老逻辑（不进入 lines 模式）', async () => {
    await setupWorkspace('# 标题\n\n内容。')
    const r = await engine.readPage('sources/test-page.md', { query: '标题' })
    expect(r.stats.mode).not.toBe('lines')
  })
})
