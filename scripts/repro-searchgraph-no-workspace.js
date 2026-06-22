/**
 * repro-searchgraph-no-workspace.js
 * 复现老板报告的 "searchGraph 需要 workspacePath 参数" 问题
 *
 * 假设：LLM 调 workspace_searchGraph 时只传 { query, topK }，
 *       但 KGExtractor.searchGraph 需要第 3 个参数 workspacePath，
 *       invoke 函数没传，KGExtractor 抛 PATH_INVALID
 */

const path = require('path')

async function main() {
  console.log('=== 假设：workspace_searchGraph invoke 没传 workspacePath ===\n')

  const WorkspaceError = require('../src/main/workspace/WorkspaceError.js')

  // mock KGExtractor
  const mockKG = {
    searchGraph: async (query, topK, workspacePath) => {
      console.log('KGExtractor.searchGraph 收到:')
      console.log('  query:', query)
      console.log('  topK:', topK)
      console.log('  workspacePath:', workspacePath)
      console.log('')
      if (!workspacePath) {
        throw new WorkspaceError('PATH_INVALID', 'searchGraph 需要 workspacePath 参数（P5 阶段请传当前工作区路径）', false)
      }
      return { triples: [] }
    }
  }

  // mock workspaceManager
  const mockWM = {
    current: () => ({ path: 'D:/test-workspace' })
  }

  // 模拟 LLM 实际调用的 args（只传 query + topK，没 workspacePath）
  const argsFromLLM = {
    query: 'UHPC 超高性能混凝土',
    topK: 30
  }

  console.log('模拟 LLM 传入的 args:', JSON.stringify(argsFromLLM))
  console.log('')

  // 模拟当前 workspaceTools.js 的 invoke（老板报告的版本）：
  // return await kg.searchGraph(args.query, args.topK || 10)
  console.log('--- 模拟当前 invoke（漏传 workspacePath）---')
  try {
    const result = await mockKG.searchGraph(argsFromLLM.query, argsFromLLM.topK || 10)
    console.log('成功:', result)
  } catch (err) {
    console.log('❌ 抛错:', err.code, '-', err.message)
    console.log('')
    console.log('✅ 假设验证：当前 invoke 没传 workspacePath → KGExtractor 抛 PATH_INVALID')
  }

  console.log('')
  console.log('--- 模拟修复后 invoke（从 global 拿 workspacePath）---')
  // 修复：execute 内部从 global.workspaceManager 拿 workspacePath
  try {
    const wp = mockWM.current().path
    const result = await mockKG.searchGraph(argsFromLLM.query, argsFromLLM.topK || 10, wp)
    console.log('✅ 修复成功，workspacePath 自动获取:', wp)
  } catch (err) {
    console.log('❌ 仍失败:', err.message)
  }
}

main().catch(e => {
  console.error('脚本错误:', e)
  process.exit(1)
})