'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('chat_history', 'workspacePath', {
      type: Sequelize.STRING(1000),
      allowNull: true
    })
    await queryInterface.addColumn('ChatSessions', 'workspacePath', {
      type: Sequelize.STRING(1000),
      allowNull: true
    })
    await queryInterface.addIndex('chat_history', ['workspacePath'], {
      name: 'idx_chat_history_workspace'
    })
    await queryInterface.addIndex('ChatSessions', ['workspacePath'], {
      name: 'idx_session_workspace'
    })

    // v2026-06-18 老板决策：清空所有历史会话数据，干净重来
    await queryInterface.bulkDelete('chat_history', null, {})
    await queryInterface.bulkDelete('ChatSessions', null, {})
    console.log('[migration 2026-06-17-add-workspace-path] 已清空所有历史会话数据（老板 2026-06-18 决策）')
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeIndex('chat_history', 'idx_chat_history_workspace')
    await queryInterface.removeIndex('ChatSessions', 'idx_session_workspace')
    await queryInterface.removeColumn('chat_history', 'workspacePath')
    await queryInterface.removeColumn('ChatSessions', 'workspacePath')
  }
}
