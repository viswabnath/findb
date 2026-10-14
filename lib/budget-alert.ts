import { apiGet } from './api-client';
import { formatRupees } from './format';
import { t } from './i18n';

/**
 * The budget warning after an expense is saved (v2 Phase 2, lib/services/budgets.ts): a sentence
 * when the category's budget for that month is at 80% or more, else null.
 */
interface Budget { category: { name: string }; amount: string; spent: string; percent: number; state: 'ok' | 'near' | 'over' }

export async function budgetWarning(categoryId: number | string | null | undefined, date: string): Promise<string | null> {
    if (categoryId === null || categoryId === undefined || categoryId === '') return null;
    const result = await apiGet<{ budget: Budget | null }>(`/api/budgets/status?${new URLSearchParams({ categoryId: String(categoryId), date })}`);
    const budget = result.ok ? result.data.budget : null;
    if (!budget || budget.state === 'ok') return null;
    const values = { name: budget.category.name, spent: formatRupees(budget.spent), limit: formatRupees(budget.amount), percent: budget.percent };
    return budget.state === 'over' ? t('budgets.alertOver', values) : t('budgets.alertNear', values);
}
