/**
 * How the activity feed labels each activity log entry, and its page links. Same labels and
 * CSS classes as the legacy feed, plus the account entries added with the recovery fix.
 */

import { t } from './i18n';

export type ActivityIcon =
    | 'banknote' | 'landmark' | 'credit-card' | 'trending-up' | 'trending-down'
    | 'plus' | 'pencil' | 'trash-2' | 'refresh-cw' | 'shield-alert' | 'key-round';

export interface ActivityLabel {
    icon: ActivityIcon;
    text: string;
    className: string;
}

type Entity = 'cash_balance' | 'bank' | 'credit_card' | 'income' | 'expense' | 'transfer' | 'account' | 'category' | 'event' | 'repeating'
    | 'reimbursement' | 'reconciliation' | 'profile' | 'dependant' | 'modules' | 'sample_data';
type Action = 'created' | 'updated' | 'deleted';

/** Each entry's icon and CSS class; the words are in messages/en.ts (activity.labels) */
const LOOKS: Record<Action, Record<Entity, Omit<ActivityLabel, 'text'>>> = {
    created: {
        cash_balance: { icon: 'banknote', className: 'action-cash-add' },
        bank: { icon: 'landmark', className: 'action-bank-add' },
        credit_card: { icon: 'credit-card', className: 'action-card-add' },
        income: { icon: 'trending-up', className: 'action-income' },
        expense: { icon: 'trending-down', className: 'action-expense' },
        transfer: { icon: 'refresh-cw', className: 'action-update' },
        account: { icon: 'plus', className: 'action-bank-add' },
        category: { icon: 'plus', className: 'action-create' },
        event: { icon: 'plus', className: 'action-create' },
        repeating: { icon: 'refresh-cw', className: 'action-create' },
        reimbursement: { icon: 'refresh-cw', className: 'action-create' },
        reconciliation: { icon: 'landmark', className: 'action-bank-update' },
        profile: { icon: 'pencil', className: 'action-update' },
        dependant: { icon: 'plus', className: 'action-create' },
        modules: { icon: 'pencil', className: 'action-update' },
        sample_data: { icon: 'plus', className: 'action-create' },
    },
    updated: {
        cash_balance: { icon: 'banknote', className: 'action-cash-update' },
        bank: { icon: 'landmark', className: 'action-bank-update' },
        credit_card: { icon: 'credit-card', className: 'action-card-update' },
        income: { icon: 'trending-up', className: 'action-income-update' },
        expense: { icon: 'pencil', className: 'action-expense-update' },
        transfer: { icon: 'refresh-cw', className: 'action-update' },
        account: { icon: 'pencil', className: 'action-bank-update' },
        category: { icon: 'pencil', className: 'action-update' },
        event: { icon: 'pencil', className: 'action-update' },
        repeating: { icon: 'refresh-cw', className: 'action-update' },
        reimbursement: { icon: 'refresh-cw', className: 'action-update' },
        reconciliation: { icon: 'landmark', className: 'action-bank-update' },
        profile: { icon: 'pencil', className: 'action-update' },
        dependant: { icon: 'pencil', className: 'action-update' },
        modules: { icon: 'pencil', className: 'action-update' },
        sample_data: { icon: 'pencil', className: 'action-update' },
    },
    deleted: {
        cash_balance: { icon: 'banknote', className: 'action-cash-delete' },
        bank: { icon: 'landmark', className: 'action-bank-delete' },
        credit_card: { icon: 'credit-card', className: 'action-card-delete' },
        income: { icon: 'trending-up', className: 'action-income-delete' },
        expense: { icon: 'trash-2', className: 'action-expense-delete' },
        transfer: { icon: 'trash-2', className: 'action-delete' },
        account: { icon: 'trash-2', className: 'action-bank-delete' },
        category: { icon: 'trash-2', className: 'action-delete' },
        event: { icon: 'trash-2', className: 'action-delete' },
        repeating: { icon: 'trash-2', className: 'action-delete' },
        reimbursement: { icon: 'trash-2', className: 'action-delete' },
        reconciliation: { icon: 'trash-2', className: 'action-delete' },
        profile: { icon: 'trash-2', className: 'action-delete' },
        dependant: { icon: 'trash-2', className: 'action-delete' },
        modules: { icon: 'pencil', className: 'action-update' },
        sample_data: { icon: 'trash-2', className: 'action-delete' },
    },
};
const OTHER: Record<Action, Omit<ActivityLabel, 'text'>> = {
    created: { icon: 'plus', className: 'action-create' },
    updated: { icon: 'pencil', className: 'action-update' },
    deleted: { icon: 'trash-2', className: 'action-delete' },
};

const isEntity = (value: string): value is Entity => Object.prototype.hasOwnProperty.call(LOOKS.created, value);

function label(action: Action, activityType: string): ActivityLabel {
    const entity = isEntity(activityType) ? activityType : 'other';
    const look = entity === 'other' ? OTHER[action] : LOOKS[action][entity];
    return { ...look, text: t(`activity.labels.${action}.${entity}`) };
}

/** The label for an entry, from its action_type and activity_type (the log's entity_type) */
export function describeActivity(actionType: string, activityType: string): ActivityLabel {
    switch (actionType) {
    case 'create':
    case 'created':
        return label('created', activityType);
    case 'update':
    case 'updated':
        return label('updated', activityType);
    case 'delete':
    case 'deleted':
        return label('deleted', activityType);
    case 'recovery_failed':
        return { icon: 'shield-alert', text: t('activity.labels.recoveryFailed'), className: 'action-delete' };
    case 'password_reset':
        return { icon: 'key-round', text: t('activity.labels.passwordReset'), className: 'action-update' };
    default:
        return { icon: 'refresh-cw', text: t('activity.labels.modified'), className: 'action-other' };
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
