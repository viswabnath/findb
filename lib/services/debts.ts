import type { Pool } from 'pg';
import {
    DANGEROUS_RATE, EMI_RATIO_DANGER, EMI_RATIO_HIGH, MINIMUM_DUE_FLOOR, MINIMUM_DUE_PERCENT, TYPICAL_CARD_RATE, emiRatio, minimumOnly, rankDebts,
    type Debt, type DebtKind,
} from '../../src/core/debts';
import { formatRupees } from '../format';
import { t } from '../i18n';
import { flows, fromPaise } from '../ledger';
import { listChits } from './chits';
import { listLoans } from './loans';
import { listPeople } from './people';
import { todayInIndia } from './recurring';

/**
 * Which debt is most dangerous (v2 plan, Phase 3): every debt the user has (loans, card balances,
 * money borrowed from people, chits already won) ranked by its true yearly cost, the figures the
 * payoff simulator on the screen starts from, and the warnings. Information on the user's own
 * figures, not advice.
 */

export interface DebtLine {
    key: string;
    name: string;
    kind: DebtKind;
    balance: string;
    yearlyRate: number;
    monthly: string;
    assumedRate: boolean;
    dangerous: boolean;
    /** Where the debt is kept */
    href: string;
}

export interface DebtWarning {
    kind: 'minimum_only' | 'emi_ratio' | 'margin' | 'overdue' | 'missed' | 'informal_chit';
    level: 'warn' | 'danger';
    text: string;
    href: string;
}

export interface DebtReview {
    debts: DebtLine[];
    total: string;
    dangerousTotal: string;
    /** EMIs and chit payments after winning, a month */
    monthlyPayments: string;
    /** Average income a month over the last three full months; null with none recorded */
    monthlyIncome: string | null;
    emiRatio: number | null;
    warnings: DebtWarning[];
    limits: { emiHigh: number; emiDanger: number; dangerousRate: number; typicalCardRate: number; minimumPercent: number; minimumFloor: string };
}

const paise = (rupees: string) => Math.round(parseFloat(rupees) * 100);

const LOAN_KINDS: Record<string, DebtKind> = {
    home: 'home', vehicle: 'vehicle', personal: 'personal', education: 'education', business: 'business', consumer: 'consumer', gold: 'gold',
};

/** The first and last days of the three full months before today's */
function lastThreeMonths(today: string): { from: string; to: string } {
    const [year, month] = today.split('-').map(Number) as [number, number];
    const from = new Date(Date.UTC(year, month - 4, 1)).toISOString().slice(0, 10);
    const to = new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10);
    return { from, to };
}

export async function debtReview(pool: Pool, userId: number, today = todayInIndia()): Promise<DebtReview> {
    const [loans, chits, { people }] = await Promise.all([listLoans(pool, userId), listChits(pool, userId), listPeople(pool, userId)]);
    const debts: Debt[] = [];
    const hrefs = new Map<string, string>();
    const add = (debt: Debt, href: string) => {
        debts.push(debt);
        hrefs.set(debt.key, href);
    };

    for (const loan of loans.filter(item => !item.closed)) {
        add({
            key: `loan-${loan.id}`, name: loan.name, kind: LOAN_KINDS[loan.kind] ?? (loan.kind.startsWith('against_') ? 'secured' : 'other'),
            balance: paise(loan.outstanding), yearlyRate: loan.effectiveRate, monthly: paise(loan.emi),
        }, '/loans');
    }

    // Card balances owed (a card account is negative while money is owed on it)
    const cards = await pool.query(
        `SELECT a.id, a.name, COALESCE(SUM(l.amount_paise) FILTER (WHERE e.voided_at IS NULL), 0)::bigint AS paise
         FROM ledger_accounts a
         LEFT JOIN journal_lines l ON l.user_id = a.user_id AND l.account_id = a.id
         LEFT JOIN journal_entries e ON e.user_id = l.user_id AND e.id = l.entry_id
         WHERE a.user_id = $1 AND a.subtype = 'credit_card' AND a.archived_at IS NULL
         GROUP BY a.id, a.name ORDER BY a.name`,
        [userId]);
    const cardDebts: Debt[] = [];
    for (const card of cards.rows) {
        const owed = -Number(card.paise);
        if (owed <= 0) continue;
        const debt: Debt = { key: `card-${card.id}`, name: card.name, kind: 'credit_card', balance: owed, yearlyRate: TYPICAL_CARD_RATE, monthly: minimumOnly(owed, TYPICAL_CARD_RATE).firstMinimum, assumedRate: true };
        cardDebts.push(debt);
        add(debt, '/setup');
    }

    for (const person of people) {
        for (const loan of person.loans.filter(item => item.direction === 'borrowed' && !item.closed)) {
            const owed = paise(loan.outstanding) + paise(loan.interestDue);
            if (owed <= 0) continue;
            add({ key: `person-${loan.id}`, name: person.name, kind: 'person', balance: owed, yearlyRate: loan.interestRate ? parseFloat(loan.interestRate) : 0, monthly: 0 }, '/people');
        }
    }

    for (const chit of chits.filter(item => item.won && !item.finished && parseFloat(item.balance) < 0)) {
        add({
            key: `chit-${chit.id}`, name: chit.name, kind: 'chit', balance: -paise(chit.balance), yearlyRate: Math.max(chit.outcome.yearlyRate, 0), monthly: paise(chit.contribution),
        }, '/chits');
    }

    const ranked = rankDebts(debts);
    const monthlyPayments = ranked.filter(debt => debt.kind !== 'credit_card' && debt.kind !== 'person').reduce((sum, debt) => sum + debt.monthly, 0);
    const { from, to } = lastThreeMonths(today);
    const income = Math.round((await flows(pool, userId, from, to)).income / 3);
    const ratio = emiRatio(monthlyPayments, income);

    const warnings: DebtWarning[] = [];
    if (ratio !== null && ratio > EMI_RATIO_HIGH) {
        warnings.push({
            kind: 'emi_ratio', level: ratio > EMI_RATIO_DANGER ? 'danger' : 'warn', href: '/loans',
            text: t('debts.warnings.emiRatio', { ratio, payments: formatRupees(fromPaise(monthlyPayments)), income: formatRupees(fromPaise(income)), limit: EMI_RATIO_HIGH }),
        });
    }
    for (const loan of loans.filter(item => !item.closed && item.missed > 0)) {
        warnings.push({ kind: 'missed', level: 'danger', href: '/loans', text: t('debts.warnings.missed', { name: loan.name, count: loan.missed }) });
    }
    for (const card of cardDebts) {
        const plan = minimumOnly(card.balance, card.yearlyRate);
        warnings.push({
            kind: 'minimum_only', level: 'warn', href: '/setup',
            text: t('debts.warnings.minimumOnly', {
                name: card.name, balance: formatRupees(fromPaise(card.balance)), minimum: formatRupees(fromPaise(plan.firstMinimum)),
                years: Math.round(plan.months / 1.2) / 10, interest: formatRupees(fromPaise(plan.totalInterest)), rate: card.yearlyRate,
            }),
        });
    }
    for (const loan of loans.filter(item => !item.closed && item.pledge && !item.pledge.released && item.pledge.risk !== 'ok')) {
        const values = { name: loan.name, ltv: loan.pledge!.ltv, limit: parseFloat(loan.pledge!.ltvLimit) };
        warnings.push({
            kind: 'margin', level: loan.pledge!.risk === 'margin' ? 'danger' : 'warn', href: '/loans',
            text: loan.pledge!.risk === 'margin' ? t('debts.warnings.marginCall', values) : t('debts.warnings.marginNear', values),
        });
    }
    for (const person of people) {
        for (const loan of person.loans.filter(item => item.direction === 'lent' && item.status === 'overdue')) {
            warnings.push({
                kind: 'overdue', level: 'warn', href: '/people',
                text: t('debts.warnings.overdue', { name: person.name, amount: formatRupees(fromPaise(paise(loan.outstanding) + paise(loan.interestDue))), date: loan.dueOn ?? '' }),
            });
        }
    }
    for (const chit of chits.filter(item => !item.finished && item.organiserKind === 'informal')) {
        warnings.push({ kind: 'informal_chit', level: 'warn', href: '/chits', text: t('debts.warnings.informalChit', { name: chit.name }) });
    }

    const total = ranked.reduce((sum, debt) => sum + debt.balance, 0);
    const dangerousTotal = ranked.filter(debt => debt.yearlyRate >= DANGEROUS_RATE).reduce((sum, debt) => sum + debt.balance, 0);
    return {
        debts: ranked.map(debt => ({
            key: debt.key, name: debt.name, kind: debt.kind, balance: fromPaise(debt.balance), yearlyRate: debt.yearlyRate, monthly: fromPaise(debt.monthly),
            assumedRate: debt.assumedRate ?? false, dangerous: debt.yearlyRate >= DANGEROUS_RATE, href: hrefs.get(debt.key)!,
        })),
        total: fromPaise(total),
        dangerousTotal: fromPaise(dangerousTotal),
        monthlyPayments: fromPaise(monthlyPayments),
        monthlyIncome: income > 0 ? fromPaise(income) : null,
        emiRatio: ratio,
        warnings: warnings.sort((a, b) => (a.level === b.level ? 0 : a.level === 'danger' ? -1 : 1)),
        limits: {
            emiHigh: EMI_RATIO_HIGH, emiDanger: EMI_RATIO_DANGER, dangerousRate: DANGEROUS_RATE, typicalCardRate: TYPICAL_CARD_RATE,
            minimumPercent: MINIMUM_DUE_PERCENT, minimumFloor: fromPaise(MINIMUM_DUE_FLOOR),
        },
    };
}
