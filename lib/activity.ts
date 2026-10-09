/**
 * How the activity feed labels each activity log entry, and its page links. Same labels and
 * CSS classes as the legacy feed, plus the account entries added with the recovery fix.
 */

export type ActivityIcon =
    | 'banknote' | 'landmark' | 'credit-card' | 'trending-up' | 'trending-down'
    | 'plus' | 'pencil' | 'trash-2' | 'refresh-cw' | 'shield-alert' | 'key-round';

export interface ActivityLabel {
    icon: ActivityIcon;
    text: string;
    className: string;
}

type Entity = 'cash_balance' | 'bank' | 'credit_card' | 'income' | 'expense' | 'transfer' | 'account';

const CREATED: Record<Entity, ActivityLabel> = {
    cash_balance: { icon: 'banknote', text: 'Cash Balance Set', className: 'action-cash-add' },
    bank: { icon: 'landmark', text: 'Bank Added', className: 'action-bank-add' },
    credit_card: { icon: 'credit-card', text: 'Credit Card Added', className: 'action-card-add' },
    income: { icon: 'trending-up', text: 'Income Added', className: 'action-income' },
    expense: { icon: 'trending-down', text: 'Expense Added', className: 'action-expense' },
    transfer: { icon: 'refresh-cw', text: 'Transfer Added', className: 'action-update' },
    account: { icon: 'plus', text: 'Account Added', className: 'action-bank-add' },
};

const UPDATED: Record<Entity, ActivityLabel> = {
    cash_balance: { icon: 'banknote', text: 'Cash Balance Updated', className: 'action-cash-update' },
    bank: { icon: 'landmark', text: 'Bank Updated', className: 'action-bank-update' },
    credit_card: { icon: 'credit-card', text: 'Credit Card Updated', className: 'action-card-update' },
    income: { icon: 'trending-up', text: 'Income Updated', className: 'action-income-update' },
    expense: { icon: 'pencil', text: 'Expense Updated', className: 'action-expense-update' },
    transfer: { icon: 'refresh-cw', text: 'Transfer Updated', className: 'action-update' },
    account: { icon: 'pencil', text: 'Account Updated', className: 'action-bank-update' },
};

const DELETED: Record<Entity, ActivityLabel> = {
    cash_balance: { icon: 'banknote', text: 'Cash Balance Deleted', className: 'action-cash-delete' },
    bank: { icon: 'landmark', text: 'Bank Deleted', className: 'action-bank-delete' },
    credit_card: { icon: 'credit-card', text: 'Credit Card Deleted', className: 'action-card-delete' },
    income: { icon: 'trending-up', text: 'Income Deleted', className: 'action-income-delete' },
    expense: { icon: 'trash-2', text: 'Expense Deleted', className: 'action-expense-delete' },
    transfer: { icon: 'trash-2', text: 'Transfer Deleted', className: 'action-delete' },
    account: { icon: 'trash-2', text: 'Account Removed', className: 'action-bank-delete' },
};

const isEntity = (value: string): value is Entity => Object.prototype.hasOwnProperty.call(CREATED, value);

/** The label for an entry, from its action_type and activity_type (the log's entity_type) */
export function describeActivity(actionType: string, activityType: string): ActivityLabel {
    switch (actionType) {
    case 'create':
    case 'created':
        return isEntity(activityType) ? CREATED[activityType] : { icon: 'plus', text: 'Created', className: 'action-create' };
    case 'update':
    case 'updated':
        return isEntity(activityType) ? UPDATED[activityType] : { icon: 'pencil', text: 'Updated', className: 'action-update' };
    case 'delete':
    case 'deleted':
        return isEntity(activityType) ? DELETED[activityType] : { icon: 'trash-2', text: 'Deleted', className: 'action-delete' };
    case 'recovery_failed':
        return { icon: 'shield-alert', text: 'Recovery Attempt Failed', className: 'action-delete' };
    case 'password_reset':
        return { icon: 'key-round', text: 'Password Reset', className: 'action-update' };
    default:
        return { icon: 'refresh-cw', text: 'Modified', className: 'action-other' };
    }
}

/** Page links like the legacy feed: first, two either side of the current page, last; 'dots' for gaps */
export function pageLinks(current: number, total: number): (number | 'dots')[] {
    if (total <= 1) return [];
    const start = Math.max(1, current - 2);
    const end = Math.min(total, current + 2);
    const links: (number | 'dots')[] = [];
    if (start > 1) {
        links.push(1);
        if (start > 2) links.push('dots');
    }
    for (let page = start; page <= end; page++) links.push(page);
    if (end < total) {
        if (end < total - 1) links.push('dots');
        links.push(total);
    }
    return links;
}
