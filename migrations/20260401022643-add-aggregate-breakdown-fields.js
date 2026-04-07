'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('mixDesigns', 'fineAggregateBreakdown', {
      type: Sequelize.JSON,
      allowNull: true,
      comment: '细骨料详细分配'
    });
    
    await queryInterface.addColumn('mixDesigns', 'coarseAggregateBreakdown', {
      type: Sequelize.JSON,
      allowNull: true,
      comment: '粗骨料详细分配'
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeColumn('mixDesigns', 'fineAggregateBreakdown');
    await queryInterface.removeColumn('mixDesigns', 'coarseAggregateBreakdown');
  }
};
