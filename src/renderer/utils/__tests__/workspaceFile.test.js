// src/renderer/utils/__tests__/workspaceFile.test.js
//
// P1 补全 - 工作区文件工具单测
// 覆盖：
//   1. toSlug       - 与 WikiEngine.ingest 规则保持一致
//   2. SUPPORTED_EXTS - 5 种可 ingest 扩展名
//   3. getImportedSlugs - 从 listFiles('wiki/sources') 结果中提取已导入的 slug
//   4. isSupportedExt  - 判断文件扩展名是否支持
//   5. 文件名 slug 冲突场景
//
// 注意：toSlug 必须与 WikiEngine.js:53-57 保持完全一致！否则 Popover 显示「✅ 已导入」
// 但实际 wiki 页面不匹配。

import { toSlug, SUPPORTED_EXTS, isSupportedExt, getImportedSlugs } from '../workspaceFile'

describe('toSlug', () => {
  test('基础英文文件名', () => {
    expect(toSlug('spec.md')).toBe('spec')
    expect(toSlug('notes.txt')).toBe('notes')
    expect(toSlug('data.xlsx')).toBe('data')
    expect(toSlug('report.pdf')).toBe('report')
  })

  test('多次扩展：path.parse() 只剥最后一个 ext', () => {
    // path.parse('archive.tar.gz').name === 'archive.tar'，点号会被后续剥离
    expect(toSlug('archive.tar.gz')).toBe('archivetar')
  })

  test('空格转 dash', () => {
    expect(toSlug('my spec.md')).toBe('my-spec')
    // /\s+/g 合并连续空格为一个 dash（无末尾 dash）
    expect(toSlug('  spaced  out.md')).toBe('-spaced-out')
  })

  test('中文文件名保留 + FNV-1a 短后缀', () => {
    // Task 2.1 (spec §4.10): 含中文文件名追加 FNV-1a(filename) 前 6 位 hex
    expect(toSlug('我的文档.md')).toBe('我的文档-9d2173')
    expect(toSlug('混凝土配合比说明.pdf')).toBe('混凝土配合比说明-5b91e1')
  })

  test('中英混合', () => {
    expect(toSlug('C30配合比设计.md')).toBe('c30配合比设计-c7a95f')
  })

  test('特殊字符剥离（保留 - 和 _ 和 .）', () => {
    expect(toSlug('v1.0_release.md')).toBe('v10_release') // 点被剥离
    expect(toSlug('a@b#c$.md')).toBe('abc')
  })

  test('空字符串和纯点', () => {
    expect(toSlug('.md')).toBe('')
    expect(toSlug('....')).toBe('')
  })

  test('大写转小写', () => {
    expect(toSlug('README.MD')).toBe('readme') // 先取 name 'README'（因为 ext=.MD 但 name 仍是大写）
    expect(toSlug('SpecFile.Md')).toBe('specfile')
  })
})

describe('SUPPORTED_EXTS & isSupportedExt', () => {
  test('支持 5 种扩展名', () => {
    expect(SUPPORTED_EXTS).toEqual(
      expect.arrayContaining(['.txt', '.md', '.pdf', '.docx', '.xlsx'])
    )
    expect(SUPPORTED_EXTS).toHaveLength(5)
  })

  test('大写扩展名也能识别', () => {
    expect(isSupportedExt('file.PDF')).toBe(true)
    expect(isSupportedExt('file.Md')).toBe(true)
  })

  test('不支持的扩展名返回 false', () => {
    expect(isSupportedExt('photo.png')).toBe(false)
    expect(isSupportedExt('slides.pptx')).toBe(false)
    expect(isSupportedExt('archive.zip')).toBe(false)
    expect(isSupportedExt('video.mp4')).toBe(false)
  })

  test('无扩展名返回 false', () => {
    expect(isSupportedExt('README')).toBe(false)
    expect(isSupportedExt('Makefile')).toBe(false)
  })
})

describe('getImportedSlugs', () => {
  test('从 listFiles 返回值中提取 slug（去掉 .md）', () => {
    const listResult = [
      { name: 'spec.md', path: 'wiki/sources/spec.md' },
      { name: '混凝土说明-33d690.md', path: 'wiki/sources/混凝土说明-33d690.md' },
      { name: 'README.md', path: 'wiki/sources/README.md' }
    ]
    const slugs = getImportedSlugs(listResult)
    // 已生成的 wiki 文件名 hex 部分是 word 字符，toSlug 不会重新加 hash 后缀
    expect(slugs).toEqual(new Set(['spec', '混凝土说明-33d690', 'readme']))
  })

  test('空数组返回空 Set', () => {
    expect(getImportedSlugs([])).toEqual(new Set())
  })

  test('只取 .md 文件，过滤子目录', () => {
    const listResult = [
      { name: 'spec.md' },
      { name: 'subdir' }, // 目录，应跳过
      { name: 'image.png' }
    ]
    const slugs = getImportedSlugs(listResult)
    expect(slugs).toEqual(new Set(['spec']))
  })

  test('不抛异常：缺 name 字段时跳过', () => {
    const listResult = [
      null,
      undefined,
      {},
      { name: 'ok.md' }
    ]
    const slugs = getImportedSlugs(listResult)
    expect(slugs).toEqual(new Set(['ok']))
  })
})
