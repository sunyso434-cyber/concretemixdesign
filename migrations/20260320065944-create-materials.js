'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.createTable('materials', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false
      },
      type: {
        type: Sequelize.STRING,
        allowNull: false
      },
      specification: {
        type: Sequelize.STRING,
        allowNull: false
      },
      manufacturer: {
        type: Sequelize.STRING
      },
      supplier: {
        type: Sequelize.STRING
      },
      batchNumber: {
        type: Sequelize.STRING
      },
      productionDate: {
        type: Sequelize.DATE
      },
      density: {
        type: Sequelize.FLOAT
      },
      fineness: {
        type: Sequelize.FLOAT
      },
      waterContent: {
        type: Sequelize.FLOAT
      },
      absorption: {
        type: Sequelize.FLOAT
      },
      chemicalComposition: {
        type: Sequelize.JSON
      },
      status: {
        type: Sequelize.STRING,
        defaultValue: '正常'
      },
      remark: {
        type: Sequelize.TEXT
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
    await queryInterface.dropTable('materials');
  }
};
