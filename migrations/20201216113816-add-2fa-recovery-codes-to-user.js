'use strict';

module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.addColumn('Users', 'twoFactorAuthRecoveryCodes', {
      type: Sequelize.ARRAY(Sequelize.STRING),
    });
  },

  down: (queryInterface, Sequelize) => {
    return queryInterface.removeColumn('Users', 'twoFactorAuthRecoveryCodes');
  },
};
