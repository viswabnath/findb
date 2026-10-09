'use client';

import { useCallback, useEffect, useState } from 'react';
import { HandCoins, Plus, Trash2 } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { apiDelete, apiGet, apiPost, httpError, redirectIfUnauthorized } from '@/lib/api-client';
import { todayUtcIso } from '@/lib/dates';
import { formatRupees } from '@/lib/format';

/**
 * Reimbursements (/api/reimbursements): expenses paid now that an employer, insurer or someone else
 * will pay back. Pending, they are money owed to you, not spending; closing one turns whatever was
 * not repaid into your own spending.
 */

interface Account { id: number; type: string; name: string }
interface Category { id: number; kind: 'income' | 'expense'; name: string }
interface Reimbursement {
    id: number; description: string; fromWhom: string | null; amount: string; received: string; outstanding: string; keptAsSpending: string;
    category: { id: number; name: string } | null; paidFrom: { id: number; name: string } | null; paidOn: string | null;
    status: 'pending' | 'partly repaid' | 'repaid' | 'closed';
}

const day = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export function ReimbursementsCard({ accounts, categories, onChange }: { accounts: Account[]; categories: Category[]; onChange: () => void }) {
    const toast = useToast();
    const [items, setItems] = useState<Reimbursement[]>([]);
    const [draft, setDraft] = useState<{ description: string; amount: string; accountId: string; date: string; fromWhom: string; categoryId: string } | null>(null);
    const [repay, setRepay] = useState<{ item: Reimbursement; amount: string; accountId: string; date: string; close: boolean } | null>(null);

    const load = useCallback(async () => {
        const result = await apiGet<Reimbursement[]>('/api/reimbursements');
        if (redirectIfUnauthorized(result) || !result.ok) return;
        setItems(result.data);
    }, []);

    useEffect(() => {
        load();
        // Once on page load; the buttons reload afterwards
    }, []);

    const firstBank = String(accounts.find(account => account.type === 'bank')?.id ?? accounts[0]?.id ?? '');

    async function add() {
        if (!draft) return;
        const result = await apiPost('/api/reimbursements', {
            description: draft.description, amount: draft.amount, accountId: Number(draft.accountId), date: draft.date,
            fromWhom: draft.fromWhom, categoryId: draft.categoryId ? Number(draft.categoryId) : undefined,
        });
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        toast('success', 'Added: owed back to you, not counted as spending');
        setDraft(null);
        await load();
        onChange();
    }

    async function saveRepayment() {
        if (!repay) return;
        const result = await apiPost(`/api/reimbursements/${repay.item.id}/repay`, {
            amount: repay.amount, accountId: Number(repay.accountId), date: repay.date, close: repay.close,
        });
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        toast('success', repay.close ? `${repay.item.description} closed` : 'Repayment recorded');
        setRepay(null);
        await load();
        onChange();
    }

    async function remove(item: Reimbursement) {
        const result = await apiDelete(`/api/reimbursements/${item.id}`);
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        toast('success', `${item.description} deleted`);
        await load();
        onChange();
    }

    const open = items.filter(item => item.status === 'pending' || item.status === 'partly repaid');
    const owed = open.reduce((sum, item) => sum + parseFloat(item.outstanding), 0);

    return (
        <section id="reimbursements-section" className="card" aria-labelledby="reimbursements-title">
            <div className="card-head">
                <h3 id="reimbursements-title"><span className="icon-tile t-income" aria-hidden="true"><HandCoins /></span>Owed back to you</h3>
                <span className="row-actions">
                    <span className="meta" id="reimbursements-owed">{formatRupees(owed)} to come back</span>
                    <button type="button" className="btn btn-secondary btn-sm" data-action="newReimbursement"
                        onClick={() => setDraft({ description: '', amount: '', accountId: firstBank, date: todayUtcIso(), fromWhom: '', categoryId: '' })}>
                        <Plus aria-hidden="true" /> Add
                    </button>
                </span>
            </div>
            <p className="card-pad form-note">
                A hotel on a work trip, a medical bill the insurer will refund: paid by you, but not your spending while it is owed back.
            </p>
            <ul id="reimbursements-list" className="settings-list">
                {items.length === 0 ? <li>Nothing owed back to you.</li> : items.map(item => (
                    <li key={item.id} data-reimbursement={item.id}>
                        <div>
                            <span className="what">{item.description}{item.fromWhom ? <span className="sub"> from {item.fromWhom}</span> : null}</span>
                            <div className="when">
                                {formatRupees(item.amount)} paid{item.paidOn ? ` ${day(item.paidOn)}` : ''}{item.paidFrom ? ` from ${item.paidFrom.name}` : ''};{' '}
                                {item.status === 'pending' ? 'nothing back yet'
                                    : item.status === 'partly repaid' ? `${formatRupees(item.received)} back, ${formatRupees(item.outstanding)} to come`
                                        : item.status === 'repaid' ? 'repaid in full'
                                            : `closed: ${formatRupees(item.received)} back, ${formatRupees(item.keptAsSpending)} counted as your spending`}
                            </div>
                        </div>
                        {item.status === 'pending' || item.status === 'partly repaid' ? (
                            <span className="row-actions">
                                <button type="button" className="btn btn-primary btn-sm" data-action="repay"
                                    onClick={() => setRepay({ item, amount: item.outstanding, accountId: String(item.paidFrom?.id ?? firstBank), date: todayUtcIso(), close: false })}>
                                    Money came back
                                </button>
                                {item.status === 'pending' ? (
                                    <button type="button" className="icon-btn danger" data-action="deleteReimbursement" onClick={() => remove(item)}><Trash2 aria-hidden="true" /> Delete</button>
                                ) : null}
                            </span>
                        ) : null}
                    </li>
                ))}
            </ul>

            <Modal id="reimbursement-modal" title="Paid now, to be paid back" open={draft !== null} closeAction="close-reimbursement" onClose={() => setDraft(null)}
                footer={(
                    <>
                        <button type="button" data-action="close-reimbursement" className="btn btn-secondary" onClick={() => setDraft(null)}>Cancel</button>
                        <button type="button" data-action="save-reimbursement" className="btn btn-primary" onClick={add}>Save</button>
                    </>
                )}>
                {draft ? (
                    <form className="form-grid two" onSubmit={event => { event.preventDefault(); add(); }}>
                        <div className="field span-2">
                            <label htmlFor="reimbursement-description">What you paid for</label>
                            <input type="text" id="reimbursement-description" maxLength={200} placeholder="Hotel, Pune work trip" value={draft.description}
                                onChange={event => setDraft(current => current && { ...current, description: event.target.value })} />
                        </div>
                        <div className="field">
                            <label htmlFor="reimbursement-amount">Amount (₹)</label>
                            <input type="number" id="reimbursement-amount" inputMode="decimal" min="0" step="0.01" value={draft.amount}
                                onChange={event => setDraft(current => current && { ...current, amount: event.target.value })} />
                        </div>
                        <div className="field">
                            <label htmlFor="reimbursement-from">Who pays it back</label>
                            <input type="text" id="reimbursement-from" maxLength={100} placeholder="Employer, insurer..." value={draft.fromWhom}
                                onChange={event => setDraft(current => current && { ...current, fromWhom: event.target.value })} />
                        </div>
                        <div className="field">
                            <label htmlFor="reimbursement-account">Paid from</label>
                            <select id="reimbursement-account" value={draft.accountId} onChange={event => setDraft(current => current && { ...current, accountId: event.target.value })}>
                                {accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
                            </select>
                        </div>
                        <div className="field">
                            <label htmlFor="reimbursement-date">Paid on</label>
                            <input type="date" id="reimbursement-date" value={draft.date} onChange={event => setDraft(current => current && { ...current, date: event.target.value })} />
                        </div>
                        <div className="field span-2">
                            <label htmlFor="reimbursement-category">If not paid back, count it as</label>
                            <select id="reimbursement-category" value={draft.categoryId} onChange={event => setDraft(current => current && { ...current, categoryId: event.target.value })}>
                                <option value="">Uncategorised</option>
                                {categories.filter(category => category.kind === 'expense').map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
                            </select>
                        </div>
                    </form>
                ) : null}
            </Modal>

            <Modal id="repay-modal" title="Money paid back" small open={repay !== null} closeAction="close-repay" onClose={() => setRepay(null)}
                footer={(
                    <>
                        <button type="button" data-action="close-repay" className="btn btn-secondary" onClick={() => setRepay(null)}>Cancel</button>
                        <button type="button" data-action="save-repay" className="btn btn-primary" onClick={saveRepayment}>Save</button>
                    </>
                )}>
                {repay ? (
                    <form className="form-grid" onSubmit={event => { event.preventDefault(); saveRepayment(); }}>
                        <p className="lead">{repay.item.description}: {formatRupees(repay.item.outstanding)} still to come.</p>
                        <div className="field">
                            <label htmlFor="repay-amount">Amount paid back (₹)</label>
                            <input type="number" id="repay-amount" inputMode="decimal" min="0" step="0.01" value={repay.amount}
                                onChange={event => setRepay(current => current && { ...current, amount: event.target.value })} />
                        </div>
                        <div className="field">
                            <label htmlFor="repay-account">Received in</label>
                            <select id="repay-account" value={repay.accountId} onChange={event => setRepay(current => current && { ...current, accountId: event.target.value })}>
                                {accounts.filter(account => account.type !== 'credit_card').map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
                            </select>
                        </div>
                        <div className="field">
                            <label htmlFor="repay-date">Date</label>
                            <input type="date" id="repay-date" value={repay.date} onChange={event => setRepay(current => current && { ...current, date: event.target.value })} />
                        </div>
                        <label className="check-line">
                            <input type="checkbox" id="repay-close" checked={repay.close} onChange={event => setRepay(current => current && { ...current, close: event.target.checked })} />
                            Nothing more will come back: count the rest as my spending
                        </label>
                    </form>
                ) : null}
            </Modal>
        </section>
    );
}
