'use client';

import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Smartphone, Trash2 } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { useFormMessage } from '@/components/useFormMessage';
import { apiDelete, apiGet, apiPost, apiPut, httpError, redirectIfUnauthorized } from '@/lib/api-client';
import { formatRupees } from '@/lib/format';

/**
 * Wallets (prepaid and UPI wallets) and meal cards (Pluxee and similar employer food cards): money
 * accounts that live only in the ledger (/api/accounts). Topping one up from a bank is a transfer;
 * a meal card's monthly top-up from the employer is income.
 */

type OtherType = 'wallet' | 'meal_card';
interface OtherAccount { id: number; type: OtherType; name: string; balance: string; institution: string | null; notes: string | null }
interface Draft { id: number; name: string; institution: string; notes: string }

const TYPE_LABELS: Record<OtherType, string> = { wallet: 'Wallet', meal_card: 'Meal card' };

export function OtherAccounts() {
    const toast = useToast();
    const [accounts, setAccounts] = useState<OtherAccount[] | null>(null);
    const [form, setForm] = useState({ type: 'wallet' as OtherType, name: '', institution: '', openingBalance: '' });
    const message = useFormMessage(3000);
    const [edit, setEdit] = useState<Draft | null>(null);
    const [pendingRemove, setPendingRemove] = useState<OtherAccount | null>(null);

    const load = useCallback(async () => {
        const result = await apiGet<(OtherAccount | { type: string })[]>('/api/accounts');
        if (redirectIfUnauthorized(result) || !result.ok) return;
        setAccounts(result.data.filter((account): account is OtherAccount => account.type === 'wallet' || account.type === 'meal_card'));
    }, []);

    useEffect(() => {
        load();
        // Once on page load; the buttons reload afterwards
    }, []);

    async function add() {
        if (!form.name.trim()) return message.show('error', 'Please enter a name');
        const result = await apiPost('/api/accounts', {
            type: form.type, name: form.name, institution: form.institution, openingBalance: form.openingBalance,
        });
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return message.show('error', httpError(result));
        message.show('success', `${TYPE_LABELS[form.type]} added successfully!`);
        setForm(current => ({ ...current, name: '', institution: '', openingBalance: '' }));
        await load();
    }

    async function save() {
        if (!edit) return;
        const result = await apiPut(`/api/accounts/${edit.id}`, { name: edit.name, institution: edit.institution, notes: edit.notes });
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        setEdit(null);
        toast('success', 'Account updated successfully!');
        await load();
    }

    async function remove() {
        if (!pendingRemove) return;
        const result = await apiDelete(`/api/accounts/${pendingRemove.id}`);
        if (redirectIfUnauthorized(result)) return;
        setPendingRemove(null);
        if (!result.ok) return toast('error', httpError(result));
        toast('success', `${pendingRemove.name} removed`);
        await load();
    }

    if (accounts === null) return null;

    return (
        <section id="other-accounts-setup" className="card" aria-labelledby="other-accounts-title">
            <div className="card-head">
                <h3 id="other-accounts-title"><span className="icon-tile t-cash" aria-hidden="true"><Smartphone /></span>Wallets and meal cards</h3>
                <span className="meta">{accounts.length} {accounts.length === 1 ? 'account' : 'accounts'}</span>
            </div>
            <p className="card-pad form-note">
                Prepaid and UPI wallets, and employer meal cards such as Pluxee. Topping one up from your bank is a transfer on the
                Transactions screen; a meal card&apos;s monthly top-up from your employer is income.
            </p>
            <form className="add-row other-add-row" onSubmit={event => { event.preventDefault(); add(); }}>
                <div className="field">
                    <label htmlFor="other-type">Type</label>
                    <select id="other-type" value={form.type} onChange={event => setForm(current => ({ ...current, type: event.target.value as OtherType }))}>
                        <option value="wallet">Wallet</option>
                        <option value="meal_card">Meal card</option>
                    </select>
                </div>
                <div className="field">
                    <label htmlFor="other-name">Name</label>
                    <input type="text" id="other-name" placeholder="For example Paytm Wallet" value={form.name}
                        onChange={event => setForm(current => ({ ...current, name: event.target.value }))} />
                </div>
                <div className="field">
                    <label htmlFor="other-institution">Provider (optional)</label>
                    <input type="text" id="other-institution" placeholder="Paytm, Pluxee..." value={form.institution}
                        onChange={event => setForm(current => ({ ...current, institution: event.target.value }))} />
                </div>
                <div className="field">
                    <label htmlFor="other-balance">Balance now (₹)</label>
                    <input type="number" id="other-balance" inputMode="decimal" placeholder="0.00" step="0.01" min="0" value={form.openingBalance}
                        onChange={event => setForm(current => ({ ...current, openingBalance: event.target.value }))} />
                </div>
                <button type="submit" className="btn btn-primary" data-action="addOtherAccount"><Plus aria-hidden="true" /> Add</button>
            </form>
            <div className="card-message" hidden={!message.message}>
                <div id="other-account-message" className={message.message?.kind ?? 'error'} role="status">{message.message?.text ?? ''}</div>
            </div>
            <div id="other-accounts-list" className="table-wrap">
                <table className="data-table stackable">
                    <thead>
                        <tr><th scope="col">Name</th><th scope="col">Type</th><th scope="col" className="amount">Balance</th><th scope="col" className="actions"><span className="sr-only">Actions</span></th></tr>
                    </thead>
                    <tbody>
                        {accounts.length === 0 ? (
                            <tr className="empty-row"><td colSpan={4}>No wallets or meal cards yet</td></tr>
                        ) : accounts.map(account => (
                            <tr key={account.id} data-account={account.id}>
                                <td className="name">
                                    {account.name}
                                    {account.institution ? <span className="sub"> ({account.institution})</span> : null}
                                </td>
                                <td className="sub" data-label="Type">{TYPE_LABELS[account.type]}</td>
                                <td className="amount" data-label="Balance">{formatRupees(account.balance)}</td>
                                <td className="actions">
                                    <span className="row-actions">
                                        <button type="button" className="icon-btn" data-action="edit-other-account" data-id={account.id}
                                            onClick={() => setEdit({ id: account.id, name: account.name, institution: account.institution ?? '', notes: account.notes ?? '' })}>
                                            <Pencil aria-hidden="true" /> Edit
                                        </button>
                                        <button type="button" className="icon-btn danger" data-action="remove-other-account" data-id={account.id}
                                            onClick={() => setPendingRemove(account)}>
                                            <Trash2 aria-hidden="true" /> Remove
                                        </button>
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <Modal id="edit-other-account-modal" title="Edit account" open={edit !== null} closeAction="close-edit-other-account" onClose={() => setEdit(null)}
                footer={(
                    <>
                        <button type="button" data-action="close-edit-other-account" className="btn btn-secondary" onClick={() => setEdit(null)}>Cancel</button>
                        <button type="button" data-action="save-other-account" className="btn btn-primary" onClick={save}>Save changes</button>
                    </>
                )}>
                <form className="form-grid" onSubmit={event => { event.preventDefault(); save(); }}>
                    <div className="field">
                        <label htmlFor="edit-other-name">Name</label>
                        <input type="text" id="edit-other-name" required value={edit?.name ?? ''}
                            onChange={event => setEdit(draft => draft && { ...draft, name: event.target.value })} />
                    </div>
                    <div className="field">
                        <label htmlFor="edit-other-institution">Provider</label>
                        <input type="text" id="edit-other-institution" value={edit?.institution ?? ''}
                            onChange={event => setEdit(draft => draft && { ...draft, institution: event.target.value })} />
                    </div>
                    <div className="field">
                        <label htmlFor="edit-other-notes">Notes</label>
                        <input type="text" id="edit-other-notes" placeholder="Where it works, when the balance expires..." value={edit?.notes ?? ''}
                            onChange={event => setEdit(draft => draft && { ...draft, notes: event.target.value })} />
                    </div>
                </form>
            </Modal>

            <Modal id="remove-other-account-modal" title="Remove this account?" small open={pendingRemove !== null} closeAction="close-remove-other-account"
                onClose={() => setPendingRemove(null)}
                footer={(
                    <>
                        <button type="button" data-action="close-remove-other-account" className="btn btn-secondary" onClick={() => setPendingRemove(null)}>Cancel</button>
                        <button type="button" data-action="confirm-remove-other-account" className="btn btn-danger" onClick={remove}>
                            <Trash2 aria-hidden="true" /> Remove
                        </button>
                    </>
                )}>
                <p className="lead">Remove {pendingRemove?.name}?</p>
                <p>It must be empty first. Its past entries stay in your history.</p>
            </Modal>
        </section>
    );
}
