'use strict';

import showdown from 'showdown';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const markdownConverter = new showdown.Converter();

    // Updates
    const [updates] = await queryInterface.sequelize.query(`
      SELECT *
      FROM "Updates"
      WHERE markdown IS NOT NULL
      AND (html IS NULL OR LENGTH(html) < 1)
    `);

    for (const update of updates) {
      await update.update({
        html: markdownConverter.makeHtml(update.markdown),
      });
    }

    // Comments
    const [comments] = await queryInterface.sequelize.query(`
      SELECT *
      FROM "Comments"
      WHERE markdown IS NOT NULL
      AND (html IS NULL OR LENGTH(html) < 1)
    `);

    for (const comment of comments) {
      await comment.update({
        html: markdownConverter.makeHtml(comment.markdown),
      });
    }
  },

  down: async () => {},
};
