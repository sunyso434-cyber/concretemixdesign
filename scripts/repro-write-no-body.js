/**
 * repro-write-no-body.js
 * 复现老板报告的"写入工具只有标题没有正文"问题
 *
 * 假设：LLM 不知道 payload 结构，传了 { title: 'xxx' } 没传 sections
 * 验证：跑 markdown.js 和 docx.js 看输出是否只有标题没正文
 */

const path = require('path')

async function main() {
  const markdownWriter = require('../src/main/workspace/writers/markdown.js')
  const docxWriter = require('../src/main/workspace/writers/docx.js')

  console.log('=== 假设：LLM 只传 { title } 不传 sections ===\n')

  const mockPayload = {
    title: 'C30 配合比设计报告'
    // LLM 不知道 sections 怎么写 → 没传 sections
  }

  console.log('1. markdown writer 输出:')
  console.log('---')
  const mdBuf = await markdownWriter.write(mockPayload)
  console.log(mdBuf.toString('utf-8'))
  console.log('---\n')

  console.log('2. docx writer 输出:')
  console.log('---')
  const docxBuf = await docxWriter.write(mockPayload)
  console.log('docx 文件大小:', docxBuf.length, 'bytes')
  console.log('(docx 是二进制，需打开 Word 才能看内容)')
  console.log('---')

  // 解压 docx 验证：提取 document.xml 看内容
  console.log('\n3. 解压 docx 看 document.xml 内容:')
  const AdmZip = require('adm-zip')  // 试试
  let zip
  try {
    zip = new AdmZip(docxBuf)
  } catch (e) {
    // 用 node:zlib 手动解压
    const fs = require('fs')
    fs.writeFileSync('/tmp/test.docx', docxBuf)
    console.log('adm-zlib 不可用，请手动用 Word 打开 /tmp/test.docx')
    console.log('或解压: unzip /tmp/test.docx -d /tmp/docx-extract')
    return
  }
  const docXml = zip.readAsText('word/document.xml')
  // 提取所有 <w:t> 文本节点
  const texts = docXml.match(/<w:t[^>]*>([^<]+)<\/w:t>/g) || []
  console.log('docx 内的文本节点:')
  for (const t of texts) {
    console.log('  ', t.replace(/<[^>]+>/g, ''))
  }
  console.log('')
  if (texts.length === 1 && texts[0].includes('C30 配合比设计报告')) {
    console.log('✅ 假设验证：只有 1 个标题文本，没正文！')
  } else if (texts.length === 0) {
    console.log('❌ 假设错误：没文本')
  } else {
    console.log('文本数量:', texts.length)
  }
}

main().catch(e => {
  console.error('错误:', e)
  process.exit(1)
})