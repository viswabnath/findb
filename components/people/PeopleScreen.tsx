'use client';

import { useEffect, useState } from 'react';
import { HandCoins, UserPlus, Users, X } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { apiDelete, apiGet, apiPost, httpError, redirectIfUnauthorized } from '@/lib/api-client';
import { todayInIndiaClient } from '@/lib/dates';
import { formatRupees } from '@/lib/format';
import { t } from '@/lib/i18n';

/**
 * Money with people (/api/people, v2 Phase 3): who owes the user and whom the user owes, each loan
 * with its status, what is left and the interest due (shown % a year and ₹ per ₹100 a month), and
 * lending, borrowing, repayments in parts, and settling what is left as a gift.
 */

interface Account { id: number; type: string; name: string }
interface LoanEvent { entryId: number; date: string; type: 'person_loan' | 'person_repayment' | 'person_settlement'; amount: string; principal: string; interest: string; account: string | null }
interface Loan {
    id: number; direction: 'lent' | 'borrowed'; principal: string; startedOn: string; dueOn: string | null; interestRate: string | null; perHundredMonthly: string | null;
    notes: string | null; outstanding: string; principalRepaid: string; interestPaid: string; interestDue: string; status: 'open' | 'overdue' | 'settled'; closed: boolean; history: LoanEvent[];
}
interface Person { id: number; name: string; notes: string | null; balance: string; loans: Loan[] }
interface People { people: Person[]; owedToYou: string; youOwe: string }

type LoanForm = { person: Person; direction: 'lent' | 'borrowed'; amount: string; accountId: string; date: string; dueOn: string; rate: string; unit: 'year' | 'per100month'; notes: string };
type PayForm = { person: Person; loan: Loan; amount: string; interest: string; accountId: string; date: string };

const shortDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const paise = (amount: string) => Math.round(parseFloat(amount || '0') * 100);
const MONEY = ['bank', 'cash', 'credit_card', 'wallet', 'meal_card'];

export function PeopleScreen() {
    const toast = useToast();
    const [data, setData] = useState<People | null>(null);
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [newName, setNewName] = useState('');
    const [loanForm, setLoanForm] = useState<LoanForm | null>(null);
    const [payForm, setPayForm] = useState<PayForm | null>(null);
    const [settling, setSettling] = useState<{ person: Person; loan: Loan } | null>(null);

    async function load() {
        const result = await apiGet<People>('/api/people');
        if (redirectIfUnauthorized(result) || !result.ok) return;
        setData(result.data);
    }

    useEffect(() => {
        load();
        apiGet<Account[]>('/api/accounts').then(result => { if (result.ok) setAccounts(result.data.filter(account => MONEY.includes(account.type))); });
        // Once on page load
    }, []);

    if (!data) return null;

    const firstAccount = String(accounts[0]?.id ?? '');

    async function addPerson() {
        if (!newName.trim()) return toast('error', t('people.needName'));
        const result = await apiPost<{ name: string }>('/api/people', { name: newName });
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        setNewName('');
        toast('success', t('people.added', { name: result.data.name }));
        await load();
    }

    async function removePerson(person: Person) {
        const result = await apiDelete(`/api/people/${person.id}`);
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        await load();
    }

    async function saveLoan() {
        if (!loanForm) return;
        const result = await apiPost(`/api/people/${loanForm.person.id}/loans`, {
            direction: loanForm.direction, amount: loanForm.amount, accountId: Number(loanForm.accountId), date: loanForm.date,
            dueOn: loanForm.dueOn || null, interestRate: loanForm.rate || null, rateUnit: loanForm.unit, notes: loanForm.notes,
        });
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        toast('success', t(loanForm.direction === 'lent' ? 'people.lentDone' : 'people.borrowedDone', { amount: formatRupees(loanForm.amount), name: loanForm.person.name }));
        setLoanForm(null);
        await load();
    }

    async function savePayment() {
        if (!payForm) return;
        const result = await apiPost(`/api/person-loans/${payForm.loan.id}/repayments`, {
            amount: payForm.amount, interest: payForm.interest === '' ? null : payForm.interest, accountId: Number(payForm.accountId), date: payForm.date,
        });
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        toast('success', t('people.repaid', { amount: formatRupees(payForm.amount) }));
        setPayForm(null);
        await load();
    }

    async function settle() {
        if (!settling) return;
        const result = await apiPost(`/api/person-loans/${settling.loan.id}/settle`, {});
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        setSettling(null);
        await load();
    }

    async function removeEvent(loan: Loan, event: LoanEvent) {
        const result = event.type === 'person_loan'
            ? await apiDelete(`/api/person-loans/${loan.id}`)
            : await apiDelete(`/api/person-loans/${loan.id}/repayments/${event.entryId}`);
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        await load();
    }

    const balanceText = (person: Person) => {
        const value = parseFloat(person.balance);
        if (value > 0) return t('people.owesYou', { amount: formatRupees(person.balance) });
        if (value < 0) return t('people.youOwe', { amount: formatRupees(String(-value)) });
        return t('people.square');
    };

    const openLoan = (person: Person, direction: 'lent' | 'borrowed') => setLoanForm({
        person, direction, amount: '', accountId: firstAccount, date: todayInIndiaClient(), dueOn: '', rate: '', unit: 'year', notes: '',
    });

    return (
        <div id="people-section">
            <div className="page-header">
                <div>
                    <h2>{t('people.title')}</h2>
                    <p>{t('people.subtitle')}</p>
                </div>
            </div>

            <div className="people-totals">
                <div className="card card-pad" id="people-owed-to-you"><span className="label">{t('people.owedToYou')}</span><b className="amount in">{formatRupees(data.owedToYou)}</b></div>
                <div className="card card-pad" id="people-you-owe"><span className="label">{t('people.youOweTotal')}</span><b className="amount">{formatRupees(data.youOwe)}</b></div>
            </div>

            <form className="card add-row single people-add" onSubmit={event => { event.preventDefault(); addPerson(); }}>
                <div className="field">
                    <label htmlFor="person-name">{t('people.addPerson')}</label>
                    <input id="person-name" type="text" maxLength={80} placeholder={t('people.namePlaceholder')} value={newName} onChange={event => setNewName(event.target.value)} />
                </div>
                <button type="submit" className="btn btn-primary" data-action="addPerson"><UserPlus aria-hidden="true" /> {t('people.add')}</button>
            </form>

            {data.people.length === 0 ? <p className="card card-pad empty-note" id="people-empty">{t('people.empty')}</p> : null}

            {data.people.map(person => (
                <section key={person.id} className="card person-card" aria-labelledby={`person-${person.id}`} data-person={person.name}>
                    <div className="card-head">
                        <h3 id={`person-${person.id}`}><span className="icon-tile t-bank" aria-hidden="true"><Users /></span>{person.name}</h3>
                        <span className="meta person-balance">{balanceText(person)}</span>
                    </div>
                    <div className="settings-actions">
                        <button type="button" className="btn btn-secondary btn-sm" data-action="lend" onClick={() => openLoan(person, 'lent')}>{t('people.lend')}</button>
                        <button type="button" className="btn btn-secondary btn-sm" data-action="borrow" onClick={() => openLoan(person, 'borrowed')}>{t('people.borrow')}</button>
                        {person.loans.every(loan => loan.status === 'settled') && parseFloat(person.balance) === 0 ? (
                            <button type="button" className="btn-link" data-action="removePerson" onClick={() => removePerson(person)}>{t('people.remove', { name: person.name })}</button>
                        ) : null}
                    </div>
                    <ul className="settings-list person-loans">
                        {person.loans.map(loan => (
                            <li key={loan.id} data-loan={loan.id} className={`person-loan loan-${loan.status}`}>
                                <div className="budget-line">
                                    <span className="what">
                                        {t(loan.direction === 'lent' ? 'people.lentLine' : 'people.borrowedLine', { amount: formatRupees(loan.principal), date: shortDate(loan.startedOn) })}
                                        <span className={`tag status-${loan.status}`}>{t(`people.status.${loan.status}`)}</span>
                                    </span>
                                    <span className="budget-figures">{loan.status === 'settled' ? t('people.settledLine') : t('people.left', { amount: formatRupees(loan.outstanding) })}</span>
                                </div>
                                <span className="when">
                                    {loan.dueOn ? `${t('people.due', { date: shortDate(loan.dueOn) })} · ` : ''}
                                    {loan.interestRate
                                        ? t('people.rate', { year: loan.interestRate, month: loan.perHundredMonthly ?? '' })
                                        : t('people.noInterest')}
                                    {parseFloat(loan.interestDue) > 0 ? ` · ${t('people.interestDue', { amount: formatRupees(loan.interestDue) })}` : ''}
                                </span>
                                <ul className="loan-history">
                                    {loan.history.map(event => (
                                        <li key={event.entryId}>
                                            <span>{shortDate(event.date)} · {t(`people.events.${event.type}`, { account: event.account ?? '' })}</span>
                                            <span className="amount">
                                                {formatRupees(event.amount)}
                                                {parseFloat(event.interest) > 0 ? ` ${t('people.ofInterest', { amount: formatRupees(event.interest) })}` : ''}
                                            </span>
                                            <button type="button" className="chip-remove" data-action="removeLoanEvent"
                                                aria-label={event.type === 'person_loan' ? t('people.removeLoan') : t('people.removeEvent', { date: shortDate(event.date) })}
                                                onClick={() => removeEvent(loan, event)}>
                                                <X aria-hidden="true" />
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                                {loan.status !== 'settled' ? (
                                    <span className="budget-actions">
                                        <button type="button" className="btn btn-primary btn-sm" data-action="repay" onClick={() => setPayForm({
                                            person, loan, amount: '', interest: parseFloat(loan.interestDue) > 0 ? loan.interestDue : '', accountId: firstAccount, date: todayInIndiaClient(),
                                        })}>
                                            <HandCoins aria-hidden="true" /> {t(loan.direction === 'lent' ? 'people.gotBack' : 'people.paidBack')}
                                        </button>
                                        <button type="button" className="btn-link" data-action="settleGift" onClick={() => setSettling({ person, loan })}>{t('people.settleGift')}</button>
                                    </span>
                                ) : null}
                            </li>
                        ))}
                    </ul>
                </section>
            ))}

            <Modal id="person-loan-modal" title={loanForm ? t(loanForm.direction === 'lent' ? 'people.lendTitle' : 'people.borrowTitle', { name: loanForm.person.name }) : ''}
                open={loanForm !== null} closeAction="close-person-loan" onClose={() => setLoanForm(null)}
                footer={(
                    <>
                        <button type="button" className="btn btn-secondary" data-action="close-person-loan" onClick={() => setLoanForm(null)}>{t('common.cancel')}</button>
                        <button type="button" className="btn btn-primary" data-action="savePersonLoan" onClick={saveLoan}>{t('people.save')}</button>
                    </>
                )}>
                {loanForm ? (
                    <div className="form-grid two">
                        <div className="field">
                            <label htmlFor="loan-amount">{t('people.amount')}</label>
                            <input id="loan-amount" type="number" inputMode="decimal" min="0.01" step="0.01" value={loanForm.amount} onChange={event => setLoanForm({ ...loanForm, amount: event.target.value })} />
                        </div>
                        <div className="field">
                            <label htmlFor="loan-account">{t(loanForm.direction === 'lent' ? 'people.fromAccount' : 'people.intoAccount')}</label>
                            <select id="loan-account" value={loanForm.accountId} onChange={event => setLoanForm({ ...loanForm, accountId: event.target.value })}>
                                {accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
                            </select>
                        </div>
                        <div className="field">
                            <label htmlFor="loan-date">{t('people.date')}</label>
                            <input id="loan-date" type="date" value={loanForm.date} onChange={event => setLoanForm({ ...loanForm, date: event.target.value })} />
                        </div>
                        <div className="field">
                            <label htmlFor="loan-due">{t('people.dueOn')}</label>
                            <input id="loan-due" type="date" value={loanForm.dueOn} onChange={event => setLoanForm({ ...loanForm, dueOn: event.target.value })} />
                        </div>
                        <div className="field">
                            <label htmlFor="loan-rate">{t('people.interest')}</label>
                            <input id="loan-rate" type="number" inputMode="decimal" min="0" step="0.001" placeholder={t('people.interestFree')} value={loanForm.rate}
                                onChange={event => setLoanForm({ ...loanForm, rate: event.target.value })} />
                        </div>
                        <div className="field">
                            <label htmlFor="loan-unit">{t('people.rateUnit')}</label>
                            <select id="loan-unit" value={loanForm.unit} onChange={event => setLoanForm({ ...loanForm, unit: event.target.value as LoanForm['unit'] })}>
                                <option value="year">{t('people.units.year')}</option>
                                <option value="per100month">{t('people.units.per100month')}</option>
                            </select>
                        </div>
                        <div className="field full">
                            <label htmlFor="loan-notes">{t('people.notes')}</label>
                            <input id="loan-notes" type="text" maxLength={500} value={loanForm.notes} onChange={event => setLoanForm({ ...loanForm, notes: event.target.value })} />
                        </div>
                    </div>
                ) : null}
            </Modal>

            <Modal id="repayment-modal" title={payForm ? t(payForm.loan.direction === 'lent' ? 'people.gotBackTitle' : 'people.paidBackTitle', { name: payForm.person.name }) : ''}
                open={payForm !== null} closeAction="close-repayment" onClose={() => setPayForm(null)}
                footer={(
                    <>
                        <button type="button" className="btn btn-secondary" data-action="close-repayment" onClick={() => setPayForm(null)}>{t('common.cancel')}</button>
                        <button type="button" className="btn btn-primary" data-action="saveRepayment" onClick={savePayment}>{t('people.save')}</button>
                    </>
                )}>
                {payForm ? (
                    <>
                        <p className="form-note" id="repayment-owed">
                            {t('people.owedNow', { amount: formatRupees(payForm.loan.outstanding) })}
                            {parseFloat(payForm.loan.interestDue) > 0 ? ` ${t('people.plusInterest', { amount: formatRupees(payForm.loan.interestDue) })}` : ''}
                        </p>
                        <div className="form-grid two">
                            <div className="field">
                                <label htmlFor="repay-amount">{t('people.amount')}</label>
                                <input id="repay-amount" type="number" inputMode="decimal" min="0.01" step="0.01" value={payForm.amount} onChange={event => setPayForm({ ...payForm, amount: event.target.value })} />
                            </div>
                            <div className="field">
                                <label htmlFor="repay-account">{t(payForm.loan.direction === 'lent' ? 'people.intoAccount' : 'people.fromAccount')}</label>
                                <select id="repay-account" value={payForm.accountId} onChange={event => setPayForm({ ...payForm, accountId: event.target.value })}>
                                    {accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
                                </select>
                            </div>
                            <div className="field">
                                <label htmlFor="repay-date">{t('people.date')}</label>
                                <input id="repay-date" type="date" value={payForm.date} onChange={event => setPayForm({ ...payForm, date: event.target.value })} />
                            </div>
                            {payForm.loan.interestRate ? (
                                <div className="field">
                                    <label htmlFor="repay-interest">{t('people.interestPart')}</label>
                                    <input id="repay-interest" type="number" inputMode="decimal" min="0" step="0.01" value={payForm.interest} onChange={event => setPayForm({ ...payForm, interest: event.target.value })} />
                                </div>
                            ) : null}
                        </div>
                        {payForm.amount ? (
                            <p className="form-note" id="repayment-split">
                                {t('people.split', {
                                    principal: formatRupees(String(Math.max(paise(payForm.amount) - paise(payForm.interest), 0) / 100)),
                                    interest: formatRupees(payForm.interest || '0'),
                                })}
                            </p>
                        ) : null}
                    </>
                ) : null}
            </Modal>

            <Modal id="settle-gift-modal" title={t('people.settleTitle')} open={settling !== null} small closeAction="close-settle" onClose={() => setSettling(null)}
                footer={(
                    <>
                        <button type="button" className="btn btn-secondary" data-action="close-settle" onClick={() => setSettling(null)}>{t('common.cancel')}</button>
                        <button type="button" className="btn btn-primary" data-action="confirmSettle" onClick={settle}>{t('people.settleConfirm')}</button>
                    </>
                )}>
                <p id="settle-text">{settling ? t(settling.loan.direction === 'lent' ? 'people.settleLent' : 'people.settleBorrowed', {
                    amount: formatRupees(settling.loan.outstanding), name: settling.person.name,
                }) : ''}</p>
            </Modal>
        </div>
    );
}
