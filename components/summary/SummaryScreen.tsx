'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Banknote, CalendarX, ChartColumn, CreditCard, Gem, Landmark, List, PiggyBank, Plus, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { apiGet, httpError, redirectIfUnauthorized } from '@/lib/api-client';
import { filterYears, MONTH_NAMES } from '@/lib/dates';
import { formatRupees } from '@/lib/format';

type Amount = string | number | null | undefined;

interface Summary {
    message?: string;
    isCurrentMonth?: boolean;
    isMonthCompleted?: boolean;
    trackingOption?: string;
    monthlyIncome?: Amount;
    totalExpenses?: Amount;
    totalCurrentWealth?: Amount;
    netSavings?: Amount;
    totalInitialBalance?: Amount;
    cash?: { balance?: Amount } | null;
    banks?: { id?: number; name?: string; current_balance?: Amount }[];
    creditCards?: { id?: number; name?: string; credit_limit?: Amount; current_balance?: Amount }[];
    otherAccounts?: { id?: number; type?: string; name?: string; current_balance?: Amount }[];
    spendingByCategory?: { id: number; name: string; amount: Amount; essential: boolean | null }[];
    essentialSpending?: Amount;
    discretionarySpending?: Amount;
    uncategorisedSpending?: Amount;
    oneOffSpending?: Amount;
    regularSpending?: Amount;
}

type Shown =
    | { kind: 'summary'; data: Summary; month: number; year: number }
    | { kind: 'error'; text: string };

const present = (value: Amount): value is string | number => value !== undefined && value !== null;

/** The legacy explanation under a "no data" message */
function messageDetail(message: string): string {
    if (message.includes('Future')) return 'Cannot show data for future dates.';
    if (message.includes('before registration')) return 'You were not registered during this period.';
    if (message.includes('No transactions found')) return 'You were registered but haven\'t added any transactions or setup accounts for this month.';
    return 'No data available for the selected period.';
}

function SummaryCard({ kind, tile, icon: Icon, title, amount, subtitle, missingSubtitle }: {
    kind: string; tile: string; icon: typeof TrendingUp; title: string; amount: Amount; subtitle: string; missingSubtitle: string;
}) {
    const has = present(amount);
    return (
        <div className={`stat summary-card ${kind}${has ? '' : ' dim'}`}>
            <span className="stat-top"><span className={`icon-tile ${tile}`} aria-hidden="true"><Icon /></span> {title}</span>
            <span className="stat-value summary-amount">{formatRupees(has ? amount : 0)}</span>
            <span className="stat-note summary-subtitle">{has ? subtitle : missingSubtitle}</span>
        </div>
    );
}

function SummaryView({ data, month, year }: { data: Summary; month: number; year: number }) {
    const router = useRouter();
    const monthName = MONTH_NAMES[month - 1];
    // "as of now" for the current month, otherwise the month's end
    const timeReference = data.isCurrentMonth ? 'as of now' : `at End of ${monthName}`;
    const heading = <h3 className="sr-only">{monthName} {year} Financial Summary</h3>;

    if (data.message) {
        const noTransactions = data.message.includes('No transactions found');
        return (
            <>
                {heading}
                <div className="card summary-message summary">
                    <CalendarX size={36} aria-hidden="true" style={{ color: 'var(--line-strong)' }} />
                    <h3>{data.message}</h3>
                    <p>{messageDetail(data.message)}</p>
                    {noTransactions ? (
                        <div className="actions">
                            <button type="button" className="btn btn-secondary setup-accounts-btn" onClick={() => router.push('/setup')}>
                                <Wallet aria-hidden="true" /> Set up accounts
                            </button>
                            <button type="button" className="btn btn-primary add-transactions-btn" onClick={() => router.push('/transactions')}>
                                <Plus aria-hidden="true" /> Add transactions
                            </button>
                        </div>
                    ) : null}
                </div>
            </>
        );
    }

    const showCards = data.trackingOption === 'expenses' || data.trackingOption === 'both';
    const netSavingsNegative = present(data.netSavings) && parseFloat(String(data.netSavings)) < 0;
    const cashBalance = data.cash ? data.cash.balance : undefined;
    const cashAvailable = present(cashBalance) && !Number.isNaN(Number(cashBalance));
    const showBreakdown = present(data.netSavings) && data.monthlyIncome !== undefined && data.totalExpenses !== undefined;
    const income = parseFloat(String(data.monthlyIncome ?? 0)) || 0;
    const expenses = parseFloat(String(data.totalExpenses ?? 0)) || 0;
    const largest = Math.max(income, expenses, 1);

    return (
        <div className="stack">
            {heading}
            <div className="stats">
                <SummaryCard kind="income" tile="t-income" icon={TrendingUp} title="Income" amount={data.monthlyIncome}
                    subtitle="Money earned this month" missingSubtitle="No income data available" />
                <SummaryCard kind="expense" tile="t-expense" icon={TrendingDown} title="Expenses" amount={data.totalExpenses}
                    subtitle="Money spent this month" missingSubtitle="No expense data available" />
                <SummaryCard kind="wealth" tile="t-wealth" icon={Gem} title="Total wealth" amount={data.totalCurrentWealth}
                    subtitle={`Banks, cash and wallets ${timeReference}`} missingSubtitle="Unable to calculate wealth" />
                <SummaryCard kind="savings" tile={netSavingsNegative ? 't-expense' : 't-income'} icon={PiggyBank}
                    title="Net savings" amount={data.netSavings}
                    subtitle="Income - Expenses + Initial" missingSubtitle="Unable to calculate savings" />
            </div>

            {data.monthlyIncome !== undefined || data.totalExpenses !== undefined ? (
                <section className="card" aria-labelledby="flow-title">
                    <div className="card-head"><h3 id="flow-title">Money in and out</h3><span className="meta">{monthName} {year}</span></div>
                    <div className="flow">
                        <div className="flow-row">
                            <span>Came in</span>
                            <span className="flow-bar"><i className="in" style={{ width: `${(income / largest) * 100}%` }} /></span>
                            <span className="amount">{formatRupees(income)}</span>
                        </div>
                        <div className="flow-row">
                            <span>Went out</span>
                            <span className="flow-bar"><i className="out" style={{ width: `${(expenses / largest) * 100}%` }} /></span>
                            <span className="amount">{formatRupees(expenses)}</span>
                        </div>
                    </div>
                </section>
            ) : null}

            <section className="card accounts-section" aria-labelledby="balances-title">
                <div className="card-head">
                    <h3 id="balances-title">Account balances {timeReference}</h3>
                </div>
                <div className="accounts-grid">
                    {data.cash ? (
                        <div className={`account-card cash${cashAvailable ? '' : ' dim'}`}>
                            <h4><span className="icon-tile t-cash" aria-hidden="true"><Banknote /></span> Cash</h4>
                            <div className="account-balance">{cashAvailable ? formatRupees(cashBalance) : 'Unavailable'}</div>
                        </div>
                    ) : null}
                    {(data.banks ?? []).map((bank, index) => (
                        <div key={bank.id ?? `bank-${index}`} className={`account-card bank${present(bank.current_balance) ? '' : ' dim'}`}>
                            <h4><span className="icon-tile t-bank" aria-hidden="true"><Landmark /></span> {bank.name || 'Unknown Bank'}</h4>
                            <div className="account-balance">{present(bank.current_balance) ? formatRupees(bank.current_balance) : 'Unavailable'}</div>
                        </div>
                    ))}
                    {(data.otherAccounts ?? []).map((account, index) => (
                        <div key={account.id ?? `other-${index}`} className="account-card wallet">
                            <h4><span className="icon-tile t-cash" aria-hidden="true"><Wallet /></span> {account.name || 'Wallet'}</h4>
                            <div className="account-balance">{formatRupees(account.current_balance ?? 0)}</div>
                            <div className="account-note">{account.type === 'meal_card' ? 'Meal card' : 'Wallet'}</div>
                        </div>
                    ))}
                    {showCards ? (data.creditCards ?? []).map((card, index) => {
                        const limit = parseFloat(String(card.credit_limit || 0));
                        const used = parseFloat(String(card.current_balance || 0));
                        const share = limit > 0 ? Math.min(used / limit, 1) : 0;
                        return (
                            <div key={card.id ?? `card-${index}`} className="account-card credit">
                                <h4><span className="icon-tile t-card" aria-hidden="true"><CreditCard /></span> {card.name || 'Unknown Card'}</h4>
                                <div className="account-balance">{formatRupees(used)} used</div>
                                <span className="meter"><i className={share > 0.7 ? 'high' : share > 0.3 ? 'warn' : undefined} style={{ width: `${share * 100}%` }} /></span>
                                <div className="account-note">{formatRupees(limit - used)} available of {formatRupees(limit)}</div>
                            </div>
                        );
                    }) : null}
                </div>
            </section>

            {(data.spendingByCategory ?? []).length > 0 ? (
                <section id="spending-by-category" className="card" aria-labelledby="by-category-title">
                    <div className="card-head">
                        <h3 id="by-category-title">Spending by category</h3>
                        <span className="meta">
                            Essential {formatRupees(data.essentialSpending ?? 0)}, discretionary {formatRupees(data.discretionarySpending ?? 0)}
                            {parseFloat(String(data.uncategorisedSpending ?? 0)) > 0 ? `, not categorised ${formatRupees(data.uncategorisedSpending ?? 0)}` : ''}
                        </span>
                    </div>
                    <ul className="category-bars">
                        {(data.spendingByCategory ?? []).map(item => {
                            const share = expenses > 0 ? Math.min(parseFloat(String(item.amount)) / expenses, 1) : 0;
                            return (
                                <li key={item.id} data-category={item.id}>
                                    <span className="category-name">
                                        {item.name}
                                        {item.essential === true ? <span className="tag">Essential</span> : null}
                                    </span>
                                    <span className="meter"><i style={{ width: `${share * 100}%` }} /></span>
                                    <span className="category-amount">{formatRupees(item.amount)}</span>
                                </li>
                            );
                        })}
                    </ul>
                </section>
            ) : null}

            {showBreakdown ? (
                <section className="card breakdown">
                    <h4><List size={18} aria-hidden="true" /> Calculation Breakdown</h4>
                    <div>
                        Net savings = income ({formatRupees(data.monthlyIncome || 0)}) -{' '}
                        expenses ({formatRupees(data.totalExpenses || 0)}) ={' '}
                        <strong>{formatRupees(data.netSavings)}</strong>
                    </div>
                    {parseFloat(String(data.oneOffSpending ?? 0)) > 0 ? (
                        <p className="breakdown-note" id="regular-spending">
                            Regular spending {formatRupees(data.regularSpending ?? 0)}, leaving out {formatRupees(data.oneOffSpending ?? 0)} on one-off events.
                        </p>
                    ) : null}
                    <p className="breakdown-note">Transfers between your own accounts, such as an ATM withdrawal or a card bill payment, are neither income nor spending.</p>
                </section>
            ) : null}
        </div>
    );
}

export function SummaryScreen() {
    const now = new Date();
    const [month, setMonth] = useState(now.getMonth() + 1);
    const [year, setYear] = useState(now.getFullYear());
    const [shown, setShown] = useState<Shown | null>(null);

    async function loadSummary(forMonth: number, forYear: number) {
        const result = await apiGet<Summary>(`/api/monthly-summary?month=${forMonth}&year=${forYear}`);
        if (redirectIfUnauthorized(result)) return;
        setShown(result.ok
            ? { kind: 'summary', data: result.data, month: forMonth, year: forYear }
            : { kind: 'error', text: `Error loading summary: ${httpError(result)}` });
    }

    useEffect(() => {
        // Like the legacy screen, opening it loads the current month
        loadSummary(month, year);
        // Runs once on page load; later loads come from the Load Summary button
    }, []);

    if (shown === null) {
        // Rendered only after the first load, so the controls are live when they appear
        return null;
    }

    return (
        <div id="summary-section">
            <div className="page-header">
                <div>
                    <h2>Monthly summary</h2>
                    <p>What came in, what went out, and where every account ended the month.</p>
                </div>
                <div className="period-picker summary-controls">
                    <div className="field">
                        <label htmlFor="summary-month">Month</label>
                        <select id="summary-month" value={month} onChange={event => setMonth(Number(event.target.value))}>
                            {MONTH_NAMES.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
                        </select>
                    </div>
                    <div className="field">
                        <label htmlFor="summary-year">Year</label>
                        <select id="summary-year" value={year} onChange={event => setYear(Number(event.target.value))}>
                            {filterYears().map(option => <option key={option} value={option}>{option}</option>)}
                        </select>
                    </div>
                    <button type="button" className="btn btn-secondary" data-action="loadMonthlySummary" onClick={() => loadSummary(month, year)}>
                        <ChartColumn aria-hidden="true" /> Show
                    </button>
                </div>
            </div>
            <div id="summary-display">
                {shown.kind === 'error'
                    ? <p className="error">{shown.text}</p>
                    : <SummaryView data={shown.data} month={shown.month} year={shown.year} />}
            </div>
        </div>
    );
}
