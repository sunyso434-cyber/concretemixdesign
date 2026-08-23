// 数据库备份恢复方法集（从 SystemService.js 拆分，行为不变）
// 通过 SystemService.prototype 挂载；纯 sqlite 文件拷贝，无实例状态依赖。

  // 备份数据库（内部使用，自动生成路径）
  async function backupDatabase() {
    try {
      const backupDir = path.join(app.getPath('userData'), 'backups')
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true })
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const backupPath = path.join(backupDir, `backup-${timestamp}.sqlite`)
      const dbPath = path.join(app.getPath('userData'), 'concrete-mixdesign.db')

      if (fs.existsSync(dbPath)) {
        await fsp.copyFile(dbPath, backupPath)
        return backupPath
      } else {
        throw new Error('数据库文件不存在')
      }
    } catch (error) {
      console.error('备份数据库失败:', error)
      throw error
    }
  }

  // 备份数据库到指定路径（供后台任务调用）
  async function backupDatabaseToFile(filePath, onProgress) {
    onProgress(30)
    const dbPath = path.join(app.getPath('userData'), 'concrete-mixdesign.db')
    if (!fs.existsSync(dbPath)) throw new Error('数据库文件不存在')
    await fsp.copyFile(dbPath, filePath)
    onProgress(100)
    return filePath
  }

  // 恢复数据库（内部使用）
  async function restoreDatabase(backupPath) {
    try {
      const dbPath = path.join(app.getPath('userData'), 'concrete-mixdesign.db')

      if (fs.existsSync(backupPath)) {
        await fsp.copyFile(backupPath, dbPath)
        return true
      } else {
        throw new Error('备份文件不存在')
      }
    } catch (error) {
      console.error('恢复数据库失败:', error)
      throw error
    }
  }

  // 从指定路径恢复数据库（供后台任务调用）
  async function restoreDatabaseFromFile(backupPath, onProgress) {
    console.log('[SystemService] restoreDatabaseFromFile called, backupPath:', backupPath)
    onProgress(30)
    const dbPath = path.join(app.getPath('userData'), 'concrete-mixdesign.db')
    if (!fs.existsSync(backupPath)) {
      console.error('[SystemService] Backup file does not exist:', backupPath)
      throw new Error('备份文件不存在')
    }
    console.log('[SystemService] DB path:', dbPath)

    // 使用异步复制，避免阻塞主线程
    await fsp.copyFile(backupPath, dbPath)
    console.log('[SystemService] Database file copied from', backupPath, 'to', dbPath)
    onProgress(80)

    // 注意：不要调用 closeAllConnections()，因为 sequelize.close() 会导致
    // 后续查询报 "ConnectionManager was closed" 错误。
    // sequelize 会在下次查询时自动重连到新的数据库文件。
    onProgress(100)
    console.log('[SystemService] restoreDatabaseFromFile completed')
    return true
  }

module.exports = { backupDatabase, backupDatabaseToFile, restoreDatabase, restoreDatabaseFromFile }
