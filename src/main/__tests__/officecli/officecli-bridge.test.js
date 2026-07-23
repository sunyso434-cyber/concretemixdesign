const path = require('path')
const { execFileSync } = require('child_process')

describe('officecli-bridge', () => {
  let bridge
  let execSpy

  beforeEach(() => {
    // 清除模块缓存，确保每次测试拿到干净的引用
    delete require.cache[require.resolve('../../officecli/officecli-bridge')]
    // 设置开发环境标志，使路径解析走项目目录
    process.env.NODE_ENV = 'development'
    bridge = require('../../officecli/officecli-bridge')
    // spy bridge 自己的 execOfficeCliSync（bridge 模块内已拿到 execFileSync 顶层引用，
    // 直接 spy require('child_process') 不生效，必须 spy bridge 的 export）
    execSpy = jest.spyOn(bridge, 'execOfficeCliSync').mockReturnValue({ stdout: '', stderr: '' })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('getBinaryPath', () => {
    it('应返回项目目录下的二进制路径', () => {
      const p = bridge.getBinaryPath()
      expect(p).toContain('resources')
      expect(p).toContain('officecli')
      // Windows 走 win/ 目录（electron-builder ${os} 命名）
      if (process.platform === 'win32') {
        expect(p).toContain('win')
        expect(p).toMatch(/officecli\.exe$/)
      } else if (process.platform === 'darwin') {
        expect(p).toContain('mac')
        expect(p).toMatch(/officecli$/)
      } else {
        expect(p).toContain('linux')
        expect(p).toMatch(/officecli$/)
      }
    })

    it('生产环境下应使用 process.resourcesPath', () => {
      // 模拟生产环境：NODE_ENV 不设 development + 设置 resourcesPath
      const origNodeEnv = process.env.NODE_ENV
      const origResourcesPath = process.resourcesPath
      process.env.NODE_ENV = 'production'
      process.resourcesPath = '/fake/resources'
      delete require.cache[require.resolve('../../officecli/officecli-bridge')]
      const prodBridge = require('../../officecli/officecli-bridge')

      const p = prodBridge.getBinaryPath()
      expect(p).toMatch(/officecli[\\/]officecli(\.exe)?$/)

      // 还原
      process.env.NODE_ENV = origNodeEnv
      process.resourcesPath = origResourcesPath
    })

    it('不支持的平台应抛错', () => {
      const origPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'freebsd' })
      delete require.cache[require.resolve('../../officecli/officecli-bridge')]
      const bridge2 = require('../../officecli/officecli-bridge')
      expect(() => bridge2.getBinaryPath()).toThrow(/不支持/)
      Object.defineProperty(process, 'platform', { value: origPlatform })
    })
  })

  describe('checkAvailability', () => {
    it('当二进制存在时应返回可用状态', () => {
      const result = bridge.checkAvailability()
      // 这个测试依赖环境是否真的下载了二进制
      // 如果二进制不存在，返回 { available: false, error: ... }
      expect(result).toHaveProperty('available')
      if (result.available) {
        expect(result).toHaveProperty('version')
        expect(result).toHaveProperty('path')
        expect(typeof result.version).toBe('string')
        expect(result.version.length).toBeGreaterThan(0)
      }
    })
  })

  describe('readFileAsJson', () => {
    it('不存在的文件应抛错', () => {
      expect(() => bridge.readFileAsJson('/nonexistent/file.docx')).toThrow()
    })
  })

  describe('readFileAsText', () => {
    it('不存在的文件应抛错', () => {
      expect(() => bridge.readFileAsText('/nonexistent/file.docx')).toThrow()
    })
  })

  // v11.7.0: addTable 桥接（老板速查手册需求）
  describe('addTable (v11.7.0)', () => {
    it('add --type table --prop rows/cols/colWidths 参数拼装正确', () => {
      // add table 一次 + 不传 rowsData 不再 setElementText → 1 次调用
      execSpy.mockReturnValueOnce({ stdout: '/body/tbl[1]\n', stderr: '' })
      bridge.addTable('/x.docx', '/body', {
        rows: 2, cols: 3, colWidths: [2000, 1500, 1500]
      })
      expect(execSpy).toHaveBeenCalledTimes(1)
      // execSpy.mock.calls[i] = [args数组]，单参数（args 数组）
      const args = execSpy.mock.calls[0][0]
      expect(args[0]).toBe('add')
      expect(args[1]).toBe('/x.docx')
      expect(args[2]).toBe('/body')
      expect(args).toContain('--type')
      expect(args).toContain('table')
      expect(args).toContain('rows=2')
      expect(args).toContain('cols=3')
      expect(args).toContain('colWidths=2000,1500,1500')
    })

    it('传 rowsData 时二次写单元格（每格 string）', () => {
      execSpy.mockReturnValueOnce({ stdout: '/body/tbl[1]\n', stderr: '' })
      bridge.addTable('/x.docx', '/body', {
        rows: 2, cols: 2,
        rowsData: [['A', 'B'], ['C', 'D']]
      })
      // add table 调用一次 + 每个 cell setElementText 一次 = 1 + 4 = 5 次
      expect(execSpy.mock.calls.length).toBeGreaterThanOrEqual(5)
      // 找 set 调用的 args
      const setCalls = execSpy.mock.calls.filter(c => c[0] && c[0][0] === 'set')
      expect(setCalls.length).toBe(4)
      expect(setCalls[0][0]).toContain('/body/tbl[1]/tr[1]/tc[1]')
      expect(setCalls[0][0]).toContain('text=A')
    })

    it('不传 rows/cols 抛错', () => {
      expect(() => bridge.addTable('/x.docx', '/body', {})).toThrow(/rows.*cols/)
    })
  })

  // v11.7.0: batchExecute 桥接（按 officecli batch verb 真实 schema）
  describe('batchExecute (v11.7.0)', () => {
    it('小 payload 走 --commands 参数', () => {
      bridge.batchExecute('/x.docx', [
        { command: 'add', parent: '/body', type: 'paragraph', props: { text: 'a' } }
      ])
      expect(execSpy).toHaveBeenCalledTimes(1)
      const args = execSpy.mock.calls[0][0]
      expect(args[0]).toBe('batch')
      expect(args[1]).toBe('/x.docx')
      expect(args).toContain('--commands')
      const json = args[args.indexOf('--commands') + 1]
      expect(JSON.parse(json)).toHaveLength(1)
    })

    it('大 payload (>50KB) 走 stdin', () => {
      // 构造 > 50KB 的 commands
      const bigCommands = Array(2000).fill({ command: 'add', parent: '/body', type: 'paragraph', props: { text: 'x'.repeat(50) } })
      bridge.batchExecute('/x.docx', bigCommands)
      expect(execSpy).toHaveBeenCalledTimes(1)
      const args = execSpy.mock.calls[0][0]
      expect(args[0]).toBe('batch')
      expect(args).not.toContain('--commands')
      // execSync 第二参数含 input
      const opts = execSpy.mock.calls[0][1]
      expect(opts.input).toBeDefined()
      expect(JSON.parse(opts.input)).toHaveLength(2000)
    })
  })

  // v11.7.0: setElementText 注释列出完整 paragraph/run 属性（不破坏现有签名）
  describe('setElementText props 透传（v11.7.0）', () => {
    it('props 完整透传到 --prop k=v', () => {
      bridge.setElementText('/x.docx', '/body/p[1]', 'hi', {
        'font.ea': '仿宋',
        'font.latin': 'Times New Roman',
        size: '12pt',
        firstLineIndent: '480',
        lineSpacing: '360',
        lineRule: 'auto'
      })
      expect(execSpy).toHaveBeenCalledTimes(1)
      const args = execSpy.mock.calls[0][0]
      expect(args[0]).toBe('set')
      expect(args).toContain('--prop')
      expect(args).toContain('font.ea=仿宋')
      expect(args).toContain('font.latin=Times New Roman')
      expect(args).toContain('size=12pt')
      expect(args).toContain('firstLineIndent=480')
      expect(args).toContain('lineSpacing=360')
      expect(args).toContain('lineRule=auto')
    })
  })

  // v11.7.0 P1: move/swap/query/validate/refresh/importCsv/resident
  describe('move + swap (v11.7.0 P1)', () => {
    it('moveElement 参数拼装正确', () => {
      bridge.moveElement('/x.docx', '/body/p[3]', '/body/p[1]')
      const args = execSpy.mock.calls[0][0]
      expect(args[0]).toBe('move')
      expect(args[1]).toBe('/x.docx')
      expect(args[2]).toBe('/body/p[3]')
      expect(args).toContain('--after')
      expect(args).toContain('/body/p[1]')
    })

    it('swapElements 参数拼装正确', () => {
      bridge.swapElements('/x.docx', '/body/p[1]', '/body/p[5]')
      const args = execSpy.mock.calls[0][0]
      expect(args[0]).toBe('swap')
      expect(args).toContain('/body/p[1]')
      expect(args).toContain('/body/p[5]')
    })
  })

  describe('query / validate / refresh (v11.7.0 P1)', () => {
    it('queryElements 返回 JSON', () => {
      execSpy.mockReturnValueOnce({ stdout: '[{"path":"/body/p[1]","text":"hi"}]', stderr: '' })
      const r = bridge.queryElements('/x.docx', { element: 'p' })
      expect(r).toHaveLength(1)
      expect(r[0].text).toBe('hi')
    })

    it('validateDocument 参数拼装正确', () => {
      bridge.validateDocument('/x.docx')
      expect(execSpy.mock.calls[0][0][0]).toBe('validate')
    })

    it('refreshDocument 参数拼装正确', () => {
      bridge.refreshDocument('/x.docx')
      expect(execSpy.mock.calls[0][0][0]).toBe('refresh')
    })
  })

  describe('importCsv (v11.7.0 P1)', () => {
    it('importCsv 参数拼装正确', () => {
      bridge.importCsv('/x.xlsx', '/', '/src/data.csv', { sheet: 'Data', startCell: 'B2', delimiter: ';' })
      const args = execSpy.mock.calls[0][0]
      expect(args[0]).toBe('import')
      expect(args).toContain('--sheet')
      expect(args).toContain('Data')
      expect(args).toContain('--startCell')
      expect(args).toContain('B2')
      expect(args).toContain('--delimiter')
      expect(args).toContain(';')
    })
  })

  // v11.7.0: officecliHelp
  describe('officecliHelp (v11.7.0)', () => {
    it('帮助查询 docx 元素列表', () => {
      bridge.officecliHelp({ format: 'docx' })
      const args = execSpy.mock.calls[0][0]
      expect(args[0]).toBe('help')
      expect(args[1]).toBe('docx')
    })

    it('帮助查询 docx paragraph add verb', () => {
      bridge.officecliHelp({ format: 'docx', verb: 'add', element: 'paragraph' })
      const args = execSpy.mock.calls[0][0]
      expect(args).toEqual(['help', 'docx', 'add', 'paragraph'])
    })

    it('帮助查询 all 格式 JSON 输出', () => {
      execSpy.mockReturnValueOnce({ stdout: '{"success":true}', stderr: '' })
      const r = bridge.officecliHelp({ format: 'all', json: true })
      expect(execSpy.mock.calls[0][0]).toContain('--json')
      expect(r.success).toBe(true)
    })

    it('verb=any 不传 verb 参数', () => {
      bridge.officecliHelp({ format: 'pptx', verb: 'any', element: 'shape' })
      const args = execSpy.mock.calls[0][0]
      expect(args).toEqual(['help', 'pptx', 'shape'])  // 'any' 被过滤掉
    })
  })

  // v11.7.0 P2: dump/raw/rawSet/addPart
  describe('dump + raw (v11.7.0 P2)', () => {
    it('dumpSubtree 参数拼装正确', () => {
      execSpy.mockReturnValueOnce({ stdout: '[{"command":"add"}]', stderr: '' })
      const r = bridge.dumpSubtree('/x.docx', '/body/tbl[1]')
      expect(execSpy.mock.calls[0][0][0]).toBe('dump')
      expect(r).toContain('add')
    })

    it('rawPart 默认 part /document', () => {
      execSpy.mockReturnValueOnce({ stdout: '<w:document>...</w:document>', stderr: '' })
      const r = bridge.rawPart('/x.docx')
      expect(execSpy.mock.calls[0][0][2]).toBe('/document')  // args[0]=raw, args[1]=file, args[2]=part
      expect(r).toContain('w:document')
    })

    it('rawSetPart 走 stdin', () => {
      bridge.rawSetPart('/x.docx', '/document', '<xml/>')
      const args = execSpy.mock.calls[0][0]
      const opts = execSpy.mock.calls[0][1]
      expect(args[0]).toBe('raw-set')
      expect(opts.input).toBe('<xml/>')
    })

    it('addPart 走 stdin', () => {
      bridge.addPart('/x.docx', '/styles', '<xml/>')
      const args = execSpy.mock.calls[0][0]
      const opts = execSpy.mock.calls[0][1]
      expect(args[0]).toBe('add-part')
      expect(opts.input).toBe('<xml/>')
    })
  })
})
