'use client';

import { useEffect, useState } from 'react';
import { Target, Trash2 } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { apiDelete, apiGet, apiPut, httpError, redirectIfUnauthorized } from '@/lib/api-client';
import { formatRupees } from '@/lib/format';
import { t } from '@/lib/i18n';

/**
 * Monthly budgets per spending category (/api/budgets, v2 Phase 2): what is spent against each
 * limit in the month on screen, near at 80% and over at 100%; set, change and remove them.
 */

interface Category { id: number; kind: 'income' | 'expense'; name: string; fallback: boolean }
interface Budget { id: number; category: { id: number; name: string }; amount: string; spent: string; left: string; percent: number; state: 'ok' | 'near' | 'over' }

export function BudgetsCard({ month, year }: { month: number; year: number }) {
    const toast = useToast();
    const [budgets, setBudgets] = useState<Budget[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [form, setForm] = useState({ categoryId: '', amount: '' });
    const [editing, setEditing] = useState<{ id: number; amount: string } | null>(null);

    async function load() {
        const result = await apiGet<Budget[]>(`/api/budgets?month=${month}&year=${year}`);
        if (redirectIfUnauthorized(result) || !result.ok) return;
        setBudgets(result.data);
    }

    useEffect(() => {
        load();
        apiGet<Category[]>('/api/categories').then(result => { if (result.ok) setCategories(result.data.filter(category => category.kind === 'expense')); });
        // Again when the month on screen changes
    }, [month, year]);

    async function save(categoryId: string | number, amount: string) {
        const result = await apiPut<Budget>('/api/budgets', { categoryId: Number(categoryId), amount });
        if (redirectIfUnauthorized(result)) return false;
        if (!result.ok) {
            toast('error', httpError(result));
            return false;
        }
        toast('success', t('budgets.saved', { name: result.data.category.name, amount: formatRupees(result.data.amount) }));
        await load();
        return true;
    }

    async function remove(budget: Budget) {
        const result = await apiDelete(`/api/budgets/${budget.id}`);
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        await load();
    }

    const free = categories.filter(category => !budgets.some(budget => budget.category.id === category.id));

    return (
        <section className="card" aria-labelledby="budgets-title" id="budgets-section">
            <div className="card-head">
                <h3 id="budgets-title"><span className="icon-tile t-income" aria-hidden="true"><Target /></span>{t('budgets.title')}</h3>
                <span className="meta">{t('budgets.alerts')}</span>
            </div>
            <ul className="settings-list budget-list" id="budget-list">
                {budgets.length === 0 ? <li>{t('budgets.none')}</li> : budgets.map(budget => (
                    <li key={budget.id} data-budget={budget.category.name} className={`budget-${budget.state}`}>
                        <div className="budget-line">
                            <span className="what">{budget.category.name}</span>
                            <span className="budget-figures">
                                {budget.state === 'over'
                                    ? t('budgets.over', { spent: formatRupees(budget.spent), limit: formatRupees(budget.amount), by: formatRupees(-parseFloat(budget.left)) })
                                    : t('budgets.used', { spent: formatRupees(budget.spent), limit: formatRupees(budget.amount), left: formatRupees(budget.left) })}
                            </span>
                        </div>
                        <div className="budget-bar" role="progressbar" aria-label={t('budgets.barLabel', { name: budget.category.name })}
                            aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(budget.percent, 100)} aria-valuetext={t('budgets.percent', { percent: budget.percent })}>
                            <span style={{ width: `${Math.min(budget.percent, 100)}%` }} />
                        </div>
                        {editing?.id === budget.id ? (
                            <form className="budget-edit" onSubmit={async event => { event.preventDefault(); if (await save(budget.category.id, editing.amount)) setEditing(null); }}>
                                <input type="number" inputMode="decimal" min="0.01" step="0.01" aria-label={t('budgets.limitFor', { name: budget.category.name })}
                                    value={editing.amount} onChange={event => setEditing({ id: budget.id, amount: event.target.value })} autoFocus />
                                <button type="submit" className="btn btn-primary btn-sm" data-action="saveBudget">{t('budgets.save')}</button>
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(null)}>{t('common.cancel')}</button>
                            </form>
                        ) : (
                            <span className="budget-actions">
                                <span className="when">{t('budgets.percent', { percent: budget.percent })}</span>
                                <button type="button" className="btn-link" data-action="editBudget" onClick={() => setEditing({ id: budget.id, amount: budget.amount })}>{t('budgets.change')}</button>
                                <button type="button" className="btn btn-secondary btn-sm" data-action="removeBudget" aria-label={t('budgets.remove', { name: budget.category.name })}
                                    onClick={() => remove(budget)}>
                                    <Trash2 aria-hidden="true" />
                                </button>
                            </span>
                        )}
                    </li>
                ))}
            </ul>
            {free.length > 0 ? (
                <form className="add-row foot" onSubmit={async event => {
                    event.preventDefault();
                    if (!form.categoryId || !form.amount) return toast('error', t('budgets.need'));
                    if (await save(form.categoryId, form.amount)) setForm({ categoryId: '', amount: '' });
                }}>
                    <div className="field">
                        <label htmlFor="budget-category">{t('budgets.category')}</label>
                        <select id="budget-category" value={form.categoryId} onChange={event => setForm(current => ({ ...current, categoryId: event.target.value }))}>
                            <option value="">{t('budgets.choose')}</option>
                            {free.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
                        </select>
                    </div>
                    <div className="field">
                        <label htmlFor="budget-amount">{t('budgets.limit')}</label>
                        <input id="budget-amount" type="number" inputMode="decimal" min="0.01" step="0.01" value={form.amount}
                            onChange={event => setForm(current => ({ ...current, amount: event.target.value }))} />
                    </div>
                    <button type="submit" className="btn btn-primary" data-action="addBudget">{t('budgets.add')}</button>
                </form>
            ) : null}
        </section>
    );
}
