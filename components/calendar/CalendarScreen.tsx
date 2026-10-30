'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarClock } from 'lucide-react';
import { apiGet, redirectIfUnauthorized } from '@/lib/api-client';
import { formatRupees } from '@/lib/format';
import { t } from '@/lib/i18n';

/**
 * What's due (/api/calendar, v2 Phase 4): everything coming up this month and next in one list,
 * with what is to pay and to receive each month, what is overdue, and how much goes out of each
 * account. Each line links to the screen where it is paid or recorded.
 */

type Direction = 'pay' | 'receive' | 'move' | 'none';
interface Item {
    date: string; kind: string; title: string; amount: number | null; direction: Direction; account: string | null; overdue: boolean; estimated: boolean; href: string;
}
interface Calendar {
    from: string; to: string; items: Item[]; months: { month: string; toPay: number; toReceive: number }[]; overdue: number;
    byAccount: { account: string | null; amount: number }[];
}

const rupees = (paise: number) => formatRupees(paise / 100);
const monthName = (month: string) => new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const dayName = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

export function CalendarScreen() {
    const [calendar, setCalendar] = useState<Calendar | null>(null);

    useEffect(() => {
        apiGet<Calendar>('/api/calendar').then(result => {
            if (redirectIfUnauthorized(result) || !result.ok) return;
            setCalendar(result.data);
        });
        // Once on page load
    }, []);

    if (!calendar) return null;
    const overdueItems = calendar.items.filter(item => item.overdue);
    const groups = calendar.months.map(month => ({
        month: month.month,
        items: calendar.items.filter(item => !item.overdue && item.date.slice(0, 7) === month.month),
    }));

    const line = (item: Item, index: number) => (
        <li key={`${item.kind}-${item.date}-${index}`} className={`due-line due-${item.direction}`} data-due={item.title}>
            <span className="due-date">{dayName(item.date)}</span>
            <span className="due-what">
                <Link href={item.href} className="what">{item.title}</Link>
                {item.overdue ? <span className="tag status-overdue">{t('calendar.overdueTag')}</span> : null}
                {item.account ? <span className="when"> · {item.account}</span> : null}
            </span>
            <b className="amount">
                {item.amount === null ? '' : `${item.estimated ? `${t('calendar.estimatedTag')} ` : ''}${item.direction === 'receive' ? '+' : ''}${rupees(item.amount)}`}
            </b>
        </li>
    );

    return (
        <div id="calendar-section">
            <div className="page-header">
                <div>
                    <h2>{t('calendar.title')}</h2>
                    <p>{t('calendar.subtitle')}</p>
                </div>
            </div>

            <div className="people-totals due-totals">
                {calendar.months.map(month => (
                    <div key={month.month} className="card card-pad" data-month={month.month}>
                        <span className="label">{monthName(month.month)}</span>
                        <b className="amount">{rupees(month.toPay)}</b>
                        <span className="when">{t('calendar.toPay')}{month.toReceive > 0 ? ` · ${t('calendar.toReceive', { amount: rupees(month.toReceive) })}` : ''}</span>
                    </div>
                ))}
            </div>
            {calendar.overdue > 0 ? <p className="notice danger" id="calendar-overdue">{t('calendar.overdue', { amount: rupees(calendar.overdue) })}</p> : null}

            {calendar.items.length === 0 ? <p className="card card-pad empty-note" id="calendar-empty">{t('calendar.none')}</p> : (
                <>
                    {overdueItems.length > 0 ? (
                        <section className="card" aria-labelledby="due-overdue-title">
                            <div className="card-head"><h3 id="due-overdue-title">{t('calendar.overdueTag')}</h3></div>
                            <ul className="due-list" id="due-overdue">{overdueItems.map(line)}</ul>
                        </section>
                    ) : null}
                    {groups.filter(group => group.items.length > 0).map(group => (
                        <section key={group.month} className="card" aria-labelledby={`due-${group.month}`}>
                            <div className="card-head"><h3 id={`due-${group.month}`}><span className="icon-tile t-bank" aria-hidden="true"><CalendarClock /></span>{monthName(group.month)}</h3></div>
                            <ul className="due-list" data-due-month={group.month}>{group.items.map(line)}</ul>
                        </section>
                    ))}
                    {calendar.byAccount.length > 0 ? (
                        <section className="card" aria-labelledby="due-accounts-title" id="due-accounts">
                            <div className="card-head"><h3 id="due-accounts-title">{t('calendar.fromAccount')}</h3></div>
                            <ul className="due-list">
                                {calendar.byAccount.map(item => (
                                    <li key={item.account ?? 'none'} className="due-line" data-account={item.account ?? ''}>
                                        <span className="due-what">{item.account ?? t('calendar.noAccount')}</span>
                                        <b className="amount">{rupees(item.amount)}</b>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ) : null}
                </>
            )}
        </div>
    );
}
