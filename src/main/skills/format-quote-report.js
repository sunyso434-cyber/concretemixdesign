/**
 * 报价单导出 Skill（format_quote_report）
 * 把 reverse_sales_quote / forward_sales_quote 算出的 quote 转换为
 * workspace_writeFile 接受的 payload，写入工作区 reports/
 *
 * 6 大块表格结构（材料/生产制造费/管理费/利税合计/运输泵送费/总计）
 * 默认输出 md，用户明确要求时才输出 xlsx/docx
 * reverse 模式报价说明体现包装策略，forward 模式体现设备费/技术服务费
 */

const quoteReportPayload = require('../services/quoteReportPayload')
const writeHandler = require('../workspace/write-handler')
const { mergeStyle } = require('./report-styles')

function defaultFilename(quote, mode, type) {
  const grade = quote?.strengthGrade || 'unknown'
  const today = new Date().toISOString().slice(0, 10)
  const ext = type || 'md'
  return `${grade}_${mode === 'forward' ? '特殊' : '普通'}混凝土报价单_${today}.${ext}`
}

module.exports = {
  name: 'format_quote_report',
  description: '【报价单导出】把 reverse_sales_quote / forward_sales_quote 算出的 quote 对象，转换为 workspace 报告格式（6 大块表格 + 报价说明），写入工作区 reports/ 目录。文件类型支持 md / xlsx / docx，**默认输出 md**，只有用户明确要求 xlsx 或 docx 时才输出对应格式。**与 workspace_writeFile 的区别**：本工具专门处理 quote 对象，自动应用样例图片的 6 大块结构（材料/生产制造费/管理费/利税合计/运输泵送费/总计），reverse 模式报价说明体现包装策略，forward 模式体现设备费/技术服务费说明。',
  version: '1.1.0',
  category: 'core',

  parameters: {
    quote: { type: 'object', required: true, description: 'reverse_sales_quote / forward_sales_quote 返回的 data 字段' },
    mode: { type: 'string', required: false, description: 'reverse / forward，影响 sections 内容。缺省读 quote.mode' },
    type: { type: 'string', required: false, description: 'md / xlsx / docx，默认 md（用户明确要求时才用 xlsx 或 docx）' },
    filename: { type: 'string', required: false, description: '输出文件名，默认 "<强度>_<普通/特殊>混凝土报价单_<日期>.md"' },
    style: { type: 'object', required: false, description: '样式覆盖（report-styles.js mergeStyle 接受的格式，仅 docx 生效）' }
  },

  errors: {
    NO_WORKSPACE: { code: 'NO_WORKSPACE', message: '工作区未打开', hint: '请先在主界面选择并打开一个工作区', recovery: 'none' },
    INVALID_QUOTE: { code: 'INVALID_QUOTE', message: 'quote 对象无效', hint: '请先调用 reverse_sales_quote 或 forward_sales_quote 算出 quote', recovery: 'retry' },
    WRITE_FAILED: { code: 'WRITE_FAILED', message: '写入报告失败', hint: '检查工作区目录权限或磁盘空间', recovery: 'retry' }
  },

  async execute(args, context) {
    const { logger } = context
    const { quote, mode: argMode, type = 'md', filename, style } = args

    try {
      if (!quote || typeof quote !== 'object') {
        return { success: false, error: this.errors.INVALID_QUOTE }
      }
      const mode = argMode || quote.mode || 'reverse'

      const workspaceManager = global.workspaceManager
      if (!workspaceManager || !workspaceManager.current || !workspaceManager.current()) {
        return { success: false, error: this.errors.NO_WORKSPACE }
      }

      const payload = quoteReportPayload.quoteToReportPayload(quote, mode)
      const mergedStyle = mergeStyle(style)
      const finalFilename = filename || defaultFilename(quote, mode, type)

      const result = await writeHandler.writeFile({
        workspaceManager,
        wikiEngine: global.wikiEngine || null,
        type,
        filename: finalFilename,
        payload,
        style: mergedStyle
      })

      logger.info(`[format_quote_report] 报告已生成: ${result.path}`)
      return {
        success: true,
        type: 'quote_report',
        data: {
          filePath: result.path,
          size: result.size,
          savedAt: result.savedAt,
          filename: finalFilename,
          format: type,
          mode
        },
        suggestions: [`报告已生成在工作区 reports/${finalFilename}，是否需要查看？`]
      }
    } catch (error) {
      logger.error('[format_quote_report] 失败:', error)
      return { success: false, error: this.errors.WRITE_FAILED, details: { originalError: error.message } }
    }
  },

  services: ['logger']
}
