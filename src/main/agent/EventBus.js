/**
 * 事件总线
 * 用于模块间解耦通信，特别是学习服务监听工具执行事件
 */

const EventEmitter = require('events')

class EventBus extends EventEmitter {
  constructor() {
    super()
    this.setMaxListeners(20)
  }

  /**
   * 触发工具执行完成事件
   * @param {string} skillName - 技能名称
   * @param {object} args - 执行参数
   * @param {object} result - 执行结果
   */
  emitToolExecuted(skillName, args, result) {
    this.emit('tool:executed', {
      skillName,
      args,
      result,
      timestamp: Date.now()
    })
  }

  /**
   * 触发用户修正事件
   * @param {object} correction - 修正数据
   * @param {string} correction.toolName - 工具名称
   * @param {object} correction.context - 修正上下文
   * @param {object} correction.original - 原始建议
   * @param {object} correction.corrected - 用户修正后的值
   */
  emitUserCorrection(correction) {
    this.emit('user:correction', {
      ...correction,
      timestamp: Date.now()
    })
  }

  /**
   * 清空所有监听者（用于测试间隔离）
   * 解决 P3-3 风险 6：Jest 多文件并行时单例污染
   * 实现：Node.js EventEmitter.removeAllListeners() 官方 API
   */
  clear() {
    this.removeAllListeners()
  }
}

// 导出单例
module.exports = new EventBus()
