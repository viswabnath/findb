'use client';

import { useMemo, useState } from 'react';
import { CircleCheck, Plus, TriangleAlert, X } from 'lucide-react';
import {
    chitFund, emi, fixedDeposit, goldValue, inflation, interestPerHundredBorrowed, payoff, perHundredMonthly,
    recurringDeposit, sip, type Karat, type LoanInput,
} from '@/src/core/calculators';
import { NumberField, RateField, Row, SplitBar, perHundred as paise, rupees } from './fields';

/* Each calculator opens with realistic sample values, so it shows what it does before any typing. */

export function EmiCalculator() {
    const [amount, setAmount] = useState(2500000);
    const [rate, setRate] = useState(8.5);
    const [years, setYears] = useState(20);
    const result = useMemo(() => emi(amount, rate, Math.max(1, Math.round(years * 12))), [amount, rate, years]);
    const monthly = perHundredMonthly(rate);
    return (
        <div className="calc">
            <div className="calc-form">
                <NumberField label="Loan amount (₹)" value={amount} onChange={setAmount} min={50000} max={20000000} step={50000} />
                <RateField label="Interest rate" value={rate} onChange={setRate} min={1} max={36} step={0.05} />
                <NumberField label="Tenure (years)" value={years} onChange={setYears} min={1} max={30} step={1} unit="years" />
            </div>
            <div className="calc-result result" aria-live="polite">
                <div className="result-main">
                    <span className="label">Your monthly EMI</span>
                    <span className="value">{rupees(result.emi)}</span>
                </div>
                <div className="verdict-box">
                    <span>
                        {Number(rate.toFixed(2))}% a year is <strong>{paise(monthly)} per ₹100 a month</strong>. Over the whole loan you pay{' '}
                        <strong>{paise(interestPerHundredBorrowed(result.totalInterest, amount))}</strong> of interest on every ₹100 borrowed.
                    </span>
                </div>
                <SplitBar a={amount} b={result.totalInterest} labelA="Loan" labelB="Interest" />
                <div className="result-rows">
                    <Row label="Interest per ₹100 a month" value={paise(monthly)} />
                    <Row label="Interest on every ₹100 borrowed, in total" value={paise(interestPerHundredBorrowed(result.totalInterest, amount))} />
                    <Row label="Total interest" value={rupees(result.totalInterest)} />
                    <Row label="Total you pay" value={rupees(result.totalPaid)} />
                    <Row label="Interest in year 1" value={rupees(result.years[0]?.interestPaid ?? 0)} />
                </div>
                <div className="table-wrap">
                    <table>
                        <caption className="sr-only">Principal and interest paid each year</caption>
                        <thead><tr><th scope="col">Year</th><th scope="col">Principal</th><th scope="col">Interest</th><th scope="col">Balance</th></tr></thead>
                        <tbody>
                            {result.years.map(year => (
                                <tr key={year.year}>
                                    <td>{year.year}</td>
                                    <td>{rupees(year.principalPaid)}</td>
                                    <td>{rupees(year.interestPaid)}</td>
                                    <td>{rupees(year.balance)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

interface LoanRow extends LoanInput {
    id: number;
}

const SAMPLE_LOANS: LoanRow[] = [
    { id: 1, name: 'Credit card', balance: 60000, annualRate: 42, emi: 3000 },
    { id: 2, name: 'Personal loan', balance: 300000, annualRate: 14, emi: 10000 },
    { id: 3, name: 'Car loan', balance: 450000, annualRate: 9.5, emi: 12000 },
];

export function PayoffCalculator() {
    const [loans, setLoans] = useState<LoanRow[]>(SAMPLE_LOANS);
    const [extra, setExtra] = useState(10000);
    const [nextId, setNextId] = useState(4);

    const valid = loans.filter(loan => loan.name.trim() && loan.balance > 0);
    const named = valid.map((loan, index) => ({ ...loan, name: `${loan.name.trim()}${valid.findIndex(other => other.name.trim() === loan.name.trim()) !== index ? ` (${index + 1})` : ''}` }));
    // Cheap enough to recompute on every change: at most 600 months for a handful of loans
    const base = payoff(named, 0);
    const withExtra = payoff(named, extra);

    const update = (id: number, field: keyof LoanInput, value: string) =>
        setLoans(rows => rows.map(row => row.id === id ? { ...row, [field]: field === 'name' ? value : Number(value) || 0 } : row));

    return (
        <div className="calc">
            <div className="calc-form">
                <div className="loan-list">
                    {loans.map(loan => (
                        <div className="loan-row" key={loan.id}>
                            <label>Loan<input value={loan.name} onChange={event => update(loan.id, 'name', event.target.value)} /></label>
                            <label>Balance (₹)<input inputMode="decimal" value={loan.balance} onChange={event => update(loan.id, 'balance', event.target.value)} /></label>
                            <label>Rate (%)<input inputMode="decimal" value={loan.annualRate} onChange={event => update(loan.id, 'annualRate', event.target.value)} /></label>
                            <label>EMI (₹)<input inputMode="decimal" value={loan.emi} onChange={event => update(loan.id, 'emi', event.target.value)} /></label>
                            <button type="button" className="icon-button" aria-label={`Remove ${loan.name || 'loan'}`} onClick={() => setLoans(rows => rows.filter(row => row.id !== loan.id))}>
                                <X size={18} />
                            </button>
                        </div>
                    ))}
                </div>
                <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ justifySelf: 'start' }}
                    onClick={() => {
                        setLoans(rows => [...rows, { id: nextId, name: `Loan ${nextId}`, balance: 100000, annualRate: 12, emi: 5000 }]);
                        setNextId(id => id + 1);
                    }}
                >
                    <Plus size={16} /> Add a loan
                </button>
                <NumberField label="Extra you can pay each month (₹)" value={extra} onChange={setExtra} min={0} max={100000} step={1000} />
            </div>
            <div className="calc-result result" aria-live="polite">
                {named.length === 0 ? (
                    <p className="calc-note">Add a loan with a balance to see the plan.</p>
                ) : !base.clears ? (
                    <div className="verdict-box warn"><TriangleAlert size={20} /><span>At least one EMI is smaller than the interest it gathers each month, so that loan never closes. Raise its EMI.</span></div>
                ) : (
                    <>
                        <div className="result-main">
                            <span className="label">Interest you save by paying {rupees(extra)} extra</span>
                            <span className="value">{rupees(base.totalInterest - withExtra.totalInterest)}</span>
                        </div>
                        <div className="result-rows">
                            <Row label="Debt-free in, paying only EMIs" value={`${base.months} months`} />
                            <Row label="Debt-free in, with the extra" value={`${withExtra.months} months`} />
                            <Row label="Interest, paying only EMIs" value={rupees(base.totalInterest)} />
                            <Row label="Interest, with the extra" value={rupees(withExtra.totalInterest)} />
                            <Row label="Interest on every ₹100 owed today, with the extra"
                                value={paise(interestPerHundredBorrowed(withExtra.totalInterest, named.reduce((sum, loan) => sum + loan.balance, 0)))} />
                        </div>
                        <span className="label" style={{ fontWeight: 700 }}>Put the extra here, in this order</span>
                        <ol className="order-list">
                            {withExtra.order.map(name => {
                                const loan = named.find(row => row.name === name)!;
                                return (
                                    <li key={name}>
                                        <span>{name}<br /><small>{loan.annualRate}% a year, {paise(perHundredMonthly(loan.annualRate))} per ₹100 a month</small></span>
                                        <small>Closed in month {withExtra.closedIn[name]}</small>
                                    </li>
                                );
                            })}
                        </ol>
                        <p className="calc-note">Highest interest rate first saves the most money. When a loan closes, its EMI joins the extra for the next one.</p>
                    </>
                )}
            </div>
        </div>
    );
}

export function FdCalculator() {
    const [amount, setAmount] = useState(500000);
    const [rate, setRate] = useState(7.1);
    const [months, setMonths] = useState(36);
    const result = fixedDeposit(amount, rate, months);
    return (
        <div className="calc">
            <div className="calc-form">
                <NumberField label="Deposit (₹)" value={amount} onChange={setAmount} min={5000} max={10000000} step={5000} />
                <RateField label="Interest rate" value={rate} onChange={setRate} min={2} max={10} step={0.05} />
                <NumberField label="Period (months)" value={months} onChange={setMonths} min={6} max={120} step={1} unit="months" />
            </div>
            <div className="calc-result result" aria-live="polite">
                <div className="result-main"><span className="label">Value at maturity</span><span className="value">{rupees(result.maturity)}</span></div>
                <SplitBar a={result.invested} b={result.interest} labelA="Deposit" labelB="Interest" />
                <div className="result-rows">
                    <Row label="Interest earned" value={rupees(result.interest)} />
                    <Row label="Effective yearly return" value={`${(((1 + rate / 400) ** 4 - 1) * 100).toFixed(2)}%`} />
                    <Row label="Interest per ₹100 a month" value={paise(perHundredMonthly(rate))} />
                    <Row label="Interest on every ₹100 deposited, in total" value={paise(interestPerHundredBorrowed(result.interest, result.invested))} />
                </div>
                <p className="calc-note">Compounded every quarter, as most Indian banks do. Interest is taxable, and the bank deducts TDS when interest crosses the yearly limit.</p>
            </div>
        </div>
    );
}

export function RdCalculator() {
    const [monthly, setMonthly] = useState(10000);
    const [rate, setRate] = useState(6.7);
    const [months, setMonths] = useState(24);
    const result = recurringDeposit(monthly, rate, months);
    return (
        <div className="calc">
            <div className="calc-form">
                <NumberField label="Every month (₹)" value={monthly} onChange={setMonthly} min={500} max={200000} step={500} />
                <RateField label="Interest rate" value={rate} onChange={setRate} min={2} max={10} step={0.05} />
                <NumberField label="Period (months)" value={months} onChange={setMonths} min={6} max={120} step={1} unit="months" />
            </div>
            <div className="calc-result result" aria-live="polite">
                <div className="result-main"><span className="label">Value at maturity</span><span className="value">{rupees(result.maturity)}</span></div>
                <SplitBar a={result.invested} b={result.interest} labelA="You put in" labelB="Interest" />
                <div className="result-rows">
                    <Row label="You put in" value={rupees(result.invested)} />
                    <Row label="Interest earned" value={rupees(result.interest)} />
                    <Row label="Interest per ₹100 a month" value={paise(perHundredMonthly(rate))} />
                    <Row label="Interest on every ₹100 you put in, in total" value={paise(interestPerHundredBorrowed(result.interest, result.invested))} />
                </div>
                <p className="calc-note">Each instalment earns quarterly compound interest for the months it stays deposited, as banks and the post office calculate it.</p>
            </div>
        </div>
    );
}

export function SipCalculator() {
    const [monthly, setMonthly] = useState(5000);
    const [rate, setRate] = useState(12);
    const [years, setYears] = useState(15);
    const result = sip(monthly, rate, years);
    return (
        <div className="calc">
            <div className="calc-form">
                <NumberField label="Every month (₹)" value={monthly} onChange={setMonthly} min={500} max={200000} step={500} />
                <RateField label="Expected return" value={rate} onChange={setRate} min={1} max={20} step={0.5} />
                <NumberField label="Years" value={years} onChange={setYears} min={1} max={40} step={1} unit="years" />
            </div>
            <div className="calc-result result" aria-live="polite">
                <div className="result-main"><span className="label">Estimated value</span><span className="value">{rupees(result.value)}</span></div>
                <SplitBar a={result.invested} b={result.gains} labelA="You put in" labelB="Growth" />
                <div className="result-rows">
                    <Row label="You put in" value={rupees(result.invested)} />
                    <Row label="Estimated growth" value={rupees(result.gains)} />
                    <Row label="Growth per ₹100 a month" value={paise(perHundredMonthly(rate))} />
                    <Row label="Growth on every ₹100 you put in, in total" value={paise(interestPerHundredBorrowed(result.gains, result.invested))} />
                </div>
                <div className="verdict-box warn"><TriangleAlert size={20} /><span>Market returns are not guaranteed. Real returns go up and down, and can be negative in some years.</span></div>
            </div>
        </div>
    );
}

const KARATS: Karat[] = [24, 22, 18, 14];

export function GoldCalculator() {
    const [grams, setGrams] = useState(42);
    const [karat, setKarat] = useState<Karat>(22);
    const [rate, setRate] = useState(7500);
    const result = goldValue(grams, karat, rate);
    return (
        <div className="calc">
            <div className="calc-form">
                <NumberField label="Weight (grams)" value={grams} onChange={setGrams} min={1} max={1000} step={0.5} unit="grams" />
                <div className="field">
                    <span style={{ fontWeight: 600 }} id="karat-label">Purity</span>
                    <div className="segmented" role="group" aria-labelledby="karat-label">
                        {KARATS.map(option => (
                            <button key={option} type="button" aria-pressed={karat === option} onClick={() => setKarat(option)}>{option}K</button>
                        ))}
                    </div>
                    <small>Most Indian jewellery is 22 karat (916 hallmark). Coins and bars are usually 24 karat.</small>
                </div>
                <NumberField
                    label="Today's 24 karat rate (₹ a gram)"
                    value={rate}
                    onChange={setRate}
                    min={3000}
                    max={20000}
                    step={10}
                    help="Enter today's rate from your jeweller or a newspaper. FinDB does not fetch prices here."
                />
            </div>
            <div className="calc-result result" aria-live="polite">
                <div className="result-main"><span className="label">Value of the gold</span><span className="value">{rupees(result.value)}</span></div>
                <div className="result-rows">
                    <Row label="Purity" value={`${result.purity}%`} />
                    <Row label="Pure gold in it" value={`${result.fineGrams} g`} />
                </div>
                <p className="calc-note">This is the metal value. Selling jewellery usually fetches a little less, after deductions; buying costs more, with making charges and 3% GST.</p>
            </div>
        </div>
    );
}

export function ChitCalculator() {
    const [chitValue, setChitValue] = useState(500000);
    const [months, setMonths] = useState(20);
    const [commission, setCommission] = useState(5);
    const [yourMonth, setYourMonth] = useState(4);
    const [yourBid, setYourBid] = useState(25);
    const [othersBid, setOthersBid] = useState(15);
    const month = Math.min(Math.max(1, Math.round(yourMonth)), Math.max(1, Math.round(months)));
    const result = chitFund({ chitValue, months: Math.max(2, Math.round(months)), commissionPct: commission, yourMonth: month, yourBidPct: yourBid, othersBidPct: othersBid });
    const borrower = result.role === 'borrower';
    return (
        <div className="calc">
            <div className="calc-form">
                <NumberField label="Chit value (₹)" value={chitValue} onChange={setChitValue} min={50000} max={5000000} step={10000} />
                <NumberField label="Members and months" value={months} onChange={setMonths} min={5} max={60} step={1} unit="months" />
                <NumberField label="Organiser's commission (%)" value={commission} onChange={setCommission} min={0} max={10} step={0.5} unit="%" help="The Chit Funds Act allows a commission of up to 7% of the chit value; 5% is common." />
                <NumberField label="The month you take the money" value={yourMonth} onChange={setYourMonth} min={1} max={Math.max(2, months)} step={1} />
                <NumberField label="Your bid discount (%)" value={yourBid} onChange={setYourBid} min={0} max={40} step={0.5} unit="%" help="How much of the chit value you give up to take it that month." />
                <NumberField label="Average discount in other months (%)" value={othersBid} onChange={setOthersBid} min={0} max={40} step={0.5} unit="%" />
            </div>
            <div className="calc-result result" aria-live="polite">
                <div className="result-main">
                    <span className="label">{borrower ? 'What it costs you, as a yearly interest rate' : 'What it earns you, as a yearly interest rate'}</span>
                    <span className="value">{result.yearlyRate.toFixed(1)}%</span>
                </div>
                <div className={`verdict-box${borrower ? ' warn' : ''}`} style={{ fontWeight: 500 }}>
                    <span>
                        That is <strong>{paise(result.perHundredMonthly)} per ₹100 a month</strong>, the way chit members usually say it.
                        {' '}On every ₹100 of the chit value you {result.net >= 0 ? 'gain' : 'lose'} <strong>{paise(Math.abs(result.net) / chitValue * 100)}</strong> in total.
                    </span>
                </div>
                <div className="result-rows">
                    <Row label="Monthly instalment, before dividends" value={rupees(result.contribution)} />
                    <Row label="You pay in total, after dividends" value={rupees(result.totalPaid)} />
                    <Row label={`You receive in month ${month}`} value={rupees(result.prize)} />
                    <Row label={result.net >= 0 ? 'You get back more by' : 'You pay more than you receive by'} value={rupees(Math.abs(result.net))} />
                </div>
                <div className={`verdict-box${borrower ? ' warn' : ''}`}>
                    {borrower ? <TriangleAlert size={20} /> : <CircleCheck size={20} />}
                    <span>
                        {borrower
                            ? 'Taking the money early works like a loan. Compare this rate with a personal or gold loan before you bid.'
                            : 'Taking the money late works like saving. Compare this rate with an RD or FD, and remember chits carry the risk of the organiser defaulting.'}
                    </span>
                </div>
                <p className="calc-note">An estimate: real bids change every month. Use a registered chit company; informal chits have no legal protection.</p>
            </div>
        </div>
    );
}

export function InflationCalculator() {
    const [amount, setAmount] = useState(50000);
    const [rate, setRate] = useState(5);
    const [years, setYears] = useState(10);
    const result = inflation(amount, rate, years);
    return (
        <div className="calc">
            <div className="calc-form">
                <NumberField label="Amount today (₹)" value={amount} onChange={setAmount} min={1000} max={10000000} step={1000} />
                <RateField label="Inflation" value={rate} onChange={setRate} min={1} max={12} step={0.1}
                    help="India's retail inflation has mostly been between 3% and 7% a year over the last decade." />
                <NumberField label="Years from now" value={years} onChange={setYears} min={1} max={40} step={1} unit="years" />
            </div>
            <div className="calc-result result" aria-live="polite">
                <div className="result-main"><span className="label">What {rupees(amount)} of spending will cost in {years} years</span><span className="value">{rupees(result.futureCost)}</span></div>
                <div className="result-rows">
                    <Row label={`What ${rupees(amount)} kept as cash will buy then, in today's money`} value={rupees(result.todaysValue)} />
                    <Row label="Value lost by keeping it as cash" value={rupees(amount - result.todaysValue)} />
                    <Row label={`What costs ₹100 today, in ${years} years`} value={paise(inflation(100, rate, years).futureCost)} />
                    <Row label="Prices rise per ₹100 a month, roughly" value={paise(perHundredMonthly(rate))} />
                </div>
                <p className="calc-note">Money in a savings account at 2.5% to 3% loses value whenever inflation is higher than that.</p>
            </div>
        </div>
    );
}

/** The calculator for a tool page, by slug */
export function ToolCalculator({ slug }: { slug: string }) {
    switch (slug) {
    case 'emi-calculator': return <EmiCalculator />;
    case 'loan-payoff': return <PayoffCalculator />;
    case 'fd-calculator': return <FdCalculator />;
    case 'rd-calculator': return <RdCalculator />;
    case 'sip-calculator': return <SipCalculator />;
    case 'gold-value': return <GoldCalculator />;
    case 'chit-fund': return <ChitCalculator />;
    case 'inflation': return <InflationCalculator />;
    default: return null;
    }
}
