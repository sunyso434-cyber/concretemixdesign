const MDParser = require('../../agent/MDParser')
const path = require('path')
const fs = require('fs')
const os = require('os')

describe('MDParser - triggerMode 字段', () => {
  let tmpDir
  let parser

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-test-'))
    parser = new MDParser()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function writeMd(content) {
    const fp = path.join(tmpDir, 'test.md')
    fs.writeFileSync(fp, content)
    return fp
  }

  test('解析 trigger_mode: soft', () => {
    const fp = writeMd(`---
name: brainstorm
description: 创新脑暴
trigger_mode: soft
---
# body`)
    const result = parser.parse(fp)
    expect(result.triggerMode).toBe('soft')
  })

  test('缺省 trigger_mode 默认 function', () => {
    const fp = writeMd(`---
name: old_skill
description: 老的
---
# body`)
    const result = parser.parse(fp)
    expect(result.triggerMode).toBe('function')
  })

  test('非法 trigger_mode 不抛错（MDParser 层只解析字符串，由 SkillRegistry 决定是否降级）', () => {
    const fp = writeMd(`---
name: weird
description: 怪
trigger_mode: invalid
---
# body`)
    expect(() => parser.parse(fp)).not.toThrow()
    const result = parser.parse(fp)
    expect(result.triggerMode).toBe('invalid')  // 字符串原样，MDParser 不管
  })
})
