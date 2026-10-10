import type { Pool } from 'pg';
import { addDays } from '../../src/core/schedule';
import { formatRupees } from '../format';
import { t } from '../i18n';
import { dueItems, todayInIndia } from './recurring';
import { listReimbursements } from './reimbursements';
import { hasSampleData } from './sample-data';

/**
 * The one clear next step shown at the top of the Accounts screen (v2 plan, Phase 1): the most
 * useful thing to do now, in this order:
 *   sample data loaded > nothing set up yet > repeating entries to confirm > spending with no
 *   category this month > money owed back for over a month > an account not checked against a
 *   statement for a month > the everyday step.
 */

export interface NextStep {
    kind: 'sample' | 'start' | 'confirm' | 'categorise' | 'reimbursement' | 'reconcile' | 'everyday';
    text: string;
    /** Where the step is done; absent when it is a button on the card (sample data) */
    href?: string;
    label: string;
}

export async function nextStep(pool: Pool, userId: number, today = todayInIndia()): Promise<NextStep> {
    if (await hasSampleData(pool, userId)) {
        return {
            kind: 'sample', label: t('nextStep.sample.label'), text: t('nextStep.sample.text'),
        };
    }

    const started = await pool.query(
        `SELECT EXISTS (SELECT 1 FROM journal_entries WHERE user_id = $1 AND voided_at IS NULL) AS entries,
                EXISTS (SELECT 1 FROM ledger_accounts WHERE user_id = $1 AND subtype IN ('bank', 'credit_card', 'wallet', 'meal_card') AND archived_at IS NULL) AS accounts`,
        [userId]);
    if (!started.rows[0].entries && !started.rows[0].accounts) {
        return {
            kind: 'start', href: '/setup#bank-name', label: t('nextStep.start.label'), text: t('nextStep.start.text'),
        };
    }

    const { pending } = await dueItems(pool, userId, today);
    if (pending.length > 0) {
        const first = pending[0]!;
        return {
            kind: 'confirm', href: '/transactions#repeating-section', label: t('nextStep.confirmLabel'),
            text: pending.length === 1
                ? t('nextStep.confirmOne', { name: first.description, amount: formatRupees(first.amount), date: first.date })
                : t('nextStep.confirmMany', { count: pending.length, name: first.description }),
        };
    }

    const monthStart = `${today.slice(0, 8)}01`;
    const uncategorised = await pool.query(
        `SELECT COUNT(DISTINCT e.id)::int AS count
         FROM journal_entries e
         JOIN journal_lines l ON l.user_id = e.user_id AND l.entry_id = e.id
         JOIN ledger_accounts a ON a.user_id = l.user_id AND a.id = l.account_id
         WHERE e.user_id = $1 AND e.voided_at IS NULL AND e.entry_type = 'expense' AND a.system_key = 'expense'
           AND e.entry_date BETWEEN $2 AND $3`,
        [userId, monthStart, today]);
    const count = uncategorised.rows[0].count as number;
    if (count > 0) {
        return {
            kind: 'categorise', href: '/transactions', label: t('nextStep.categoriseLabel'), text: t('nextStep.categorise', { count }),
        };
    }

    // Paid over a month ago and not all back yet (the list is open ones first, newest first)
    const monthAgo = addDays(today, -30);
    const owed = (await listReimbursements(pool, userId))
        .filter(item => (item.status === 'pending' || item.status === 'partly repaid') && item.paidOn !== null && item.paidOn < monthAgo)
        .at(-1);
    if (owed) {
        return {
            kind: 'reimbursement', href: '/transactions#reimbursements-section', label: t('nextStep.reimbursementLabel'),
            text: t('nextStep.reimbursement', {
                amount: formatRupees(owed.outstanding), name: owed.description, from: owed.fromWhom ? t('nextStep.reimbursementFrom', { name: owed.fromWhom }) : '',
            }),
        };
    }

    const unchecked = await pool.query(
        `SELECT a.name
         FROM ledger_accounts a
         WHERE a.user_id = $1 AND a.subtype IN ('bank', 'credit_card') AND a.archived_at IS NULL
           AND EXISTS (SELECT 1 FROM journal_lines l JOIN journal_entries e ON e.user_id = l.user_id AND e.id = l.entry_id
                       WHERE l.user_id = a.user_id AND l.account_id = a.id AND e.voided_at IS NULL AND e.entry_type <> 'opening_balance')
           AND NOT EXISTS (SELECT 1 FROM reconciliations r WHERE r.user_id = a.user_id AND r.account_id = a.id
                           AND r.status = 'done' AND r.completed_at > now() - interval '30 days')
           AND a.created_at < now() - interval '30 days'
         ORDER BY a.name LIMIT 1`,
        [userId]);
    if (unchecked.rows.length > 0) {
        const account = unchecked.rows[0];
        return {
            kind: 'reconcile', href: '/reconcile', label: t('nextStep.reconcileLabel'), text: t('nextStep.reconcile', { account: account.name }),
        };
    }

    return { kind: 'everyday', href: '/transactions', label: t('nextStep.everydayLabel'), text: t('nextStep.everyday') };
}
