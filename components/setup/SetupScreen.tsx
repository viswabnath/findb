'use client';

import { useCallback, useEffect, useState } from 'react';
import { Banknote, CreditCard, Landmark, Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { apiDelete, apiGet, apiPost, apiPut, httpError, redirectIfUnauthorized } from '@/lib/api-client';
import { formatRupees } from '@/lib/format';
import { OtherAccounts } from './OtherAccounts';
import { useFormMessage, type FormMessageState } from '@/components/useFormMessage';

interface Bank { id: number; name: string; initial_balance: string; current_balance: string }
interface Card { id: number; name: string; credit_limit: string; used_limit: string }
interface Cash { initial_balance?: string | number }
/** A bank's details, kept on its ledger account (/api/accounts) */
interface BankDetails { ledgerId: number; institution: string; accountType: string; interestRate: string }
interface LedgerAccount { id: number; type: string; sourceId: number | null; institution: string | null; accountType: string | null; interestRate: string | null }

const ACCOUNT_TYPES: { value: string; label: string }[] = [
    { value: 'savings', label: 'Savings' }, { value: 'current', label: 'Current' }, { value: 'salary', label: 'Salary' },
    { value: 'nre', label: 'NRE' }, { value: 'nro', label: 'NRO' },
];

/** "Savings, 3.25% interest" from a bank's details */
function detailsText(details: BankDetails | undefined): string {
    if (!details) return '';
    const parts = [
        details.institution,
        ACCOUNT_TYPES.find(type => type.value === details.accountType)?.label,
        details.interestRate ? `${Number(details.interestRate)}% interest` : '',
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
    const [trackingOption, setTrackingOption] = useState('both');
    const [banks, setBanks] = useState<Bank[]>([]);
    const [cards, setCards] = useState<Card[]>([]);
    const [cash, setCash] = useState<Cash>({});

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
    }, []);

    useEffect(() => {
        (async () => {
            const user = await apiGet<{ tracking_option?: string }>('/api/user');
            if (redirectIfUnauthorized(user)) return;
            setTrackingOption(user.data.tracking_option || 'both');
            await Promise.all([loadBanks(), loadCards(), loadCash()]);
            setLoaded(true);
        })();
    }, [loadBanks, loadCards, loadCash]);

    async function addBank() {
        bankMessage.clear();
        const name = bankName.trim();
        if (!name) return bankMessage.show('error', 'Please enter bank name');
        if (isNegativeOrInvalid(bankBalance)) return bankMessage.show('error', 'Please enter a valid initial balance (0 or greater)');
        const result = await apiPost('/api/banks', { name, initialBalance: bankBalance ? parseFloat(bankBalance) : 0 });
        if (!result.ok) return bankMessage.show('error', httpError(result));
        setBankName('');
        setBankBalance('');
        bankMessage.show('success', 'Bank added successfully');
        await loadBanks();
    }

    async function addCard() {
        cardMessage.clear();
        const name = cardName.trim();
        if (!name) return cardMessage.show('error', 'Please enter card name');
        if (!cardLimit || isNaN(Number(cardLimit)) || parseFloat(cardLimit) <= 0) {
            return cardMessage.show('error', 'Please enter a valid credit limit greater than 0');
        }
        const result = await apiPost('/api/credit-cards', { name, creditLimit: parseFloat(cardLimit) });
        if (!result.ok) return cardMessage.show('error', httpError(result));
        setCardName('');
        setCardLimit('');
        cardMessage.show('success', 'Credit card added successfully');
        await loadCards();
    }

    async function setCashBalance() {
        cashMessage.clear();
        if (isNegativeOrInvalid(cashInput)) return cashMessage.show('error', 'Please enter a valid cash balance (0 or greater)');
        const result = await apiPost('/api/cash-balance', { balance: cashInput ? parseFloat(cashInput) : 0 });
        if (!result.ok) return cashMessage.show('error', httpError(result));
        setCashInput('');
        cashMessage.show('success', 'Cash balance updated successfully');
        await loadCash();
    }

    async function saveBank() {
        if (!editBank) return;
        const name = editBank.name.trim();
        if (!name) return toast('error', 'Bank name is required');
        if (!editBank.balance || isNaN(Number(editBank.balance)) || parseFloat(editBank.balance) < 0) {
            return toast('error', 'Valid initial balance is required');
        }
        const { details } = editBank;
        if (details?.interestRate && (isNaN(Number(details.interestRate)) || Number(details.interestRate) < 0 || Number(details.interestRate) > 100)) {
            return toast('error', 'Interest rate must be a percentage between 0 and 100');
        }
        const result = await apiPut(`/api/banks/${editBank.id}`, { name, initialBalance: parseFloat(editBank.balance) });
        if (!result.ok) return toast('error', httpError(result));
        if (details) {
            const saved = await apiPut(`/api/accounts/${details.ledgerId}`, {
                institution: details.institution, accountType: details.accountType, interestRate: details.interestRate,
            });
            if (!saved.ok) return toast('error', httpError(saved));
        }
        toast('success', 'Bank updated successfully');
        setEditBank(null);
        await loadBanks();
    }

    async function saveCard() {
        if (!editCard) return;
        const name = editCard.name.trim();
        if (!name) return toast('error', 'Card name is required');
        if (!editCard.limit || isNaN(Number(editCard.limit)) || parseFloat(editCard.limit) <= 0) {
            return toast('error', 'Valid credit limit greater than 0 is required');
        }
        const result = await apiPut(`/api/credit-cards/${editCard.id}`, { name, creditLimit: parseFloat(editCard.limit) });
        if (!result.ok) return toast('error', httpError(result));
        toast('success', 'Credit card updated successfully');
        setEditCard(null);
        await loadCards();
    }

    async function saveCash() {
        if (editCash === null) return;
        if (editCash === '' || isNaN(Number(editCash)) || parseFloat(editCash) < 0) {
            return toast('error', 'Please enter a valid cash balance (0 or greater)');
        }
        const value = parseFloat(editCash);
        const result = await apiPost('/api/cash-balance', { initial_balance: value, balance: value });
        if (!result.ok) return toast('error', httpError(result));
        toast('success', 'Cash balance updated successfully');
        setEditCash(null);
        await loadCash();
    }

    async function confirmDelete() {
        if (!pendingDelete) return;
        const isBank = pendingDelete.type === 'bank';
        const result = await apiDelete(isBank ? `/api/banks/${pendingDelete.id}` : `/api/credit-cards/${pendingDelete.id}`);
        if (!result.ok) return toast('error', httpError(result));
        toast('success', isBank ? 'Bank deleted successfully' : 'Credit card deleted successfully');
        setPendingDelete(null);
        await (isBank ? loadBanks() : loadCards());
    }

    if (!loaded) {
        // Rendered only after the data loads, so nothing can be typed before the form is live
        return null;
    }

    const initialCash = parseFloat(String(cash.initial_balance ?? 0)) || 0;
    const inBanks = banks.reduce((sum, bank) => sum + (parseFloat(bank.current_balance) || 0), 0);
    const cardDues = cards.reduce((sum, card) => sum + (parseFloat(card.used_limit) || 0), 0);
    const showCards = trackingOption !== 'income';
    const modalButtons = (saveAction: string, closeAction: string, onSave: () => void, onClose: () => void) => (
        <>
            <button type="button" data-action={closeAction} className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="button" data-action={saveAction} className="btn btn-primary" onClick={onSave}>Save changes</button>
        </>
    );

    return (
        <div id="setup-section">
            <div className="page-header">
                <div>
                    <h2>Accounts</h2>
                    <p>Your banks, cards and cash, with today&apos;s balances.</p>
                </div>
            </div>

            <div className={`stats ${showCards ? 'three' : 'two'}`}>
                <div className="stat hero">
                    <span className="stat-top"><Landmark size={18} aria-hidden="true" /> In your banks</span>
                    <span className="stat-value">{formatRupees(inBanks)}</span>
                    <span className="stat-note">{banks.length} {banks.length === 1 ? 'account' : 'accounts'}</span>
                </div>
                <div className="stat">
                    <span className="stat-top"><span className="icon-tile t-cash" aria-hidden="true"><Banknote /></span> Cash in hand</span>
                    <span className="stat-value">{formatRupees(initialCash)}</span>
                </div>
                {showCards ? (
                    <div className="stat">
                        <span className="stat-top"><span className="icon-tile t-card" aria-hidden="true"><CreditCard /></span> Card dues</span>
                        <span className="stat-value">{formatRupees(cardDues)}</span>
                        <span className="stat-note">{cards.length} {cards.length === 1 ? 'card' : 'cards'}</span>
                    </div>
                ) : null}
            </div>

            <div className="setup-grid">
                <section id="bank-setup" className="card" aria-labelledby="bank-setup-title">
                    <div className="card-head">
                        <h3 id="bank-setup-title"><span className="icon-tile t-bank" aria-hidden="true"><Landmark /></span>Bank accounts</h3>
                    </div>
                    <div className="add-row">
                        <div className="field">
                            <label htmlFor="bank-name">Bank name</label>
                            <input type="text" id="bank-name" placeholder="For example HDFC Savings" value={bankName}
                                onChange={event => { setBankName(event.target.value); bankMessage.clear(); }} />
                        </div>
                        <div className="field">
                            <label htmlFor="bank-balance">Balance today (₹)</label>
                            <input type="number" id="bank-balance" inputMode="decimal" placeholder="0.00" step="0.01" value={bankBalance}
                                onChange={event => { setBankBalance(event.target.value); bankMessage.clear(); }} />
                        </div>
                        <button type="button" className="btn btn-primary" data-action="addBank" onClick={addBank}><Plus aria-hidden="true" /> Add bank</button>
                    </div>
                    <FormMessage id="bank-message" message={bankMessage.message} />
                    <div id="banks-list" className="table-wrap">
                        {banks.length === 0 ? (
                            <div className="empty"><Landmark aria-hidden="true" /><p>No banks added yet.</p></div>
                        ) : (
                            <table className="data-table stackable">
                                <thead>
                                    <tr><th scope="col">Bank</th><th scope="col" className="amount">Starting balance</th><th scope="col" className="amount">Current balance</th><th scope="col" className="actions"><span className="sr-only">Actions</span></th></tr>
                                </thead>
                                <tbody>
                                    {banks.map(bank => (
                                        <tr key={bank.id}>
                                            <td className="name">
                                                <span className="cell-with-icon"><span className="icon-tile t-bank" aria-hidden="true"><Landmark /></span>{bank.name}</span>
                                                {detailsText(bankDetails.get(bank.id)) ? <span className="sub bank-details">{detailsText(bankDetails.get(bank.id))}</span> : null}
                                            </td>
                                            <td className="amount" data-label="Starting balance">{formatRupees(bank.initial_balance)}</td>
                                            <td className="amount out" data-label="Current balance">{formatRupees(bank.current_balance)}</td>
                                            <td className="actions">
                                                <span className="row-actions">
                                                    <button type="button" className="icon-btn" data-action="edit-bank" data-id={bank.id}
                                                        onClick={() => setEditBank({
                                                            id: bank.id, name: bank.name, balance: String(parseFloat(bank.initial_balance)),
                                                            details: bankDetails.get(bank.id) ?? null,
                                                        })}>
                                                        <Pencil aria-hidden="true" /> Edit
                                                    </button>
                                                    <button type="button" className="icon-btn danger" data-action="delete-bank" data-id={bank.id}
                                                        onClick={() => setPendingDelete({ type: 'bank', id: bank.id })}>
                                                        <Trash2 aria-hidden="true" /> Delete
                                                    </button>
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </section>

                <section id="credit-card-setup" className={`card${showCards ? '' : ' hidden'}`} aria-labelledby="card-setup-title">
                    <div className="card-head">
                        <h3 id="card-setup-title"><span className="icon-tile t-card" aria-hidden="true"><CreditCard /></span>Credit cards</h3>
                    </div>
                    <div className="add-row">
                        <div className="field">
                            <label htmlFor="cc-name">Card name</label>
                            <input type="text" id="cc-name" placeholder="For example SBI SimplyCLICK" value={cardName}
                                onChange={event => { setCardName(event.target.value); cardMessage.clear(); }} />
                        </div>
                        <div className="field">
                            <label htmlFor="cc-limit">Credit limit (₹)</label>
                            <input type="number" id="cc-limit" inputMode="decimal" placeholder="0.00" step="0.01" value={cardLimit}
                                onChange={event => { setCardLimit(event.target.value); cardMessage.clear(); }} />
                        </div>
                        <button type="button" className="btn btn-primary" data-action="addCreditCard" onClick={addCard}><Plus aria-hidden="true" /> Add card</button>
                    </div>
                    <FormMessage id="credit-card-message" message={cardMessage.message} />
                    <div id="credit-cards-list" className="table-wrap">
                        {cards.length === 0 ? (
                            <div className="empty"><CreditCard aria-hidden="true" /><p>No credit cards added yet.</p></div>
                        ) : (
                            <table className="data-table stackable">
                                <thead>
                                    <tr><th scope="col">Card</th><th scope="col" className="amount">Limit</th><th scope="col" className="amount">Used</th><th scope="col" className="amount">Available</th><th scope="col" className="actions"><span className="sr-only">Actions</span></th></tr>
                                </thead>
                                <tbody>
                                    {cards.map(card => {
                                        const limit = parseFloat(card.credit_limit) || 0;
                                        const used = parseFloat(card.used_limit) || 0;
                                        const share = limit > 0 ? Math.min(used / limit, 1) : 0;
                                        return (
                                            <tr key={card.id}>
                                                <td className="name">
                                                    <span className="cell-with-icon">
                                                        <span className="icon-tile t-card" aria-hidden="true"><CreditCard /></span>
                                                        <span>{card.name}<span className="meter" title={`${Math.round(share * 100)}% of the limit used`}><i className={share > 0.7 ? 'high' : share > 0.3 ? 'warn' : undefined} style={{ width: `${share * 100}%` }} /></span></span>
                                                    </span>
                                                </td>
                                                <td className="amount" data-label="Limit">{formatRupees(card.credit_limit)}</td>
                                                <td className="amount" data-label="Used">{formatRupees(card.used_limit)}</td>
                                                <td className="amount out" data-label="Available">{formatRupees(limit - used)}</td>
                                                <td className="actions">
                                                    <span className="row-actions">
                                                        <button type="button" className="icon-btn" data-action="edit-credit-card" data-id={card.id}
                                                            onClick={() => setEditCard({ id: card.id, name: card.name, limit: String(parseFloat(card.credit_limit)), used: card.used_limit })}>
                                                            <Pencil aria-hidden="true" /> Edit
                                                        </button>
                                                        <button type="button" className="icon-btn danger" data-action="delete-credit-card" data-id={card.id}
                                                            onClick={() => setPendingDelete({ type: 'credit-card', id: card.id })}>
                                                            <Trash2 aria-hidden="true" /> Delete
                                                        </button>
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                </section>

                <section id="cash-setup" className="card" aria-labelledby="cash-setup-title">
                    <div className="card-head">
                        <h3 id="cash-setup-title"><span className="icon-tile t-cash" aria-hidden="true"><Wallet /></span>Cash in hand</h3>
                    </div>
                    <div className="add-row single">
                        <div className="field">
                            <label htmlFor="cash-balance">Cash you have now (₹)</label>
                            <input type="number" id="cash-balance" inputMode="decimal" placeholder="0.00" step="0.01" value={cashInput}
                                onChange={event => { setCashInput(event.target.value); cashMessage.clear(); }} />
                        </div>
                        <button type="button" className="btn btn-primary" data-action="setCashBalance" onClick={setCashBalance}><Banknote aria-hidden="true" /> Set cash</button>
                    </div>
                    <FormMessage id="cash-message" message={cashMessage.message} />
                    <div id="cash-display" className="cash-display">
                        <div>
                            <h4>Cash balance</h4>
                            <span className="cash-amount">{formatRupees(initialCash)}</span>
                        </div>
                        <button type="button" className="icon-btn" data-action="edit-cash-balance" disabled={initialCash === 0}
                            onClick={() => setEditCash(String(initialCash))}>
                            <Pencil aria-hidden="true" /> Edit
                        </button>
                    </div>
                </section>

                <OtherAccounts />
            </div>

            <Modal id="edit-bank-modal" title="Edit bank" open={editBank !== null} closeAction="close-edit-bank" onClose={() => setEditBank(null)}
                footer={modalButtons('save-bank', 'close-edit-bank', saveBank, () => setEditBank(null))}>
                <form id="edit-bank-form" className="form-grid" onSubmit={event => { event.preventDefault(); saveBank(); }}>
                    <div className="field">
                        <label htmlFor="edit-bank-name">Bank name</label>
                        <input type="text" id="edit-bank-name" required value={editBank?.name ?? ''}
                            onChange={event => setEditBank(current => current && { ...current, name: event.target.value })} />
                    </div>
                    <div className="field">
                        <label htmlFor="edit-bank-balance">Starting balance (₹)</label>
                        <input type="number" id="edit-bank-balance" inputMode="decimal" step="0.01" min="0" required value={editBank?.balance ?? ''}
                            onChange={event => setEditBank(current => current && { ...current, balance: event.target.value })} />
                    </div>
                    <div className="notice warn">Changing the starting balance moves the current balance by the same difference.</div>
                    {editBank?.details ? (
                        <>
                            <div className="field">
                                <label htmlFor="edit-bank-institution">Bank (optional)</label>
                                <input type="text" id="edit-bank-institution" placeholder="For example HDFC Bank" value={editBank.details.institution}
                                    onChange={event => setEditBank(current => current && current.details && { ...current, details: { ...current.details, institution: event.target.value } })} />
                            </div>
                            <div className="field">
                                <label htmlFor="edit-bank-account-type">Account type (optional)</label>
                                <select id="edit-bank-account-type" value={editBank.details.accountType}
                                    onChange={event => setEditBank(current => current && current.details && { ...current, details: { ...current.details, accountType: event.target.value } })}>
                                    <option value="">Not set</option>
                                    {ACCOUNT_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
                                </select>
                            </div>
                            <div className="field">
                                <label htmlFor="edit-bank-interest-rate">Savings interest, % a year (optional)</label>
                                <input type="number" id="edit-bank-interest-rate" inputMode="decimal" step="0.001" min="0" max="100" placeholder="3.25"
                                    value={editBank.details.interestRate}
                                    onChange={event => setEditBank(current => current && current.details && { ...current, details: { ...current.details, interestRate: event.target.value } })} />
                            </div>
                        </>
                    ) : null}
                </form>
            </Modal>

            <Modal id="edit-credit-card-modal" title="Edit credit card" open={editCard !== null} closeAction="close-edit-credit-card" onClose={() => setEditCard(null)}
                footer={modalButtons('save-credit-card', 'close-edit-credit-card', saveCard, () => setEditCard(null))}>
                <form id="edit-credit-card-form" className="form-grid" onSubmit={event => { event.preventDefault(); saveCard(); }}>
                    <div className="field">
                        <label htmlFor="edit-credit-card-name">Card name</label>
                        <input type="text" id="edit-credit-card-name" required value={editCard?.name ?? ''}
                            onChange={event => setEditCard(current => current && { ...current, name: event.target.value })} />
                    </div>
                    <div className="field">
                        <label htmlFor="edit-credit-card-limit">Credit limit (₹)</label>
                        <input type="number" id="edit-credit-card-limit" inputMode="decimal" step="0.01" min="0.01" required value={editCard?.limit ?? ''}
                            onChange={event => setEditCard(current => current && { ...current, limit: event.target.value })} />
                    </div>
                    <div id="credit-card-used-info" className="notice">
                        {editCard ? (
                            <span>
                                <strong>Current Used Limit:</strong> {formatRupees(editCard.used)}. The limit must be at least this amount.
                            </span>
                        ) : null}
                    </div>
                </form>
            </Modal>

            <Modal id="edit-cash-modal" title="Edit cash balance" open={editCash !== null} closeAction="close-edit-cash" onClose={() => setEditCash(null)}
                footer={modalButtons('save-cash-balance', 'close-edit-cash', saveCash, () => setEditCash(null))}>
                <form id="edit-cash-form" className="form-grid" onSubmit={event => { event.preventDefault(); saveCash(); }}>
                    <div className="field">
                        <label htmlFor="edit-cash-balance">Cash you have now (₹)</label>
                        <input type="number" id="edit-cash-balance" inputMode="decimal" step="0.01" min="0" required value={editCash ?? ''}
                            onChange={event => setEditCash(event.target.value)} />
                    </div>
                    <p>This replaces your current cash balance.</p>
                </form>
            </Modal>

            <Modal id="delete-setup-modal" title="Delete this account?" small open={pendingDelete !== null} closeAction="close-delete-setup" onClose={() => setPendingDelete(null)}
                footer={(
                    <>
                        <button type="button" data-action="close-delete-setup" className="btn btn-secondary" onClick={() => setPendingDelete(null)}>Cancel</button>
                        <button type="button" data-action="confirm-delete-setup" className="btn btn-danger" onClick={confirmDelete}>
                            <Trash2 aria-hidden="true" /> Delete
                        </button>
                    </>
                )}>
                <p id="delete-setup-message" className="lead">
                    {pendingDelete?.type === 'credit-card' ? 'Are you sure you want to delete this credit card?' : 'Are you sure you want to delete this bank?'}
                </p>
                <p>This cannot be undone, and is refused while the account has transactions.</p>
            </Modal>
        </div>
    );
}
