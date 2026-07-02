/**
 * 蓝图创作准备技能
 *
 * 用途：当用户明确要求创建"蓝图（blueprint）"格式的自定义配合比设计技能时，
 *      主 agent 先调用本技能获取《蓝图技能创作规范》全文，
 *      规范内容通过 tool_result 注入主对话上下文，
 *      主 agent 据此在同一轮对话中生成完整蓝图 YAML，
 *      最后调用 create_skill(format='blueprint', rawBlueprint='...') 落盘。
 *
 * 设计要点：
 * - 不调用任何 LLM，纯读文件
 * - md 文件按需加载，不常驻主 system prompt
 * - 返回值直接携带 md 全文，主 agent 视为对话上下文的一部分
 */

const fs = require('fs')
const path = require('path')

const GUIDE_PATH = path.join(__dirname, 'resources', 'blueprint-authoring-guide.md')

module.exports = {
  name: 'prepare_blueprint_authoring',
  description: '当且仅当用户明确要创建"蓝图（blueprint）"类型的自定义配合比设计技能时调用。返回蓝图技能创作规范全文（包含7种原子操作、字段白名单、硬约束、few-shot 示例）。调用后请在同一轮对话内基于对话上下文生成完整蓝图 YAML，然后调用 create_skill(format=\'blueprint\', rawBlueprint=...) 完成落盘。',
  version: '1.0.0',
  category: 'system',

  parameters: {},

  services: [],

  async execute(args, context) {
    const { logger } = context || {}

    let content
    try {
      content = fs.readFileSync(GUIDE_PATH, 'utf8')
    } catch (e) {
      if (logger && typeof logger.error === 'function') {
        logger.error(`[prepare_blueprint_authoring] 读取创作规范失败: ${e.message}`)
      }
      return {
        success: false,
        error: {
          code: 'SKILL_INTERNAL_ERROR',
          message: '蓝图技能创作规范文件不存在或不可读',
          hint: `请检查 ${GUIDE_PATH} 是否存在`,
          recovery: 'contact_developer'
        },
        details: { originalError: e.message }
      }
    }

    if (logger && typeof logger.info === 'function') {
      logger.info(`[prepare_blueprint_authoring] 已加载创作规范，长度 ${content.length} 字符`)
    }

    return {
      success: true,
      type: 'blueprint_authoring_guide',
      guide: content,
      message: [
        '已加载《蓝图技能创作规范》。请你（主 agent）现在：',
        '1. 结合当前对话已确认的规范、参数、材料等上下文；',
        '2. 严格按照规范生成完整蓝图（=== meta.yaml === / === blueprint.yaml === / === tables/<表名>.json ===）；',
        '3. 生成前逐条过一遍规范末尾的 checklist（尤其是"formula.var 不得出现在 expr 中"）；',
        '4. 调用 create_skill(format=\'blueprint\', rawBlueprint=<生成内容>) 落盘。',
        '',
        '若用户尚未确认关键参数（强度等级、扩展度、材料等），请先向用户澄清再生成。'
      ].join('\n'),
      nextAction: 'call_create_skill_with_raw_blueprint'
    }
  }
}
