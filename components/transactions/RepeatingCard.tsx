'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Pause, Play, Plus, Repeat, SkipForward, Trash2 } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { apiDelete, apiGet, apiPost, apiPut, httpError, redirectIfUnauthorized } from '@/lib/api-client';
import { MONTH_NAMES, todayUtcIso } from '@/lib/dates';
import { formatRupees } from '@/lib/format';

/**
 * Repeating entries (/api/recurring): salary, rent, EMIs, SIPs, subscriptions. Shows what is due
 * to confirm (with its amount, which can be changed) or skip, the list of repeating entries, and a
 * form to add one. Automatic ones are recorded when FinDB opens (AppShell runs /api/recurring/run).
 */

type Kind = 'income' | 'expense' | 'transfer';
interface Account { id: number; type: string; name: string }
interface Category { id: number; kind: 'income' | 'expense'; name: string }
interface Repeating {
    id: number; type: Kind; description: string; amount: string; account: { id: number; name: string }; toAccount: { id: number; name: string } | null;
    category: { id: number; name: string } | null; frequency: 'daily' | 'weekly' | 'monthly' | 'yearly'; dayOfWeek: number | null;
    dayOfMonth: number | null; month: number | null; nextDue: string | null; mode: 'auto' | 'confirm'; paused: boolean; endsOn: string | null;
}
interface DueItem { recurringId: number; type: Kind; description: string; amount: string; date: string; account: string; mode: string }

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const day = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

function schedule(item: Repeating): string {
    switch (item.frequency) {
    case 'daily': return 'Every day';
    case 'weekly': return `Every ${WEEKDAYS[item.dayOfWeek ?? 0]}`;
    case 'monthly': return `Every month on the ${item.dayOfMonth}${item.dayOfMonth === 31 ? ' (or the last day)' : ''}`;
    default: return `Every year on ${item.dayOfMonth} ${MONTH_NAMES[(item.month ?? 1) - 1]}`;
    }
}

interface Draft {
    type: Kind; description: string; amount: string; accountId: string; toAccountId: string; categoryId: string;
    frequency: Repeating['frequency']; dayOfWeek: string; dayOfMonth: string; month: string; startsOn: string; endsOn: string;
    mode: 'auto' | 'confirm'; remindDays: string;
}

export function RepeatingCard({ accounts, categories, onRecorded }: { accounts: Account[]; categories: Category[]; onRecorded: () => void }) {
    const toast = useToast();
    const [items, setItems] = useState<Repeating[]>([]);
    const [pending, setPending] = useState<DueItem[]>([]);
    const [amounts, setAmounts] = useState<Record<number, string>>({});
    const [draft, setDraft] = useState<Draft | null>(null);

    const load = useCallback(async () => {
        const [list, due] = await Promise.all([
            apiGet<Repeating[]>('/api/recurring'),
            apiPost<{ pending: DueItem[] }>('/api/recurring/run', {}),
        ]);
        if (redirectIfUnauthorized(list) || redirectIfUnauthorized(due)) return;
        if (list.ok) setItems(list.data);
        if (due.ok) setPending(due.data.pending);
    }, []);

    useEffect(() => {
        load();
        // Once on page load; the buttons reload afterwards
    }, []);

    function startNew() {
        const today = todayUtcIso();
        const cash = accounts.find(account => account.type === 'cash') ?? accounts[0];
        setDraft({
            type: 'expense', description: '', amount: '', accountId: String(cash?.id ?? ''), toAccountId: '', categoryId: '',
            frequency: 'monthly', dayOfWeek: '1', dayOfMonth: String(Number(today.slice(8, 10))), month: String(Number(today.slice(5, 7))),
            startsOn: today, endsOn: '', mode: 'confirm', remindDays: '3',
        });
    }

    async function save() {
        if (!draft) return;
        const body = {
            type: draft.type, description: draft.description, amount: draft.amount, accountId: Number(draft.accountId),
            toAccountId: draft.type === 'transfer' ? Number(draft.toAccountId) : undefined,
            categoryId: draft.type !== 'transfer' && draft.categoryId ? Number(draft.categoryId) : undefined,
            frequency: draft.frequency, dayOfWeek: Number(draft.dayOfWeek), dayOfMonth: Number(draft.dayOfMonth), month: Number(draft.month),
            startsOn: draft.startsOn, endsOn: draft.endsOn || undefined, mode: draft.mode, remindDays: Number(draft.remindDays),
        };
        const result = await apiPost('/api/recurring', body);
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        toast('success', 'Repeating entry added');
        setDraft(null);
        await load();
        onRecorded();
    }

    async function confirm(item: DueItem) {
        const amount = amounts[item.recurringId] ?? item.amount;
        const result = await apiPost(`/api/recurring/${item.recurringId}/confirm`, { date: item.date, amount });
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        toast('success', `${item.description} recorded for ${day(item.date)}`);
        setAmounts(current => ({ ...current, [item.recurringId]: '' }));
        await load();
        onRecorded();
    }

    async function skip(item: DueItem) {
        const result = await apiPost(`/api/recurring/${item.recurringId}/skip`, { date: item.date });
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        toast('info', `${item.description} skipped for ${day(item.date)}`);
        await load();
    }

    async function setPaused(item: Repeating, paused: boolean) {
        const result = await apiPut(`/api/recurring/${item.id}`, { paused });
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        await load();
    }

    async function remove(item: Repeating) {
        const result = await apiDelete(`/api/recurring/${item.id}`);
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        toast('success', `${item.description} no longer repeats; the entries it made stay`);
        await load();
    }

    const set = (changes: Partial<Draft>) => setDraft(current => current && { ...current, ...changes });
    const usableAccounts = draft?.type === 'income' ? accounts.filter(account => account.type !== 'credit_card') : accounts;

    return (
        <section id="repeating-section" className="card" aria-labelledby="repeating-title">
            <div className="card-head">
                <h3 id="repeating-title"><span className="icon-tile t-bank" aria-hidden="true"><Repeat /></span>Repeating</h3>
                <button type="button" className="btn btn-secondary btn-sm" data-action="newRepeating" onClick={startNew}><Plus aria-hidden="true" /> Add repeating</button>
            </div>
            {pending.length > 0 ? (
                <>
                    <h4 className="settings-subhead">Due now</h4>
                    <ul id="repeating-due" className="settings-list">
                        {pending.map(item => (
                            <li key={`${item.recurringId}-${item.date}`} data-recurring={item.recurringId}>
                                <div>
                                    <span className="what">{item.description}</span>
                                    <div className="when">{day(item.date)}, {item.account}</div>
                                </div>
                                <span className="row-actions">
                                    <label className="sr-only" htmlFor={`due-amount-${item.recurringId}-${item.date}`}>Amount</label>
                                    <input type="number" className="due-amount" id={`due-amount-${item.recurringId}-${item.date}`} inputMode="decimal" step="0.01" min="0"
                                        value={amounts[item.recurringId] || item.amount}
                                        onChange={event => setAmounts(current => ({ ...current, [item.recurringId]: event.target.value }))} />
                                    <button type="button" className="btn btn-primary btn-sm" data-action="confirmDue" onClick={() => confirm(item)}><Check aria-hidden="true" /> Record</button>
                                    <button type="button" className="btn btn-secondary btn-sm" data-action="skipDue" onClick={() => skip(item)}><SkipForward aria-hidden="true" /> Skip</button>
                                </span>
                            </li>
                        ))}
                    </ul>
                </>
            ) : null}
            <ul id="repeating-list" className="settings-list">
                {items.length === 0 ? <li>Nothing repeats yet. Add your salary, rent or subscriptions, and FinDB records or reminds you of them.</li> : items.map(item => (
                    <li key={item.id} data-repeating={item.id} className={item.paused ? 'paused' : undefined}>
                        <div>
                            <span className="what">{item.description} <span className="sub">{formatRupees(item.amount)}</span></span>
                            <div className="when">
                                {schedule(item)}; {item.mode === 'auto' ? 'recorded automatically' : 'you confirm each'};{' '}
                                {item.paused ? 'paused' : item.nextDue ? `next ${day(item.nextDue)}` : 'ended'}
                            </div>
                        </div>
                        <span className="row-actions">
                            <button type="button" className="icon-btn" data-action={item.paused ? 'resumeRepeating' : 'pauseRepeating'} onClick={() => setPaused(item, !item.paused)}>
                                {item.paused ? <><Play aria-hidden="true" /> Resume</> : <><Pause aria-hidden="true" /> Pause</>}
                            </button>
                            <button type="button" className="icon-btn danger" data-action="deleteRepeating" onClick={() => remove(item)}><Trash2 aria-hidden="true" /> Delete</button>
                        </span>
                    </li>
                ))}
            </ul>

            <Modal id="repeating-modal" title="Add a repeating entry" open={draft !== null} closeAction="close-repeating" onClose={() => setDraft(null)}
                footer={(
                    <>
                        <button type="button" data-action="close-repeating" className="btn btn-secondary" onClick={() => setDraft(null)}>Cancel</button>
                        <button type="button" data-action="save-repeating" className="btn btn-primary" onClick={save}>Save</button>
                    </>
                )}>
                {draft ? (
                    <form className="form-grid two" onSubmit={event => { event.preventDefault(); save(); }}>
                        <div className="field">
                            <label htmlFor="repeating-type">Kind</label>
                            <select id="repeating-type" value={draft.type} onChange={event => set({ type: event.target.value as Kind, categoryId: '' })}>
                                <option value="expense">Expense</option>
                                <option value="income">Income</option>
                                <option value="transfer">Money moved</option>
                            </select>
                        </div>
                        <div className="field">
                            <label htmlFor="repeating-amount">Amount (₹)</label>
                            <input type="number" id="repeating-amount" inputMode="decimal" step="0.01" min="0" value={draft.amount} onChange={event => set({ amount: event.target.value })} />
                        </div>
                        <div className="field span-2">
                            <label htmlFor="repeating-description">What it is</label>
                            <input type="text" id="repeating-description" placeholder="Salary, rent, Netflix..." maxLength={200} value={draft.description}
                                onChange={event => set({ description: event.target.value })} />
                        </div>
                        <div className="field">
                            <label htmlFor="repeating-account">{draft.type === 'income' ? 'Received in' : draft.type === 'expense' ? 'Paid from' : 'From'}</label>
                            <select id="repeating-account" value={draft.accountId} onChange={event => set({ accountId: event.target.value })}>
                                {usableAccounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
                            </select>
                        </div>
                        {draft.type === 'transfer' ? (
                            <div className="field">
                                <label htmlFor="repeating-to">To</label>
                                <select id="repeating-to" value={draft.toAccountId} onChange={event => set({ toAccountId: event.target.value })}>
                                    <option value="">Choose</option>
                                    {accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
                                </select>
                            </div>
                        ) : (
                            <div className="field">
                                <label htmlFor="repeating-category">Category</label>
                                <select id="repeating-category" value={draft.categoryId} onChange={event => set({ categoryId: event.target.value })}>
                                    <option value="">{draft.type === 'income' ? 'Other income' : 'Uncategorised'}</option>
                                    {categories.filter(category => category.kind === draft.type).map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
                                </select>
                            </div>
                        )}
                        <div className="field">
                            <label htmlFor="repeating-frequency">Repeats</label>
                            <select id="repeating-frequency" value={draft.frequency} onChange={event => set({ frequency: event.target.value as Draft['frequency'] })}>
                                <option value="daily">Every day</option>
                                <option value="weekly">Every week</option>
                                <option value="monthly">Every month</option>
                                <option value="yearly">Every year</option>
                            </select>
                        </div>
                        {draft.frequency === 'weekly' ? (
                            <div className="field">
                                <label htmlFor="repeating-weekday">On</label>
                                <select id="repeating-weekday" value={draft.dayOfWeek} onChange={event => set({ dayOfWeek: event.target.value })}>
                                    {WEEKDAYS.map((name, index) => <option key={name} value={index}>{name}</option>)}
                                </select>
                            </div>
                        ) : null}
                        {draft.frequency === 'yearly' ? (
                            <div className="field">
                                <label htmlFor="repeating-month">Month</label>
                                <select id="repeating-month" value={draft.month} onChange={event => set({ month: event.target.value })}>
                                    {MONTH_NAMES.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
                                </select>
                            </div>
                        ) : null}
                        {draft.frequency === 'monthly' || draft.frequency === 'yearly' ? (
                            <div className="field">
                                <label htmlFor="repeating-day">Day of the month</label>
                                <input type="number" id="repeating-day" min="1" max="31" value={draft.dayOfMonth} onChange={event => set({ dayOfMonth: event.target.value })} />
                            </div>
                        ) : null}
                        <div className="field">
                            <label htmlFor="repeating-starts">From</label>
                            <input type="date" id="repeating-starts" value={draft.startsOn} onChange={event => set({ startsOn: event.target.value })} />
                        </div>
                        <div className="field">
                            <label htmlFor="repeating-ends">Until (optional)</label>
                            <input type="date" id="repeating-ends" value={draft.endsOn} onChange={event => set({ endsOn: event.target.value })} />
                        </div>
                        <div className="field">
                            <label htmlFor="repeating-mode">When it falls due</label>
                            <select id="repeating-mode" value={draft.mode} onChange={event => set({ mode: event.target.value as Draft['mode'] })}>
                                <option value="confirm">Ask me to confirm it</option>
                                <option value="auto">Record it automatically</option>
                            </select>
                        </div>
                        <div className="field">
                            <label htmlFor="repeating-remind">Remind me (days before)</label>
                            <input type="number" id="repeating-remind" min="0" max="30" value={draft.remindDays} onChange={event => set({ remindDays: event.target.value })} />
                        </div>
                    </form>
                ) : null}
            </Modal>
        </section>
    );
}
