'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Banknote, CalendarX, ChartColumn, CreditCard, Gem, Landmark, List, PiggyBank, Plus, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { apiGet, httpError, redirectIfUnauthorized } from '@/lib/api-client';
import { filterYears, MONTH_NAMES } from '@/lib/dates';
import { formatRupees } from '@/lib/format';
import { t } from '@/lib/i18n';
import { AccountList, AccountRow } from '@/components/ui/AccountList';
import { BarList, type ChartRow } from '@/components/ui/Charts';

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
    owedToYou?: Amount;
    regularSpending?: Amount;
}

type Shown =
    | { kind: 'summary'; data: Summary; month: number; year: number }
    | { kind: 'error'; text: string };

const present = (value: Amount): value is string | number => value !== undefined && value !== null;

/** The legacy explanation under a "no data" message */
function messageDetail(message: string): string {
    if (message.includes('Future')) return t('summary.noData.future');
    if (message.includes('before registration')) return t('summary.noData.beforeRegistration');
    if (message.includes('No transactions found')) return t('summary.noData.noTransactions');
    return t('summary.noData.other');
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

/** Categories after the largest few are shown as one "Other" bar, so the chart stays readable */
const CHART_CATEGORIES = 7;

function SummaryView({ data, month, year }: { data: Summary; month: number; year: number }) {
    const router = useRouter();
    const monthName = MONTH_NAMES[month - 1] ?? '';
    const period = `${monthName} ${year}`;
    // "as of now" for the current month, otherwise the month's end
    const timeReference = data.isCurrentMonth ? t('summary.asOfNow') : t('summary.atEnd', { month: monthName });
    const heading = <h3 className="sr-only">{t('summary.srHeading', { period })}</h3>;

    if (data.message) {
        const noTransactions = data.message.includes('No transactions found');
        return (
            <>
                {heading}
                <div className="card summary-message summary">
                    <CalendarX size={36} aria-hidden="true" className="summary-message-icon" />
                    <h3>{data.message}</h3>
                    <p>{messageDetail(data.message)}</p>
                    {noTransactions ? (
                        <div className="actions">
                            <button type="button" className="btn btn-secondary setup-accounts-btn" onClick={() => router.push('/setup')}>
                                <Wallet aria-hidden="true" /> {t('summary.setUpAccounts')}
                            </button>
                            <button type="button" className="btn btn-primary add-transactions-btn" onClick={() => router.push('/transactions')}>
                                <Plus aria-hidden="true" /> {t('summary.addTransactions')}
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
    const categories = (data.spendingByCategory ?? []).map(item => ({ ...item, value: parseFloat(String(item.amount)) || 0 }));
    const shownCategories: ChartRow[] = categories.slice(0, CHART_CATEGORIES).map(item => ({ label: item.name, amount: item.value }));
    const rest = categories.slice(CHART_CATEGORIES).reduce((total, item) => total + item.value, 0);
    if (rest > 0) shownCategories.push({ label: t('summary.other'), amount: rest });

    return (
        <div className="stack">
            {heading}
            <div className="figures">
                <SummaryCard kind="income" tile="t-income" icon={TrendingUp} title={t('summary.income')} amount={data.monthlyIncome}
                    subtitle={t('summary.incomeNote')} missingSubtitle={t('summary.incomeMissing')} />
                <SummaryCard kind="expense" tile="t-expense" icon={TrendingDown} title={t('summary.expenses')} amount={data.totalExpenses}
                    subtitle={t('summary.expensesNote')} missingSubtitle={t('summary.expensesMissing')} />
                <SummaryCard kind="savings" tile={netSavingsNegative ? 't-expense' : 't-income'} icon={PiggyBank}
                    title={t('summary.savings')} amount={data.netSavings}
                    subtitle={t('summary.savingsNote')} missingSubtitle={t('summary.savingsMissing')} />
                <SummaryCard kind="wealth" tile="t-wealth" icon={Gem} title={t('summary.wealth')} amount={data.totalCurrentWealth}
                    subtitle={t('summary.wealthNote', { when: timeReference })} missingSubtitle={t('summary.wealthMissing')} />
            </div>

            {data.monthlyIncome !== undefined || data.totalExpenses !== undefined ? (
                <section className="card" aria-labelledby="flow-title">
                    <div className="card-head"><h3 id="flow-title">{t('summary.flowTitle')}</h3><span className="meta">{period}</span></div>
                    <div className="card-pad">
                        <BarList label={t('summary.flowChart', { period })} labelWidth={84} rows={[
                            { label: t('summary.cameIn'), amount: income, tone: 'in' },
                            { label: t('summary.wentOut'), amount: expenses, tone: 'out' },
                        ]} />
                    </div>
                </section>
            ) : null}

            {categories.length > 0 ? (
                <section id="spending-by-category" className="card" aria-labelledby="by-category-title">
                    <div className="card-head">
                        <h3 id="by-category-title">{t('summary.byCategory')}</h3>
                        <span className="meta">
                            {t('summary.split', { essential: formatRupees(data.essentialSpending ?? 0), discretionary: formatRupees(data.discretionarySpending ?? 0) })}
                            {parseFloat(String(data.uncategorisedSpending ?? 0)) > 0 ? t('summary.notCategorised', { amount: formatRupees(data.uncategorisedSpending ?? 0) }) : ''}
                        </span>
                    </div>
                    <div className="card-pad">
                        <BarList label={t('summary.byCategoryChart', { period })} labelWidth={150} rows={shownCategories} />
                    </div>
                    <ul className="category-bars">
                        {categories.map(item => (
                            <li key={item.id} data-category={item.id}>
                                <span className="category-name">
                                    {item.name}
                                    {item.essential === true ? <span className="tag">{t('summary.essential')}</span> : null}
                                </span>
                                <span className="category-share">{expenses > 0 ? `${Math.round((item.value / expenses) * 100)}%` : ''}</span>
                                <span className="category-amount">{formatRupees(item.amount)}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}

            <section className="card accounts-section" aria-labelledby="balances-title">
                <div className="card-head">
                    <h3 id="balances-title">{t('summary.balancesTitle', { when: timeReference })}</h3>
                </div>
                <AccountList>
                    {[
                        ...(data.cash ? [
                            <AccountRow key="cash" className="account-card cash" icon={Banknote} tile="t-cash" name={t('summary.cash')}
                                amount={cashAvailable ? cashBalance : 0} sub={cashAvailable ? undefined : t('summary.unavailable')} />,
                        ] : []),
                        ...(data.banks ?? []).map((bank, index) => (
                            <AccountRow key={bank.id ?? `bank-${index}`} className="account-card bank" icon={Landmark} tile="t-bank" name={bank.name || t('summary.unknownBank')}
                                amount={present(bank.current_balance) ? bank.current_balance : 0} sub={present(bank.current_balance) ? undefined : t('summary.unavailable')} />
                        )),
                        ...(data.otherAccounts ?? []).map((account, index) => (
                            <AccountRow key={account.id ?? `other-${index}`} className="account-card wallet" icon={Wallet} tile="t-cash" name={account.name || t('summary.wallet')}
                                amount={account.current_balance ?? 0} sub={account.type === 'meal_card' ? t('summary.mealCard') : t('summary.wallet')} />
                        )),
                        ...(showCards ? (data.creditCards ?? []).map((card, index) => {
                            const limit = parseFloat(String(card.credit_limit || 0));
                            const used = parseFloat(String(card.current_balance || 0));
                            const share = limit > 0 ? Math.min(used / limit, 1) : 0;
                            return (
                                <AccountRow key={card.id ?? `card-${index}`} className="account-card credit" icon={CreditCard} tile="t-card" name={card.name || t('summary.unknownCard')}
                                    amount={used} sub={t('summary.cardUsed', { amount: formatRupees(used) })}
                                    meter={{ share, label: t('accounts.cards.usedShare', { percent: Math.round(share * 100) }) }}
                                    amountNote={t('summary.cardAvailable', { available: formatRupees(limit - used), limit: formatRupees(limit) })} />
                            );
                        }) : []),
                    ]}
                </AccountList>
            </section>

            {showBreakdown ? (
                <section className="card breakdown">
                    <h4><List size={18} aria-hidden="true" /> {t('summary.breakdown')}</h4>
                    <div>
                        {t('summary.breakdownLine', { income: formatRupees(data.monthlyIncome || 0), expenses: formatRupees(data.totalExpenses || 0) })}
                        <strong>{formatRupees(data.netSavings)}</strong>
                    </div>
                    {parseFloat(String(data.oneOffSpending ?? 0)) > 0 ? (
                        <p className="breakdown-note" id="regular-spending">
                            {t('summary.regular', { regular: formatRupees(data.regularSpending ?? 0), oneOff: formatRupees(data.oneOffSpending ?? 0) })}
                        </p>
                    ) : null}
                    {parseFloat(String(data.owedToYou ?? 0)) > 0 ? (
                        <p className="breakdown-note" id="owed-to-you">{t('summary.owed', { amount: formatRupees(data.owedToYou ?? 0) })}</p>
                    ) : null}
                    <p className="breakdown-note">{t('summary.transfers')}</p>
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
            : { kind: 'error', text: t('summary.loadError', { error: httpError(result) }) });
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
                    <h2>{t('summary.title')}</h2>
                    <p>{t('summary.subtitle')}</p>
                </div>
                <div className="period-picker summary-controls">
                    <div className="field">
                        <label htmlFor="summary-month">{t('summary.month')}</label>
                        <select id="summary-month" value={month} onChange={event => setMonth(Number(event.target.value))}>
                            {MONTH_NAMES.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
                        </select>
                    </div>
                    <div className="field">
                        <label htmlFor="summary-year">{t('summary.year')}</label>
                        <select id="summary-year" value={year} onChange={event => setYear(Number(event.target.value))}>
                            {filterYears().map(option => <option key={option} value={option}>{option}</option>)}
                        </select>
                    </div>
                    <button type="button" className="btn btn-secondary" data-action="loadMonthlySummary" onClick={() => loadSummary(month, year)}>
                        <ChartColumn aria-hidden="true" /> {t('summary.show')}
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
