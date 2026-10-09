'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCheck, Scale } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { apiDelete, apiGet, apiPost, httpError, redirectIfUnauthorized } from '@/lib/api-client';
import { todayUtcIso } from '@/lib/dates';
import { formatRupees } from '@/lib/format';

/**
 * Reconcile an account against a statement (/api/reconciliations): enter the balance the statement
 * shows on a date, tick the entries that appear on it, and finish when nothing is left over. For a
 * credit card, the statement balance is the amount owed.
 */

interface Account { id: number; type: string; name: string }
interface Line { lineId: number; entryId: number; date: string; description: string; amount: string; ticked: boolean }
interface Reconciliation {
    id: number; account: { id: number; name: string; type: string }; statementDate: string; statementBalance: string; status: 'open' | 'done';
    previouslyCleared: string; clearedBalance: string; difference: string; lines: Line[]; completedAt: string | null;
}

const day = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export function ReconcileScreen() {
    const toast = useToast();
    const [accounts, setAccounts] = useState<Account[] | null>(null);
    const [form, setForm] = useState({ accountId: '', statementDate: todayUtcIso(), statementBalance: '' });
    const [current, setCurrent] = useState<Reconciliation | null>(null);
    const [history, setHistory] = useState<Omit<Reconciliation, 'lines'>[]>([]);

    const loadHistory = useCallback(async (accountId: string) => {
        if (!accountId) return;
        const result = await apiGet<Omit<Reconciliation, 'lines'>[]>(`/api/reconciliations?accountId=${accountId}`);
        if (redirectIfUnauthorized(result) || !result.ok) return;
        setHistory(result.data);
        const open = result.data.find(item => item.status === 'open');
        if (open) {
            const detail = await apiGet<Reconciliation>(`/api/reconciliations/${open.id}`);
            if (detail.ok) setCurrent(detail.data);
        } else {
            setCurrent(null);
        }
    }, []);

    useEffect(() => {
        (async () => {
            const result = await apiGet<Account[]>('/api/accounts');
            if (redirectIfUnauthorized(result) || !result.ok) return;
            setAccounts(result.data);
            const wanted = new URLSearchParams(window.location.search).get('account');
            const first = String(result.data.find(account => String(account.id) === wanted)?.id ?? result.data.find(account => account.type === 'bank')?.id ?? result.data[0]?.id ?? '');
            setForm(value => ({ ...value, accountId: first }));
            await loadHistory(first);
        })();
        // Once on page load
    }, []);

    async function start() {
        if (!form.accountId || form.statementBalance === '') return toast('error', 'Choose the account and enter the statement balance');
        const result = await apiPost<Reconciliation>('/api/reconciliations', {
            accountId: Number(form.accountId), statementDate: form.statementDate, statementBalance: form.statementBalance,
        });
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        setCurrent(result.data);
        await loadHistory(form.accountId);
    }

    async function tick(line: Line) {
        if (!current) return;
        const result = await apiPost<Reconciliation>(`/api/reconciliations/${current.id}/tick`, { lineIds: [line.lineId], ticked: !line.ticked });
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        setCurrent(result.data);
    }

    async function finish(adjust: boolean) {
        if (!current) return;
        const result = await apiPost<Reconciliation>(`/api/reconciliations/${current.id}/finish`, { adjust });
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        toast('success', `${current.account.name} matches the statement of ${day(current.statementDate)}`);
        setCurrent(null);
        await loadHistory(form.accountId);
    }

    async function cancel() {
        if (!current) return;
        const result = await apiDelete(`/api/reconciliations/${current.id}`);
        if (redirectIfUnauthorized(result)) return;
        setCurrent(null);
        await loadHistory(form.accountId);
    }

    if (accounts === null) return null;
    const isCard = accounts.find(account => String(account.id) === form.accountId)?.type === 'credit_card';
    const difference = current ? parseFloat(current.difference) : 0;

    return (
        <div id="reconcile-section">
            <div className="page-header">
                <div>
                    <h2>Reconcile</h2>
                    <p>Check an account against its statement: tick the entries that appear on it until nothing is left over.</p>
                </div>
            </div>
            <section className="card" aria-labelledby="statement-title">
                <div className="card-head">
                    <h3 id="statement-title"><span className="icon-tile t-bank" aria-hidden="true"><Scale /></span>Statement</h3>
                </div>
                <form className="add-row other-add-row" onSubmit={event => { event.preventDefault(); start(); }}>
                    <div className="field">
                        <label htmlFor="reconcile-account">Account</label>
                        <select id="reconcile-account" value={form.accountId}
                            onChange={event => { setForm(value => ({ ...value, accountId: event.target.value })); loadHistory(event.target.value); }}>
                            {accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
                        </select>
                    </div>
                    <div className="field">
                        <label htmlFor="reconcile-date">Statement date</label>
                        <input type="date" id="reconcile-date" value={form.statementDate} onChange={event => setForm(value => ({ ...value, statementDate: event.target.value }))} />
                    </div>
                    <div className="field">
                        <label htmlFor="reconcile-balance">{isCard ? 'Amount owed on the statement (₹)' : 'Balance on the statement (₹)'}</label>
                        <input type="number" id="reconcile-balance" inputMode="decimal" step="0.01" value={form.statementBalance}
                            onChange={event => setForm(value => ({ ...value, statementBalance: event.target.value }))} />
                    </div>
                    <button type="submit" className="btn btn-primary" data-action="startReconcile">{current ? 'Update statement' : 'Start'}</button>
                </form>
            </section>

            {current ? (
                <section id="reconcile-current" className="card" aria-labelledby="current-title">
                    <div className="card-head">
                        <h3 id="current-title">{current.account.name}, statement of {day(current.statementDate)}</h3>
                        <span className={`meta${difference === 0 ? ' ok' : ''}`} id="reconcile-difference">
                            {difference === 0 ? 'No difference' : `Difference ${formatRupees(current.difference)}`}
                        </span>
                    </div>
                    <p className="card-pad form-note">
                        Statement {formatRupees(current.statementBalance)}; cleared {formatRupees(current.clearedBalance)}
                        {parseFloat(current.previouslyCleared) !== 0 ? ` (including ${formatRupees(current.previouslyCleared)} from earlier statements)` : ''}.
                        Tick each entry you can see on the statement.
                    </p>
                    <ul id="reconcile-lines" className="settings-list">
                        {current.lines.length === 0 ? <li>No entries on this account up to the statement date.</li> : current.lines.map(line => (
                            <li key={line.lineId} data-line={line.lineId}>
                                <label className="select-entry">
                                    <input type="checkbox" data-action="tickLine" checked={line.ticked} onChange={() => tick(line)} />
                                    <span>
                                        <span className="what">{line.description}</span>
                                        <span className="when"> {day(line.date)}</span>
                                    </span>
                                </label>
                                <span className={parseFloat(line.amount) >= 0 ? 'amount in' : 'amount out'}>{formatRupees(line.amount)}</span>
                            </li>
                        ))}
                    </ul>
                    <div className="settings-actions">
                        <button type="button" className="btn btn-primary" data-action="finishReconcile" disabled={difference !== 0} onClick={() => finish(false)}>
                            <CheckCheck aria-hidden="true" /> Finish
                        </button>
                        {difference !== 0 ? (
                            <button type="button" className="btn btn-secondary" data-action="adjustReconcile" onClick={() => finish(true)}>
                                Record the difference as an adjustment
                            </button>
                        ) : null}
                        <button type="button" className="btn btn-secondary" data-action="cancelReconcile" onClick={cancel}>Cancel</button>
                    </div>
                </section>
            ) : null}

            {history.filter(item => item.status === 'done').length > 0 ? (
                <section className="card" aria-labelledby="reconcile-history-title">
                    <div className="card-head"><h3 id="reconcile-history-title">Earlier statements</h3></div>
                    <ul id="reconcile-history" className="settings-list">
                        {history.filter(item => item.status === 'done').map(item => (
                            <li key={item.id}>
                                <span className="what">{day(item.statementDate)}</span>
                                <span>{formatRupees(item.statementBalance)}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}
        </div>
    );
}
