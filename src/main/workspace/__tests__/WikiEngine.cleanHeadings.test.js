// WikiEngine._extractHeading / _isFakeHeading 单元测试
//
// 覆盖：
// - PDF 页眉（期刊名+卷期号）
// - PDF 页脚（"-- X of Y --"、"Page X of Y"、"2 of 19"）
// - XLSX Sheet 名、"_(空 sheet)_" 占位符
// - XLSX 合并单元格标题行（整行 markdown 表格）
// - ScienceDirect 元信息（"Available online ..."、"Received ..."、"E-mail addresses:"、"* Corresponding author."）
// - 真标题保留（"1. Introduction"、"2.1. Materials"、"A B S T R A C T"、"Keywords:"、"试验方法"）

const { WikiEngine } = require('../WikiEngine')

function createEngine() {
  return new WikiEngine({ workspace: { current: () => null } })
}

function fakeSeg(firstLine, fullText) {
  return {
    text: fullText !== undefined ? fullText : firstLine + '\n正文内容',
    lines: [{ lineNumber: 1, text: firstLine }]
  }
}

describe('WikiEngine._isFakeHeading', () => {
  const engine = createEngine()

  describe('PDF 页眉/页脚（应丢弃）', () => {
    test('期刊名 + 卷期号', () => {
      expect(engine._isFakeHeading('Journal of Building Engineering 78 (2023) 107738', 'Journal of Building Engineering 78 (2023) 107738')).toBe(true)
    })

    test('Proceedings 期刊名', () => {
      expect(engine._isFakeHeading('Proceedings of the IEEE 105 (2017) 1234-1240', 'Proceedings of the IEEE 105 (2017) 1234-1240')).toBe(true)
    })

    test('PDF 页脚 -- X of Y --', () => {
      expect(engine._isFakeHeading('-- 1 of 19 --', '-- 1 of 19 --')).toBe(true)
      expect(engine._isFakeHeading('-- 14 of 14 --', '-- 14 of 14 --')).toBe(true)
    })

    test('英文页脚 Page X of Y', () => {
      expect(engine._isFakeHeading('Page 5 of 19', 'Page 5 of 19')).toBe(true)
    })

    test('孤立页码 2 of 19', () => {
      expect(engine._isFakeHeading('2 of 19', '2 of 19')).toBe(true)
    })
  })

  describe('XLSX 元信息（应丢弃）', () => {
    test('Sheet 名 "Sheet: 适应性"', () => {
      expect(engine._isFakeHeading('Sheet: 适应性', '## Sheet: 适应性')).toBe(true)
    })

    test('Sheet 名 "Sheet: Sheet3"', () => {
      expect(engine._isFakeHeading('Sheet: Sheet3', '## Sheet: Sheet3')).toBe(true)
    })

    test('_(空 sheet)_ 占位符', () => {
      expect(engine._isFakeHeading('_(空 sheet)_', '_(空 sheet)_')).toBe(true)
    })

    test('合并单元格标题行（首行整行表格）', () => {
      const mergedLine = '| (   中心    )试验室试配表 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |'
      expect(engine._isFakeHeading(mergedLine.slice(0, 60), mergedLine)).toBe(true)
    })

    test('普通表格行（至少 2 个 |）', () => {
      const tableLine = '| 水泥 | P·O52.5 | 峨胜 |'
      expect(engine._isFakeHeading(tableLine, tableLine)).toBe(true)
    })
  })

  describe('ScienceDirect 元信息（应丢弃）', () => {
    test('"Available online 14 September 2023"', () => {
      expect(engine._isFakeHeading('Available online 14 September 2023', 'Available online 14 September 2023')).toBe(true)
    })

    test('"Received 23 May 2023"', () => {
      expect(engine._isFakeHeading('Received 23 May 2023', 'Received 23 May 2023')).toBe(true)
    })

    test('"Contents lists available at ScienceDirect"', () => {
      expect(engine._isFakeHeading('Contents lists available at ScienceDirect', 'Contents lists available at ScienceDirect')).toBe(true)
    })

    test('"E-mail addresses: ..."', () => {
      expect(engine._isFakeHeading('E-mail addresses: foo@bar.com', 'E-mail addresses: foo@bar.com')).toBe(true)
    })

    test('"* Corresponding author."', () => {
      expect(engine._isFakeHeading('* Corresponding author.', '* Corresponding author.')).toBe(true)
    })

    test('"Z. Fang et al."（PDF 引用行）', () => {
      expect(engine._isFakeHeading('Z. Fang et al.', 'Z. Fang et al.')).toBe(true)
      expect(engine._isFakeHeading('Z. Fang et al', 'Z. Fang et al')).toBe(true)
    })

    test('"Cement and Concrete Composites 133 (2022) 104709"（带期刊名前缀的卷期号）', () => {
      expect(engine._isFakeHeading('Cement and Concrete Composites 133 (2022) 104709', 'Cement and Concrete Composites 133 (2022) 104709')).toBe(true)
    })

    test('含二进制/控制字符的 PDF 垃圾', () => {
      expect(engine._isFakeHeading('\x00 x2', '\x00 x2')).toBe(true)
    })
  })

  describe('真标题（应保留）', () => {
    test('"1. Introduction"', () => {
      expect(engine._isFakeHeading('1. Introduction', '1. Introduction')).toBe(false)
    })

    test('"2.1. Materials"', () => {
      expect(engine._isFakeHeading('2.1. Materials', '2.1. Materials')).toBe(false)
    })

    test('"2.3.1. Mechanical properties"', () => {
      expect(engine._isFakeHeading('2.3.1. Mechanical properties', '2.3.1. Mechanical properties')).toBe(false)
    })

    test('"A B S T R A C T" 全大写真标题（保留，不命中黑名单）', () => {
      // 全大写黑名单仅适用于纯大写但不应误判"ABSTRACT" 这种 Elsevier 标配
      expect(engine._isFakeHeading('A B S T R A C T', 'A B S T R A C T')).toBe(false)
    })

    test('"Keywords:" 后跟关键词列表', () => {
      expect(engine._isFakeHeading('Keywords:', 'Keywords:')).toBe(false)
    })

    test('中文章节标题 "2.1 试验方法"', () => {
      expect(engine._isFakeHeading('2.1 试验方法', '2.1 试验方法')).toBe(false)
    })

    test('"## 标题二" markdown 形式', () => {
      expect(engine._isFakeHeading('标题二', '## 标题二')).toBe(false)
    })
  })
})

describe('WikiEngine._extractHeading', () => {
  const engine = createEngine()

  describe('假标题应返回 ""', () => {
    test('PDF 页眉', () => {
      const seg = fakeSeg('Journal of Building Engineering 78 (2023) 107738')
      expect(engine._extractHeading(seg)).toBe('')
    })

    test('PDF 页脚', () => {
      const seg = fakeSeg('-- 1 of 19 --')
      expect(engine._extractHeading(seg)).toBe('')
    })

    test('XLSX Sheet 名', () => {
      const seg = fakeSeg('## Sheet: 适应性', '## Sheet: 适应性\n\n表格内容...')
      expect(engine._extractHeading(seg)).toBe('')
    })

    test('XLSX 合并单元格标题行', () => {
      const mergedLine = '| (   中心    )试验室试配表 |  |  |  |  |  |  |  |  |  |'
      const seg = fakeSeg(mergedLine, mergedLine + '\n| 试验目的 |  | UHPC试验 |')
      expect(engine._extractHeading(seg)).toBe('')
    })

    test('空段（seg.text 为空）', () => {
      expect(engine._extractHeading({ text: '', lines: [] })).toBe('')
    })

    test('段内搜索：PDF 页面段落含页眉+真标题 → 返回真标题', () => {
      // 模拟 PDF 提取结果：每页是一段，开头是页眉，段落中部是真标题
      const fullText = [
        'Cement and Concrete Composites 133 (2022) 104709',
        '',
        'Abstract',
        'Some abstract text...',
        '',
        '1. Introduction',
        'Introduction content here.'
      ].join('\n')
      const seg = { text: fullText, lines: [] }
      expect(engine._extractHeading(seg)).toBe('1. Introduction')
    })

    test('段内搜索：选编号最深的标题（"2.2." > "2.1" > "2"）', () => {
      // PDF 段内同时有 "2. Materials" 和 "2.1. Materials" 和 "2.2. Mixture proportions"
      // 应选最具体的 "2.2. Mixture proportions..."
      const fullText = [
        'Journal of Building Engineering 78 (2023) 107738',
        '',
        '2. Materials and methods',
        '',
        '2.1. Materials',
        'Materials description.',
        '',
        '2.2. Mixture proportions and samples preparation',
        'More details here.'
      ].join('\n')
      const seg = { text: fullText, lines: [] }
      expect(engine._extractHeading(seg)).toBe('2.2. Mixture proportions and samples preparation')
    })

    test('段内搜索：同级标题取最晚出现的', () => {
      // PDF 段内同时有 "2.1." 和 "2.2."（同深度），取最晚的
      const fullText = [
        'Journal of Building Engineering 78 (2023) 107738',
        '',
        '2.1. Materials',
        'Materials.',
        '',
        '2.2. Methods',
        'Methods.'
      ].join('\n')
      const seg = { text: fullText, lines: [] }
      expect(engine._extractHeading(seg)).toBe('2.2. Methods')
    })

    test('段内搜索：全大写 "A B S T R A C T"', () => {
      const fullText = [
        'Journal of Building Engineering 78 (2023) 107738',
        '',
        'A B S T R A C T',
        'Abstract content.'
      ].join('\n')
      const seg = { text: fullText, lines: [] }
      expect(engine._extractHeading(seg)).toBe('A B S T R A C T')
    })

    test('段内搜索："Keywords:" 章节', () => {
      const fullText = [
        'Journal of Building Engineering 78 (2023) 107738',
        '',
        'Keywords:',
        'UHPC, FAM, mechanical properties'
      ].join('\n')
      const seg = { text: fullText, lines: [] }
      expect(engine._extractHeading(seg)).toBe('Keywords:')
    })

    test('段内搜索：同时有 "Keywords:" 和 "1. Introduction" → 选 1. Introduction', () => {
      // 真实 PDF 首页场景：Keywords: 出现早，1. Introduction 出现晚
      // 应该选 1. Introduction 作为 section 的代表章节
      const fullText = [
        'Journal of Building Engineering 78 (2023) 107738',
        'Available online 14 September 2023',
        'Author Name, Affiliation',
        'A R T I C L E  I N F O',
        'Keywords:',
        'UHPC, FAM, mechanical properties',
        'A B S T R A C T',
        'Abstract text here...',
        '1. Introduction',
        'Introduction content here.'
      ].join('\n')
      const seg = { text: fullText, lines: [] }
      expect(engine._extractHeading(seg)).toBe('1. Introduction')
    })

    test('段内搜索：找不到真标题（段全是页眉页脚）→ 返回 ""', () => {
      const fullText = [
        'Journal of Building Engineering 78 (2023) 107738',
        '',
        '-- 1 of 19 --',
        '',
        'some random paragraph text without any heading pattern'
      ].join('\n')
      const seg = { text: fullText, lines: [] }
      expect(engine._extractHeading(seg)).toBe('')
    })
  })

  describe('真标题应保留', () => {
    test('"## 1. Introduction" → "1. Introduction"', () => {
      const seg = fakeSeg('## 1. Introduction', '## 1. Introduction\n正文...')
      expect(engine._extractHeading(seg)).toBe('1. Introduction')
    })

    test('"# 中文标题" → "中文标题"', () => {
      const seg = fakeSeg('# 中文标题', '# 中文标题\n正文')
      expect(engine._extractHeading(seg)).toBe('中文标题')
    })

    test('fallback：首行前 60 字符（真标题）', () => {
      const seg = fakeSeg('2.1. Materials and methods')
      expect(engine._extractHeading(seg)).toBe('2.1. Materials and methods')
    })
  })
})

describe('WikiEngine.computeSections (回归测试)', () => {
  const engine = createEngine()

  test('清洗后的 PDF sections 不含页眉/页脚', () => {
    const content = `Journal of Building Engineering 78 (2023) 107738

正文第一段内容...

-- 1 of 19 --

Journal of Building Engineering 78 (2023) 107738

1. Introduction
第一段正文。

-- 2 of 19 --

2. Materials and methods
材料与方法正文。`
    const sections = engine.computeSections(content)
    const fakeHeadings = sections.filter(s =>
      s.heading.includes('Journal of') ||
      /--\s*\d+\s*of\s*\d+\s*--/.test(s.heading)
    )
    expect(fakeHeadings.length).toBe(0)
    const realHeadings = sections.filter(s => s.heading).map(s => s.heading)
    expect(realHeadings).toContain('1. Introduction')
    expect(realHeadings).toContain('2. Materials and methods')
  })

  test('清洗后的 XLSX sections 不含 Sheet 名/合并单元格标题', () => {
    const content = `## Sheet: 适应性

| (   中心    )试验室试配表 |  |  |  |  |
|------|------|------|------|
| 试验目的 |  | UHPC试验 |  |

## Sheet: Sheet3

_(空 sheet)_`
    const sections = engine.computeSections(content)
    const fakeHeadings = sections.filter(s =>
      s.heading.startsWith('Sheet:') ||
      s.heading.includes('试验室试配表') ||
      s.heading === '_(空 sheet)_'
    )
    expect(fakeHeadings.length).toBe(0)
  })
})

describe('WikiEngine._mergeEmptySections', () => {
  const engine = createEngine()

  test('空数组', () => {
    expect(engine._mergeEmptySections([])).toEqual([])
  })

  test('所有 section 都有 heading → 不动', () => {
    const input = [
      { id: 0, heading: 'A', startLine: 0, endLine: 5 },
      { id: 1, heading: 'B', startLine: 6, endLine: 10 }
    ]
    const result = engine._mergeEmptySections(input)
    expect(result.length).toBe(2)
    expect(result[0].heading).toBe('A')
    expect(result[1].heading).toBe('B')
  })

  test('1-2 行空 section（页脚/页眉）→ 直接删除', () => {
    const input = [
      { id: 0, heading: '1. Introduction', startLine: 0, endLine: 5 },
      { id: 1, heading: '', startLine: 6, endLine: 6 },  // 1 行空（页脚）
      { id: 2, heading: '2. Methods', startLine: 7, endLine: 15 },
      { id: 3, heading: '', startLine: 16, endLine: 17 }  // 2 行空（页脚）
    ]
    const result = engine._mergeEmptySections(input)
    expect(result.length).toBe(2)
    expect(result[0].heading).toBe('1. Introduction')
    expect(result[1].heading).toBe('2. Methods')
  })

  test('多行空 section（跨页正文）→ 合并到上一个保留 section', () => {
    const input = [
      { id: 0, heading: '1. Introduction', startLine: 0, endLine: 10 },
      { id: 1, heading: '', startLine: 11, endLine: 50 },  // 多行空
      { id: 2, heading: '2. Methods', startLine: 51, endLine: 60 }
    ]
    const result = engine._mergeEmptySections(input)
    expect(result.length).toBe(2)
    expect(result[0].heading).toBe('1. Introduction')
    expect(result[0].startLine).toBe(0)
    expect(result[0].endLine).toBe(50)  // 扩展到空 section 的 endLine
    expect(result[1].heading).toBe('2. Methods')
  })

  test('连续多个空 section → 全部合并到上一个', () => {
    const input = [
      { id: 0, heading: '1. Intro', startLine: 0, endLine: 10 },
      { id: 1, heading: '', startLine: 11, endLine: 20 },
      { id: 2, heading: '', startLine: 21, endLine: 30 },
      { id: 3, heading: '', startLine: 31, endLine: 40 },
      { id: 4, heading: '2. Methods', startLine: 41, endLine: 50 }
    ]
    const result = engine._mergeEmptySections(input)
    expect(result.length).toBe(2)
    expect(result[0].endLine).toBe(40)  // 扩展到最后空 section
    expect(result[1].startLine).toBe(41)
  })

  test('文末多行空 section → 合并到上一个；单行空 section → 删除', () => {
    const input = [
      { id: 0, heading: '1. Intro', startLine: 0, endLine: 10 },
      { id: 1, heading: '2. Methods', startLine: 11, endLine: 20 },
      { id: 2, heading: '', startLine: 21, endLine: 30 },  // 多行空（合并）
      { id: 3, heading: '', startLine: 31, endLine: 31 }   // 1 行空（删，不合并）
    ]
    const result = engine._mergeEmptySections(input)
    expect(result.length).toBe(2)
    expect(result[1].heading).toBe('2. Methods')
    expect(result[1].endLine).toBe(30)  // 扩展到多行空的 endLine；1 行空被删
  })

  test('文件开头的空 section → 丢弃', () => {
    const input = [
      { id: 0, heading: '', startLine: 0, endLine: 5 },    // 开头空
      { id: 1, heading: '1. Intro', startLine: 6, endLine: 10 }
    ]
    const result = engine._mergeEmptySections(input)
    expect(result.length).toBe(1)
    expect(result[0].heading).toBe('1. Intro')
  })

  test('id 重新分配为连续 0,1,2...', () => {
    const input = [
      { id: 0, heading: 'A', startLine: 0, endLine: 5 },
      { id: 1, heading: '', startLine: 6, endLine: 10 },
      { id: 2, heading: 'B', startLine: 11, endLine: 15 },
      { id: 3, heading: '', startLine: 16, endLine: 20 },
      { id: 4, heading: 'C', startLine: 21, endLine: 25 }
    ]
    const result = engine._mergeEmptySections(input)
    expect(result.map(s => s.id)).toEqual([0, 1, 2])
    expect(result[0].heading).toBe('A')
    expect(result[0].endLine).toBe(10)
    expect(result[1].heading).toBe('B')
    expect(result[1].endLine).toBe(20)
    expect(result[2].heading).toBe('C')
  })

  test('混合场景：1 行空 + 多行空 + 文末空', () => {
    const input = [
      { id: 0, heading: '1. Intro', startLine: 0, endLine: 10 },
      { id: 1, heading: '', startLine: 11, endLine: 11 },     // 1 行（删）
      { id: 2, heading: '2. Methods', startLine: 12, endLine: 30 },
      { id: 3, heading: '', startLine: 31, endLine: 50 },     // 多行（合并到 2. Methods）
      { id: 4, heading: '', startLine: 51, endLine: 51 },     // 1 行（删）
      { id: 5, heading: '3. Results', startLine: 52, endLine: 60 },
      { id: 6, heading: '', startLine: 61, endLine: 80 }      // 多行（文末，合并到 3. Results）
    ]
    const result = engine._mergeEmptySections(input)
    expect(result.length).toBe(3)
    expect(result[0].heading).toBe('1. Intro')
    expect(result[0].endLine).toBe(10)
    expect(result[1].heading).toBe('2. Methods')
    expect(result[1].endLine).toBe(50)
    expect(result[2].heading).toBe('3. Results')
    expect(result[2].endLine).toBe(80)
  })
})