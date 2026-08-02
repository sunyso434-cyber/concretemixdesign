const { SecurityLog: SecurityLogModel } = require('../db/database')

// 安全/访问日志封装：登录、配对、连接、远程操作
// 与业务审计 AuditLog 分离；不采集 IP（frp 转发后恒为 127.0.0.1 无意义，记 deviceId + 时间）
class SecurityLog {
  /**
   * 记录一条安全/访问日志
   * @param {object} params
   * @param {string} params.event    事件类型，如 auth.login / remote.pair / remote.connect
   * @param {string} params.deviceId 设备标识
   * @param {string} [params.detail] 详情（可空）
   * @param {'desktop'|'remote'} [params.origin] 来源，默认 'remote'
   * @param {boolean} [params.ok]    是否成功，默认 true
   * @returns {Promise<import('sequelize').Model>} 落库后的记录
   */
  static async record({ event, deviceId, detail = null, origin = 'remote', ok = true }) {
    return SecurityLogModel.create({ event, deviceId, detail, origin, ok })
  }
}

module.exports = SecurityLog
