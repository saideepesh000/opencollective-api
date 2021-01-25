import { expect } from 'chai';
import gql from 'fake-tag';
import { describe, it } from 'mocha';
import sinon from 'sinon';

import roles from '../../../../server/constants/roles';
import { idEncode } from '../../../../server/graphql/v2/identifiers';
import emailLib from '../../../../server/lib/email';
import models from '../../../../server/models';
import * as utils from '../../../utils';

const gqlV2 = gql;

let host,
  collectiveAdmin,
  user1,
  hostAdmin,
  collective1,
  event1,
  expense1,
  comment1,
  sandbox,
  sendEmailSpy,
  comment,
  comments;

describe('server/graphql/v1/comments', () => {
  /* SETUP
     - collective1: host, collectiveAdmin as admin
       - event1: collectiveAdmin as admin
     - user1
  */

  before(() => {
    sandbox = sinon.createSandbox();
    sendEmailSpy = sandbox.spy(emailLib, 'sendMessage');
  });

  before(() => utils.resetTestDB());

  before(() =>
    models.User.createUserWithCollective({
      firstName: 'Sean',
      email: 'sean@webpack.opencollective.com',
    }).tap(u => (collectiveAdmin = u)),
  );
  before(() =>
    models.User.createUserWithCollective({
      firstName: 'Tobias',
      email: 'tobias@webpack.opencollective.com',
    }).tap(u => (user1 = u)),
  );
  before(() =>
    models.User.createUserWithCollective({
      firstName: 'host admin',
      email: 'hostadmin@opencollective.com',
    }).tap(u => (hostAdmin = u)),
  );
  before(() => models.Collective.create({ name: 'webpack', slug: 'webpack' }).tap(g => (collective1 = g)));
  before(() => models.Collective.create(utils.data('host1')).tap(g => (host = g)));
  before(() =>
    models.Expense.create({
      CollectiveId: collective1.id,
      lastEditedById: user1.id,
      UserId: user1.id,
      FromCollectiveId: user1.CollectiveId,
      description: 'Plane ticket',
      incurredAt: new Date(),
      amount: 100000,
      currency: 'USD',
    }).tap(e => (expense1 = e)),
  );
  before(async () => {
    await host.addUserWithRole(hostAdmin, roles.ADMIN);
    await collective1.addHost(host, collectiveAdmin);
    await collective1.addUserWithRole(collectiveAdmin, roles.ADMIN);
  });

  before('create an event collective', () =>
    models.Collective.create(
      Object.assign(utils.data('event1'), {
        CreatedByUserId: collectiveAdmin.id,
        ParentCollectiveId: collective1.id,
      }),
    ).tap(e => (event1 = e)),
  );
  before(() => event1.addUserWithRole(collectiveAdmin, roles.ADMIN));

  before(() => {
    comment = {
      html: '<p>This is the <strong>comment</strong></p>',
      ExpenseId: expense1.id,
    };
    comments = [
      { html: 'comment 1', createdAt: new Date('2018-01-01'), FromCollectiveId: collectiveAdmin.CollectiveId },
      { html: 'comment 2', createdAt: new Date('2018-01-02'), FromCollectiveId: collectiveAdmin.CollectiveId },
      { html: 'comment 3', createdAt: new Date('2018-01-03'), FromCollectiveId: collectiveAdmin.CollectiveId },
      { html: 'comment 4', createdAt: new Date('2018-01-04'), FromCollectiveId: collectiveAdmin.CollectiveId },
      { html: 'comment 5', createdAt: new Date('2018-01-05'), FromCollectiveId: collectiveAdmin.CollectiveId },
      { html: 'comment 6', createdAt: new Date('2018-01-06'), FromCollectiveId: collectiveAdmin.CollectiveId },
      { html: 'comment 7', createdAt: new Date('2018-01-07'), FromCollectiveId: collectiveAdmin.CollectiveId },
      { html: 'comment 8', createdAt: new Date('2018-01-08'), FromCollectiveId: collectiveAdmin.CollectiveId },
      { html: 'comment 9', createdAt: new Date('2018-01-09'), FromCollectiveId: collectiveAdmin.CollectiveId },
      { html: 'comment 10', createdAt: new Date('2018-01-10'), FromCollectiveId: collectiveAdmin.CollectiveId },
    ];
  });

  after(() => {
    sandbox.restore();
    return utils.resetTestDB();
  });

  afterEach(() => {
    sendEmailSpy.resetHistory();
    comment1 = null;
    return models.Comment.sync({ force: true });
  });

  async function createComment() {
    comment1 = await models.Comment.create({
      CollectiveId: collective1.id,
      FromCollectiveId: collectiveAdmin.CollectiveId,
      CreatedByUserId: collectiveAdmin.id,
      html: 'first comment & "love"',
      ExpenseId: expense1.id,
    });
    await utils.waitForCondition(() => sendEmailSpy.callCount >= 1);
  }

  function populateComments() {
    return models.Comment.createMany(comments, {
      CreatedByUserId: collectiveAdmin.id,
      CollectiveId: collective1.id,
      ExpenseId: expense1.id,
    });
  }

  describe('create a comment', () => {
    const createCommentMutation = gql`
      mutation CreateComment($comment: CommentInputType!) {
        createComment(comment: $comment) {
          id
          html
          expense {
            id
          }
        }
      }
    `;

    it('fails if not authenticated', async () => {
      const result = await utils.graphqlQuery(createCommentMutation, { comment });
      expect(result.errors).to.have.length(1);
      expect(result.errors[0].message).to.equal('You must be logged in to create a comment');
    });

    it('creates a comment', async () => {
      const result = await utils.graphqlQuery(createCommentMutation, { comment }, user1);
      utils.expectNoErrorsFromResult(result);
      const createdComment = result.data.createComment;
      expect(createdComment.html).to.equal('<p>This is the <strong>comment</strong></p>');
      await utils.waitForCondition(() => sendEmailSpy.callCount === 2);
      expect(sendEmailSpy.callCount).to.equal(2);
      expect(sendEmailSpy.firstCall.args[1]).to.contain(
        `webpack: New comment on expense ${expense1.description} by ${user1.firstName}`,
      );
      expect(sendEmailSpy.secondCall.args[1]).to.contain(
        `webpack: New comment on expense ${expense1.description} by ${user1.firstName}`,
      );
      const firstRecipient = sendEmailSpy.args[0][0] === hostAdmin.email ? hostAdmin : collectiveAdmin;
      const secondRecipient = sendEmailSpy.args[0][0] === hostAdmin.email ? collectiveAdmin : hostAdmin;
      expect(sendEmailSpy.args[0][0]).to.equal(firstRecipient.email);
      expect(sendEmailSpy.args[1][0]).to.equal(secondRecipient.email);
    });
  });

  describe('edit a comment', () => {
    const editCommentMutation = gql`
      mutation EditComment($comment: CommentAttributesInputType!) {
        editComment(comment: $comment) {
          id
          html
        }
      }
    `;

    beforeEach(() => createComment());

    it('fails if not authenticated', async () => {
      const result = await utils.graphqlQuery(editCommentMutation, {
        comment: { id: comment1.id },
      });
      expect(result.errors).to.exist;
      expect(result.errors[0].message).to.equal('You must be logged in to edit this comment');
    });

    it('fails if not authenticated as author or admin of collective', async () => {
      const result = await utils.graphqlQuery(editCommentMutation, { comment: { id: comment1.id } }, user1);
      expect(result.errors).to.exist;
      expect(result.errors[0].message).to.equal(
        'You must be the author or an admin of this collective to edit this comment',
      );
    });

    it('edits a comment successfully', async () => {
      const result = await utils.graphqlQuery(
        editCommentMutation,
        { comment: { id: comment1.id, html: 'new <em>comment</em> text' } },
        collectiveAdmin,
      );
      utils.expectNoErrorsFromResult(result);
      expect(result.data.editComment.html).to.equal('new <em>comment</em> text');
    });
  });

  describe('delete Comment', () => {
    const deleteCommentMutation = gql`
      mutation DeleteComment($id: Int!) {
        deleteComment(id: $id) {
          id
        }
      }
    `;

    beforeEach(() => createComment());

    it('fails to delete a comment if not logged in', async () => {
      const result = await utils.graphqlQuery(deleteCommentMutation, {
        id: comment1.id,
      });
      expect(result.errors).to.exist;
      expect(result.errors[0].message).to.equal('You must be logged in to delete this comment');
      return models.Comment.findByPk(comment1.id).then(commentFound => {
        expect(commentFound).to.not.be.null;
      });
    });

    it('fails to delete a comment if logged in as another user', async () => {
      const result = await utils.graphqlQuery(deleteCommentMutation, { id: comment1.id }, user1);
      expect(result.errors).to.exist;
      expect(result.errors[0].message).to.equal(
        'You need to be logged in as a core contributor or as a host to delete this comment',
      );
      return models.Comment.findByPk(comment1.id).then(commentFound => {
        expect(commentFound).to.not.be.null;
      });
    });

    it('deletes a comment', async () => {
      const res = await utils.graphqlQuery(deleteCommentMutation, { id: comment1.id }, collectiveAdmin);
      utils.expectNoErrorsFromResult(res);
      expect(res.errors).to.not.exist;
      return models.Comment.findByPk(comment1.id).then(commentFound => {
        expect(commentFound).to.be.null;
      });
    });
  });

  describe('query comments', () => {
    it('get all the comments', async () => {
      await populateComments();
      const allCommentsQuery = gql`
        query AllComments($ExpenseId: Int, $limit: Int, $offset: Int) {
          allComments(ExpenseId: $ExpenseId, limit: $limit, offset: $offset) {
            id
            html
          }
        }
      `;
      const result = await utils.graphqlQuery(allCommentsQuery, {
        ExpenseId: expense1.id,
        limit: 5,
        offset: 2,
      });
      utils.expectNoErrorsFromResult(result);
      const comments = result.data.allComments;
      expect(comments).to.have.length(5);
      expect(comments[0].html).to.equal('comment 3');
    });

    it('get an expense with associated comments as unauthenticated', async () => {
      await populateComments();
      const expenseQuery = gql`
        query Expense($id: Int!, $limit: Int) {
          Expense(id: $id) {
            description
            amount
            comments(limit: $limit) {
              total
              comments {
                id
                html
              }
            }
          }
        }
      `;
      const result = await utils.graphqlQuery(expenseQuery, {
        id: expense1.id,
        limit: 5,
      });
      utils.expectNoErrorsFromResult(result);
      const expense = result.data.Expense;
      expect(expense.comments).to.be.null;
    });

    it('get an expense with associated comments as collective admin', async () => {
      await populateComments();
      const expenseQuery = gql`
        query Expense($id: Int!, $limit: Int) {
          Expense(id: $id) {
            description
            amount
            comments(limit: $limit) {
              total
              comments {
                id
                html
              }
            }
          }
        }
      `;
      const result = await utils.graphqlQuery(
        expenseQuery,
        {
          id: expense1.id,
          limit: 5,
        },
        collectiveAdmin,
      );
      utils.expectNoErrorsFromResult(result);
      const expense = result.data.Expense;
      expect(expense.comments.total).to.equal(10);
      expect(expense.comments.comments).to.have.length(5);
    });

    it('get an expense with associated comments empty', async () => {
      const expenseQuery = gql`
        query Expense($id: Int!, $limit: Int) {
          Expense(id: $id) {
            description
            amount
            comments(limit: $limit) {
              total
              comments {
                id
                html
              }
            }
          }
        }
      `;
      const result = await utils.graphqlQuery(
        expenseQuery,
        {
          id: expense1.id,
          limit: 5,
        },
        collectiveAdmin,
      );
      utils.expectNoErrorsFromResult(result);
      const expense = result.data.Expense;
      expect(expense.comments.total).to.equal(0);
      expect(expense.comments.comments).to.have.length(0);
    });
  });

  // Api version 2 tests.
  before('V2 - query comments', () => {
    const expenseQuery = gqlV2/* GraphQL */ `
      query Expense($id: String!, $limit: Int, $offset: Int) {
        expense(id: $id) {
          id
          comments(limit: $limit, offset: $offset) {
            totalCount
            nodes {
              id
              html
              createdAt
              collective {
                id
                slug
                currency
                name
                ... on Collective {
                  balance
                  host {
                    id
                    slug
                  }
                }
              }
              fromCollective {
                id
                type
                name
                slug
                imageUrl
              }
            }
          }
        }
      }
    `;

    it('get an expense with associated comments empty (unauthenticated)', async () => {
      const result = await utils.graphqlQueryV2(expenseQuery, {
        id: `${expense1.id}`,
        limit: 5,
        offset: 0,
      });
      utils.expectNoErrorsFromResult(result);
      expect(result.data.expense.comments).to.be.null;
    });

    it('get an expense with associated comments empty', async () => {
      const result = await utils.graphqlQueryV2(
        expenseQuery,
        {
          id: `${expense1.id}`,
          limit: 5,
          offset: 0,
        },
        collectiveAdmin,
      );
      utils.expectNoErrorsFromResult(result);
      expect(result.data.expense.comments.totalCount).to.equal(0);
      expect(result.data.expense.comments.nodes).to.have.length(0);
    });

    it('get expense with associated comments', async () => {
      await populateComments();
      const result = await utils.graphqlQueryV2(expenseQuery, {
        id: `${expense1.id}`,
        limit: 5,
        offset: 0,
      });
      utils.expectNoErrorsFromResult(result);
      expect(result.data.expense.comments.totalCount).to.equal(10);
      expect(result.data.expense.comments.nodes).to.have.length(5);

      // Check all fields returned are not null.
      utils.traverse(result, (key, value) => {
        expect(value, key).to.not.be.null;
      });

      // Check comments are returned in the right order.
      comments
        .reverse()
        .slice(0, 5)
        .forEach((comment, index) => {
          expect(result.data.expense.comments.nodes[index].html).to.contain(comment.hmtl);
        });
    });
  });

  describe('V2 - edit a comment', () => {
    const editCommentMutation = gqlV2/* GraphQL */ `
      mutation EditComment($comment: CommentUpdateInput!) {
        editComment(comment: $comment) {
          id
          html
        }
      }
    `;

    beforeEach(() => createComment());

    it('fails to delete a comment if not logged in', async () => {
      const result = await utils.graphqlQueryV2(editCommentMutation, {
        comment: { id: idEncode(comment1.id) },
      });
      expect(result.errors).to.exist;
      expect(result.errors[0].message).to.equal('You must be logged in to edit this comment');
    });

    it('fails if not authenticated as author or admin of collective', async () => {
      const result = await utils.graphqlQueryV2(editCommentMutation, { comment: { id: idEncode(comment1.id) } }, user1);
      expect(result.errors).to.exist;
      expect(result.errors[0].message).to.equal(
        'You must be the author or an admin of this collective to edit this comment',
      );
    });
    it('edits a comment successfully', async () => {
      const html = '<p>new <em>comment</em> text</p>';
      const result = await utils.graphqlQueryV2(
        editCommentMutation,
        { comment: { id: idEncode(comment1.id), html } },
        collectiveAdmin,
      );
      utils.expectNoErrorsFromResult(result);

      // Check the returned edited comment has the correct value.
      expect(result.data.editComment.html).to.equal(html);

      // Check the database has the correct value.
      const comment = await models.Comment.findByPk(comment1.id);
      expect(comment.html).to.equal(html);
    });
  });

  describe('V2 - create a comment', () => {
    const createCommentMutation = gqlV2/* GraphQL */ `
      mutation CreateComment($comment: CommentCreateInput!) {
        createComment(comment: $comment) {
          id
          html
        }
      }
    `;

    it('fails if not authenticated', async () => {
      const result = await utils.graphqlQueryV2(createCommentMutation, {
        comment: { html: comment.html, expense: { legacyId: comment.ExpenseId } },
      });
      expect(result.errors).to.have.length(1);
      expect(result.errors[0].message).to.equal('You must be logged in to create a comment');
    });

    it('creates a comment', async () => {
      const result = await utils.graphqlQueryV2(
        createCommentMutation,
        { comment: { html: comment.html, expense: { legacyId: comment.ExpenseId } } },
        user1,
      );
      utils.expectNoErrorsFromResult(result);
      const createdComment = result.data.createComment;
      expect(createdComment.html).to.equal('<p>This is the <strong>comment</strong></p>');
      await utils.waitForCondition(() => sendEmailSpy.callCount === 2);
      expect(sendEmailSpy.callCount).to.equal(2);
      expect(sendEmailSpy.firstCall.args[1]).to.contain(
        `webpack: New comment on expense ${expense1.description} by ${user1.firstName}`,
      );
      expect(sendEmailSpy.secondCall.args[1]).to.contain(
        `webpack: New comment on expense ${expense1.description} by ${user1.firstName}`,
      );
      const firstRecipient = sendEmailSpy.args[0][0] === hostAdmin.email ? hostAdmin : collectiveAdmin;
      const secondRecipient = sendEmailSpy.args[0][0] === hostAdmin.email ? collectiveAdmin : hostAdmin;
      expect(sendEmailSpy.args[0][0]).to.equal(firstRecipient.email);
      expect(sendEmailSpy.args[1][0]).to.equal(secondRecipient.email);
    });
  });

  describe('V2 - delete Comment', () => {
    const deleteCommentMutation = gqlV2/* GraphQL */ `
      mutation DeleteComment($id: String!) {
        deleteComment(id: $id) {
          id
        }
      }
    `;

    beforeEach(() => createComment());

    it('fails to delete a comment if not logged in', async () => {
      const result = await utils.graphqlQueryV2(deleteCommentMutation, {
        id: idEncode(comment1.id),
      });
      expect(result.errors).to.exist;
      expect(result.errors[0].message).to.equal('You must be logged in to delete this comment');
      return models.Comment.findByPk(comment1.id).then(commentFound => {
        expect(commentFound).to.not.be.null;
      });
    });

    it('fails to delete a comment if logged in as another user', async () => {
      const result = await utils.graphqlQueryV2(deleteCommentMutation, { id: idEncode(comment1.id) }, user1);
      expect(result.errors).to.exist;
      expect(result.errors[0].message).to.equal(
        'You need to be logged in as a core contributor or as a host to delete this comment',
      );
      return models.Comment.findByPk(comment1.id).then(commentFound => {
        expect(commentFound).to.not.be.null;
      });
    });

    it('deletes a comment', async () => {
      const res = await utils.graphqlQueryV2(deleteCommentMutation, { id: idEncode(comment1.id) }, collectiveAdmin);
      utils.expectNoErrorsFromResult(res);
      expect(res.errors).to.not.exist;
      return models.Comment.findByPk(comment1.id).then(commentFound => {
        expect(commentFound).to.be.null;
      });
    });
  });
});
