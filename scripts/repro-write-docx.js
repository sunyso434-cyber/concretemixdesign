/**
 * repro-write-docx.js
 * 复现老板的 bug：workspace_writeFile 写入 word 报告有问题
 */
process.env.USER_DATA_PATH = process.env.APPDATA

const path = require('path')
const fs = require('fs')
const os = require('os')

const writers = require('../src/main/workspace/writers')
const writeHandler = require('../src/main/workspace/write-handler')
const { sequelize } = require('../src/main/db/database')

async function main() {
  // 1. 直接调 docx writer 测试
  console.log('=== 测试 1: 直接调 docx writer ===')
  try {
    const payload = {
      title: 'C30 混凝土配合比设计报告',
      sections: [
        { type: 'h1', content: '一、设计依据' },
        { type: 'p', content: '本设计依据 JGJ 55-2011《普通混凝土配合比设计规程》。' },
        { type: 'h1', content: '二、原材料' },
        { type: 'list', items: ['水泥：P.O 42.5 普通硅酸盐水泥', '砂：中砂，细度模数 2.6', '石：碎石，5-25mm 连续级配'] },
        { type: 'h1', content: '三、配合比' },
        { type: 'table', rows: [
          ['材料', '用量(kg/m³)', '比例'],
          ['水泥', '320', '1.00'],
          ['砂', '730', '2.28'],
          ['石', '1080', '3.38'],
          ['水', '175', '0.55']
        ]}
      ]
    }
    const buf = await writers.write('docx', payload)
    console.log('  ✅ docx Buffer 生成成功，大小:', buf.length, 'bytes')
    // 写到临时文件看
    const tmpFile = path.join(os.tmpdir(), 'test-report.docx')
    fs.writeFileSync(tmpFile, buf)
    console.log('  已写到:', tmpFile)
  } catch (err) {
    console.log('  ❌ docx writer 抛错:', err.message)
    console.log('  stack:', err.stack?.split('\n').slice(0, 5).join('\n'))
  }

  // 2. 测试 xlsx writer
  console.log('\n=== 测试 2: xlsx writer ===')
  try {
    const payload = {
      title: 'C30 配合比数据',
      sections: [
        { type: 'table', rows: [
          ['材料', '用量', '单位'],
          ['水泥', '320', 'kg']
        ]}
      ]
    }
    const buf = await writers.write('xlsx', payload)
    console.log('  ✅ xlsx Buffer 生成成功，大小:', buf.length, 'bytes')
  } catch (err) {
    console.log('  ❌ xlsx writer 抛错:', err.message)
  }

  // 3. 测试 markdown writer
  console.log('\n=== 测试 3: markdown writer ===')
  try {
    const payload = {
      title: '测试报告',
      sections: [
        { type: 'h1', content: '标题' },
        { type: 'p', content: '正文' }
      ]
    }
    const buf = await writers.write('markdown', payload)
    console.log('  ✅ md Buffer 生成成功:', buf.toString('utf-8').slice(0, 200))
  } catch (err) {
    console.log('  ❌ markdown writer 抛错:', err.message)
  }

  // 4. 通过 write-handler 跑完整链路（需要工作区）
  console.log('\n=== 测试 4: writeHandler.writeFile ===')
  try {
    // 构造一个 mock workspaceManager
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-workspace-test-'))
    const mockWM = {
      current: () => ({ path: tmpDir, status: 'ready' })
    }
    const payload = {
      title: '集成测试报告',
      sections: [
        { type: 'h1', content: '测试' },
        { type: 'p', content: '通过 writeHandler 写入' }
      ]
    }
    const result = await writeHandler.writeFile({
      workspaceManager: mockWM,
      type: 'docx',
      filename: 'test-report.docx',
      payload
    })
    console.log('  ✅ writeHandler 返回:', JSON.stringify(result, null, 2))
    console.log('  文件存在:', fs.existsSync(result.path))
    console.log('  文件大小:', fs.statSync(result.path).size, 'bytes')
    // 清理
    fs.rmSync(tmpDir, { recursive: true, force: true })
  } catch (err) {
    console.log('  ❌ writeHandler 抛错:', err.message)
    console.log('  stack:', err.stack?.split('\n').slice(0, 8).join('\n'))
  }

  await sequelize.close()
}

main().catch(e => {
  console.error('脚本异常:', e)
  process.exit(1)
})