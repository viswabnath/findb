'use client';

import { useCallback, useEffect, useState } from 'react';
import { Banknote, CreditCard, Landmark, Pencil, Plus, Trash2 } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { AccountList, AccountRow } from '@/components/ui/AccountList';
import { useToast } from '@/components/Toast';
import { apiDelete, apiGet, apiPost, apiPut, httpError, redirectIfUnauthorized } from '@/lib/api-client';
import { formatRupees } from '@/lib/format';
import { t } from '@/lib/i18n';
import { NextStepCard } from './NextStepCard';
import { OtherAccounts } from './OtherAccounts';
import { useFormMessage, type FormMessageState } from '@/components/useFormMessage';

interface Bank { id: number; name: string; initial_balance: string; current_balance: string }
interface Card { id: number; name: string; credit_limit: string; used_limit: string }
interface Cash { initial_balance?: string | number }
/** A bank's details, kept on its ledger account (/api/accounts) */
interface BankDetails { ledgerId: number; institution: string; accountType: string; interestRate: string }
interface LedgerAccount {
    id: number; type: string; sourceId: number | null; balance: string;
    institution: string | null; accountType: string | null; interestRate: string | null;
}

const ACCOUNT_TYPES = ['savings', 'current', 'salary', 'nre', 'nro'] as const;
const accountTypeLabel = (value: string) => (ACCOUNT_TYPES as readonly string[]).includes(value) ? t(`accounts.accountTypes.${value as typeof ACCOUNT_TYPES[number]}`) : '';

/** "Savings, 3.25% interest" from a bank's details */
function detailsText(details: BankDetails | undefined): string {
    if (!details) return '';
    const parts = [
        details.institution,
        accountTypeLabel(details.accountType),
        details.interestRate ? t('accounts.interest', { rate: Number(details.interestRate) }) : '',
    ].filter(Boolean);
    return parts.join(', ');
}

/** The legacy number checks: empty is allowed where the legacy form allowed it */
const isNegativeOrInvalid = (value: string) => value !== '' && (isNaN(Number(value)) || parseFloat(value) < 0);

/** Inline form message (#bank-message etc.), hidden when empty */
function FormMessage({ id, message }: { id: string; message: FormMessageState | null }) {
    return (
        <div className="card-message" hidden={!message}>
            <div id={id} className={message ? message.kind : 'error'} role="status">{message?.text ?? ''}</div>
        </div>
    );
}

export function SetupScreen() {
    const toast = useToast();
    const [loaded, setLoaded] = useState(false);
    const [modules, setModules] = useState<string[]>([]);
    const [banks, setBanks] = useState<Bank[]>([]);
    const [cards, setCards] = useState<Card[]>([]);
    const [cash, setCash] = useState<Cash>({});
    // Every balance as the ledger keeps it (/api/accounts): cash, and wallets and meal cards for the total
    const [ledgerAccounts, setLedgerAccounts] = useState<LedgerAccount[]>([]);

    const [bankName, setBankName] = useState('');
    const [bankBalance, setBankBalance] = useState('');
    const [cardName, setCardName] = useState('');
    const [cardLimit, setCardLimit] = useState('');
    const [cashInput, setCashInput] = useState('');
    const bankMessage = useFormMessage(3000);
    const cardMessage = useFormMessage(3000);
    const cashMessage = useFormMessage(3000);

    const [bankDetails, setBankDetails] = useState<Map<number, BankDetails>>(new Map());
    const [editBank, setEditBank] = useState<{ id: number; name: string; balance: string; details: BankDetails | null } | null>(null);
    const [editCard, setEditCard] = useState<{ id: number; name: string; limit: string; used: string } | null>(null);
    const [editCash, setEditCash] = useState<string | null>(null);
    const [pendingDelete, setPendingDelete] = useState<{ type: 'bank' | 'credit-card'; id: number } | null>(null);

    const loadBanks = useCallback(async () => {
        const [result, ledger] = await Promise.all([apiGet<Bank[]>('/api/banks'), apiGet<LedgerAccount[]>('/api/accounts')]);
        if (redirectIfUnauthorized(result) || redirectIfUnauthorized(ledger)) return;
        if (result.ok) setBanks(result.data);
        if (ledger.ok) {
            setLedgerAccounts(ledger.data);
            setBankDetails(new Map(ledger.data.filter(account => account.type === 'bank' && account.sourceId !== null).map(account => [
                account.sourceId!,
                { ledgerId: account.id, institution: account.institution ?? '', accountType: account.accountType ?? '', interestRate: account.interestRate ?? '' },
            ])));
        }
    }, []);
    const loadCards = useCallback(async () => {
        const result = await apiGet<Card[]>('/api/credit-cards');
        if (redirectIfUnauthorized(result)) return;
        if (result.ok) setCards(result.data);
    }, []);
    const loadCash = useCallback(async () => {
        const result = await apiGet<Cash>('/api/cash-balance');
        if (redirectIfUnauthorized(result)) return;
        setCash(result.ok ? result.data : {});
        const ledger = await apiGet<LedgerAccount[]>('/api/accounts');
        if (ledger.ok) setLedgerAccounts(ledger.data);
    }, []);

    useEffect(() => {
        (async () => {
            const user = await apiGet<{ modules?: string[] }>('/api/user');
            if (redirectIfUnauthorized(user)) return;
            setModules(user.data.modules ?? []);
            await Promise.all([loadBanks(), loadCards(), loadCash()]);
            setLoaded(true);
        })();
    }, [loadBanks, loadCards, loadCash]);

    async function addBank() {
        bankMessage.clear();
        const name = bankName.trim();
        if (!name) return bankMessage.show('error', t('accounts.banks.needName'));
        if (isNegativeOrInvalid(bankBalance)) return bankMessage.show('error', t('accounts.banks.badBalance'));
        const result = await apiPost('/api/banks', { name, initialBalance: bankBalance ? parseFloat(bankBalance) : 0 });
        if (!result.ok) return bankMessage.show('error', httpError(result));
        setBankName('');
        setBankBalance('');
        bankMessage.show('success', t('accounts.banks.added'));
        await loadBanks();
    }

    async function addCard() {
        cardMessage.clear();
        const name = cardName.trim();
        if (!name) return cardMessage.show('error', t('accounts.cards.needName'));
        if (!cardLimit || isNaN(Number(cardLimit)) || parseFloat(cardLimit) <= 0) {
            return cardMessage.show('error', t('accounts.cards.badLimit'));
        }
        const result = await apiPost('/api/credit-cards', { name, creditLimit: parseFloat(cardLimit) });
        if (!result.ok) return cardMessage.show('error', httpError(result));
        setCardName('');
        setCardLimit('');
        cardMessage.show('success', t('accounts.cards.added'));
        await loadCards();
    }

    async function setCashBalance() {
        cashMessage.clear();
        if (isNegativeOrInvalid(cashInput)) return cashMessage.show('error', t('accounts.cash.bad'));
        const result = await apiPost('/api/cash-balance', { balance: cashInput ? parseFloat(cashInput) : 0 });
        if (!result.ok) return cashMessage.show('error', httpError(result));
        setCashInput('');
        cashMessage.show('success', t('accounts.cash.updated'));
        await loadCash();
    }

    async function saveBank() {
        if (!editBank) return;
        const name = editBank.name.trim();
        if (!name) return toast('error', t('accounts.editBank.needName'));
        if (!editBank.balance || isNaN(Number(editBank.balance)) || parseFloat(editBank.balance) < 0) {
            return toast('error', t('accounts.editBank.badBalance'));
        }
        const { details } = editBank;
        if (details?.interestRate && (isNaN(Number(details.interestRate)) || Number(details.interestRate) < 0 || Number(details.interestRate) > 100)) {
            return toast('error', t('accounts.editBank.badInterest'));
        }
        const result = await apiPut(`/api/banks/${editBank.id}`, { name, initialBalance: parseFloat(editBank.balance) });
        if (!result.ok) return toast('error', httpError(result));
        if (details) {
            const saved = await apiPut(`/api/accounts/${details.ledgerId}`, {
                institution: details.institution, accountType: details.accountType, interestRate: details.interestRate,
            });
            if (!saved.ok) return toast('error', httpError(saved));
        }
        toast('success', t('accounts.editBank.saved'));
        setEditBank(null);
        await loadBanks();
    }

    async function saveCard() {
        if (!editCard) return;
        const name = editCard.name.trim();
        if (!name) return toast('error', t('accounts.editCard.needName'));
        if (!editCard.limit || isNaN(Number(editCard.limit)) || parseFloat(editCard.limit) <= 0) {
            return toast('error', t('accounts.editCard.badLimit'));
        }
        const result = await apiPut(`/api/credit-cards/${editCard.id}`, { name, creditLimit: parseFloat(editCard.limit) });
        if (!result.ok) return toast('error', httpError(result));
        toast('success', t('accounts.editCard.saved'));
        setEditCard(null);
        await loadCards();
    }

    async function saveCash() {
        if (editCash === null) return;
        if (editCash === '' || isNaN(Number(editCash)) || parseFloat(editCash) < 0) {
            return toast('error', t('accounts.cash.bad'));
        }
        const value = parseFloat(editCash);
        const result = await apiPost('/api/cash-balance', { initial_balance: value, balance: value });
        if (!result.ok) return toast('error', httpError(result));
        toast('success', t('accounts.cash.updated'));
        setEditCash(null);
        await loadCash();
    }

    async function confirmDelete() {
        if (!pendingDelete) return;
        const isBank = pendingDelete.type === 'bank';
        const result = await apiDelete(isBank ? `/api/banks/${pendingDelete.id}` : `/api/credit-cards/${pendingDelete.id}`);
        if (!result.ok) return toast('error', httpError(result));
        toast('success', isBank ? t('accounts.deleteAccount.bankDeleted') : t('accounts.deleteAccount.cardDeleted'));
        setPendingDelete(null);
        await (isBank ? loadBanks() : loadCards());
    }

    if (!loaded) {
        // Rendered only after the data loads, so nothing can be typed before the form is live
        return null;
    }

    const amountOf = (value: string | number | undefined) => parseFloat(String(value ?? 0)) || 0;
    // Cash as the ledger has it now, not the amount first entered
    const cashNow = amountOf(ledgerAccounts.find(account => account.type === 'cash')?.balance);
    const inOther = ledgerAccounts.filter(account => account.type === 'wallet' || account.type === 'meal_card')
        .reduce((sum, account) => sum + amountOf(account.balance), 0);
    const inBanks = banks.reduce((sum, bank) => sum + amountOf(bank.current_balance), 0);
    const cardDues = cards.reduce((sum, card) => sum + amountOf(card.used_limit), 0);
    const worth = inBanks + cashNow + inOther - cardDues;
    // Cards show while the module is on, and always while there are cards, so switching it off hides nothing saved
    const showCards = modules.includes('credit_cards') || cards.length > 0;
    const modalButtons = (saveAction: string, closeAction: string, onSave: () => void, onClose: () => void) => (
        <>
            <button type="button" data-action={closeAction} className="btn btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
            <button type="button" data-action={saveAction} className="btn btn-primary" onClick={onSave}>{t('common.saveChanges')}</button>
        </>
    );
    const rowButtons = (editAction: string, deleteAction: string, id: number, onEdit: () => void, onDelete: () => void) => (
        <>
            <button type="button" className="icon-btn" data-action={editAction} data-id={id} onClick={onEdit}><Pencil aria-hidden="true" /> {t('common.edit')}</button>
            <button type="button" className="icon-btn danger" data-action={deleteAction} data-id={id} onClick={onDelete}><Trash2 aria-hidden="true" /> {t('common.delete')}</button>
        </>
    );

    return (
        <div id="setup-section">
            <div className="page-header">
                <div>
                    <h2>{t('accounts.title')}</h2>
                    <p>{t('accounts.subtitle')}</p>
                </div>
                <a href="/reconcile" className="btn btn-secondary btn-sm" data-action="goReconcile">{t('accounts.checkStatement')}</a>
            </div>

            <NextStepCard />

            <section id="net-worth" className="worth" aria-labelledby="net-worth-label">
                <div className="worth-main">
                    <span id="net-worth-label" className="worth-label">{t('accounts.worth.label')}</span>
                    <span className="worth-value">{formatRupees(worth)}</span>
                    <span className="worth-note">{t('accounts.worth.note')}</span>
                </div>
                <dl className="worth-parts">
                    <div><dt>{t('accounts.worth.banks')}</dt><dd>{formatRupees(inBanks)}</dd></div>
                    <div><dt>{t('accounts.worth.cash')}</dt><dd>{formatRupees(cashNow)}</dd></div>
                    {inOther !== 0 ? <div><dt>{t('accounts.worth.other')}</dt><dd>{formatRupees(inOther)}</dd></div> : null}
                    {showCards ? <div><dt>{t('accounts.worth.cards')}</dt><dd className="owed">{formatRupees(cardDues)}</dd></div> : null}
                </dl>
            </section>

            <div className="setup-grid">
                <section id="bank-setup" className="card" aria-labelledby="bank-setup-title">
                    <div className="card-head">
                        <h3 id="bank-setup-title"><span className="icon-tile t-bank" aria-hidden="true"><Landmark /></span>{t('accounts.banks.title')}</h3>
                        <span className="meta">{t('accounts.banks.count', { count: banks.length })}</span>
                    </div>
                    <AccountList id="banks-list" empty={t('accounts.banks.empty')} emptyIcon={Landmark}>
                        {banks.map(bank => (
                            <AccountRow key={bank.id} icon={Landmark} tile="t-bank" name={bank.name} amount={bank.current_balance}
                                sub={[detailsText(bankDetails.get(bank.id)), t('accounts.banks.started', { amount: formatRupees(bank.initial_balance) })].filter(Boolean).join(' · ')}
                                actions={rowButtons('edit-bank', 'delete-bank', bank.id,
                                    () => setEditBank({ id: bank.id, name: bank.name, balance: String(parseFloat(bank.initial_balance)), details: bankDetails.get(bank.id) ?? null }),
                                    () => setPendingDelete({ type: 'bank', id: bank.id }))} />
                        ))}
                    </AccountList>
                    <div className="add-row foot">
                        <div className="field">
                            <label htmlFor="bank-name">{t('accounts.banks.nameLabel')}</label>
                            <input type="text" id="bank-name" placeholder={t('accounts.banks.namePlaceholder')} value={bankName}
                                onChange={event => { setBankName(event.target.value); bankMessage.clear(); }} />
                        </div>
                        <div className="field">
                            <label htmlFor="bank-balance">{t('accounts.banks.balanceLabel')}</label>
                            <input type="number" id="bank-balance" inputMode="decimal" placeholder="0.00" step="0.01" value={bankBalance}
                                onChange={event => { setBankBalance(event.target.value); bankMessage.clear(); }} />
                        </div>
                        <button type="button" className="btn btn-primary" data-action="addBank" onClick={addBank}><Plus aria-hidden="true" /> {t('accounts.banks.add')}</button>
                    </div>
                    <FormMessage id="bank-message" message={bankMessage.message} />
                </section>

                <section id="credit-card-setup" className={`card${showCards ? '' : ' hidden'}`} aria-labelledby="card-setup-title">
                    <div className="card-head">
                        <h3 id="card-setup-title"><span className="icon-tile t-card" aria-hidden="true"><CreditCard /></span>{t('accounts.cards.title')}</h3>
                        <span className="meta">{t('accounts.cards.count', { count: cards.length })}</span>
                    </div>
                    <AccountList id="credit-cards-list" empty={t('accounts.cards.empty')} emptyIcon={CreditCard}>
                        {cards.map(card => {
                            const limit = amountOf(card.credit_limit);
                            const used = amountOf(card.used_limit);
                            const share = limit > 0 ? Math.min(used / limit, 1) : 0;
                            return (
                                <AccountRow key={card.id} icon={CreditCard} tile="t-card" name={card.name} amount={limit - used}
                                    amountNote={t('accounts.cards.availableNote')}
                                    sub={t('accounts.cards.usedOf', { used: formatRupees(used), limit: formatRupees(limit) })}
                                    meter={{ share, label: t('accounts.cards.usedShare', { percent: Math.round(share * 100) }) }}
                                    actions={rowButtons('edit-credit-card', 'delete-credit-card', card.id,
                                        () => setEditCard({ id: card.id, name: card.name, limit: String(parseFloat(card.credit_limit)), used: card.used_limit }),
                                        () => setPendingDelete({ type: 'credit-card', id: card.id }))} />
                            );
                        })}
                    </AccountList>
                    <div className="add-row foot">
                        <div className="field">
                            <label htmlFor="cc-name">{t('accounts.cards.nameLabel')}</label>
                            <input type="text" id="cc-name" placeholder={t('accounts.cards.namePlaceholder')} value={cardName}
                                onChange={event => { setCardName(event.target.value); cardMessage.clear(); }} />
                        </div>
                        <div className="field">
                            <label htmlFor="cc-limit">{t('accounts.cards.limitLabel')}</label>
                            <input type="number" id="cc-limit" inputMode="decimal" placeholder="0.00" step="0.01" value={cardLimit}
                                onChange={event => { setCardLimit(event.target.value); cardMessage.clear(); }} />
                        </div>
                        <button type="button" className="btn btn-primary" data-action="addCreditCard" onClick={addCard}><Plus aria-hidden="true" /> {t('accounts.cards.add')}</button>
                    </div>
                    <FormMessage id="credit-card-message" message={cardMessage.message} />
                </section>

                <section id="cash-setup" className="card" aria-labelledby="cash-setup-title">
                    <div className="card-head">
                        <h3 id="cash-setup-title"><span className="icon-tile t-cash" aria-hidden="true"><Banknote /></span>{t('accounts.cash.title')}</h3>
                    </div>
                    <AccountList id="cash-display">
                        {[
                            <AccountRow key="cash" icon={Banknote} tile="t-cash" name={t('accounts.cash.row')} sub={t('accounts.cash.rowNote')} amount={cashNow}
                                actions={(
                                    <button type="button" className="icon-btn" data-action="edit-cash-balance" disabled={cash.initial_balance === undefined}
                                        onClick={() => setEditCash(String(cashNow))}>
                                        <Pencil aria-hidden="true" /> {t('common.edit')}
                                    </button>
                                )} />,
                        ]}
                    </AccountList>
                    <div className="add-row single foot">
                        <div className="field">
                            <label htmlFor="cash-balance">{t('accounts.cash.inputLabel')}</label>
                            <input type="number" id="cash-balance" inputMode="decimal" placeholder="0.00" step="0.01" value={cashInput}
                                onChange={event => { setCashInput(event.target.value); cashMessage.clear(); }} />
                        </div>
                        <button type="button" className="btn btn-primary" data-action="setCashBalance" onClick={setCashBalance}><Banknote aria-hidden="true" /> {t('accounts.cash.set')}</button>
                    </div>
                    <FormMessage id="cash-message" message={cashMessage.message} />
                </section>

                <OtherAccounts onChange={loadCash} />
            </div>

            <Modal id="edit-bank-modal" title={t('accounts.editBank.title')} open={editBank !== null} closeAction="close-edit-bank" onClose={() => setEditBank(null)}
                footer={modalButtons('save-bank', 'close-edit-bank', saveBank, () => setEditBank(null))}>
                <form id="edit-bank-form" className="form-grid" onSubmit={event => { event.preventDefault(); saveBank(); }}>
                    <div className="field">
                        <label htmlFor="edit-bank-name">{t('accounts.editBank.name')}</label>
                        <input type="text" id="edit-bank-name" required value={editBank?.name ?? ''}
                            onChange={event => setEditBank(current => current && { ...current, name: event.target.value })} />
                    </div>
                    <div className="field">
                        <label htmlFor="edit-bank-balance">{t('accounts.editBank.balance')}</label>
                        <input type="number" id="edit-bank-balance" inputMode="decimal" step="0.01" min="0" required value={editBank?.balance ?? ''}
                            onChange={event => setEditBank(current => current && { ...current, balance: event.target.value })} />
                    </div>
                    <div className="notice warn">{t('accounts.editBank.balanceWarning')}</div>
                    {editBank?.details ? (
                        <>
                            <div className="field">
                                <label htmlFor="edit-bank-institution">{t('accounts.editBank.institution')}</label>
                                <input type="text" id="edit-bank-institution" placeholder={t('accounts.editBank.institutionPlaceholder')} value={editBank.details.institution}
                                    onChange={event => setEditBank(current => current && current.details && { ...current, details: { ...current.details, institution: event.target.value } })} />
                            </div>
                            <div className="field">
                                <label htmlFor="edit-bank-account-type">{t('accounts.editBank.accountType')}</label>
                                <select id="edit-bank-account-type" value={editBank.details.accountType}
                                    onChange={event => setEditBank(current => current && current.details && { ...current, details: { ...current.details, accountType: event.target.value } })}>
                                    <option value="">{t('accounts.editBank.notSet')}</option>
                                    {ACCOUNT_TYPES.map(type => <option key={type} value={type}>{accountTypeLabel(type)}</option>)}
                                </select>
                            </div>
                            <div className="field">
                                <label htmlFor="edit-bank-interest-rate">{t('accounts.editBank.interest')}</label>
                                <input type="number" id="edit-bank-interest-rate" inputMode="decimal" step="0.001" min="0" max="100" placeholder="3.25"
                                    value={editBank.details.interestRate}
                                    onChange={event => setEditBank(current => current && current.details && { ...current, details: { ...current.details, interestRate: event.target.value } })} />
                            </div>
                        </>
                    ) : null}
                </form>
            </Modal>

            <Modal id="edit-credit-card-modal" title={t('accounts.editCard.title')} open={editCard !== null} closeAction="close-edit-credit-card" onClose={() => setEditCard(null)}
                footer={modalButtons('save-credit-card', 'close-edit-credit-card', saveCard, () => setEditCard(null))}>
                <form id="edit-credit-card-form" className="form-grid" onSubmit={event => { event.preventDefault(); saveCard(); }}>
                    <div className="field">
                        <label htmlFor="edit-credit-card-name">{t('accounts.editCard.name')}</label>
                        <input type="text" id="edit-credit-card-name" required value={editCard?.name ?? ''}
                            onChange={event => setEditCard(current => current && { ...current, name: event.target.value })} />
                    </div>
                    <div className="field">
                        <label htmlFor="edit-credit-card-limit">{t('accounts.editCard.limit')}</label>
                        <input type="number" id="edit-credit-card-limit" inputMode="decimal" step="0.01" min="0.01" required value={editCard?.limit ?? ''}
                            onChange={event => setEditCard(current => current && { ...current, limit: event.target.value })} />
                    </div>
                    <div id="credit-card-used-info" className="notice">
                        {editCard ? <span>{t('accounts.editCard.used', { amount: formatRupees(editCard.used) })}</span> : null}
                    </div>
                </form>
            </Modal>

            <Modal id="edit-cash-modal" title={t('accounts.editCash.title')} open={editCash !== null} closeAction="close-edit-cash" onClose={() => setEditCash(null)}
                footer={modalButtons('save-cash-balance', 'close-edit-cash', saveCash, () => setEditCash(null))}>
                <form id="edit-cash-form" className="form-grid" onSubmit={event => { event.preventDefault(); saveCash(); }}>
                    <div className="field">
                        <label htmlFor="edit-cash-balance">{t('accounts.editCash.label')}</label>
                        <input type="number" id="edit-cash-balance" inputMode="decimal" step="0.01" min="0" required value={editCash ?? ''}
                            onChange={event => setEditCash(event.target.value)} />
                    </div>
                    <p>{t('accounts.editCash.note')}</p>
                </form>
            </Modal>

            <Modal id="delete-setup-modal" title={t('accounts.deleteAccount.title')} small open={pendingDelete !== null} closeAction="close-delete-setup" onClose={() => setPendingDelete(null)}
                footer={(
                    <>
                        <button type="button" data-action="close-delete-setup" className="btn btn-secondary" onClick={() => setPendingDelete(null)}>{t('common.cancel')}</button>
                        <button type="button" data-action="confirm-delete-setup" className="btn btn-danger" onClick={confirmDelete}>
                            <Trash2 aria-hidden="true" /> {t('common.delete')}
                        </button>
                    </>
                )}>
                <p id="delete-setup-message" className="lead">
                    {pendingDelete?.type === 'credit-card' ? t('accounts.deleteAccount.card') : t('accounts.deleteAccount.bank')}
                </p>
                <p>{t('accounts.deleteAccount.note')}</p>
            </Modal>
        </div>
    );
}
