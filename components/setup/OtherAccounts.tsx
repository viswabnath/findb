'use client';

import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Smartphone, Trash2, UtensilsCrossed } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { AccountList, AccountRow } from '@/components/ui/AccountList';
import { useToast } from '@/components/Toast';
import { useFormMessage } from '@/components/useFormMessage';
import { apiDelete, apiGet, apiPost, apiPut, httpError, redirectIfUnauthorized } from '@/lib/api-client';
import { t } from '@/lib/i18n';

/**
 * Wallets (prepaid and UPI wallets) and meal cards (Pluxee and similar employer food cards): money
 * accounts that live only in the ledger (/api/accounts). Topping one up from a bank is a transfer;
 * a meal card's monthly top-up from the employer is income.
 */

type OtherType = 'wallet' | 'meal_card';
interface OtherAccount { id: number; type: OtherType; name: string; balance: string; institution: string | null; notes: string | null }
interface Draft { id: number; name: string; institution: string; notes: string }

const typeLabel = (type: OtherType) => t(`accounts.other.types.${type}`);

/** onChange: called after a wallet or meal card is added or removed, so the totals above update */
export function OtherAccounts({ onChange }: { onChange?: () => void }) {
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
        if (!form.name.trim()) return message.show('error', t('accounts.other.needName'));
        const result = await apiPost('/api/accounts', {
            type: form.type, name: form.name, institution: form.institution, openingBalance: form.openingBalance,
        });
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return message.show('error', httpError(result));
        message.show('success', t('accounts.other.added', { type: typeLabel(form.type) }));
        setForm(current => ({ ...current, name: '', institution: '', openingBalance: '' }));
        await load();
        onChange?.();
    }

    async function save() {
        if (!edit) return;
        const result = await apiPut(`/api/accounts/${edit.id}`, { name: edit.name, institution: edit.institution, notes: edit.notes });
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        setEdit(null);
        toast('success', t('accounts.other.saved'));
        await load();
    }

    async function remove() {
        if (!pendingRemove) return;
        const result = await apiDelete(`/api/accounts/${pendingRemove.id}`);
        if (redirectIfUnauthorized(result)) return;
        setPendingRemove(null);
        if (!result.ok) return toast('error', httpError(result));
        toast('success', t('accounts.other.removed', { name: pendingRemove.name }));
        await load();
        onChange?.();
    }

    if (accounts === null) return null;

    return (
        <section id="other-accounts-setup" className="card" aria-labelledby="other-accounts-title">
            <div className="card-head">
                <h3 id="other-accounts-title"><span className="icon-tile t-cash" aria-hidden="true"><Smartphone /></span>{t('accounts.other.title')}</h3>
                <span className="meta">{t('accounts.banks.count', { count: accounts.length })}</span>
            </div>
            <p className="card-pad form-note">{t('accounts.other.note')}</p>
            <AccountList id="other-accounts-list" empty={t('accounts.other.empty')} emptyIcon={Smartphone}>
                {accounts.map(account => (
                    <AccountRow key={account.id} data={{ 'data-account': account.id }} icon={account.type === 'meal_card' ? UtensilsCrossed : Smartphone} tile="t-cash"
                        name={account.name} amount={account.balance}
                        sub={[typeLabel(account.type), account.institution].filter(Boolean).join(' · ')}
                        actions={(
                            <>
                                <button type="button" className="icon-btn" data-action="edit-other-account" data-id={account.id}
                                    onClick={() => setEdit({ id: account.id, name: account.name, institution: account.institution ?? '', notes: account.notes ?? '' })}>
                                    <Pencil aria-hidden="true" /> {t('common.edit')}
                                </button>
                                <button type="button" className="icon-btn danger" data-action="remove-other-account" data-id={account.id}
                                    onClick={() => setPendingRemove(account)}>
                                    <Trash2 aria-hidden="true" /> {t('common.remove')}
                                </button>
                            </>
                        )} />
                ))}
            </AccountList>
            <form className="add-row other-add-row foot" onSubmit={event => { event.preventDefault(); add(); }}>
                <div className="field">
                    <label htmlFor="other-type">{t('accounts.other.typeLabel')}</label>
                    <select id="other-type" value={form.type} onChange={event => setForm(current => ({ ...current, type: event.target.value as OtherType }))}>
                        <option value="wallet">{typeLabel('wallet')}</option>
                        <option value="meal_card">{typeLabel('meal_card')}</option>
                    </select>
                </div>
                <div className="field">
                    <label htmlFor="other-name">{t('accounts.other.nameLabel')}</label>
                    <input type="text" id="other-name" placeholder={t('accounts.other.namePlaceholder')} value={form.name}
                        onChange={event => setForm(current => ({ ...current, name: event.target.value }))} />
                </div>
                <div className="field">
                    <label htmlFor="other-institution">{t('accounts.other.providerLabel')}</label>
                    <input type="text" id="other-institution" placeholder={t('accounts.other.providerPlaceholder')} value={form.institution}
                        onChange={event => setForm(current => ({ ...current, institution: event.target.value }))} />
                </div>
                <div className="field">
                    <label htmlFor="other-balance">{t('accounts.other.balanceLabel')}</label>
                    <input type="number" id="other-balance" inputMode="decimal" placeholder="0.00" step="0.01" min="0" value={form.openingBalance}
                        onChange={event => setForm(current => ({ ...current, openingBalance: event.target.value }))} />
                </div>
                <button type="submit" className="btn btn-primary" data-action="addOtherAccount"><Plus aria-hidden="true" /> {t('common.add')}</button>
            </form>
            <div className="card-message" hidden={!message.message}>
                <div id="other-account-message" className={message.message?.kind ?? 'error'} role="status">{message.message?.text ?? ''}</div>
            </div>

            <Modal id="edit-other-account-modal" title={t('accounts.other.editTitle')} open={edit !== null} closeAction="close-edit-other-account" onClose={() => setEdit(null)}
                footer={(
                    <>
                        <button type="button" data-action="close-edit-other-account" className="btn btn-secondary" onClick={() => setEdit(null)}>{t('common.cancel')}</button>
                        <button type="button" data-action="save-other-account" className="btn btn-primary" onClick={save}>{t('common.saveChanges')}</button>
                    </>
                )}>
                <form className="form-grid" onSubmit={event => { event.preventDefault(); save(); }}>
                    <div className="field">
                        <label htmlFor="edit-other-name">{t('accounts.other.nameLabel')}</label>
                        <input type="text" id="edit-other-name" required value={edit?.name ?? ''}
                            onChange={event => setEdit(draft => draft && { ...draft, name: event.target.value })} />
                    </div>
                    <div className="field">
                        <label htmlFor="edit-other-institution">{t('accounts.other.provider')}</label>
                        <input type="text" id="edit-other-institution" value={edit?.institution ?? ''}
                            onChange={event => setEdit(draft => draft && { ...draft, institution: event.target.value })} />
                    </div>
                    <div className="field">
                        <label htmlFor="edit-other-notes">{t('accounts.other.notes')}</label>
                        <input type="text" id="edit-other-notes" placeholder={t('accounts.other.notesPlaceholder')} value={edit?.notes ?? ''}
                            onChange={event => setEdit(draft => draft && { ...draft, notes: event.target.value })} />
                    </div>
                </form>
            </Modal>

            <Modal id="remove-other-account-modal" title={t('accounts.other.removeTitle')} small open={pendingRemove !== null} closeAction="close-remove-other-account"
                onClose={() => setPendingRemove(null)}
                footer={(
                    <>
                        <button type="button" data-action="close-remove-other-account" className="btn btn-secondary" onClick={() => setPendingRemove(null)}>{t('common.cancel')}</button>
                        <button type="button" data-action="confirm-remove-other-account" className="btn btn-danger" onClick={remove}>
                            <Trash2 aria-hidden="true" /> {t('common.remove')}
                        </button>
                    </>
                )}>
                <p className="lead">{t('accounts.other.removeQuestion', { name: pendingRemove?.name ?? '' })}</p>
                <p>{t('accounts.other.removeNote')}</p>
            </Modal>
        </section>
    );
}
