import { activities, expenseStatus, roles } from '../../constants';
import FEATURE from '../../constants/feature';
import { canUseFeature } from '../../lib/user-permissions';
import { formatCurrency } from '../../lib/utils';
import models from '../../models';
import { ExpenseItem } from '../../models/ExpenseItem';
import { BadRequest, Forbidden, Unauthorized } from '../errors';

const isOwner = async (req, expense): Promise<boolean> => {
  if (!req.remoteUser) {
    return false;
  }

  if (!expense.fromCollective) {
    expense.fromCollective = await req.loaders.Collective.byId.load(expense.FromCollectiveId);
  }

  return req.remoteUser.isAdminOfCollective(expense.fromCollective) || req.remoteUser.id === expense.UserId;
};

const isCollectiveAccountant = async (req, expense): Promise<boolean> => {
  if (!req.remoteUser) {
    return false;
  } else if (req.remoteUser.hasRole(roles.ACCOUNTANT, expense.CollectiveId)) {
    return true;
  }

  const collective = await req.loaders.Collective.byId.load(expense.CollectiveId);
  if (!collective) {
    return false;
  } else if (req.remoteUser.hasRole(roles.ACCOUNTANT, collective.HostCollectiveId)) {
    return true;
  } else if (collective.ParentCollectiveId) {
    return req.remoteUser.hasRole(roles.ACCOUNTANT, collective.ParentCollectiveId);
  } else {
    return false;
  }
};

const isCollectiveAdmin = async (req, expense): Promise<boolean> => {
  if (!req.remoteUser) {
    return false;
  }

  if (!expense.collective) {
    expense.collective = await req.loaders.Collective.byId.load(expense.CollectiveId);
  }

  return req.remoteUser.isAdminOfCollective(expense.collective);
};

const isHostAdmin = async (req, expense): Promise<boolean> => {
  if (!req.remoteUser) {
    return false;
  }

  if (!expense.collective) {
    expense.collective = await req.loaders.Collective.byId.load(expense.CollectiveId);
  }

  if (!expense.collective) {
    return false;
  }

  return req.remoteUser.isAdmin(expense.collective.HostCollectiveId) && expense.collective.isActive;
};

/**
 * Returns true if the expense meets at least one condition.
 * Always returns false for unkauthenticated requests.
 */
const remoteUserMeetsOneCondition = async (req, expense, conditions): Promise<boolean> => {
  if (!req.remoteUser) {
    return false;
  }

  for (const condition of conditions) {
    if (await condition(req, expense)) {
      return true;
    }
  }

  return false;
};

/** Checks if the user can see expense's attachments (items URLs, attached files) */
export const canSeeExpenseAttachments = async (req, expense): Promise<boolean> => {
  return remoteUserMeetsOneCondition(req, expense, [isOwner, isCollectiveAdmin, isCollectiveAccountant, isHostAdmin]);
};

/** Checks if the user can see expense's payout method */
export const canSeeExpensePayoutMethod = async (req, expense): Promise<boolean> => {
  return remoteUserMeetsOneCondition(req, expense, [isOwner, isCollectiveAdmin, isCollectiveAccountant, isHostAdmin]);
};

/** Checks if the user can see expense's payout method */
export const canSeeExpenseInvoiceInfo = async (req, expense): Promise<boolean> => {
  return remoteUserMeetsOneCondition(req, expense, [isOwner, isCollectiveAdmin, isCollectiveAccountant, isHostAdmin]);
};

/** Checks if the user can see expense's payout method */
export const canSeeExpensePayeeLocation = async (req, expense): Promise<boolean> => {
  return remoteUserMeetsOneCondition(req, expense, [isOwner, isCollectiveAdmin, isCollectiveAccountant, isHostAdmin]);
};

/** Checks if the user can verify or resend a draft */
export const canVerifyDraftExpense = async (req, expense): Promise<boolean> => {
  return remoteUserMeetsOneCondition(req, expense, [isOwner, isCollectiveAdmin, isHostAdmin]);
};

/**
 * Returns the list of items for this expense.
 */
export const getExpenseItems = async (expenseId, req): Promise<ExpenseItem[]> => {
  return req.loaders.Expense.items.load(expenseId);
};

/**
 * Only admin of expense.collective or of expense.collective.host can approve/reject expenses
 * @deprecated: Please use more specific helpers like `canEdit`, `canDelete`, etc.
 */
export const canUpdateExpenseStatus = async (req, expense): Promise<boolean> => {
  const { remoteUser } = req;
  if (!remoteUser) {
    return false;
  } else if (!canUseFeature(req.remoteUser, FEATURE.USE_EXPENSES)) {
    return false;
  } else if (remoteUser.hasRole([roles.ADMIN], expense.CollectiveId)) {
    return true;
  } else {
    if (!expense.collective) {
      expense.collective = await req.loaders.Collective.byId.load(expense.CollectiveId);
    }

    return remoteUser.isAdmin(expense.collective.HostCollectiveId);
  }
};

/**
 * Only the author or an admin of the collective or collective.host can edit an expense when it hasn't been paid yet
 */
export const canEditExpense = async (req, expense): Promise<boolean> => {
  if (
    expense.status === expenseStatus.PAID ||
    expense.status === expenseStatus.PROCESSING ||
    expense.status === expenseStatus.DRAFT
  ) {
    return false;
  } else if (!canUseFeature(req.remoteUser, FEATURE.USE_EXPENSES)) {
    return false;
  } else {
    return remoteUserMeetsOneCondition(req, expense, [isOwner, isHostAdmin, isCollectiveAdmin]);
  }
};

/**
 * Only the author or an admin of the collective or collective.host can delete an expense,
 * and only when its status is REJECTED.
 */
export const canDeleteExpense = async (req, expense): Promise<boolean> => {
  if (expense.status !== expenseStatus.REJECTED) {
    return false;
  } else if (!canUseFeature(req.remoteUser, FEATURE.USE_EXPENSES)) {
    return false;
  } else {
    return remoteUserMeetsOneCondition(req, expense, [isOwner, isCollectiveAdmin, isHostAdmin]);
  }
};

/**
 * Returns true if expense can be paid by user
 */
export const canPayExpense = async (req, expense): Promise<boolean> => {
  if (![expenseStatus.APPROVED, expenseStatus.ERROR].includes(expense.status)) {
    return false;
  } else if (!canUseFeature(req.remoteUser, FEATURE.USE_EXPENSES)) {
    return false;
  } else {
    return isHostAdmin(req, expense);
  }
};

/**
 * Returns true if expense can be approved by user
 */
export const canApprove = async (req, expense): Promise<boolean> => {
  if (![expenseStatus.PENDING, expenseStatus.REJECTED].includes(expense.status)) {
    return false;
  } else if (!canUseFeature(req.remoteUser, FEATURE.USE_EXPENSES)) {
    return false;
  } else {
    return remoteUserMeetsOneCondition(req, expense, [isCollectiveAdmin, isHostAdmin]);
  }
};

/**
 * Returns true if expense can be rejected by user
 */
export const canReject = async (req, expense): Promise<boolean> => {
  if (![expenseStatus.PENDING, expenseStatus.UNVERIFIED].includes(expense.status)) {
    return false;
  } else if (!canUseFeature(req.remoteUser, FEATURE.USE_EXPENSES)) {
    return false;
  } else {
    return remoteUserMeetsOneCondition(req, expense, [isCollectiveAdmin, isHostAdmin]);
  }
};

/**
 * Returns true if expense can be unapproved by user
 */
export const canUnapprove = async (req, expense): Promise<boolean> => {
  if (expense.status !== expenseStatus.APPROVED) {
    return false;
  } else if (!canUseFeature(req.remoteUser, FEATURE.USE_EXPENSES)) {
    return false;
  } else {
    return remoteUserMeetsOneCondition(req, expense, [isCollectiveAdmin, isHostAdmin]);
  }
};

/**
 * Returns true if expense can be marked as unpaid by user
 */
export const canMarkAsUnpaid = async (req, expense): Promise<boolean> => {
  if (expense.status !== expenseStatus.PAID) {
    return false;
  } else if (!canUseFeature(req.remoteUser, FEATURE.USE_EXPENSES)) {
    return false;
  } else {
    return isHostAdmin(req, expense);
  }
};

/**
 * Returns true if user can comment and see others comments for this expense
 */
export const canComment = async (req, expense): Promise<boolean> => {
  if (!canUseFeature(req.remoteUser, FEATURE.USE_EXPENSES)) {
    return false;
  } else {
    return remoteUserMeetsOneCondition(req, expense, [isCollectiveAdmin, isHostAdmin, isOwner]);
  }
};

export const canViewRequiredLegalDocuments = async (req, expense): Promise<boolean> => {
  return remoteUserMeetsOneCondition(req, expense, [isHostAdmin, isCollectiveAccountant, isOwner]);
};

// ---- Expense actions ----

export const approveExpense = async (req, expense): Promise<typeof models.Expense> => {
  if (expense.status === expenseStatus.APPROVED) {
    return expense;
  } else if (!(await canApprove(req, expense))) {
    throw new Forbidden();
  }

  const updatedExpense = await expense.update({ status: expenseStatus.APPROVED, lastEditedById: req.remoteUser.id });
  await expense.createActivity(activities.COLLECTIVE_EXPENSE_APPROVED, req.remoteUser);
  return updatedExpense;
};

export const unapproveExpense = async (req, expense): Promise<typeof models.Expense> => {
  if (expense.status === expenseStatus.PENDING) {
    return expense;
  } else if (!(await canUnapprove(req, expense))) {
    throw new Forbidden();
  }

  const updatedExpense = await expense.update({ status: expenseStatus.PENDING, lastEditedById: req.remoteUser.id });
  await expense.createActivity(activities.COLLECTIVE_EXPENSE_UNAPPROVED, req.remoteUser);
  return updatedExpense;
};

export const rejectExpense = async (req, expense): Promise<typeof models.Expense> => {
  if (expense.status === expenseStatus.REJECTED) {
    return expense;
  } else if (!(await canReject(req, expense))) {
    throw new Forbidden();
  }

  const updatedExpense = await expense.update({ status: expenseStatus.REJECTED, lastEditedById: req.remoteUser.id });
  await expense.createActivity(activities.COLLECTIVE_EXPENSE_REJECTED, req.remoteUser);
  return updatedExpense;
};

export const scheduleExpenseForPayment = async (req, expense): Promise<typeof models.Expense> => {
  if (expense.status === expenseStatus.SCHEDULED_FOR_PAYMENT) {
    throw new BadRequest('Expense is already scheduled for payment');
  } else if (!(await canPayExpense(req, expense))) {
    throw new Forbidden("You're authenticated but you can't schedule this expense for payment");
  }

  const balance = await expense.collective.getBalance();
  if (expense.amount > balance) {
    throw new Unauthorized(
      `You don't have enough funds to pay this expense. Current balance: ${formatCurrency(
        balance,
        expense.collective.currency,
      )}, Expense amount: ${formatCurrency(expense.amount, expense.collective.currency)}`,
    );
  }

  const updatedExpense = await expense.update({
    status: expenseStatus.SCHEDULED_FOR_PAYMENT,
    lastEditedById: req.remoteUser.id,
  });
  await expense.createActivity(activities.COLLECTIVE_EXPENSE_SCHEDULED_FOR_PAYMENT, req.remoteUser);
  return updatedExpense;
};
