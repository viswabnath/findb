'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeftRight, ArrowRight, Pencil, Plus, Search, Trash2, TrendingDown, TrendingUp } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { useFormMessage } from '@/components/useFormMessage';
import { apiDelete, apiGet, apiPost, apiPut, httpError, redirectIfUnauthorized } from '@/lib/api-client';
import { filterYears, MONTH_NAMES, todayUtcIso } from '@/lib/dates';
import { formatRupees } from '@/lib/format';

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
}
interface Draft {
    id: number; type: EntryType; description: string; amount: string; accountId: string; toAccountId: string; date: string;
    categoryId: string; tags: string; eventId: string;
}

function EventOptions({ events }: { events: EventChoice[] }) {
    return (
        <>
            <option value="">No event</option>
            {events.map(event => <option key={event.id} value={event.id}>{event.name}</option>)}
            <option value={NEW_EVENT}>New event...</option>
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

const GROUPS: { type: AccountType; label: string }[] = [
    { type: 'bank', label: 'Banks' }, { type: 'cash', label: 'Cash' }, { type: 'credit_card', label: 'Credit cards' },
    { type: 'wallet', label: 'Wallets' }, { type: 'meal_card', label: 'Meal cards' },
];

/** The accounts an entry of this type can use: income cannot go onto a credit card */
const usable = (accounts: Account[], type: EntryType) => accounts.filter(account => type !== 'income' || account.type !== 'credit_card');

function AccountOptions({ accounts }: { accounts: Account[] }) {
    return (
        <>
            {GROUPS.map(group => {
                const inGroup = accounts.filter(account => account.type === group.type);
                if (inGroup.length === 0) return null;
                return (
                    <optgroup key={group.type} label={group.label}>
                        {inGroup.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
                    </optgroup>
                );
            })}
        </>
    );
}

function EmptyRow({ text }: { text: string }) {
    return (
        <tr className="empty-row">
            <td colSpan={5}>{text}</td>
        </tr>
    );
}

/** Toast when an edited entry's new date falls outside the month on screen */
function movedMessage(date: string, month: number, year: number): string | null {
    const [y, m] = date.split('-').map(Number);
    if (m === month && y === year) return null;
    const name = new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return `Transaction moved to ${name}. Change filter to view it.`;
}

/** An entry's date (YYYY-MM-DD) as "3 Oct 2026" */
const shortDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const sum = (rows: { amount: string }[]) => rows.reduce((total, row) => total + (parseFloat(row.amount) || 0), 0);
const ENTRY_NAMES: Record<EntryType, string> = { income: 'Income', expense: 'Expense', transfer: 'Transfer' };

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

    const [edit, setEdit] = useState<Draft | null>(null);
    const [pendingDelete, setPendingDelete] = useState<Entry | null>(null);

    const loadEntries = useCallback(async (month: number, year: number) => {
        const result = await apiGet<Entry[]>(`/api/entries?${new URLSearchParams({ month: String(month), year: String(year) })}`);
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) {
            toast('error', 'Failed to load transactions. Please try again.');
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
        if (!newEvent.name.trim()) return toast('error', 'Please enter a name');
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
        toast('info', `Loading transactions for ${MONTH_NAMES[filterMonth - 1]} ${filterYear}...`);
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
        return true;
    }

    async function addIncome() {
        const { source, amount, accountId, date, categoryId, tags, eventId } = incomeForm;
        if (!source || !amount || !date || !accountId) return formMessage.show('error', 'Please fill all fields');
        const body = {
            type: 'income', description: source, amount, accountId: Number(accountId), date,
            categoryId: categoryId ? Number(categoryId) : undefined, tags: tagList(tags), eventId: eventValue(eventId),
        };
        if (await add(body, 'Income added successfully!')) {
            setIncomeForm(form => ({ ...form, source: '', amount: '', tags: '', categoryChosen: false, categoryId: fallbackCategory('income') }));
        }
    }

    async function addExpense() {
        const { title, amount, accountId, date, categoryId, tags, eventId } = expenseForm;
        if (!title || !amount || !date || !accountId) return formMessage.show('error', 'Please fill all fields');
        const body = {
            type: 'expense', description: title, amount, accountId: Number(accountId), date,
            categoryId: categoryId ? Number(categoryId) : undefined, tags: tagList(tags), eventId: eventValue(eventId),
        };
        if (await add(body, 'Expense added successfully!')) {
            setExpenseForm(form => ({ ...form, title: '', amount: '', tags: '', categoryChosen: false, categoryId: fallbackCategory('expense') }));
        }
    }

    async function addTransfer() {
        const { note, amount, fromId, toId, date } = transferForm;
        if (!amount || !date || !fromId || !toId) return formMessage.show('error', 'Please fill all fields');
        if (fromId === toId) return formMessage.show('error', 'Choose two different accounts for a transfer');
        const from = accounts.find(account => String(account.id) === fromId);
        const to = accounts.find(account => String(account.id) === toId);
        const description = note.trim() || `${from?.name ?? 'Account'} to ${to?.name ?? 'account'}`;
        const transfer = { type: 'transfer', description, amount, accountId: Number(fromId), toAccountId: Number(toId), date, eventId: eventValue(transferForm.eventId) };
        if (await add(transfer, 'Transfer added successfully!')) {
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
        const { id, type, description, amount, accountId, toAccountId, date, categoryId, tags, eventId } = edit;
        if (!description || !amount || !date || !accountId || (type === 'transfer' && !toAccountId)) return toast('error', 'Please fill all fields');
        const result = await apiPut(`/api/entries/${id}`, {
            type, description, amount, accountId: Number(accountId), date, tags: tagList(tags), eventId: eventValue(eventId),
            ...(type === 'transfer' ? { toAccountId: Number(toAccountId) } : { categoryId: categoryId ? Number(categoryId) : undefined }),
        });
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        setEdit(null);
        toast('success', `${ENTRY_NAMES[type]} transaction updated successfully!`);
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
        if (selected.size === 0 || !bulkCategory) return toast('error', 'Tick some entries and choose a category');
        const result = await apiPost<{ changed?: number }>('/api/entries/categorise', { entryIds: [...selected], categoryId: Number(bulkCategory) });
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        const changed = result.data.changed ?? 0;
        toast('success', `${changed} ${changed === 1 ? 'entry' : 'entries'} put in ${categories.find(category => String(category.id) === bulkCategory)?.name ?? 'the category'}`);
        await loadEntries(period.month, period.year);
    }

    async function confirmDelete() {
        if (!pendingDelete) return;
        const result = await apiDelete(`/api/entries/${pendingDelete.id}`);
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', 'Failed to delete transaction');
        toast('success', `${ENTRY_NAMES[pendingDelete.type]} transaction deleted successfully!`);
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
    const rowActions = (entry: Entry) => (
        <span className="row-actions">
            <button type="button" className="icon-btn" data-action={`edit-${entry.type}`} data-id={entry.id} onClick={() => startEdit(entry)}>
                <Pencil aria-hidden="true" /> Edit
            </button>
            <button type="button" className="icon-btn danger" data-action={`delete-${entry.type}`} data-id={entry.id} onClick={() => setPendingDelete(entry)}>
                <Trash2 aria-hidden="true" /> Delete
            </button>
        </span>
    );
    const descriptionLabel = (type: EntryType) => (type === 'income' ? 'Source' : type === 'expense' ? 'What for' : 'Note');
    const accountLabel = (type: EntryType) => (type === 'income' ? 'Received in' : type === 'expense' ? 'Paid from' : 'From');

    return (
        <div id="transactions-section">
            <div className="page-header">
                <div>
                    <h2>Transactions</h2>
                    <p>Add what comes in, goes out, and moves between your accounts. Showing {periodName}.</p>
                </div>
                <div className="period-picker transaction-filters">
                    <div className="field">
                        <label htmlFor="transaction-month">Month</label>
                        <select id="transaction-month" value={filterMonth} onChange={event => setFilterMonth(Number(event.target.value))}>
                            {MONTH_NAMES.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
                        </select>
                    </div>
                    <div className="field">
                        <label htmlFor="transaction-year">Year</label>
                        <select id="transaction-year" value={filterYear} onChange={event => setFilterYear(Number(event.target.value))}>
                            {filterYears().map(year => <option key={year} value={year}>{year}</option>)}
                        </select>
                    </div>
                    <button type="button" id="filter-transactions" className="btn btn-secondary" data-action="filterTransactions" onClick={filterTransactions}>
                        <Search aria-hidden="true" /> Show
                    </button>
                </div>
            </div>

            <div className={`stats ${showIncome && showExpenses ? 'three' : 'two'}`}>
                {showIncome ? (
                    <div className="stat">
                        <span className="stat-top"><span className="icon-tile t-income" aria-hidden="true"><TrendingUp /></span> Money in</span>
                        <span className="stat-value">{formatRupees(incomeTotal)}</span>
                        <span className="stat-note">{incomes.length} {incomes.length === 1 ? 'entry' : 'entries'} in {periodName}</span>
                    </div>
                ) : null}
                {showExpenses ? (
                    <div className="stat">
                        <span className="stat-top"><span className="icon-tile t-expense" aria-hidden="true"><TrendingDown /></span> Money out</span>
                        <span className="stat-value">{formatRupees(expenseTotal)}</span>
                        <span className="stat-note">{expenses.length} {expenses.length === 1 ? 'entry' : 'entries'} in {periodName}</span>
                    </div>
                ) : null}
                {showIncome && showExpenses ? (
                    <div className="stat hero">
                        <span className="stat-top"><ArrowLeftRight size={18} aria-hidden="true" /> Difference</span>
                        <span className="stat-value">{formatRupees(incomeTotal - expenseTotal)}</span>
                        <span className="stat-note">{incomeTotal >= expenseTotal ? 'More came in than went out' : 'More went out than came in'}</span>
                    </div>
                ) : null}
            </div>

            <div id="forms-wrapper" className={`entry-forms${showIncome && showExpenses ? '' : ' one'}`}>
                <form id="income-form" className={`card entry-form${showIncome ? '' : ' hidden'}`} onSubmit={event => { event.preventDefault(); addIncome(); }}>
                    <h3><span className="icon-tile t-income" aria-hidden="true"><TrendingUp /></span>Add income</h3>
                    <div className="form-grid two">
                        <div className="field">
                            <label htmlFor="income-source">Source</label>
                            <input type="text" id="income-source" placeholder="Salary, freelance..." value={incomeForm.source}
                                onChange={event => setIncomeForm(form => ({ ...form, source: event.target.value }))}
                                onBlur={event => suggest('income', event.target.value)} />
                        </div>
                        <div className="field">
                            <label htmlFor="income-amount">Amount (₹)</label>
                            <input type="number" id="income-amount" inputMode="decimal" placeholder="0.00" step="0.01" value={incomeForm.amount}
                                onChange={event => setIncomeForm(form => ({ ...form, amount: event.target.value }))} />
                        </div>
                        <div className="field">
                            <label htmlFor="income-credited-to">Received in</label>
                            <select id="income-credited-to" value={incomeForm.accountId}
                                onChange={event => setIncomeForm(form => ({ ...form, accountId: event.target.value }))}>
                                <AccountOptions accounts={usable(accounts, 'income')} />
                            </select>
                        </div>
                        <div className="field">
                            <label htmlFor="income-date">Date</label>
                            <input type="date" id="income-date" value={incomeForm.date}
                                onChange={event => setIncomeForm(form => ({ ...form, date: event.target.value }))} />
                        </div>
                        <div className="field">
                            <label htmlFor="income-category">Category</label>
                            <select id="income-category" value={incomeForm.categoryId}
                                onChange={event => setIncomeForm(form => ({ ...form, categoryId: event.target.value, categoryChosen: true }))}>
                                <CategoryOptions categories={categories} kind="income" />
                            </select>
                        </div>
                        <div className="field">
                            <label htmlFor="income-tags">Tags (optional)</label>
                            <input type="text" id="income-tags" placeholder="bonus, 2026" value={incomeForm.tags}
                                onChange={event => setIncomeForm(form => ({ ...form, tags: event.target.value }))} />
                        </div>
                        <div className="field">
                            <label htmlFor="income-event">Event (optional)</label>
                            <select id="income-event" value={incomeForm.eventId} onChange={event => chooseEvent('income', event.target.value)}>
                                <EventOptions events={events} />
                            </select>
                        </div>
                    </div>
                    <button type="submit" className="btn btn-primary" data-action="addIncome"><Plus aria-hidden="true" /> Add income</button>
                </form>
                <form id="expense-form" className={`card entry-form expense${showExpenses ? '' : ' hidden'}`} onSubmit={event => { event.preventDefault(); addExpense(); }}>
                    <h3><span className="icon-tile t-expense" aria-hidden="true"><TrendingDown /></span>Add expense</h3>
                    <div className="form-grid two">
                        <div className="field">
                            <label htmlFor="expense-title">What for</label>
                            <input type="text" id="expense-title" placeholder="Groceries, rent..." value={expenseForm.title}
                                onChange={event => setExpenseForm(form => ({ ...form, title: event.target.value }))}
                                onBlur={event => suggest('expense', event.target.value)} />
                        </div>
                        <div className="field">
                            <label htmlFor="expense-amount">Amount (₹)</label>
                            <input type="number" id="expense-amount" inputMode="decimal" placeholder="0.00" step="0.01" value={expenseForm.amount}
                                onChange={event => setExpenseForm(form => ({ ...form, amount: event.target.value }))} />
                        </div>
                        <div className="field">
                            <label htmlFor="expense-payment-method">Paid from</label>
                            <select id="expense-payment-method" value={expenseForm.accountId}
                                onChange={event => setExpenseForm(form => ({ ...form, accountId: event.target.value }))}>
                                <AccountOptions accounts={accounts} />
                            </select>
                        </div>
                        <div className="field">
                            <label htmlFor="expense-date">Date</label>
                            <input type="date" id="expense-date" value={expenseForm.date}
                                onChange={event => setExpenseForm(form => ({ ...form, date: event.target.value }))} />
                        </div>
                        <div className="field">
                            <label htmlFor="expense-category">Category</label>
                            <select id="expense-category" value={expenseForm.categoryId}
                                onChange={event => setExpenseForm(form => ({ ...form, categoryId: event.target.value, categoryChosen: true }))}>
                                <CategoryOptions categories={categories} kind="expense" />
                            </select>
                        </div>
                        <div className="field">
                            <label htmlFor="expense-tags">Tags (optional)</label>
                            <input type="text" id="expense-tags" placeholder="goa trip, work" value={expenseForm.tags}
                                onChange={event => setExpenseForm(form => ({ ...form, tags: event.target.value }))} />
                        </div>
                        <div className="field">
                            <label htmlFor="expense-event">Event (optional)</label>
                            <select id="expense-event" value={expenseForm.eventId} onChange={event => chooseEvent('expense', event.target.value)}>
                                <EventOptions events={events} />
                            </select>
                        </div>
                    </div>
                    <button type="submit" className="btn btn-primary" data-action="addExpense"><Plus aria-hidden="true" /> Add expense</button>
                </form>
                <form id="transfer-form" className="card entry-form transfer" onSubmit={event => { event.preventDefault(); addTransfer(); }}>
                    <h3><span className="icon-tile t-bank" aria-hidden="true"><ArrowLeftRight /></span>Move money</h3>
                    <p className="form-note">Between your own accounts: an ATM withdrawal, a card bill payment, topping up a wallet. Not income or spending.</p>
                    <div className="form-grid two">
                        <div className="field">
                            <label htmlFor="transfer-from">From</label>
                            <select id="transfer-from" value={transferForm.fromId}
                                onChange={event => setTransferForm(form => ({ ...form, fromId: event.target.value }))}>
                                <AccountOptions accounts={accounts} />
                            </select>
                        </div>
                        <div className="field">
                            <label htmlFor="transfer-to">To</label>
                            <select id="transfer-to" value={transferForm.toId}
                                onChange={event => setTransferForm(form => ({ ...form, toId: event.target.value }))}>
                                <AccountOptions accounts={accounts} />
                            </select>
                        </div>
                        <div className="field">
                            <label htmlFor="transfer-amount">Amount (₹)</label>
                            <input type="number" id="transfer-amount" inputMode="decimal" placeholder="0.00" step="0.01" value={transferForm.amount}
                                onChange={event => setTransferForm(form => ({ ...form, amount: event.target.value }))} />
                        </div>
                        <div className="field">
                            <label htmlFor="transfer-date">Date</label>
                            <input type="date" id="transfer-date" value={transferForm.date}
                                onChange={event => setTransferForm(form => ({ ...form, date: event.target.value }))} />
                        </div>
                        <div className="field span-2">
                            <label htmlFor="transfer-note">Note (optional)</label>
                            <input type="text" id="transfer-note" placeholder="ATM withdrawal, card bill..." value={transferForm.note}
                                onChange={event => setTransferForm(form => ({ ...form, note: event.target.value }))} />
                        </div>
                        <div className="field span-2">
                            <label htmlFor="transfer-event">Event (optional)</label>
                            <select id="transfer-event" value={transferForm.eventId} onChange={event => chooseEvent('transfer', event.target.value)}>
                                <EventOptions events={events} />
                            </select>
                        </div>
                    </div>
                    <button type="submit" className="btn btn-primary" data-action="addTransfer"><ArrowLeftRight aria-hidden="true" /> Move money</button>
                </form>
            </div>
            <div id="transactions-message" className={formMessage.message?.kind ?? 'error'} role="status">{formMessage.message?.text ?? ''}</div>

            <div id="bulk-categorise" className="bulk-bar" hidden={selected.size === 0}>
                <span>{selected.size} selected</span>
                <label htmlFor="bulk-category" className="sr-only">Category</label>
                <select id="bulk-category" value={bulkCategory} onChange={event => setBulkCategory(event.target.value)}>
                    <option value="">Choose a category</option>
                    <optgroup label="Spending"><CategoryOptions categories={categories} kind="expense" /></optgroup>
                    <optgroup label="Income"><CategoryOptions categories={categories} kind="income" /></optgroup>
                </select>
                <button type="button" className="btn btn-primary btn-sm" data-action="bulkCategorise" onClick={categoriseSelected}>Put in category</button>
                <button type="button" className="btn btn-secondary btn-sm" data-action="clearSelection" onClick={() => setSelected(new Set())}>Clear</button>
            </div>

            <div id="transactions-history" className="histories">
                <section id="income-history" className="card" style={{ display: showIncome ? undefined : 'none' }} aria-labelledby="income-history-title">
                    <div className="card-head">
                        <h3 id="income-history-title">Income</h3>
                        <span className="meta">{periodName}</span>
                    </div>
                    <div className="table-wrap scrollable-table">
                        <table className="data-table stackable">
                            <thead>
                                <tr><th scope="col">Date</th><th scope="col">Source</th><th scope="col" className="amount">Amount</th><th scope="col">Received in</th><th scope="col" className="actions"><span className="sr-only">Actions</span></th></tr>
                            </thead>
                            <tbody id="income-table-body">
                                {incomes.length === 0 ? <EmptyRow text="No income transactions found for this period" /> : incomes.map(entry => (
                                    <tr key={entry.id}>
                                        <td className="sub" data-label="Date">{shortDate(entry.date)}</td>
                                        <td className="name">
                                            <label className="select-entry">
                                                <input type="checkbox" data-action="select-entry" data-id={entry.id} checked={selected.has(entry.id)}
                                                    onChange={() => toggleSelected(entry.id)} aria-label={`Select ${entry.description}`} />
                                                {entry.description}
                                            </label>
                                            <EntryMeta entry={entry} />
                                        </td>
                                        <td className="amount in" data-label="Amount">{formatRupees(entry.amount)}</td>
                                        <td className="sub" data-label="Received in">{entry.account.name}</td>
                                        <td className="actions">{rowActions(entry)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
                <section id="expense-history" className="card" style={{ display: showExpenses ? undefined : 'none' }} aria-labelledby="expense-history-title">
                    <div className="card-head">
                        <h3 id="expense-history-title">Expenses</h3>
                        <span className="meta">{periodName}</span>
                    </div>
                    <div className="table-wrap scrollable-table">
                        <table className="data-table stackable">
                            <thead>
                                <tr><th scope="col">Date</th><th scope="col">What for</th><th scope="col" className="amount">Amount</th><th scope="col">Paid from</th><th scope="col" className="actions"><span className="sr-only">Actions</span></th></tr>
                            </thead>
                            <tbody id="expense-table-body">
                                {expenses.length === 0 ? <EmptyRow text="No expense transactions found for this period" /> : expenses.map(entry => (
                                    <tr key={entry.id}>
                                        <td className="sub" data-label="Date">{shortDate(entry.date)}</td>
                                        <td className="name">
                                            <label className="select-entry">
                                                <input type="checkbox" data-action="select-entry" data-id={entry.id} checked={selected.has(entry.id)}
                                                    onChange={() => toggleSelected(entry.id)} aria-label={`Select ${entry.description}`} />
                                                {entry.description}
                                            </label>
                                            <EntryMeta entry={entry} />
                                        </td>
                                        <td className="amount out" data-label="Amount">{formatRupees(entry.amount)}</td>
                                        <td className="sub" data-label="Paid from">{entry.account.name}</td>
                                        <td className="actions">{rowActions(entry)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
                <section id="transfer-history" className="card" aria-labelledby="transfer-history-title">
                    <div className="card-head">
                        <h3 id="transfer-history-title">Money moved</h3>
                        <span className="meta">{periodName}</span>
                    </div>
                    <div className="table-wrap scrollable-table">
                        <table className="data-table stackable">
                            <thead>
                                <tr><th scope="col">Date</th><th scope="col">Note</th><th scope="col" className="amount">Amount</th><th scope="col">From and to</th><th scope="col" className="actions"><span className="sr-only">Actions</span></th></tr>
                            </thead>
                            <tbody id="transfer-table-body">
                                {transfers.length === 0 ? <EmptyRow text="No money moved between your accounts in this period" /> : transfers.map(entry => (
                                    <tr key={entry.id}>
                                        <td className="sub" data-label="Date">{shortDate(entry.date)}</td>
                                        <td className="name">{entry.description}<EntryMeta entry={entry} /></td>
                                        <td className="amount" data-label="Amount">{formatRupees(entry.amount)}</td>
                                        <td className="sub" data-label="From and to">
                                            {entry.account.name} <ArrowRight size={14} aria-label="to" /> {entry.toAccount?.name ?? ''}
                                        </td>
                                        <td className="actions">{rowActions(entry)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>

            <Modal id={`edit-${edit?.type ?? 'income'}-modal`} title={`Edit ${(edit?.type ?? 'income') === 'transfer' ? 'transfer' : edit?.type ?? 'income'}`}
                open={edit !== null} closeAction={`close-edit-${edit?.type ?? 'income'}`} onClose={() => setEdit(null)}
                footer={(
                    <>
                        <button type="button" data-action={`close-edit-${edit?.type ?? 'income'}`} className="btn btn-secondary" onClick={() => setEdit(null)}>Cancel</button>
                        <button type="button" data-action={`save-${edit?.type ?? 'income'}-edit`} className="btn btn-primary" onClick={saveEdit}>Save changes</button>
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
                            <label htmlFor={`edit-${edit.type}-amount`}>Amount (₹)</label>
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
                                <label htmlFor="edit-transfer-to">To</label>
                                <select id="edit-transfer-to" required value={edit.toAccountId}
                                    onChange={event => setEdit(draft => draft && { ...draft, toAccountId: event.target.value })}>
                                    <AccountOptions accounts={accounts} />
                                </select>
                            </div>
                        ) : null}
                        {edit.type !== 'transfer' ? (
                            <div className="field">
                                <label htmlFor={`edit-${edit.type}-category`}>Category</label>
                                <select id={`edit-${edit.type}-category`} value={edit.categoryId}
                                    onChange={event => setEdit(draft => draft && { ...draft, categoryId: event.target.value })}>
                                    <CategoryOptions categories={categories} kind={edit.type} />
                                </select>
                            </div>
                        ) : null}
                        <div className="field">
                            <label htmlFor={`edit-${edit.type}-event`}>Event</label>
                            <select id={`edit-${edit.type}-event`} value={edit.eventId} onChange={event => chooseEvent('edit', event.target.value)}>
                                <EventOptions events={events} />
                            </select>
                        </div>
                        <div className="field">
                            <label htmlFor={`edit-${edit.type}-tags`}>Tags</label>
                            <input type="text" id={`edit-${edit.type}-tags`} value={edit.tags}
                                onChange={event => setEdit(draft => draft && { ...draft, tags: event.target.value })} />
                        </div>
                        <div className="field">
                            <label htmlFor={`edit-${edit.type}-date`}>Date</label>
                            <input type="date" id={`edit-${edit.type}-date`} required value={edit.date}
                                onChange={event => setEdit(draft => draft && { ...draft, date: event.target.value })} />
                        </div>
                    </div>
                ) : null}
            </Modal>

            <Modal id="new-event-modal" title="New event" small open={newEvent !== null} closeAction="close-new-event" onClose={() => setNewEvent(null)}
                footer={(
                    <>
                        <button type="button" data-action="close-new-event" className="btn btn-secondary" onClick={() => setNewEvent(null)}>Cancel</button>
                        <button type="button" data-action="save-new-event" className="btn btn-primary" onClick={createEvent}>Add event</button>
                    </>
                )}>
                <div className="form-grid">
                    <div className="field">
                        <label htmlFor="new-event-name">Name</label>
                        <input type="text" id="new-event-name" maxLength={80} placeholder="Goa trip, Diwali 2026..." value={newEvent?.name ?? ''}
                            onChange={event => setNewEvent(current => current && { ...current, name: event.target.value })} />
                    </div>
                    <label className="check-line">
                        <input type="checkbox" id="new-event-one-off" checked={newEvent?.oneOff ?? true}
                            onChange={event => setNewEvent(current => current && { ...current, oneOff: event.target.checked })} />
                        A one-off: leave it out of regular spending
                    </label>
                    <p className="form-note">Dates and a budget can be added on the Events screen.</p>
                </div>
            </Modal>

            <Modal id="delete-confirmation-modal" title="Delete this entry?" small open={pendingDelete !== null} closeAction="close-delete"
                onClose={() => setPendingDelete(null)}
                footer={(
                    <>
                        <button type="button" data-action="close-delete" className="btn btn-secondary" onClick={() => setPendingDelete(null)}>Cancel</button>
                        <button type="button" data-action="confirm-delete" className="btn btn-danger" onClick={confirmDelete}>
                            <Trash2 aria-hidden="true" /> Delete
                        </button>
                    </>
                )}>
                <p id="delete-confirmation-message" className="lead">
                    {pendingDelete ? (
                        <>
                            Are you sure you want to delete this {pendingDelete.type} transaction?<br />
                            <span className="sub">
                                {descriptionLabel(pendingDelete.type) === 'What for' ? 'Title' : descriptionLabel(pendingDelete.type)}: {pendingDelete.description}
                                <br />Amount: {formatRupees(pendingDelete.amount)}
                            </span>
                        </>
                    ) : 'Are you sure you want to delete this transaction?'}
                </p>
                <p>This cannot be undone. The account balance is adjusted back.</p>
            </Modal>
        </div>
    );
}
