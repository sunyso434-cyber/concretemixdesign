// 共享 fixture 生成脚本（5 个 reader 测试共用）
// 由 jest globalSetup 调用，自动生成 pdf/docx/xlsx/md/txt/csv 样本
//
// Task 1.3 阶段：仅 papaparse 已安装。pdfkit / mammoth / xlsx / docx 等库
// 都没装，所以采用 LAZY require（在函数内部 try/catch），
// 缺失则跳过对应 fixture（其他 reader 任务后续补齐）。
const fs = require('fs')
const path = require('path')

const FIXTURE_DIR = __dirname

function generate() {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true })

  // ---------- 1. sample.txt + sample.csv（Task 1.3 负责） ----------
  if (!fs.existsSync(path.join(FIXTURE_DIR, 'sample.txt'))) {
    fs.writeFileSync(path.join(FIXTURE_DIR, 'sample.txt'), '混凝土水胶比 0.42')
  }
  if (!fs.existsSync(path.join(FIXTURE_DIR, 'sample.csv'))) {
    fs.writeFileSync(
      path.join(FIXTURE_DIR, 'sample.csv'),
      '材料,用量\n水泥,350\n砂,750\n'
    )
  }

  // ---------- 2. sample.md（Task 1.4 负责，此处提供以便测试时齐全） ----------
  if (!fs.existsSync(path.join(FIXTURE_DIR, 'sample.md'))) {
    fs.writeFileSync(
      path.join(FIXTURE_DIR, 'sample.md'),
      '# 混凝土规范\n\n水胶比不大于 0.45'
    )
  }

  // ---------- 3. sample.pdf（Task 1.5 负责，LAZY require） ----------
  const pdfPath = path.join(FIXTURE_DIR, 'sample.pdf')
  if (!fs.existsSync(pdfPath)) {
    try {
      const PDFDocument = require('pdfkit')
      const doc = new PDFDocument()
      doc.pipe(fs.createWriteStream(pdfPath))
      doc.text('混凝土配合比设计规范 JGJ 55-2011').fontSize(20)
      doc.addPage().text('水胶比是决定混凝土强度的主要因素').fontSize(14)
      doc.addPage().text('砂率影响混凝土的工作性和强度').fontSize(14)
      doc.end()
    } catch (err) {
      console.log('[generate] skip pdf fixture, library not installed yet:', err.message)
    }
  }

  // ---------- 4. sample.docx（Task 1.6 负责，LAZY require） ----------
  const docxPath = path.join(FIXTURE_DIR, 'sample.docx')
  if (!fs.existsSync(docxPath)) {
    try {
      const docxLib = require('docx')
      const { Document, Packer, Paragraph, TextRun } = docxLib
      const d = new Document({
        sections: [{
          children: [
            new Paragraph({ children: [new TextRun('混凝土配合比设计报告')] }),
            new Paragraph({ children: [new TextRun('本报告涵盖 C30 配合比计算')] })
          ]
        }]
      })
      Packer.toBuffer(d).then(buf => fs.writeFileSync(docxPath, buf))
    } catch (err) {
      console.log('[generate] skip docx fixture, library not installed yet:', err.message)
    }
  }

  // ---------- 5. sample.xlsx（Task 1.7 负责，LAZY require） ----------
  const xlsxPath = path.join(FIXTURE_DIR, 'sample.xlsx')
  if (!fs.existsSync(xlsxPath)) {
    try {
      const xlsx = require('xlsx')
      const wb = xlsx.utils.book_new()
      const ws1 = xlsx.utils.aoa_to_sheet([
        ['材料', '用量(kg/m³)'],
        ['水泥', '350'],
        ['砂', '750']
      ])
      xlsx.utils.book_append_sheet(wb, ws1, '材料用量')
      const ws2 = xlsx.utils.aoa_to_sheet([
        ['强度等级', '水胶比'],
        ['C30', '0.45'],
        ['C40', '0.38']
      ])
      xlsx.utils.book_append_sheet(wb, ws2, '配合比')
      xlsx.writeFile(wb, xlsxPath)
    } catch (err) {
      console.log('[generate] skip xlsx fixture, library not installed yet:', err.message)
    }
  }

  // ---------- 6. broken.pdf（Task 1.5 负责，提供以便后续测试） ----------
  const brokenPath = path.join(FIXTURE_DIR, 'broken.pdf')
  if (!fs.existsSync(brokenPath)) {
    fs.writeFileSync(brokenPath, 'this is not a real pdf')
  }
}

module.exports = { generate }

// 如果被直接 node 调用，跑一次
if (require.main === module) generate()