'use client';

import { useEffect, useState } from 'react';
import { Landmark, Plus, X } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { apiDelete, apiGet, apiPost, httpError, redirectIfUnauthorized } from '@/lib/api-client';
import { todayInIndiaClient } from '@/lib/dates';
import { formatRupees } from '@/lib/format';
import { t } from '@/lib/i18n';

/**
 * Loans from banks and lenders (/api/loans, v2 Phase 3): what is owed on each, the rate in both
 * forms and its true yearly cost, the next EMI and any missed, and recording EMIs, part payments,
 * top-ups, rate changes and closing early; the schedule and the per-year figures for tax.
 */

interface Account { id: number; type: string; name: string }
interface Payment { id: number; kind: string; date: string; principal: string; interest: string; charges: string; total: string; status: 'full' | 'partial' | 'late' | null }
interface Loan {
    id: number; name: string; lender: string | null; kind: string; rateType: 'reducing' | 'flat'; rateKind: 'fixed' | 'floating'; principal: string;
    yearlyRate: string; perHundredMonthly: string; months: number; emi: string; effectiveRate: number; outstanding: string; interestPaid: string;
    nextDue: { date: string; amount: string } | null; missed: number; monthsLeft: number; endsOn: string | null;
    foreclosure: { interest: string; charge: string; total: string } | null; byYear: { year: string; principal: string; interest: string; fees: string }[];
    schedule: { number: number; date: string; emi: string; interest: string; principal: string; prepaid: string; closing: string }[];
    payments: Payment[]; closed: boolean;
}
type Action = 'emi' | 'prepay' | 'topup' | 'rate' | 'close';

const MONEY = ['bank', 'cash', 'credit_card', 'wallet', 'meal_card'];
const KINDS = ['home', 'vehicle', 'personal', 'education', 'business', 'consumer', 'other'] as const;
const shortDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const ENDPOINT: Record<Action, string> = { emi: 'emi', prepay: 'prepay', topup: 'topup', rate: 'rate', close: 'close' };

const EMPTY = {
    name: '', lender: '', kind: 'home', rateType: 'reducing', rateKind: 'floating', principal: '', interestRate: '', rateUnit: 'year', months: '',
    disbursedOn: '', firstDue: '', emi: '', processingFee: '', otherCharges: '', foreclosureCharge: '', status: 'existing', accountId: '', outstanding: '',
};

export function LoansScreen() {
    const toast = useToast();
    const [loans, setLoans] = useState<Loan[] | null>(null);
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [form, setForm] = useState(EMPTY);
    const [acting, setActing] = useState<{ loan: Loan; action: Action; amount: string; accountId: string; date: string; interest: string; keep: string; rate: string; unit: string; charges: string } | null>(null);

    async function load() {
        const result = await apiGet<Loan[]>('/api/loans');
        if (redirectIfUnauthorized(result) || !result.ok) return;
        setLoans(result.data);
    }

    useEffect(() => {
        load();
        apiGet<Account[]>('/api/accounts').then(result => {
            if (!result.ok) return;
            const money = result.data.filter(account => MONEY.includes(account.type));
            setAccounts(money);
            setForm(current => ({ ...current, accountId: String(money[0]?.id ?? '') }));
        });
        // Once on page load
    }, []);

    if (!loans) return null;
    const firstAccount = String(accounts[0]?.id ?? '');
    const active = loans.filter(loan => !loan.closed);
    const owed = active.reduce((sum, loan) => sum + parseFloat(loan.outstanding), 0);
    const monthly = active.reduce((sum, loan) => sum + parseFloat(loan.nextDue?.amount ?? '0'), 0);
    const set = (key: keyof typeof EMPTY, value: string) => setForm(current => ({ ...current, [key]: value }));

    async function addLoan() {
        const { status, accountId, outstanding, ...rest } = form;
        const result = await apiPost<Loan>('/api/loans', { ...rest, months: Number(form.months), ...(status === 'existing' ? { outstanding } : { accountId: Number(accountId) }) });
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        toast('success', t('loans.added', { name: result.data.name }));
        setForm({ ...EMPTY, accountId: firstAccount });
        await load();
    }

    const open = (loan: Loan, action: Action) => setActing({
        loan, action, amount: action === 'emi' ? loan.nextDue?.amount ?? loan.emi : '', accountId: firstAccount, date: todayInIndiaClient(),
        interest: '', keep: action === 'rate' ? 'tenure' : 'emi', rate: '', unit: 'year', charges: '',
    });

    async function act() {
        if (!acting) return;
        const { loan, action } = acting;
        const body = action === 'rate'
            ? { from: acting.date, interestRate: acting.rate, rateUnit: acting.unit, keep: acting.keep }
            : { amount: acting.amount, accountId: Number(acting.accountId), date: acting.date, interest: acting.interest || undefined, keep: acting.keep, charges: acting.charges || undefined };
        const result = await apiPost<Loan & { interestSaved?: string }>(`/api/loans/${loan.id}/${ENDPOINT[action]}`, body);
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        const done = action === 'emi' ? t('loans.emiDone', { amount: formatRupees(acting.amount) })
            : action === 'prepay' ? `${t('loans.prepaid', { amount: formatRupees(acting.amount) })}. ${t('loans.saved', { amount: formatRupees(result.data.interestSaved ?? '0') })}`
                : action === 'topup' ? t('loans.toppedUp', { amount: formatRupees(acting.amount) })
                    : action === 'rate' ? t('loans.rateDone', { date: shortDate(acting.date) }) : t('loans.closedDone', { name: loan.name });
        toast('success', done);
        setActing(null);
        setLoans(current => (current ?? []).map(item => (item.id === result.data.id ? result.data : item)));
    }

    async function removePayment(loan: Loan, payment: Payment) {
        const result = await apiDelete<Loan>(`/api/loans/${loan.id}/payments/${payment.id}`);
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        setLoans(current => (current ?? []).map(item => (item.id === result.data.id ? result.data : item)));
    }

    async function removeLoan(loan: Loan) {
        const result = await apiDelete(`/api/loans/${loan.id}`);
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        await load();
    }

    return (
        <div id="loans-section">
            <div className="page-header">
                <div>
                    <h2>{t('loans.title')}</h2>
                    <p>{t('loans.subtitle')}</p>
                </div>
            </div>
            <div className="people-totals">
                <div className="card card-pad" id="loans-owed"><span className="label">{t('loans.totalOwed')}</span><b className="amount">{formatRupees(owed)}</b></div>
                <div className="card card-pad" id="loans-monthly"><span className="label">{t('loans.monthlyEmi')}</span><b className="amount">{formatRupees(monthly)}</b></div>
            </div>

            {loans.length === 0 ? <p className="card card-pad empty-note" id="loans-empty">{t('loans.none')}</p> : null}

            {loans.map(loan => (
                <section key={loan.id} className="card loan-card" data-loan={loan.name} aria-labelledby={`loan-${loan.id}`}>
                    <div className="card-head">
                        <h3 id={`loan-${loan.id}`}><span className="icon-tile t-bank" aria-hidden="true"><Landmark /></span>{loan.name}</h3>
                        <span className="meta loan-owed">{loan.closed ? t('loans.closedTag') : t('loans.owed', { amount: formatRupees(loan.outstanding) })}</span>
                    </div>
                    <div className="card-pad loan-facts">
                        <p>{[loan.lender, t(`loans.kinds.${loan.kind as typeof KINDS[number]}`), t('loans.rateLine', { year: loan.yearlyRate, month: loan.perHundredMonthly })].filter(Boolean).join(' · ')}</p>
                        <p className="loan-effective">{t('loans.effective', { rate: loan.effectiveRate })}</p>
                        {loan.rateType === 'flat' ? <p className="notice warn">{t('loans.flatNote')}</p> : null}
                        {loan.nextDue ? <p className="loan-next">{t('loans.nextDue', { amount: formatRupees(loan.nextDue.amount), date: shortDate(loan.nextDue.date) })}</p> : null}
                        {loan.missed > 0 ? <p className="notice warn loan-missed">{t('loans.missed', { count: loan.missed })}</p> : null}
                        {loan.endsOn && !loan.closed ? <p className="when">{t('loans.endsOn', { date: shortDate(loan.endsOn), count: loan.monthsLeft })}</p> : null}
                    </div>
                    {!loan.closed ? (
                        <div className="settings-actions">
                            <button type="button" className="btn btn-primary btn-sm" data-action="payEmi" onClick={() => open(loan, 'emi')}>{t('loans.payEmi')}</button>
                            <button type="button" className="btn btn-secondary btn-sm" data-action="prepay" onClick={() => open(loan, 'prepay')}>{t('loans.prepay')}</button>
                            <button type="button" className="btn btn-secondary btn-sm" data-action="topUp" onClick={() => open(loan, 'topup')}>{t('loans.topUp')}</button>
                            {loan.rateKind === 'floating' ? <button type="button" className="btn btn-secondary btn-sm" data-action="rateChange" onClick={() => open(loan, 'rate')}>{t('loans.rateChange')}</button> : null}
                            <button type="button" className="btn-link" data-action="closeLoan" onClick={() => open(loan, 'close')}>{t('loans.closeLoan')}</button>
                        </div>
                    ) : null}
                    {loan.byYear.length > 0 ? (
                        <div className="card-pad loan-years">
                            <span className="label">{t('loans.byYear')}</span>
                            <ul>{loan.byYear.map(year => (
                                <li key={year.year} data-year={year.year}>
                                    <b>{t('loans.fy', { year: year.year })}</b> {t('loans.yearLine', { principal: formatRupees(year.principal), interest: formatRupees(year.interest), fees: formatRupees(year.fees) })}
                                </li>
                            ))}</ul>
                        </div>
                    ) : null}
                    <details className="loan-more">
                        <summary className="card-pad">{t('loans.payments')} ({loan.payments.length})</summary>
                        <ul className="loan-history">
                            {loan.payments.map(payment => (
                                <li key={payment.id}>
                                    <span>{shortDate(payment.date)} · {t(`loans.paymentKinds.${payment.kind as 'emi'}`)}{payment.status && payment.status !== 'full' ? ` (${t(`loans.paymentStatus.${payment.status}`)})` : ''}</span>
                                    <span className="amount">{formatRupees(payment.total)}</span>
                                    {!['opening', 'disbursal'].includes(payment.kind) ? (
                                        <button type="button" className="chip-remove" aria-label={t('loans.removePayment')} onClick={() => removePayment(loan, payment)}><X aria-hidden="true" /></button>
                                    ) : null}
                                </li>
                            ))}
                        </ul>
                    </details>
                    <details className="loan-more">
                        <summary className="card-pad">{t('loans.schedule')}</summary>
                        <div className="loan-schedule">
                            <table className="data-table">
                                <thead><tr><th>#</th><th>{t('loans.scheduleHead.date')}</th><th>{t('loans.scheduleHead.emi')}</th><th>{t('loans.scheduleHead.interest')}</th><th>{t('loans.scheduleHead.principal')}</th><th>{t('loans.scheduleHead.left')}</th></tr></thead>
                                <tbody>
                                    {loan.schedule.map(row => (
                                        <tr key={row.number}><td>{row.number}</td><td>{shortDate(row.date)}</td><td className="amount">{formatRupees(row.emi)}</td>
                                            <td className="amount">{formatRupees(row.interest)}</td><td className="amount">{formatRupees(row.principal)}</td><td className="amount">{formatRupees(row.closing)}</td></tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="settings-actions"><button type="button" className="btn-link" data-action="removeLoan" onClick={() => removeLoan(loan)}>{t('loans.remove')}</button></div>
                    </details>
                </section>
            ))}

            <form className="card card-pad loan-form" onSubmit={event => { event.preventDefault(); addLoan(); }}>
                <h3><span className="icon-tile t-bank" aria-hidden="true"><Plus /></span>{t('loans.add')}</h3>
                <div className="segmented" role="radiogroup" aria-label={t('loans.status')}>
                    {(['existing', 'new'] as const).map(status => (
                        <button key={status} type="button" role="radio" aria-checked={form.status === status} data-status={status} onClick={() => set('status', status)}>
                            {t(`loans.statuses.${status}`)}
                        </button>
                    ))}
                </div>
                <div className="form-grid two">
                    <div className="field"><label htmlFor="loan-name">{t('loans.name')}</label><input id="loan-name" type="text" maxLength={80} placeholder={t('loans.namePlaceholder')} value={form.name} onChange={event => set('name', event.target.value)} /></div>
                    <div className="field"><label htmlFor="loan-lender">{t('loans.lender')}</label><input id="loan-lender" type="text" maxLength={100} value={form.lender} onChange={event => set('lender', event.target.value)} /></div>
                    <div className="field"><label htmlFor="loan-kind">{t('loans.kind')}</label>
                        <select id="loan-kind" value={form.kind} onChange={event => set('kind', event.target.value)}>{KINDS.map(kind => <option key={kind} value={kind}>{t(`loans.kinds.${kind}`)}</option>)}</select></div>
                    <div className="field"><label htmlFor="loan-principal">{t('loans.principal')}</label><input id="loan-principal" type="number" inputMode="decimal" min="1" step="0.01" value={form.principal} onChange={event => set('principal', event.target.value)} /></div>
                    <div className="field"><label htmlFor="loan-rate">{t('loans.rate')}</label><input id="loan-rate" type="number" inputMode="decimal" min="0" step="0.001" value={form.interestRate} onChange={event => set('interestRate', event.target.value)} /></div>
                    <div className="field"><label htmlFor="loan-unit">{t('loans.rateUnit')}</label>
                        <select id="loan-unit" value={form.rateUnit} onChange={event => set('rateUnit', event.target.value)}>
                            <option value="year">{t('loans.units.year')}</option><option value="per100month">{t('loans.units.per100month')}</option>
                        </select></div>
                    <div className="field"><label htmlFor="loan-rate-type">{t('loans.rateType')}</label>
                        <select id="loan-rate-type" value={form.rateType} onChange={event => set('rateType', event.target.value)}>
                            <option value="reducing">{t('loans.rateTypes.reducing')}</option><option value="flat">{t('loans.rateTypes.flat')}</option>
                        </select></div>
                    <div className="field"><label htmlFor="loan-rate-kind">{t('loans.rateKind')}</label>
                        <select id="loan-rate-kind" value={form.rateKind} onChange={event => set('rateKind', event.target.value)}>
                            <option value="floating">{t('loans.rateKinds.floating')}</option><option value="fixed">{t('loans.rateKinds.fixed')}</option>
                        </select></div>
                    <div className="field"><label htmlFor="loan-months">{t('loans.months')}</label><input id="loan-months" type="number" inputMode="numeric" min="1" max="480" value={form.months} onChange={event => set('months', event.target.value)} /></div>
                    <div className="field"><label htmlFor="loan-disbursed">{t('loans.disbursedOn')}</label><input id="loan-disbursed" type="date" value={form.disbursedOn} onChange={event => set('disbursedOn', event.target.value)} /></div>
                    <div className="field"><label htmlFor="loan-first-due">{t('loans.firstDue')}</label><input id="loan-first-due" type="date" value={form.firstDue} onChange={event => set('firstDue', event.target.value)} /></div>
                    <div className="field"><label htmlFor="loan-emi">{t('loans.emi')}</label><input id="loan-emi" type="number" inputMode="decimal" min="0" step="0.01" value={form.emi} onChange={event => set('emi', event.target.value)} /></div>
                    {form.status === 'existing' ? (
                        <div className="field"><label htmlFor="loan-outstanding">{t('loans.outstanding')}</label><input id="loan-outstanding" type="number" inputMode="decimal" min="0" step="0.01" value={form.outstanding} onChange={event => set('outstanding', event.target.value)} /></div>
                    ) : (
                        <>
                            <div className="field"><label htmlFor="loan-into">{t('loans.into')}</label>
                                <select id="loan-into" value={form.accountId} onChange={event => set('accountId', event.target.value)}>{accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></div>
                            <div className="field"><label htmlFor="loan-fee">{t('loans.processingFee')}</label><input id="loan-fee" type="number" inputMode="decimal" min="0" step="0.01" value={form.processingFee} onChange={event => set('processingFee', event.target.value)} /></div>
                            <div className="field"><label htmlFor="loan-charges">{t('loans.otherCharges')}</label><input id="loan-charges" type="number" inputMode="decimal" min="0" step="0.01" value={form.otherCharges} onChange={event => set('otherCharges', event.target.value)} /></div>
                        </>
                    )}
                    <div className="field"><label htmlFor="loan-foreclosure">{t('loans.foreclosureCharge')}</label><input id="loan-foreclosure" type="number" inputMode="decimal" min="0" max="10" step="0.01" value={form.foreclosureCharge} onChange={event => set('foreclosureCharge', event.target.value)} /></div>
                </div>
                <button type="submit" className="btn btn-primary" data-action="addLoan"><Plus aria-hidden="true" /> {t('loans.save')}</button>
            </form>

            <Modal id="loan-action-modal" title={acting ? `${t(`loans.${acting.action === 'emi' ? 'payEmi' : acting.action === 'prepay' ? 'prepay' : acting.action === 'topup' ? 'topUp' : acting.action === 'rate' ? 'rateChange' : 'closeLoan'}`)}: ${acting.loan.name}` : ''}
                open={acting !== null} closeAction="close-loan-action" onClose={() => setActing(null)}
                footer={(
                    <>
                        <button type="button" className="btn btn-secondary" data-action="close-loan-action" onClick={() => setActing(null)}>{t('common.cancel')}</button>
                        <button type="button" className="btn btn-primary" data-action="saveLoanAction" onClick={act}>
                            {acting?.action === 'close' && acting.loan.foreclosure ? t('loans.closeConfirm', { total: formatRupees(acting.loan.foreclosure.total) }) : t('loans.save')}
                        </button>
                    </>
                )}>
                {acting ? (
                    <div className="form-grid two">
                        {acting.action === 'close' && acting.loan.foreclosure ? (
                            <p className="field full" id="loan-foreclosure-quote">{t('loans.foreclosure', {
                                total: formatRupees(acting.loan.foreclosure.total), interest: formatRupees(acting.loan.foreclosure.interest), charge: formatRupees(acting.loan.foreclosure.charge),
                            })}</p>
                        ) : null}
                        {acting.action === 'rate' ? (
                            <>
                                <div className="field"><label htmlFor="act-rate">{t('loans.newRate')}</label><input id="act-rate" type="number" inputMode="decimal" min="0" step="0.001" value={acting.rate} onChange={event => setActing({ ...acting, rate: event.target.value })} /></div>
                                <div className="field"><label htmlFor="act-unit">{t('loans.rateUnit')}</label>
                                    <select id="act-unit" value={acting.unit} onChange={event => setActing({ ...acting, unit: event.target.value })}>
                                        <option value="year">{t('loans.units.year')}</option><option value="per100month">{t('loans.units.per100month')}</option>
                                    </select></div>
                            </>
                        ) : acting.action !== 'close' ? (
                            <div className="field"><label htmlFor="act-amount">{t('loans.amount')}</label><input id="act-amount" type="number" inputMode="decimal" min="0.01" step="0.01" value={acting.amount} onChange={event => setActing({ ...acting, amount: event.target.value })} /></div>
                        ) : null}
                        {acting.action !== 'rate' ? (
                            <div className="field"><label htmlFor="act-account">{acting.action === 'topup' ? t('loans.into') : t('loans.fromAccount')}</label>
                                <select id="act-account" value={acting.accountId} onChange={event => setActing({ ...acting, accountId: event.target.value })}>{accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></div>
                        ) : null}
                        <div className="field"><label htmlFor="act-date">{acting.action === 'rate' ? t('loans.from') : t('loans.date')}</label><input id="act-date" type="date" value={acting.date} onChange={event => setActing({ ...acting, date: event.target.value })} /></div>
                        {acting.action === 'emi' ? (
                            <div className="field"><label htmlFor="act-interest">{t('loans.interestPart')}</label><input id="act-interest" type="number" inputMode="decimal" min="0" step="0.01" value={acting.interest} onChange={event => setActing({ ...acting, interest: event.target.value })} /></div>
                        ) : null}
                        {acting.action === 'prepay' ? (
                            <div className="field"><label htmlFor="act-charges">{t('loans.charges')}</label><input id="act-charges" type="number" inputMode="decimal" min="0" step="0.01" value={acting.charges} onChange={event => setActing({ ...acting, charges: event.target.value })} /></div>
                        ) : null}
                        {acting.action === 'prepay' || acting.action === 'rate' ? (
                            <div className="field full"><label htmlFor="act-keep">{acting.action === 'rate' ? t('loans.rateKeep') : t('loans.keep')}</label>
                                <select id="act-keep" value={acting.keep} onChange={event => setActing({ ...acting, keep: event.target.value })}>
                                    {acting.action === 'rate' ? (
                                        <>
                                            <option value="tenure">{t('loans.rateKeeps.tenure')}</option>
                                            <option value="emi">{t('loans.rateKeeps.emi')}</option>
                                        </>
                                    ) : (
                                        <>
                                            <option value="emi">{t('loans.keeps.emi')}</option>
                                            <option value="tenure">{t('loans.keeps.tenure')}</option>
                                        </>
                                    )}
                                </select></div>
                        ) : null}
                    </div>
                ) : null}
            </Modal>
        </div>
    );
}
