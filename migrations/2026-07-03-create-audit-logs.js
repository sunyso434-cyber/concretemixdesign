'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.createTable('auditLogs', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      timestamp: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      actor: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'ai'
      },
      action: {
        type: Sequelize.STRING,
        allowNull: false
      },
      targetType: {
        type: Sequelize.STRING,
        allowNull: false
      },
      targetId: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      targetName: {
        type: Sequelize.STRING,
        allowNull: true
      },
      before: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      after: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      userIntent: {
        type: Sequelize.TEXT,
        allowNull: true
      }
    })
    await queryInterface.addIndex('auditLogs', ['targetType', 'targetId'])
    await queryInterface.addIndex('auditLogs', ['timestamp'])
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.dropTable('auditLogs')
  }
}
