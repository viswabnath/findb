'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCheck, Scale } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { apiDelete, apiGet, apiPost, httpError, redirectIfUnauthorized } from '@/lib/api-client';
import { todayUtcIso } from '@/lib/dates';
import { formatRupees } from '@/lib/format';
import { t } from '@/lib/i18n';

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
        if (!form.accountId || form.statementBalance === '') return toast('error', t('reconcile.need'));
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
        toast('success', t('reconcile.matches', { account: current.account.name, date: day(current.statementDate) }));
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
                    <h2>{t('reconcile.title')}</h2>
                    <p>{t('reconcile.subtitle')}</p>
                </div>
            </div>
            <section className="card" aria-labelledby="statement-title">
                <div className="card-head">
                    <h3 id="statement-title"><span className="icon-tile t-bank" aria-hidden="true"><Scale /></span>{t('reconcile.statement')}</h3>
                </div>
                <form className="add-row other-add-row" onSubmit={event => { event.preventDefault(); start(); }}>
                    <div className="field">
                        <label htmlFor="reconcile-account">{t('reconcile.account')}</label>
                        <select id="reconcile-account" value={form.accountId}
                            onChange={event => { setForm(value => ({ ...value, accountId: event.target.value })); loadHistory(event.target.value); }}>
                            {accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
                        </select>
                    </div>
                    <div className="field">
                        <label htmlFor="reconcile-date">{t('reconcile.date')}</label>
                        <input type="date" id="reconcile-date" value={form.statementDate} onChange={event => setForm(value => ({ ...value, statementDate: event.target.value }))} />
                    </div>
                    <div className="field">
                        <label htmlFor="reconcile-balance">{isCard ? t('reconcile.owed') : t('reconcile.balance')}</label>
                        <input type="number" id="reconcile-balance" inputMode="decimal" step="0.01" value={form.statementBalance}
                            onChange={event => setForm(value => ({ ...value, statementBalance: event.target.value }))} />
                    </div>
                    <button type="submit" className="btn btn-primary" data-action="startReconcile">{current ? t('reconcile.update') : t('reconcile.start')}</button>
                </form>
            </section>

            {current ? (
                <section id="reconcile-current" className="card" aria-labelledby="current-title">
                    <div className="card-head">
                        <h3 id="current-title">{t('reconcile.current', { account: current.account.name, date: day(current.statementDate) })}</h3>
                        <span className={`meta${difference === 0 ? ' ok' : ''}`} id="reconcile-difference">
                            {difference === 0 ? t('reconcile.noDifference') : t('reconcile.difference', { amount: formatRupees(current.difference) })}
                        </span>
                    </div>
                    <p className="card-pad form-note">
                        {t('reconcile.cleared', { statement: formatRupees(current.statementBalance), cleared: formatRupees(current.clearedBalance) })}
                        {parseFloat(current.previouslyCleared) !== 0 ? t('reconcile.earlier', { amount: formatRupees(current.previouslyCleared) }) : ''}
                        {t('reconcile.tickNote')}
                    </p>
                    <ul id="reconcile-lines" className="settings-list">
                        {current.lines.length === 0 ? <li>{t('reconcile.noLines')}</li> : current.lines.map(line => (
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
                            <CheckCheck aria-hidden="true" /> {t('reconcile.finish')}
                        </button>
                        {difference !== 0 ? (
                            <button type="button" className="btn btn-secondary" data-action="adjustReconcile" onClick={() => finish(true)}>
                                {t('reconcile.adjust')}
                            </button>
                        ) : null}
                        <button type="button" className="btn btn-secondary" data-action="cancelReconcile" onClick={cancel}>{t('common.cancel')}</button>
                    </div>
                </section>
            ) : null}

            {history.filter(item => item.status === 'done').length > 0 ? (
                <section className="card" aria-labelledby="reconcile-history-title">
                    <div className="card-head"><h3 id="reconcile-history-title">{t('reconcile.history')}</h3></div>
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
