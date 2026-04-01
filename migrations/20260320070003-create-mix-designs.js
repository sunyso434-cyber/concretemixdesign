'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.createTable('mixDesigns', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false
      },
      projectName: {
        type: Sequelize.STRING
      },
      description: {
        type: Sequelize.TEXT
      },
      strength: {
        type: Sequelize.STRING,
        allowNull: false
      },
      slump: {
        type: Sequelize.FLOAT,
        allowNull: false
      },
      environment: {
        type: Sequelize.STRING,
        allowNull: false
      },
      waterRatio: {
        type: Sequelize.FLOAT
      },
      sandRatio: {
        type: Sequelize.FLOAT
      },
      density: {
        type: Sequelize.FLOAT
      },
      materials: {
        type: Sequelize.JSON
      },
      validationResult: {
        type: Sequelize.JSON
      },
      status: {
        type: Sequelize.STRING,
        defaultValue: '未验证'
      },
      tempSettings: {
        type: Sequelize.JSON
      },
      materialCosts: {
        type: Sequelize.JSON
      },
      totalCost: {
        type: Sequelize.FLOAT
      },
      materialDetails: {
        type: Sequelize.JSON
      },
      createdAt: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW
      },
      updatedAt: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW
      }
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.dropTable('mixDesigns');
  }
};
