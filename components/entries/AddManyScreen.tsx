'use client';

import { useEffect, useState, type ClipboardEvent } from 'react';
import { Rows3, Trash2 } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { apiGet, apiPost, httpError, redirectIfUnauthorized } from '@/lib/api-client';
import { todayInIndiaClient } from '@/lib/dates';
import { t } from '@/lib/i18n';
import { parseAmount, parseCsv, parseDate, paiseText } from '@/src/core/statement';

/**
 * Add many entries at once (v2 Phase 2, faster entry): a grid of rows, each an income, expense or
 * transfer, saved together (/api/entries/bulk: all or none). Rows copied from a spreadsheet can be
 * pasted into any cell: dates, descriptions, amounts and category names are recognised.
 */

interface Account { id: number; type: string; name: string }
interface Category { id: number; kind: 'income' | 'expense'; name: string; fallback: boolean }
type EntryType = 'expense' | 'income' | 'transfer';
interface Row {
    key: number; date: string; type: EntryType; description: string; amount: string; accountId: string;
    /** A category for income and expenses, the destination account for a transfer */
    otherId: string; tags: string;
    /** The user picked the category, so a suggestion no longer replaces it */
    chosen: boolean;
}

const START_ROWS = 5;
const MAX_ROWS = 200;
let nextKey = 1;

const isBlank = (row: Row) => row.description.trim() === '' && row.amount.trim() === '';

export function AddManyScreen() {
    const toast = useToast();
    const [accounts, setAccounts] = useState<Account[] | null>(null);
    const [categories, setCategories] = useState<Category[]>([]);
    const [rows, setRows] = useState<Row[]>([]);
    const [saving, setSaving] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);

    const fallback = (kind: 'income' | 'expense', list = categories) => String(list.find(category => category.kind === kind && category.fallback)?.id ?? '');

    function blankRow(accountList: Account[], categoryList: Category[], date = todayInIndiaClient()): Row {
        // The first account: banks come first
        return {
            key: nextKey++, date, type: 'expense', description: '', amount: '', accountId: String(accountList[0]?.id ?? ''),
            otherId: fallback('expense', categoryList), tags: '', chosen: false,
        };
    }

    useEffect(() => {
        (async () => {
            const [accountList, categoryList] = await Promise.all([apiGet<Account[]>('/api/accounts'), apiGet<Category[]>('/api/categories')]);
            if (redirectIfUnauthorized(accountList) || !accountList.ok) return;
            const loaded = categoryList.ok ? categoryList.data : [];
            setCategories(loaded);
            setAccounts(accountList.data);
            setRows(Array.from({ length: START_ROWS }, () => blankRow(accountList.data, loaded)));
        })();
        // Once on page load
    }, []);

    if (accounts === null) return null;

    const update = (key: number, change: Partial<Row>) => setRows(current => current.map(row => (row.key === key ? { ...row, ...change } : row)));

    function changeType(row: Row, type: EntryType) {
        const other = type === 'transfer'
            ? String(accounts!.find(account => String(account.id) !== row.accountId)?.id ?? '')
            : fallback(type);
        update(row.key, { type, otherId: other, chosen: false });
    }

    async function suggest(row: Row) {
        if (row.type === 'transfer' || row.chosen || !row.description.trim()) return;
        const result = await apiGet<{ category: Category | null }>(`/api/categories/suggest?${new URLSearchParams({ kind: row.type, description: row.description })}`);
        if (!result.ok || !result.data.category) return;
        const id = String(result.data.category.id);
        setRows(current => current.map(item => (item.key === row.key && !item.chosen && item.type === row.type ? { ...item, otherId: id } : item)));
    }

    function addRows() {
        setRows(current => [...current, ...Array.from({ length: Math.min(START_ROWS, MAX_ROWS - current.length) }, () => blankRow(accounts!, categories, current[current.length - 1]?.date))]);
    }

    /**
     * Rows copied from a spreadsheet: each line becomes a row from this one down. In each line, a
     * date, an amount and a category's name are recognised; the first other text is the description.
     */
    function paste(event: ClipboardEvent<HTMLInputElement>, at: number) {
        const text = event.clipboardData.getData('text/plain');
        if (!/[\t\n]/.test(text.trim())) return;
        event.preventDefault();
        const lines = parseCsv(text).filter(cells => cells.some(cell => cell.trim() !== ''));
        const pasted = lines.map(cells => {
            let date = '';
            let amount = '';
            let category: Category | undefined;
            const words: string[] = [];
            for (const cell of cells) {
                const value = cell.trim();
                if (!value) continue;
                const asDate = !date ? parseDate(value, 'dmy') : null;
                const asAmount = !amount && !asDate ? parseAmount(value) : null;
                const asCategory = !category ? categories.find(item => item.name.toLowerCase() === value.toLowerCase()) : undefined;
                if (asDate) date = asDate;
                else if (asAmount && asAmount.paise !== 0) amount = paiseText(Math.abs(asAmount.paise));
                else if (asCategory) category = asCategory;
                else words.push(value);
            }
            return { date, amount, category, description: words[0] ?? '' };
        });
        setRows(current => {
            const next = [...current];
            pasted.slice(0, MAX_ROWS - at).forEach((item, index) => {
                const base = next[at + index] ?? blankRow(accounts!, categories, next[next.length - 1]?.date);
                const type: EntryType = item.category?.kind ?? 'expense';
                next[at + index] = {
                    ...base, type, date: item.date || base.date, description: item.description, amount: item.amount,
                    otherId: item.category ? String(item.category.id) : fallback(type), chosen: Boolean(item.category),
                };
            });
            return next;
        });
        toast('info', t('addMany.pasted', { count: Math.min(pasted.length, MAX_ROWS - at) }));
    }

    async function save() {
        setProblem(null);
        const filled = rows.map((row, index) => ({ row, number: index + 1 })).filter(({ row }) => !isBlank(row));
        if (filled.length === 0) return setProblem(t('addMany.nothing'));
        setSaving(true);
        const result = await apiPost<{ created: number }>('/api/entries/bulk', {
            entries: filled.map(({ row, number }) => ({
                row: number, type: row.type, date: row.date, description: row.description, amount: row.amount, accountId: Number(row.accountId),
                ...(row.type === 'transfer' ? { toAccountId: Number(row.otherId) } : { categoryId: row.otherId ? Number(row.otherId) : null }),
                tags: row.tags,
            })),
        });
        setSaving(false);
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return setProblem(httpError(result));
        toast('success', t('addMany.saved', { count: result.data.created }));
        setRows(Array.from({ length: START_ROWS }, () => blankRow(accounts!, categories)));
    }

    const filledCount = rows.filter(row => !isBlank(row)).length;

    return (
        <div id="add-many-section">
            <div className="page-header">
                <div>
                    <h2>{t('addMany.title')}</h2>
                    <p>{t('addMany.subtitle')}</p>
                </div>
            </div>
            <section className="card" aria-labelledby="add-many-title">
                <div className="card-head">
                    <h3 id="add-many-title"><span className="icon-tile t-bank" aria-hidden="true"><Rows3 /></span>{t('addMany.entries')}</h3>
                    <span className="meta" id="add-many-count">{t('addMany.count', { count: filledCount })}</span>
                </div>
                <p className="card-pad form-note add-many-help">{t('addMany.help')}</p>
                <div className="grid-head" aria-hidden="true">
                    <span>#</span><span>{t('addMany.date')}</span><span>{t('addMany.type')}</span><span>{t('addMany.description')}</span><span>{t('addMany.amount')}</span>
                    <span>{t('addMany.account')}</span><span>{t('addMany.categoryOrTo')}</span><span>{t('addMany.tags')}</span><span />
                </div>
                <ol id="add-many-rows" className="grid-rows">
                    {rows.map((row, index) => {
                        const number = index + 1;
                        const from = accounts.filter(account => row.type !== 'income' || account.type !== 'credit_card');
                        return (
                            <li key={row.key} className="grid-row" data-row={number}>
                                <span className="grid-number">{number}</span>
                                <input type="date" aria-label={t('addMany.rowDate', { row: number })} value={row.date}
                                    onChange={event => update(row.key, { date: event.target.value })} onPaste={event => paste(event, index)} />
                                <select aria-label={t('addMany.rowType', { row: number })} data-field="type" value={row.type} onChange={event => changeType(row, event.target.value as EntryType)}>
                                    <option value="expense">{t('addMany.types.expense')}</option>
                                    <option value="income">{t('addMany.types.income')}</option>
                                    <option value="transfer">{t('addMany.types.transfer')}</option>
                                </select>
                                <input type="text" aria-label={t('addMany.rowDescription', { row: number })} data-field="description" maxLength={200} placeholder={t('addMany.description')} value={row.description}
                                    onChange={event => update(row.key, { description: event.target.value })} onBlur={() => suggest(row)} onPaste={event => paste(event, index)} />
                                <input type="number" inputMode="decimal" min="0.01" step="0.01" aria-label={t('addMany.rowAmount', { row: number })} data-field="amount" placeholder="0.00" value={row.amount}
                                    onChange={event => update(row.key, { amount: event.target.value })} onPaste={event => paste(event, index)} />
                                <select aria-label={t('addMany.rowAccount', { row: number })} data-field="account" value={row.accountId} onChange={event => update(row.key, { accountId: event.target.value })}>
                                    {from.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
                                </select>
                                <select aria-label={row.type === 'transfer' ? t('addMany.rowTo', { row: number }) : t('addMany.rowCategory', { row: number })} data-field="other"
                                    value={row.otherId} onChange={event => update(row.key, { otherId: event.target.value, chosen: true })}>
                                    {row.type === 'transfer'
                                        ? accounts.filter(account => String(account.id) !== row.accountId).map(account => <option key={account.id} value={account.id}>{t('addMany.to', { name: account.name })}</option>)
                                        : categories.filter(category => category.kind === row.type).map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
                                </select>
                                <input type="text" aria-label={t('addMany.rowTags', { row: number })} data-field="tags" placeholder={t('addMany.tagsPlaceholder')} value={row.tags}
                                    onChange={event => update(row.key, { tags: event.target.value })} />
                                <button type="button" className="btn btn-secondary btn-sm grid-remove" data-action="removeRow" aria-label={t('addMany.remove', { row: number })}
                                    onClick={() => setRows(current => (current.length > 1 ? current.filter(item => item.key !== row.key) : current))}>
                                    <Trash2 aria-hidden="true" />
                                </button>
                            </li>
                        );
                    })}
                </ol>
                {problem ? <p className="notice warn add-many-problem" id="add-many-problem" role="alert">{problem}</p> : null}
                <div className="settings-actions">
                    <button type="button" className="btn btn-primary" data-action="saveMany" disabled={saving || filledCount === 0} onClick={save}>
                        {t('addMany.save', { count: filledCount })}
                    </button>
                    <button type="button" className="btn btn-secondary" data-action="addRows" disabled={rows.length >= MAX_ROWS} onClick={addRows}>{t('addMany.more')}</button>
                    <a className="btn btn-secondary" href="/transactions">{t('addMany.back')}</a>
                </div>
            </section>
        </div>
    );
}
