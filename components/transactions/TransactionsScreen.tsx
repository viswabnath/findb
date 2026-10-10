'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeftRight, ArrowRight, Pencil, Plus, Search, Trash2, TrendingDown, TrendingUp } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { useFormMessage } from '@/components/useFormMessage';
import { apiDelete, apiGet, apiPost, apiPut, httpError, redirectIfUnauthorized } from '@/lib/api-client';
import { filterYears, MONTH_NAMES, todayUtcIso } from '@/lib/dates';
import { formatRupees } from '@/lib/format';
import { t } from '@/lib/i18n';
import { ReimbursementsCard } from './ReimbursementsCard';
import { RepeatingCard } from './RepeatingCard';

/**
 * Income, expenses and transfers, recorded in the ledger (/api/entries) on any money account
 * (/api/accounts): banks, cash, credit cards, wallets and meal cards. A transfer moves money
 * between the user's own accounts (an ATM withdrawal, a card bill payment) and is neither income
 * nor spending. The ids and data-action hooks are the former screen's (the end-to-end tests use them).
 */

type AccountType = 'bank' | 'cash' | 'credit_card' | 'wallet' | 'meal_card';
interface Account { id: number; type: AccountType; name: string }
interface Category { id: number; kind: 'income' | 'expense'; name: string; fallback: boolean }
interface EventChoice { id: number; name: string }
/** The event select's value that opens "New event" */
const NEW_EVENT = 'new';
type EntryType = 'income' | 'expense' | 'transfer';
interface Entry {
    id: number; type: EntryType; date: string; description: string; amount: string;
    account: { id: number; name: string; type: AccountType };
    toAccount: { id: number; name: string; type: AccountType } | null;
    category: { id: number; name: string } | null;
    tags: string[];
    event: { id: number; name: string } | null;
    /** Part of a reimbursement: changed under Owed back to you, not here */
    reimbursement?: boolean;
}
interface Draft {
    id: number; type: EntryType; description: string; amount: string; accountId: string; toAccountId: string; date: string;
    categoryId: string; tags: string; eventId: string;
    /** Set when the API says the entry is in a reconciled statement: shows a confirmation */
    reconciledWarning?: string; confirmReconciled?: boolean;
}

function EventOptions({ events }: { events: EventChoice[] }) {
    return (
        <>
            <option value="">{t('transactions.noEvent')}</option>
            {events.map(event => <option key={event.id} value={event.id}>{event.name}</option>)}
            <option value={NEW_EVENT}>{t('transactions.newEventOption')}</option>
        </>
    );
}

/** Tags typed as "trip, work" */
const tagList = (text: string) => text.split(',').map(tag => tag.trim()).filter(Boolean);

function CategoryOptions({ categories, kind }: { categories: Category[]; kind: 'income' | 'expense' }) {
    return <>{categories.filter(category => category.kind === kind).map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</>;
}

function EntryMeta({ entry }: { entry: Entry }) {
    if (!entry.category && entry.tags.length === 0 && !entry.event) return null;
    return (
        <span className="entry-meta">
            {entry.category ? <span className="entry-category">{entry.category.name}</span> : null}
            {entry.event ? <span className="tag event-tag">{entry.event.name}</span> : null}
            {entry.tags.map(tag => <span key={tag} className="tag">{tag}</span>)}
        </span>
    );
}

const GROUPS: AccountType[] = ['bank', 'cash', 'credit_card', 'wallet', 'meal_card'];

/** The accounts an entry of this type can use: income cannot go onto a credit card */
const usable = (accounts: Account[], type: EntryType) => accounts.filter(account => type !== 'income' || account.type !== 'credit_card');

function AccountOptions({ accounts }: { accounts: Account[] }) {
    return (
        <>
            {GROUPS.map(group => {
                const inGroup = accounts.filter(account => account.type === group);
                if (inGroup.length === 0) return null;
                return (
                    <optgroup key={group} label={t(`transactions.accountGroups.${group}`)}>
                        {inGroup.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
                    </optgroup>
                );
            })}
        </>
    );
}


/** Toast when an edited entry's new date falls outside the month on screen */
function movedMessage(date: string, month: number, year: number): string | null {
    const [y, m] = date.split('-').map(Number);
    if (m === month && y === year) return null;
    const name = new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return t('transactions.moved', { period: name });
}

/** An entry's date (YYYY-MM-DD) as "3 Oct 2026" */
const shortDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const sum = (rows: { amount: string }[]) => rows.reduce((total, row) => total + (parseFloat(row.amount) || 0), 0);

export function TransactionsScreen() {
    const toast = useToast();
    const now = new Date();
    const [loaded, setLoaded] = useState(false);
    const [trackingOption, setTrackingOption] = useState('both');
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [events, setEvents] = useState<EventChoice[]>([]);
    // "New event" from a form: which form asked, and the name being typed
    const [newEvent, setNewEvent] = useState<{ form: 'income' | 'expense' | 'transfer' | 'edit'; name: string; oneOff: boolean } | null>(null);
    const [entries, setEntries] = useState<Entry[]>([]);
    // Entries ticked for "Put in a category", and the category to put them in
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [bulkCategory, setBulkCategory] = useState('');

    // The month on screen, and the filter controls (applied with "Show")
    const [period, setPeriod] = useState({ month: now.getMonth() + 1, year: now.getFullYear() });
    const [filterMonth, setFilterMonth] = useState(period.month);
    const [filterYear, setFilterYear] = useState(period.year);

    // categoryChosen: the user picked the category, so a suggestion no longer replaces it
    const [incomeForm, setIncomeForm] = useState({ source: '', amount: '', accountId: '', date: todayUtcIso(), categoryId: '', categoryChosen: false, tags: '', eventId: '' });
    const [expenseForm, setExpenseForm] = useState({ title: '', amount: '', accountId: '', date: todayUtcIso(), categoryId: '', categoryChosen: false, tags: '', eventId: '' });
    const [transferForm, setTransferForm] = useState({ note: '', amount: '', fromId: '', toId: '', date: todayUtcIso(), eventId: '' });
    const formMessage = useFormMessage(5000);
    // Phones show one form at a time (tabs); wider screens show all three
    const [activeForm, setActiveForm] = useState<EntryType>('expense');

    const [edit, setEdit] = useState<Draft | null>(null);
    const [pendingDelete, setPendingDelete] = useState<Entry | null>(null);
    const [deleteWarning, setDeleteWarning] = useState<{ text: string; confirmed: boolean } | null>(null);
    // A switched-off module a new entry's title suggests (lib/modules.ts), offered once
    const [suggestion, setSuggestion] = useState<{ key: string; name: string; line: string } | null>(null);

    const loadEntries = useCallback(async (month: number, year: number) => {
        const result = await apiGet<Entry[]>(`/api/entries?${new URLSearchParams({ month: String(month), year: String(year) })}`);
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) {
            toast('error', t('transactions.loadFailed'));
            return;
        }
        setEntries(result.data);
        setSelected(new Set());
    }, [toast]);

    const loadCategories = useCallback(async () => {
        const result = await apiGet<Category[]>('/api/categories');
        if (redirectIfUnauthorized(result) || !result.ok) return;
        setCategories(result.data);
        const fallback = (kind: 'income' | 'expense') => String(result.data.find(category => category.kind === kind && category.fallback)?.id ?? '');
        setIncomeForm(form => ({ ...form, categoryId: form.categoryId || fallback('income') }));
        setExpenseForm(form => ({ ...form, categoryId: form.categoryId || fallback('expense') }));
    }, []);

    const loadEvents = useCallback(async () => {
        const result = await apiGet<EventChoice[]>('/api/events');
        if (redirectIfUnauthorized(result) || !result.ok) return;
        setEvents(result.data.map(event => ({ id: event.id, name: event.name })));
    }, []);

    /** Pick an event in a form, or open "New event" for it */
    function chooseEvent(form: 'income' | 'expense' | 'transfer' | 'edit', value: string) {
        if (value === NEW_EVENT) {
            setNewEvent({ form, name: '', oneOff: true });
            return;
        }
        if (form === 'income') setIncomeForm(current => ({ ...current, eventId: value }));
        if (form === 'expense') setExpenseForm(current => ({ ...current, eventId: value }));
        if (form === 'transfer') setTransferForm(current => ({ ...current, eventId: value }));
        if (form === 'edit') setEdit(draft => draft && { ...draft, eventId: value });
    }

    async function createEvent() {
        if (!newEvent) return;
        if (!newEvent.name.trim()) return toast('error', t('transactions.newEvent.needName'));
        const result = await apiPost<{ id: number; name: string }>('/api/events', { name: newEvent.name, oneOff: newEvent.oneOff });
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        await loadEvents();
        chooseEvent(newEvent.form, String(result.data.id));
        setNewEvent(null);
    }

    const eventValue = (value: string) => (value ? Number(value) : null);

    /** Fill in the category a title suggests, unless the user already chose one */
    async function suggest(kind: 'income' | 'expense', description: string) {
        if (!description.trim()) return;
        const result = await apiGet<{ category: Category | null }>(`/api/categories/suggest?${new URLSearchParams({ kind, description })}`);
        const id = result.ok && result.data.category ? String(result.data.category.id) : null;
        if (!id) return;
        if (kind === 'income') setIncomeForm(form => (form.categoryChosen ? form : { ...form, categoryId: id }));
        else setExpenseForm(form => (form.categoryChosen ? form : { ...form, categoryId: id }));
    }

    const fallbackCategory = (kind: 'income' | 'expense') => String(categories.find(category => category.kind === kind && category.fallback)?.id ?? '');

    const loadAccounts = useCallback(async () => {
        const result = await apiGet<Account[]>('/api/accounts');
        if (redirectIfUnauthorized(result) || !result.ok) return;
        setAccounts(result.data);
        // Cash first in the entry forms, as before
        const cash = String(result.data.find(account => account.type === 'cash')?.id ?? result.data[0]?.id ?? '');
        setIncomeForm(form => ({ ...form, accountId: form.accountId || cash }));
        setExpenseForm(form => ({ ...form, accountId: form.accountId || cash }));
        setTransferForm(form => ({ ...form, fromId: form.fromId || String(result.data[0]?.id ?? ''), toId: form.toId || cash }));
    }, []);

    useEffect(() => {
        (async () => {
            const user = await apiGet<{ tracking_option?: string }>('/api/user');
            if (redirectIfUnauthorized(user)) return;
            setTrackingOption(user.data.tracking_option || 'both');
            await Promise.all([loadAccounts(), loadCategories(), loadEvents(), loadEntries(period.month, period.year)]);
            setLoaded(true);
        })();
        // Runs once on page load; later reloads go through loadEntries directly
    }, []);

    async function filterTransactions() {
        setPeriod({ month: filterMonth, year: filterYear });
        toast('info', t('transactions.loading', { period: `${MONTH_NAMES[filterMonth - 1]} ${filterYear}` }));
        await loadEntries(filterMonth, filterYear);
    }

    /** Save a new entry; returns true when it was saved */
    async function add(body: Record<string, unknown>, success: string): Promise<boolean> {
        const result = await apiPost('/api/entries', body);
        if (redirectIfUnauthorized(result)) return false;
        if (!result.ok) {
            formMessage.show('error', httpError(result));
            return false;
        }
        formMessage.show('success', success);
        await loadEntries(period.month, period.year);
        if (typeof body.description === 'string') offerModule(body.description);
        return true;
    }

    async function offerModule(title: string) {
        const result = await apiGet<{ suggestion: { key: string; name: string; line: string } | null }>(`/api/modules/suggestion?title=${encodeURIComponent(title)}`);
        if (result.ok && result.data.suggestion) setSuggestion(result.data.suggestion);
    }

    async function answerSuggestion(accept: boolean) {
        if (!suggestion) return;
        const result = await apiPost('/api/modules/suggestion', { module: suggestion.key, accept });
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        if (accept) toast('success', t('transactions.module.turnedOn', { name: suggestion.name }));
        setSuggestion(null);
    }

    async function addIncome() {
        const { source, amount, accountId, date, categoryId, tags, eventId } = incomeForm;
        if (!source || !amount || !date || !accountId) return formMessage.show('error', t('transactions.fillAll'));
        const body = {
            type: 'income', description: source, amount, accountId: Number(accountId), date,
            categoryId: categoryId ? Number(categoryId) : undefined, tags: tagList(tags), eventId: eventValue(eventId),
        };
        if (await add(body, t('transactions.income.added'))) {
            setIncomeForm(form => ({ ...form, source: '', amount: '', tags: '', categoryChosen: false, categoryId: fallbackCategory('income') }));
        }
    }

    async function addExpense() {
        const { title, amount, accountId, date, categoryId, tags, eventId } = expenseForm;
        if (!title || !amount || !date || !accountId) return formMessage.show('error', t('transactions.fillAll'));
        const body = {
            type: 'expense', description: title, amount, accountId: Number(accountId), date,
            categoryId: categoryId ? Number(categoryId) : undefined, tags: tagList(tags), eventId: eventValue(eventId),
        };
        if (await add(body, t('transactions.expense.added'))) {
            setExpenseForm(form => ({ ...form, title: '', amount: '', tags: '', categoryChosen: false, categoryId: fallbackCategory('expense') }));
        }
    }

    async function addTransfer() {
        const { note, amount, fromId, toId, date } = transferForm;
        if (!amount || !date || !fromId || !toId) return formMessage.show('error', t('transactions.fillAll'));
        if (fromId === toId) return formMessage.show('error', t('transactions.transfer.sameAccount'));
        const from = accounts.find(account => String(account.id) === fromId);
        const to = accounts.find(account => String(account.id) === toId);
        const description = note.trim() || t('transactions.transfer.defaultNote', { from: from?.name ?? t('transactions.transfer.account'), to: to?.name ?? t('transactions.transfer.toAccount') });
        const transfer = { type: 'transfer', description, amount, accountId: Number(fromId), toAccountId: Number(toId), date, eventId: eventValue(transferForm.eventId) };
        if (await add(transfer, t('transactions.transfer.added'))) {
            setTransferForm(form => ({ ...form, note: '', amount: '' }));
        }
    }

    function startEdit(entry: Entry) {
        setEdit({
            id: entry.id, type: entry.type, description: entry.description, amount: entry.amount,
            accountId: String(entry.account.id), toAccountId: String(entry.toAccount?.id ?? ''), date: entry.date,
            categoryId: String(entry.category?.id ?? ''), tags: entry.tags.join(', '), eventId: String(entry.event?.id ?? ''),
        });
    }

    async function saveEdit() {
        if (!edit) return;
        const { id, type, description, amount, accountId, toAccountId, date, categoryId, tags, eventId, confirmReconciled } = edit;
        if (!description || !amount || !date || !accountId || (type === 'transfer' && !toAccountId)) return toast('error', t('transactions.fillAll'));
        const result = await apiPut(`/api/entries/${id}`, {
            type, description, amount, accountId: Number(accountId), date, tags: tagList(tags), eventId: eventValue(eventId), confirmReconciled,
            ...(type === 'transfer' ? { toAccountId: Number(toAccountId) } : { categoryId: categoryId ? Number(categoryId) : undefined }),
        });
        if (redirectIfUnauthorized(result)) return;
        if (result.status === 409) {
            setEdit(draft => draft && { ...draft, reconciledWarning: httpError(result), confirmReconciled: false });
            return;
        }
        if (!result.ok) return toast('error', httpError(result));
        setEdit(null);
        toast('success', t('transactions.updated', { type: t(`transactions.types.${type}`) }));
        const moved = movedMessage(date, period.month, period.year);
        if (moved) toast('info', moved);
        await loadEntries(period.month, period.year);
    }

    function toggleSelected(id: number) {
        setSelected(current => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }

    async function categoriseSelected() {
        if (selected.size === 0 || !bulkCategory) return toast('error', t('transactions.bulk.needBoth'));
        const result = await apiPost<{ changed?: number }>('/api/entries/categorise', { entryIds: [...selected], categoryId: Number(bulkCategory) });
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        const changed = result.data.changed ?? 0;
        toast('success', t('transactions.bulk.done', { count: changed, category: categories.find(category => String(category.id) === bulkCategory)?.name ?? t('transactions.bulk.theCategory') }));
        await loadEntries(period.month, period.year);
    }

    async function confirmDelete() {
        if (!pendingDelete) return;
        const confirm = deleteWarning?.confirmed ? '?confirmReconciled=true' : '';
        const result = await apiDelete(`/api/entries/${pendingDelete.id}${confirm}`);
        if (redirectIfUnauthorized(result)) return;
        if (result.status === 409) {
            setDeleteWarning({ text: httpError(result), confirmed: false });
            return;
        }
        setDeleteWarning(null);
        if (!result.ok) return toast('error', t('transactions.delete.failed'));
        toast('success', t('transactions.delete.done', { type: t(`transactions.types.${pendingDelete.type}`) }));
        setPendingDelete(null);
        await loadEntries(period.month, period.year);
    }

    if (!loaded) {
        // Rendered only after the data loads, so nothing can be typed or picked before the form is live
        return null;
    }

    const showIncome = trackingOption !== 'expenses';
    const showExpenses = trackingOption !== 'income';
    const incomes = entries.filter(entry => entry.type === 'income');
    const expenses = entries.filter(entry => entry.type === 'expense');
    const transfers = entries.filter(entry => entry.type === 'transfer');
    const incomeTotal = sum(incomes);
    const expenseTotal = sum(expenses);
    const periodName = `${MONTH_NAMES[period.month - 1]} ${period.year}`;
    const tabs = ([showExpenses ? 'expense' : null, showIncome ? 'income' : null, 'transfer'] as (EntryType | null)[]).filter((tab): tab is EntryType => tab !== null);
    const formClass = (type: EntryType) => (activeForm === type || !tabs.includes(activeForm) && type === tabs[0] ? ' is-active' : '');
    const rowActions = (entry: Entry) => entry.reimbursement ? (
        <span className="row-actions sub">{t('transactions.fromReimbursement')}</span>
    ) : (
        <span className="row-actions">
            <button type="button" className="icon-btn" data-action={`edit-${entry.type}`} data-id={entry.id} onClick={() => startEdit(entry)}>
                <Pencil aria-hidden="true" /> {t('common.edit')}
            </button>
            <button type="button" className="icon-btn danger" data-action={`delete-${entry.type}`} data-id={entry.id} onClick={() => setPendingDelete(entry)}>
                <Trash2 aria-hidden="true" /> {t('common.delete')}
            </button>
        </span>
    );
    const descriptionLabel = (type: EntryType) => t(`transactions.descriptionLabel.${type}`);
    const accountLabel = (type: EntryType) => t(`transactions.accountLabel.${type}`);
    /** One entry as a row: date, what, its labels and account, the amount, then the actions */
    const entryRow = (entry: Entry, selectable: boolean) => (
        <li key={entry.id} className="entry-row" data-entry={entry.id}>
            <span className="entry-date">{shortDate(entry.date)}</span>
            <span className="entry-main">
                {selectable ? (
                    <label className="select-entry">
                        <input type="checkbox" data-action="select-entry" data-id={entry.id} checked={selected.has(entry.id)} disabled={entry.reimbursement}
                            onChange={() => toggleSelected(entry.id)} aria-label={t('transactions.select', { name: entry.description })} />
                        <span className="entry-what">{entry.description}</span>
                    </label>
                ) : <span className="entry-what">{entry.description}</span>}
                <span className="entry-account">
                    {entry.type === 'transfer'
                        ? <>{entry.account.name} <ArrowRight size={13} aria-label={t('transactions.transfer.toWord')} /> {entry.toAccount?.name ?? ''}</>
                        : entry.account.name}
                </span>
                <EntryMeta entry={entry} />
            </span>
            <span className={`entry-amount ${entry.type === 'income' ? 'in' : entry.type === 'expense' ? 'out' : ''}`}>{formatRupees(entry.amount)}</span>
            {rowActions(entry)}
        </li>
    );
    const entryList = (id: string, rows: Entry[], empty: string, selectable: boolean) => (
        <ul id={id} className="entry-list">
            {rows.length === 0 ? <li className="entry-empty">{empty}</li> : rows.map(entry => entryRow(entry, selectable))}
        </ul>
    );

    return (
        <div id="transactions-section">
            <div className="page-header">
                <div>
                    <h2>{t('transactions.title')}</h2>
                    <p>{t('transactions.subtitle', { period: periodName })}</p>
                </div>
                <div className="period-picker transaction-filters">
                    <div className="field">
                        <label htmlFor="transaction-month">{t('transactions.month')}</label>
                        <select id="transaction-month" value={filterMonth} onChange={event => setFilterMonth(Number(event.target.value))}>
                            {MONTH_NAMES.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
                        </select>
                    </div>
                    <div className="field">
                        <label htmlFor="transaction-year">{t('transactions.year')}</label>
                        <select id="transaction-year" value={filterYear} onChange={event => setFilterYear(Number(event.target.value))}>
                            {filterYears().map(year => <option key={year} value={year}>{year}</option>)}
                        </select>
                    </div>
                    <button type="button" id="filter-transactions" className="btn btn-secondary" data-action="filterTransactions" onClick={filterTransactions}>
                        <Search aria-hidden="true" /> {t('transactions.show')}
                    </button>
                </div>
            </div>

            {suggestion ? (
                <div id="module-suggestion" className="notice module-suggestion" role="status">
                    <span>{t('transactions.module.question')} <b>{suggestion.name}</b>? {suggestion.line}</span>
                    <span className="module-actions">
                        <button type="button" className="btn btn-secondary" data-action="declineModule" onClick={() => answerSuggestion(false)}>{t('transactions.module.noThanks')}</button>
                        <button type="button" className="btn btn-primary" data-action="acceptModule" onClick={() => answerSuggestion(true)}>{t('transactions.module.turnOn')}</button>
                    </span>
                </div>
            ) : null}

            <section className="figures" aria-label={periodName}>
                {showIncome ? (
                    <div className="stat">
                        <span className="stat-top"><span className="icon-tile t-income" aria-hidden="true"><TrendingUp /></span> {t('transactions.moneyIn')}</span>
                        <span className="stat-value in">{formatRupees(incomeTotal)}</span>
                        <span className="stat-note">{t('transactions.entriesIn', { count: incomes.length, period: periodName })}</span>
                    </div>
                ) : null}
                {showExpenses ? (
                    <div className="stat">
                        <span className="stat-top"><span className="icon-tile t-expense" aria-hidden="true"><TrendingDown /></span> {t('transactions.moneyOut')}</span>
                        <span className="stat-value">{formatRupees(expenseTotal)}</span>
                        <span className="stat-note">{t('transactions.entriesIn', { count: expenses.length, period: periodName })}</span>
                    </div>
                ) : null}
                {showIncome && showExpenses ? (
                    <div className="stat">
                        <span className="stat-top"><span className="icon-tile t-bank" aria-hidden="true"><ArrowLeftRight /></span> {t('transactions.difference')}</span>
                        <span className={`stat-value ${incomeTotal >= expenseTotal ? 'in' : 'out'}`}>{formatRupees(incomeTotal - expenseTotal)}</span>
                        <span className="stat-note">{incomeTotal >= expenseTotal ? t('transactions.moreIn') : t('transactions.moreOut')}</span>
                    </div>
                ) : null}
            </section>

            <div className="entry-tabs" role="tablist" aria-label={t('transactions.tabs.label')}>
                {tabs.map(tab => (
                    <button key={tab} type="button" role="tab" data-entry-tab={tab} aria-selected={formClass(tab) !== ''} onClick={() => setActiveForm(tab)}>
                        {t(`transactions.tabs.${tab}`)}
                    </button>
                ))}
            </div>
            <div id="forms-wrapper" className={`entry-forms${showIncome && showExpenses ? '' : ' one'}`}>
                <form id="income-form" className={`card entry-form${showIncome ? '' : ' hidden'}${formClass('income')}`} onSubmit={event => { event.preventDefault(); addIncome(); }}>
                    <h3><span className="icon-tile t-income" aria-hidden="true"><TrendingUp /></span>{t('transactions.income.add')}</h3>
                    <div className="form-grid two">
                        <div className="field">
                            <label htmlFor="income-source">{t('transactions.income.source')}</label>
                            <input type="text" id="income-source" placeholder={t('transactions.income.sourcePlaceholder')} value={incomeForm.source}
                                onChange={event => setIncomeForm(form => ({ ...form, source: event.target.value }))}
                                onBlur={event => suggest('income', event.target.value)} />
                        </div>
                        <div className="field">
                            <label htmlFor="income-amount">{t('transactions.amount')}</label>
                            <input type="number" id="income-amount" inputMode="decimal" placeholder="0.00" step="0.01" value={incomeForm.amount}
                                onChange={event => setIncomeForm(form => ({ ...form, amount: event.target.value }))} />
                        </div>
                        <div className="field">
                            <label htmlFor="income-credited-to">{t('transactions.income.receivedIn')}</label>
                            <select id="income-credited-to" value={incomeForm.accountId}
                                onChange={event => setIncomeForm(form => ({ ...form, accountId: event.target.value }))}>
                                <AccountOptions accounts={usable(accounts, 'income')} />
                            </select>
                        </div>
                        <div className="field">
                            <label htmlFor="income-date">{t('transactions.date')}</label>
                            <input type="date" id="income-date" value={incomeForm.date}
                                onChange={event => setIncomeForm(form => ({ ...form, date: event.target.value }))} />
                        </div>
                        <div className="field">
                            <label htmlFor="income-category">{t('transactions.category')}</label>
                            <select id="income-category" value={incomeForm.categoryId}
                                onChange={event => setIncomeForm(form => ({ ...form, categoryId: event.target.value, categoryChosen: true }))}>
                                <CategoryOptions categories={categories} kind="income" />
                            </select>
                        </div>
                        <div className="field">
                            <label htmlFor="income-tags">{t('transactions.tags')}</label>
                            <input type="text" id="income-tags" placeholder={t('transactions.income.tagsPlaceholder')} value={incomeForm.tags}
                                onChange={event => setIncomeForm(form => ({ ...form, tags: event.target.value }))} />
                        </div>
                        <div className="field">
                            <label htmlFor="income-event">{t('transactions.event')}</label>
                            <select id="income-event" value={incomeForm.eventId} onChange={event => chooseEvent('income', event.target.value)}>
                                <EventOptions events={events} />
                            </select>
                        </div>
                    </div>
                    <button type="submit" className="btn btn-primary" data-action="addIncome"><Plus aria-hidden="true" /> {t('transactions.income.add')}</button>
                </form>
                <form id="expense-form" className={`card entry-form expense${showExpenses ? '' : ' hidden'}${formClass('expense')}`} onSubmit={event => { event.preventDefault(); addExpense(); }}>
                    <h3><span className="icon-tile t-expense" aria-hidden="true"><TrendingDown /></span>{t('transactions.expense.add')}</h3>
                    <div className="form-grid two">
                        <div className="field">
                            <label htmlFor="expense-title">{t('transactions.expense.title')}</label>
                            <input type="text" id="expense-title" placeholder={t('transactions.expense.titlePlaceholder')} value={expenseForm.title}
                                onChange={event => setExpenseForm(form => ({ ...form, title: event.target.value }))}
                                onBlur={event => suggest('expense', event.target.value)} />
                        </div>
                        <div className="field">
                            <label htmlFor="expense-amount">{t('transactions.amount')}</label>
                            <input type="number" id="expense-amount" inputMode="decimal" placeholder="0.00" step="0.01" value={expenseForm.amount}
                                onChange={event => setExpenseForm(form => ({ ...form, amount: event.target.value }))} />
                        </div>
                        <div className="field">
                            <label htmlFor="expense-payment-method">{t('transactions.expense.paidFrom')}</label>
                            <select id="expense-payment-method" value={expenseForm.accountId}
                                onChange={event => setExpenseForm(form => ({ ...form, accountId: event.target.value }))}>
                                <AccountOptions accounts={accounts} />
                            </select>
                        </div>
                        <div className="field">
                            <label htmlFor="expense-date">{t('transactions.date')}</label>
                            <input type="date" id="expense-date" value={expenseForm.date}
                                onChange={event => setExpenseForm(form => ({ ...form, date: event.target.value }))} />
                        </div>
                        <div className="field">
                            <label htmlFor="expense-category">{t('transactions.category')}</label>
                            <select id="expense-category" value={expenseForm.categoryId}
                                onChange={event => setExpenseForm(form => ({ ...form, categoryId: event.target.value, categoryChosen: true }))}>
                                <CategoryOptions categories={categories} kind="expense" />
                            </select>
                        </div>
                        <div className="field">
                            <label htmlFor="expense-tags">{t('transactions.tags')}</label>
                            <input type="text" id="expense-tags" placeholder={t('transactions.expense.tagsPlaceholder')} value={expenseForm.tags}
                                onChange={event => setExpenseForm(form => ({ ...form, tags: event.target.value }))} />
                        </div>
                        <div className="field">
                            <label htmlFor="expense-event">{t('transactions.event')}</label>
                            <select id="expense-event" value={expenseForm.eventId} onChange={event => chooseEvent('expense', event.target.value)}>
                                <EventOptions events={events} />
                            </select>
                        </div>
                    </div>
                    <button type="submit" className="btn btn-primary" data-action="addExpense"><Plus aria-hidden="true" /> {t('transactions.expense.add')}</button>
                </form>
                <form id="transfer-form" className={`card entry-form transfer${formClass('transfer')}`} onSubmit={event => { event.preventDefault(); addTransfer(); }}>
                    <h3><span className="icon-tile t-bank" aria-hidden="true"><ArrowLeftRight /></span>{t('transactions.transfer.add')}</h3>
                    <p className="form-note">{t('transactions.transfer.note')}</p>
                    <div className="form-grid two">
                        <div className="field">
                            <label htmlFor="transfer-from">{t('transactions.transfer.from')}</label>
                            <select id="transfer-from" value={transferForm.fromId}
                                onChange={event => setTransferForm(form => ({ ...form, fromId: event.target.value }))}>
                                <AccountOptions accounts={accounts} />
                            </select>
                        </div>
                        <div className="field">
                            <label htmlFor="transfer-to">{t('transactions.transfer.to')}</label>
                            <select id="transfer-to" value={transferForm.toId}
                                onChange={event => setTransferForm(form => ({ ...form, toId: event.target.value }))}>
                                <AccountOptions accounts={accounts} />
                            </select>
                        </div>
                        <div className="field">
                            <label htmlFor="transfer-amount">{t('transactions.amount')}</label>
                            <input type="number" id="transfer-amount" inputMode="decimal" placeholder="0.00" step="0.01" value={transferForm.amount}
                                onChange={event => setTransferForm(form => ({ ...form, amount: event.target.value }))} />
                        </div>
                        <div className="field">
                            <label htmlFor="transfer-date">{t('transactions.date')}</label>
                            <input type="date" id="transfer-date" value={transferForm.date}
                                onChange={event => setTransferForm(form => ({ ...form, date: event.target.value }))} />
                        </div>
                        <div className="field span-2">
                            <label htmlFor="transfer-note">{t('transactions.transfer.noteLabel')}</label>
                            <input type="text" id="transfer-note" placeholder={t('transactions.transfer.notePlaceholder')} value={transferForm.note}
                                onChange={event => setTransferForm(form => ({ ...form, note: event.target.value }))} />
                        </div>
                        <div className="field span-2">
                            <label htmlFor="transfer-event">{t('transactions.event')}</label>
                            <select id="transfer-event" value={transferForm.eventId} onChange={event => chooseEvent('transfer', event.target.value)}>
                                <EventOptions events={events} />
                            </select>
                        </div>
                    </div>
                    <button type="submit" className="btn btn-primary" data-action="addTransfer"><ArrowLeftRight aria-hidden="true" /> {t('transactions.transfer.add')}</button>
                </form>
            </div>
            <div id="transactions-message" className={formMessage.message?.kind ?? 'error'} role="status">{formMessage.message?.text ?? ''}</div>

            <div id="bulk-categorise" className="bulk-bar" hidden={selected.size === 0}>
                <span>{t('transactions.bulk.selected', { count: selected.size })}</span>
                <label htmlFor="bulk-category" className="sr-only">{t('transactions.category')}</label>
                <select id="bulk-category" value={bulkCategory} onChange={event => setBulkCategory(event.target.value)}>
                    <option value="">{t('transactions.bulk.choose')}</option>
                    <optgroup label={t('transactions.bulk.spending')}><CategoryOptions categories={categories} kind="expense" /></optgroup>
                    <optgroup label={t('transactions.bulk.income')}><CategoryOptions categories={categories} kind="income" /></optgroup>
                </select>
                <button type="button" className="btn btn-primary btn-sm" data-action="bulkCategorise" onClick={categoriseSelected}>{t('transactions.bulk.apply')}</button>
                <button type="button" className="btn btn-secondary btn-sm" data-action="clearSelection" onClick={() => setSelected(new Set())}>{t('transactions.bulk.clear')}</button>
            </div>

            <div id="transactions-history" className="histories">
                <section id="expense-history" className="card" hidden={!showExpenses} aria-labelledby="expense-history-title">
                    <div className="card-head">
                        <h3 id="expense-history-title">{t('transactions.expense.list')}</h3>
                        <span className="meta">{periodName}</span>
                    </div>
                    {entryList('expense-table-body', expenses, t('transactions.expense.empty'), true)}
                </section>
                <section id="income-history" className="card" hidden={!showIncome} aria-labelledby="income-history-title">
                    <div className="card-head">
                        <h3 id="income-history-title">{t('transactions.income.list')}</h3>
                        <span className="meta">{periodName}</span>
                    </div>
                    {entryList('income-table-body', incomes, t('transactions.income.empty'), true)}
                </section>
                <section id="transfer-history" className="card" aria-labelledby="transfer-history-title">
                    <div className="card-head">
                        <h3 id="transfer-history-title">{t('transactions.transfer.list')}</h3>
                        <span className="meta">{periodName}</span>
                    </div>
                    {entryList('transfer-table-body', transfers, t('transactions.transfer.empty'), false)}
                </section>
            </div>

            <RepeatingCard accounts={accounts} categories={categories} onRecorded={() => loadEntries(period.month, period.year)} />
            <ReimbursementsCard accounts={accounts} categories={categories} onChange={() => loadEntries(period.month, period.year)} />

            <Modal id={`edit-${edit?.type ?? 'income'}-modal`} title={t(`transactions.edit.${edit?.type ?? 'income'}`)}
                open={edit !== null} closeAction={`close-edit-${edit?.type ?? 'income'}`} onClose={() => setEdit(null)}
                footer={(
                    <>
                        <button type="button" data-action={`close-edit-${edit?.type ?? 'income'}`} className="btn btn-secondary" onClick={() => setEdit(null)}>{t('common.cancel')}</button>
                        <button type="button" data-action={`save-${edit?.type ?? 'income'}-edit`} className="btn btn-primary" onClick={saveEdit}>{t('common.saveChanges')}</button>
                    </>
                )}>
                {edit ? (
                    <div className="form-grid">
                        <div className="field">
                            <label htmlFor={`edit-${edit.type}-${edit.type === 'expense' ? 'title' : edit.type === 'income' ? 'source' : 'note'}`}>{descriptionLabel(edit.type)}</label>
                            <input type="text" id={`edit-${edit.type}-${edit.type === 'expense' ? 'title' : edit.type === 'income' ? 'source' : 'note'}`} required value={edit.description}
                                onChange={event => setEdit(draft => draft && { ...draft, description: event.target.value })} />
                        </div>
                        <div className="field">
                            <label htmlFor={`edit-${edit.type}-amount`}>{t('transactions.amount')}</label>
                            <input type="number" id={`edit-${edit.type}-amount`} inputMode="decimal" step="0.01" min="0" required value={edit.amount}
                                onChange={event => setEdit(draft => draft && { ...draft, amount: event.target.value })} />
                        </div>
                        <div className="field">
                            <label htmlFor={`edit-${edit.type}-${edit.type === 'income' ? 'credited-to' : edit.type === 'expense' ? 'payment-method' : 'from'}`}>{accountLabel(edit.type)}</label>
                            <select id={`edit-${edit.type}-${edit.type === 'income' ? 'credited-to' : edit.type === 'expense' ? 'payment-method' : 'from'}`} required value={edit.accountId}
                                onChange={event => setEdit(draft => draft && { ...draft, accountId: event.target.value })}>
                                <AccountOptions accounts={usable(accounts, edit.type)} />
                            </select>
                        </div>
                        {edit.type === 'transfer' ? (
                            <div className="field">
                                <label htmlFor="edit-transfer-to">{t('transactions.transfer.to')}</label>
                                <select id="edit-transfer-to" required value={edit.toAccountId}
                                    onChange={event => setEdit(draft => draft && { ...draft, toAccountId: event.target.value })}>
                                    <AccountOptions accounts={accounts} />
                                </select>
                            </div>
                        ) : null}
                        {edit.type !== 'transfer' ? (
                            <div className="field">
                                <label htmlFor={`edit-${edit.type}-category`}>{t('transactions.category')}</label>
                                <select id={`edit-${edit.type}-category`} value={edit.categoryId}
                                    onChange={event => setEdit(draft => draft && { ...draft, categoryId: event.target.value })}>
                                    <CategoryOptions categories={categories} kind={edit.type} />
                                </select>
                            </div>
                        ) : null}
                        <div className="field">
                            <label htmlFor={`edit-${edit.type}-event`}>{t('transactions.eventShort')}</label>
                            <select id={`edit-${edit.type}-event`} value={edit.eventId} onChange={event => chooseEvent('edit', event.target.value)}>
                                <EventOptions events={events} />
                            </select>
                        </div>
                        <div className="field">
                            <label htmlFor={`edit-${edit.type}-tags`}>{t('transactions.tagsShort')}</label>
                            <input type="text" id={`edit-${edit.type}-tags`} value={edit.tags}
                                onChange={event => setEdit(draft => draft && { ...draft, tags: event.target.value })} />
                        </div>
                        <div className="field">
                            <label htmlFor={`edit-${edit.type}-date`}>{t('transactions.date')}</label>
                            <input type="date" id={`edit-${edit.type}-date`} required value={edit.date}
                                onChange={event => setEdit(draft => draft && { ...draft, date: event.target.value })} />
                        </div>
                        {edit.reconciledWarning ? (
                            <div className="notice warn" id="edit-reconciled-warning">
                                {edit.reconciledWarning}
                                <label className="check-line">
                                    <input type="checkbox" id="edit-confirm-reconciled" checked={edit.confirmReconciled === true}
                                        onChange={event => setEdit(draft => draft && { ...draft, confirmReconciled: event.target.checked })} />
                                    {t('transactions.changeAnyway')}
                                </label>
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </Modal>

            <Modal id="new-event-modal" title={t('transactions.newEvent.title')} small open={newEvent !== null} closeAction="close-new-event" onClose={() => setNewEvent(null)}
                footer={(
                    <>
                        <button type="button" data-action="close-new-event" className="btn btn-secondary" onClick={() => setNewEvent(null)}>{t('common.cancel')}</button>
                        <button type="button" data-action="save-new-event" className="btn btn-primary" onClick={createEvent}>{t('transactions.newEvent.add')}</button>
                    </>
                )}>
                <div className="form-grid">
                    <div className="field">
                        <label htmlFor="new-event-name">{t('transactions.newEvent.name')}</label>
                        <input type="text" id="new-event-name" maxLength={80} placeholder={t('transactions.newEvent.namePlaceholder')} value={newEvent?.name ?? ''}
                            onChange={event => setNewEvent(current => current && { ...current, name: event.target.value })} />
                    </div>
                    <label className="check-line">
                        <input type="checkbox" id="new-event-one-off" checked={newEvent?.oneOff ?? true}
                            onChange={event => setNewEvent(current => current && { ...current, oneOff: event.target.checked })} />
                        {t('transactions.newEvent.oneOff')}
                    </label>
                    <p className="form-note">{t('transactions.newEvent.note')}</p>
                </div>
            </Modal>

            <Modal id="delete-confirmation-modal" title={t('transactions.delete.title')} small open={pendingDelete !== null} closeAction="close-delete"
                onClose={() => { setPendingDelete(null); setDeleteWarning(null); }}
                footer={(
                    <>
                        <button type="button" data-action="close-delete" className="btn btn-secondary" onClick={() => setPendingDelete(null)}>{t('common.cancel')}</button>
                        <button type="button" data-action="confirm-delete" className="btn btn-danger" onClick={confirmDelete}>
                            <Trash2 aria-hidden="true" /> {t('common.delete')}
                        </button>
                    </>
                )}>
                <p id="delete-confirmation-message" className="lead">
                    {pendingDelete ? (
                        <>
                            {t('transactions.delete.question', { type: t(`transactions.typesLower.${pendingDelete.type}`) })}<br />
                            <span className="sub">
                                {pendingDelete.type === 'expense' ? t('transactions.delete.titleLabel') : descriptionLabel(pendingDelete.type)}: {pendingDelete.description}
                                <br />{t('transactions.delete.amount', { amount: formatRupees(pendingDelete.amount) })}
                            </span>
                        </>
                    ) : t('transactions.delete.questionPlain')}
                </p>
                <p>{t('transactions.delete.note')}</p>
                {deleteWarning ? (
                    <div className="notice warn" id="delete-reconciled-warning">
                        {deleteWarning.text}
                        <label className="check-line">
                            <input type="checkbox" id="delete-confirm-reconciled" checked={deleteWarning.confirmed}
                                onChange={event => setDeleteWarning(current => current && { ...current, confirmed: event.target.checked })} />
                            {t('transactions.delete.anyway')}
                        </label>
                    </div>
                ) : null}
            </Modal>
        </div>
    );
}
