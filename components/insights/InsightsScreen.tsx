'use client';

import { useEffect, useState } from 'react';
import { CalendarHeart, ChartColumn, Lightbulb, Repeat, TriangleAlert } from 'lucide-react';
import { BarList } from '@/components/ui/Charts';
import { BudgetsCard } from './BudgetsCard';
import { apiGet, httpError, redirectIfUnauthorized } from '@/lib/api-client';
import { filterYears, MONTH_NAMES } from '@/lib/dates';
import { formatRupees } from '@/lib/format';
import { t } from '@/lib/i18n';

/**
 * Spending insights for a month (/api/insights, v2 Phase 2): what was spent, regular and on events;
 * anything unusual; each category against its averages; the year's trend; and subscriptions. Rule
 * based, on the user's own entries: information, not advice, with the thresholds shown.
 */

interface CategoryRow {
    id: number; name: string; thisMonth: string; lastMonth: string; average3: string | null; average6: string | null; average12: string | null;
    change3: number | null; unusual: boolean;
}
interface SubscriptionRow {
    description: string; cadence: 'weekly' | 'monthly' | 'quarterly' | 'yearly'; charges: number; first: string; last: string;
    lastAmount: string; monthly: string; yearly: string; category: string | null; account: string | null;
    status: 'active' | 'new' | 'stopped'; priceRiseFrom: string | null;
}
interface Insights {
    month: string;
    thresholds: { unusualRatio: number; unusualMinimum: string; historyMonths: number };
    spending: { regular: string; oneOff: string; events: { id: number; name: string; amount: string }[] };
    categories: CategoryRow[];
    trend: { month: string; regular: string; oneOff: string }[];
    firstMonth: string;
    subscriptions: { monthly: string; yearly: string; items: SubscriptionRow[] };
}
type Span = 3 | 6 | 12;

const monthName = (month: string) => new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
const shortDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export function InsightsScreen() {
    const now = new Date();
    const [period, setPeriod] = useState({ month: now.getMonth() + 1, year: now.getFullYear() });
    const [data, setData] = useState<Insights | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [span, setSpan] = useState<Span>(3);

    async function load(month: number, year: number) {
        const response = await apiGet<Insights>(`/api/insights?month=${month}&year=${year}`);
        if (redirectIfUnauthorized(response)) return;
        if (!response.ok) {
            setProblem(httpError(response));
            return;
        }
        setProblem(null);
        setData(response.data);
    }

    useEffect(() => {
        load(period.month, period.year);
        // Once on page load; "Show" loads other months
    }, []);

    if (!data) return problem ? <p className="notice warn" role="alert">{problem}</p> : null;

    const unusual = data.categories.filter(item => item.unusual);
    const spent = data.categories.filter(item => parseFloat(item.thisMonth) > 0);
    const averageOf = (item: CategoryRow) => (span === 3 ? item.average3 : span === 6 ? item.average6 : item.average12);
    const withAverage = data.categories.filter(item => averageOf(item) !== null);
    const active = data.subscriptions.items.filter(item => item.status !== 'stopped');
    const stopped = data.subscriptions.items.filter(item => item.status === 'stopped');

    const subscriptionRow = (item: SubscriptionRow) => (
        <li key={`${item.description}-${item.first}`} data-subscription={item.description}>
            <span className="search-entry">
                <span className="what">{item.description}</span>
                <span className="when">
                    {t(`insights.cadences.${item.cadence}`, { amount: formatRupees(item.lastAmount) })}
                    {item.account ? ` · ${item.account}` : ''}
                    {` · ${t('insights.lastCharged', { date: shortDate(item.last) })}`}
                </span>
                <span className="entry-meta">
                    {item.status === 'new' ? <span className="tag">{t('insights.new')}</span> : null}
                    {item.status === 'stopped' ? <span className="tag muted-tag">{t('insights.stopped')}</span> : null}
                    {item.priceRiseFrom ? <span className="tag warn-tag">{t('insights.priceUp', { from: formatRupees(item.priceRiseFrom) })}</span> : null}
                </span>
            </span>
            <span className="amount out">{t('insights.perMonth', { amount: formatRupees(item.monthly) })}</span>
        </li>
    );

    return (
        <div id="insights-section">
            <div className="page-header">
                <div>
                    <h2>{t('insights.title')}</h2>
                    <p>{t('insights.subtitle', { period: monthName(data.month) })}</p>
                </div>
                <form className="period-picker" onSubmit={event => { event.preventDefault(); load(period.month, period.year); }}>
                    <div className="field">
                        <label htmlFor="insights-month">{t('insights.month')}</label>
                        <select id="insights-month" value={period.month} onChange={event => setPeriod(current => ({ ...current, month: Number(event.target.value) }))}>
                            {MONTH_NAMES.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
                        </select>
                    </div>
                    <div className="field">
                        <label htmlFor="insights-year">{t('insights.year')}</label>
                        <select id="insights-year" value={period.year} onChange={event => setPeriod(current => ({ ...current, year: Number(event.target.value) }))}>
                            {filterYears().map(year => <option key={year} value={year}>{year}</option>)}
                        </select>
                    </div>
                    <button type="submit" className="btn btn-primary" data-action="showInsights">{t('insights.show')}</button>
                </form>
            </div>

            <p className="notice insights-note" id="insights-thresholds">
                {t('insights.notAdvice', {
                    ratio: data.thresholds.unusualRatio, minimum: formatRupees(data.thresholds.unusualMinimum), months: data.thresholds.historyMonths,
                })}
            </p>

            <section className="card" aria-labelledby="insights-month-title">
                <div className="card-head">
                    <h3 id="insights-month-title"><span className="icon-tile t-bank" aria-hidden="true"><ChartColumn /></span>{t('insights.spent')}</h3>
                    <span className="meta" id="insights-regular">{t('insights.regular', { amount: formatRupees(data.spending.regular) })}</span>
                </div>
                {data.spending.events.length > 0 ? (
                    <ul className="settings-list" id="insights-events">
                        {data.spending.events.map(event => (
                            <li key={event.id}>
                                <span><CalendarHeart className="inline-icon" aria-hidden="true" /> <span className="what">{event.name}</span></span>
                                <span className="amount">{formatRupees(event.amount)}</span>
                            </li>
                        ))}
                    </ul>
                ) : null}
                {parseFloat(data.spending.oneOff) > 0 ? <p className="card-pad form-note">{t('insights.oneOffNote', { amount: formatRupees(data.spending.oneOff) })}</p> : null}
                {spent.length > 0 ? (
                    <div className="card-pad">
                        <BarList label={t('insights.topCategories')} rows={spent.slice(0, 8).map(item => ({ label: item.name, amount: parseFloat(item.thisMonth) }))} labelWidth={150} />
                    </div>
                ) : <p className="card-pad empty-note">{t('insights.nothingSpent')}</p>}
            </section>

            <BudgetsCard month={Number(data.month.slice(5, 7))} year={Number(data.month.slice(0, 4))} />

            <section className="card" aria-labelledby="insights-unusual-title" id="insights-unusual">
                <div className="card-head">
                    <h3 id="insights-unusual-title"><span className="icon-tile t-wealth" aria-hidden="true"><TriangleAlert /></span>{t('insights.unusual')}</h3>
                </div>
                <ul className="settings-list">
                    {unusual.length === 0 ? <li>{t('insights.nothingUnusual')}</li> : unusual.map(item => (
                        <li key={item.id} data-unusual={item.name}>
                            {t('insights.unusualLine', {
                                name: item.name, amount: formatRupees(item.thisMonth), times: (parseFloat(item.thisMonth) / parseFloat(item.average3!)).toFixed(1),
                                average: formatRupees(item.average3),
                            })}
                        </li>
                    ))}
                </ul>
            </section>

            <section className="card" aria-labelledby="insights-averages-title" id="insights-averages">
                <div className="card-head">
                    <h3 id="insights-averages-title"><span className="icon-tile t-income" aria-hidden="true"><Lightbulb /></span>{t('insights.averages')}</h3>
                    <div className="segmented span-choice" role="radiogroup" aria-label={t('insights.over')}>
                        {([3, 6, 12] as Span[]).map(value => (
                            <button key={value} type="button" role="radio" aria-checked={span === value} data-span={value} onClick={() => setSpan(value)}>
                                {t('insights.months', { count: value })}
                            </button>
                        ))}
                    </div>
                </div>
                <ul className="settings-list">
                    {withAverage.length === 0 ? <li>{t('insights.noHistory', { months: span === 3 ? data.thresholds.historyMonths : span })}</li> : withAverage.map(item => (
                        <li key={item.id} data-category={item.name}>
                            <span className="search-entry">
                                <span className="what">{item.name}</span>
                                <span className="when">
                                    {t('insights.thisAndLast', { now: formatRupees(item.thisMonth), last: formatRupees(item.lastMonth) })}
                                    {span === 3 && item.change3 !== null && item.change3 !== 0
                                        ? ` · ${item.change3 > 0 ? t('insights.up', { percent: item.change3 }) : t('insights.down', { percent: -item.change3 })}` : ''}
                                </span>
                            </span>
                            <span className="amount">{t('insights.perMonth', { amount: formatRupees(averageOf(item)) })}</span>
                        </li>
                    ))}
                </ul>
            </section>

            <section className="card" aria-labelledby="insights-trend-title">
                <div className="card-head">
                    <h3 id="insights-trend-title"><span className="icon-tile t-bank" aria-hidden="true"><ChartColumn /></span>{t('insights.trend')}</h3>
                </div>
                <div className="card-pad">
                    <BarList label={t('insights.trend')} labelWidth={90}
                        rows={data.trend.filter(item => item.month >= data.firstMonth).reverse().map(item => ({ label: monthName(item.month), amount: parseFloat(item.regular) + parseFloat(item.oneOff) }))} />
                </div>
            </section>

            <section className="card" aria-labelledby="insights-subscriptions-title" id="insights-subscriptions">
                <div className="card-head">
                    <h3 id="insights-subscriptions-title"><span className="icon-tile t-wealth" aria-hidden="true"><Repeat /></span>{t('insights.subscriptions')}</h3>
                    {active.length > 0 ? (
                        <span className="meta" id="insights-subscriptions-total">
                            {t('insights.subscriptionTotal', { monthly: formatRupees(data.subscriptions.monthly), yearly: formatRupees(data.subscriptions.yearly) })}
                        </span>
                    ) : null}
                </div>
                <ul className="settings-list search-list">
                    {data.subscriptions.items.length === 0 ? <li>{t('insights.noSubscriptions')}</li> : [...active, ...stopped].map(subscriptionRow)}
                </ul>
            </section>
        </div>
    );
}
