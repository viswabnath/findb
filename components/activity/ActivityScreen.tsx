'use client';

import { useEffect, useState } from 'react';
import {
    Banknote, Clock, CreditCard, History, KeyRound, Landmark, Loader2, MapPin, Pencil, Plus, RefreshCw,
    Search, ShieldAlert, Trash2, TrendingDown, TrendingUp, X, type LucideIcon,
} from 'lucide-react';
import { apiGet, redirectIfUnauthorized } from '@/lib/api-client';
import { describeActivity, pageLinks, type ActivityIcon } from '@/lib/activity';
import { filterYears, MONTH_NAMES } from '@/lib/dates';
import { formatRupees } from '@/lib/format';
import { t } from '@/lib/i18n';

const PAGE_SIZE = 10;

const ICONS: Record<ActivityIcon, LucideIcon> = {
    banknote: Banknote, landmark: Landmark, 'credit-card': CreditCard, 'trending-up': TrendingUp,
    'trending-down': TrendingDown, plus: Plus, pencil: Pencil, 'trash-2': Trash2, 'refresh-cw': RefreshCw,
    'shield-alert': ShieldAlert, 'key-round': KeyRound,
};

interface Activity {
    id: number;
    activity_type: string;
    action_type: string;
    description?: string;
    amount?: string | number | null;
    account_info?: string | null;
    activity_date: string;
}

interface ActivityPage {
    activities: Activity[];
    currentPage: number;
    totalPages: number;
    totalItems: number;
}

interface Filters { month: string; year: string }

type Shown = { kind: 'page'; data: ActivityPage } | { kind: 'error'; text: string };

function ActivityItem({ activity }: { activity: Activity }) {
    const label = describeActivity(activity.action_type, activity.activity_type);
    const Icon = ICONS[label.icon];
    const date = new Date(activity.activity_date);
    const day = date.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
    const time = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    return (
        <div className={`activity-item ${label.className}`}>
            <div className="activity-icon" aria-hidden="true"><Icon /></div>
            <div className="activity-content">
                <div className="activity-action">{label.text}</div>
                <div className="activity-description">{activity.description || t('activity.systemOperation')}</div>
                <div className="activity-meta">
                    <span className="activity-account"><MapPin aria-hidden="true" /> {activity.account_info || t('activity.system')}</span>
                    <span className="activity-timestamp"><Clock aria-hidden="true" /> {t('activity.at', { day, time })}</span>
                </div>
            </div>
            <span className="activity-amount">{activity.amount ? formatRupees(activity.amount) : '—'}</span>
        </div>
    );
}

export function ActivityScreen() {
    const [month, setMonth] = useState('');
    const [year, setYear] = useState('');
    const [shown, setShown] = useState<Shown | null>(null);
    const [busy, setBusy] = useState<'load' | 'clear' | null>(null);
    // The filters behind the page on screen; page links keep using them
    const [applied, setApplied] = useState<Filters>({ month: '', year: '' });

    async function load(filters: Filters, page: number) {
        const query = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
        // The API filters by month only together with a year
        if (filters.year) {
            query.set('year', filters.year);
            if (filters.month) query.set('month', filters.month);
        }
        const result = await apiGet<ActivityPage>(`/api/activity?${query}`);
        if (redirectIfUnauthorized(result)) return;
        setApplied(filters);
        setShown(result.ok && Array.isArray(result.data.activities)
            ? { kind: 'page', data: result.data }
            : { kind: 'error', text: t('activity.loadFailed') });
    }

    async function run(kind: 'load' | 'clear', filters: Filters) {
        setBusy(kind);
        try {
            await load(filters, 1);
        } finally {
            setBusy(null);
        }
    }

    useEffect(() => {
        load({ month: '', year: '' }, 1);
        // Runs once on page load; later loads come from the buttons and page links
    }, []);

    if (shown === null) {
        // Rendered only after the first load, so the controls are live when they appear
        return null;
    }

    function clearFilters() {
        setMonth('');
        setYear('');
        run('clear', { month: '', year: '' });
    }

    let feed;
    if (shown.kind === 'error') {
        feed = <p className="error-message">{shown.text}</p>;
    } else if (shown.data.activities.length === 0) {
        feed = <div className="no-activities">{t('activity.none')}</div>;
    } else {
        const { activities, currentPage, totalPages } = shown.data;
        const goTo = (page: number) => { if (page !== currentPage) load(applied, page); };
        feed = (
            <div className="activity-feed">
                <div className="activity-items">
                    {activities.map(activity => <ActivityItem key={activity.id} activity={activity} />)}
                </div>
                {totalPages > 1 ? (
                    <nav className="pagination" aria-label={t('activity.pages')}>
                        {currentPage > 1 ? <button type="button" className="pagination-btn" data-page={currentPage - 1} onClick={() => goTo(currentPage - 1)}>{t('activity.previous')}</button> : null}
                        {pageLinks(currentPage, totalPages).map((link, index) => (link === 'dots'
                            ? <span key={`dots-${index}`} className="pagination-dots">...</span>
                            : (
                                <button key={link} type="button" className={`pagination-btn${link === currentPage ? ' active' : ''}`} data-page={link}
                                    aria-current={link === currentPage ? 'page' : undefined} onClick={() => goTo(link)}>
                                    {link}
                                </button>
                            )))}
                        {currentPage < totalPages ? <button type="button" className="pagination-btn" data-page={currentPage + 1} onClick={() => goTo(currentPage + 1)}>{t('activity.next')}</button> : null}
                    </nav>
                ) : null}
            </div>
        );
    }

    const total = shown.kind === 'page' ? shown.data.totalItems : 0;
    return (
        <div id="activity-section">
            <div className="page-header">
                <div>
                    <h2>{t('activity.title')}</h2>
                    <p>{t('activity.subtitle')}</p>
                </div>
            </div>
            <section className="card" aria-labelledby="activity-title">
                <div className="card-head">
                    <h3 id="activity-title"><span className="icon-tile t-bank" aria-hidden="true"><History /></span>{t('activity.log')}</h3>
                    <span className="meta">{t('activity.changes', { count: total })}</span>
                </div>
                <div className="filters activity-filters">
                    <div className="field">
                        <label htmlFor="activity-year">{t('activity.year')}</label>
                        <select id="activity-year" value={year} onChange={event => setYear(event.target.value)}>
                            <option value="">{t('activity.allYears')}</option>
                            {filterYears().map(option => <option key={option} value={option}>{option}</option>)}
                        </select>
                    </div>
                    <div className="field">
                        <label htmlFor="activity-month">{t('activity.month')}</label>
                        <select id="activity-month" value={year ? month : ''} disabled={!year} title={year ? undefined : t('activity.monthNeedsYear')}
                            onChange={event => setMonth(event.target.value)}>
                            <option value="">{t('activity.allMonths')}</option>
                            {MONTH_NAMES.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
                        </select>
                    </div>
                    <button type="button" data-action="filterActivity" className="btn btn-primary" disabled={busy !== null}
                        onClick={() => run('load', { month: year ? month : '', year })}>
                        {busy === 'load' ? <Loader2 className="spin" aria-hidden="true" /> : <Search aria-hidden="true" />} {t('activity.show')}
                    </button>
                    <button type="button" data-action="clearActivityFilters" className="btn btn-secondary" disabled={busy !== null} onClick={clearFilters}>
                        {busy === 'clear' ? <Loader2 className="spin" aria-hidden="true" /> : <X aria-hidden="true" />} {t('activity.clear')}
                    </button>
                </div>
                <div id="activity-feed">
                    <div id="activity-list">{feed}</div>
                </div>
            </section>
        </div>
    );
}
