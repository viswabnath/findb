'use client';

import { useCallback, useEffect, useState } from 'react';
import { HandCoins, Plus, Trash2 } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { apiDelete, apiGet, apiPost, httpError, redirectIfUnauthorized } from '@/lib/api-client';
import { todayUtcIso } from '@/lib/dates';
import { formatRupees } from '@/lib/format';
import { t } from '@/lib/i18n';

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
        toast('success', t('reimbursements.added'));
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
        toast('success', repay.close ? t('reimbursements.closedToast', { name: repay.item.description }) : t('reimbursements.repaymentRecorded'));
        setRepay(null);
        await load();
        onChange();
    }

    async function remove(item: Reimbursement) {
        const result = await apiDelete(`/api/reimbursements/${item.id}`);
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        toast('success', t('reimbursements.deleted', { name: item.description }));
        await load();
        onChange();
    }

    const open = items.filter(item => item.status === 'pending' || item.status === 'partly repaid');
    const owed = open.reduce((sum, item) => sum + parseFloat(item.outstanding), 0);

    return (
        <section id="reimbursements-section" className="card" aria-labelledby="reimbursements-title">
            <div className="card-head">
                <h3 id="reimbursements-title"><span className="icon-tile t-income" aria-hidden="true"><HandCoins /></span>{t('reimbursements.title')}</h3>
                <span className="row-actions">
                    <span className="meta" id="reimbursements-owed">{t('reimbursements.toCome', { amount: formatRupees(owed) })}</span>
                    <button type="button" className="btn btn-secondary btn-sm" data-action="newReimbursement"
                        onClick={() => setDraft({ description: '', amount: '', accountId: firstBank, date: todayUtcIso(), fromWhom: '', categoryId: '' })}>
                        <Plus aria-hidden="true" /> {t('common.add')}
                    </button>
                </span>
            </div>
            <p className="card-pad form-note">{t('reimbursements.note')}</p>
            <ul id="reimbursements-list" className="settings-list">
                {items.length === 0 ? <li>{t('reimbursements.empty')}</li> : items.map(item => (
                    <li key={item.id} data-reimbursement={item.id}>
                        <div>
                            <span className="what">{item.description}{item.fromWhom ? <span className="sub"> {t('reimbursements.from', { name: item.fromWhom })}</span> : null}</span>
                            <div className="when">
                                {t('reimbursements.paid', { amount: formatRupees(item.amount) })}
                                {item.paidOn ? t('reimbursements.paidOn', { date: day(item.paidOn) }) : ''}
                                {item.paidFrom ? t('reimbursements.paidFrom', { account: item.paidFrom.name }) : ''};{' '}
                                {item.status === 'pending' ? t('reimbursements.pending')
                                    : item.status === 'partly repaid' ? t('reimbursements.partly', { received: formatRupees(item.received), outstanding: formatRupees(item.outstanding) })
                                        : item.status === 'repaid' ? t('reimbursements.repaid')
                                            : t('reimbursements.closed', { received: formatRupees(item.received), kept: formatRupees(item.keptAsSpending) })}
                            </div>
                        </div>
                        {item.status === 'pending' || item.status === 'partly repaid' ? (
                            <span className="row-actions">
                                <button type="button" className="btn btn-primary btn-sm" data-action="repay"
                                    onClick={() => setRepay({ item, amount: item.outstanding, accountId: String(item.paidFrom?.id ?? firstBank), date: todayUtcIso(), close: false })}>
                                    {t('reimbursements.moneyBack')}
                                </button>
                                {item.status === 'pending' ? (
                                    <button type="button" className="icon-btn danger" data-action="deleteReimbursement" onClick={() => remove(item)}><Trash2 aria-hidden="true" /> {t('common.delete')}</button>
                                ) : null}
                            </span>
                        ) : null}
                    </li>
                ))}
            </ul>

            <Modal id="reimbursement-modal" title={t('reimbursements.modal.title')} open={draft !== null} closeAction="close-reimbursement" onClose={() => setDraft(null)}
                footer={(
                    <>
                        <button type="button" data-action="close-reimbursement" className="btn btn-secondary" onClick={() => setDraft(null)}>{t('common.cancel')}</button>
                        <button type="button" data-action="save-reimbursement" className="btn btn-primary" onClick={add}>{t('reimbursements.save')}</button>
                    </>
                )}>
                {draft ? (
                    <form className="form-grid two" onSubmit={event => { event.preventDefault(); add(); }}>
                        <div className="field span-2">
                            <label htmlFor="reimbursement-description">{t('reimbursements.modal.what')}</label>
                            <input type="text" id="reimbursement-description" maxLength={200} placeholder={t('reimbursements.modal.whatPlaceholder')} value={draft.description}
                                onChange={event => setDraft(current => current && { ...current, description: event.target.value })} />
                        </div>
                        <div className="field">
                            <label htmlFor="reimbursement-amount">{t('transactions.amount')}</label>
                            <input type="number" id="reimbursement-amount" inputMode="decimal" min="0" step="0.01" value={draft.amount}
                                onChange={event => setDraft(current => current && { ...current, amount: event.target.value })} />
                        </div>
                        <div className="field">
                            <label htmlFor="reimbursement-from">{t('reimbursements.modal.who')}</label>
                            <input type="text" id="reimbursement-from" maxLength={100} placeholder={t('reimbursements.modal.whoPlaceholder')} value={draft.fromWhom}
                                onChange={event => setDraft(current => current && { ...current, fromWhom: event.target.value })} />
                        </div>
                        <div className="field">
                            <label htmlFor="reimbursement-account">{t('reimbursements.modal.paidFrom')}</label>
                            <select id="reimbursement-account" value={draft.accountId} onChange={event => setDraft(current => current && { ...current, accountId: event.target.value })}>
                                {accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
                            </select>
                        </div>
                        <div className="field">
                            <label htmlFor="reimbursement-date">{t('reimbursements.modal.paidOn')}</label>
                            <input type="date" id="reimbursement-date" value={draft.date} onChange={event => setDraft(current => current && { ...current, date: event.target.value })} />
                        </div>
                        <div className="field span-2">
                            <label htmlFor="reimbursement-category">{t('reimbursements.modal.countAs')}</label>
                            <select id="reimbursement-category" value={draft.categoryId} onChange={event => setDraft(current => current && { ...current, categoryId: event.target.value })}>
                                <option value="">{t('reimbursements.modal.uncategorised')}</option>
                                {categories.filter(category => category.kind === 'expense').map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
                            </select>
                        </div>
                    </form>
                ) : null}
            </Modal>

            <Modal id="repay-modal" title={t('reimbursements.repay.title')} small open={repay !== null} closeAction="close-repay" onClose={() => setRepay(null)}
                footer={(
                    <>
                        <button type="button" data-action="close-repay" className="btn btn-secondary" onClick={() => setRepay(null)}>{t('common.cancel')}</button>
                        <button type="button" data-action="save-repay" className="btn btn-primary" onClick={saveRepayment}>{t('reimbursements.save')}</button>
                    </>
                )}>
                {repay ? (
                    <form className="form-grid" onSubmit={event => { event.preventDefault(); saveRepayment(); }}>
                        <p className="lead">{t('reimbursements.repay.stillToCome', { name: repay.item.description, amount: formatRupees(repay.item.outstanding) })}</p>
                        <div className="field">
                            <label htmlFor="repay-amount">{t('reimbursements.repay.amount')}</label>
                            <input type="number" id="repay-amount" inputMode="decimal" min="0" step="0.01" value={repay.amount}
                                onChange={event => setRepay(current => current && { ...current, amount: event.target.value })} />
                        </div>
                        <div className="field">
                            <label htmlFor="repay-account">{t('reimbursements.repay.receivedIn')}</label>
                            <select id="repay-account" value={repay.accountId} onChange={event => setRepay(current => current && { ...current, accountId: event.target.value })}>
                                {accounts.filter(account => account.type !== 'credit_card').map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
                            </select>
                        </div>
                        <div className="field">
                            <label htmlFor="repay-date">{t('reimbursements.repay.date')}</label>
                            <input type="date" id="repay-date" value={repay.date} onChange={event => setRepay(current => current && { ...current, date: event.target.value })} />
                        </div>
                        <label className="check-line">
                            <input type="checkbox" id="repay-close" checked={repay.close} onChange={event => setRepay(current => current && { ...current, close: event.target.checked })} />
                            {t('reimbursements.repay.close')}
                        </label>
                    </form>
                ) : null}
            </Modal>
        </section>
    );
}
