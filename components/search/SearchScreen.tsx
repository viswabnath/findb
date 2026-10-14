'use client';

import { useEffect, useState } from 'react';
import { Bookmark, Search, SlidersHorizontal, X } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { apiDelete, apiGet, apiPost, httpError, redirectIfUnauthorized } from '@/lib/api-client';
import { formatRupees } from '@/lib/format';
import { t } from '@/lib/i18n';

/**
 * Search across everything (/api/search, v2 Phase 2): words, dates, amounts, type, account,
 * category, tag and event, with the totals of every match. The filters are kept in the address,
 * so a search can be bookmarked or shared between tabs; saved searches keep them under a name.
 */

interface Account { id: number; type: string; name: string }
interface Category { id: number; kind: 'income' | 'expense'; name: string }
interface EventChoice { id: number; name: string }
interface Entry {
    id: number; type: 'income' | 'expense' | 'transfer'; date: string; description: string; amount: string;
    account: { id: number; name: string }; toAccount: { id: number; name: string } | null;
    category: { id: number; name: string } | null; tags: string[]; event: { id: number; name: string } | null;
}
type Filters = Partial<Record<'q' | 'from' | 'to' | 'min' | 'max' | 'type' | 'accountId' | 'categoryId' | 'tag' | 'eventId', string>>;
interface Result {
    entries: Entry[]; total: number; totals: { income: string; expense: string; transfer: string }; offset: number; more: boolean;
    accounts: { id: number; name: string }[]; categories: { id: number; name: string }[]; events: { id: number; name: string }[];
}
interface Saved { id: number; name: string; filters: Record<string, string | number> }

const KEYS = ['q', 'from', 'to', 'min', 'max', 'type', 'accountId', 'categoryId', 'tag', 'eventId'] as const;
const shortDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** Only the filters that are set, as text */
function clean(filters: Filters | Record<string, string | number>): Filters {
    return Object.fromEntries(KEYS.flatMap(key => {
        const value = (filters as Record<string, unknown>)[key];
        return value === undefined || value === null || String(value).trim() === '' ? [] : [[key, String(value).trim()]];
    }));
}

export function SearchScreen() {
    const toast = useToast();
    const [accounts, setAccounts] = useState<Account[] | null>(null);
    const [categories, setCategories] = useState<Category[]>([]);
    const [events, setEvents] = useState<EventChoice[]>([]);
    const [saved, setSaved] = useState<Saved[]>([]);
    const [filters, setFilters] = useState<Filters>({});
    const [result, setResult] = useState<Result | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [saveName, setSaveName] = useState<string | null>(null);

    async function run(next: Filters, offset = 0) {
        const wanted = clean(next);
        setFilters(wanted);
        setProblem(null);
        const query = new URLSearchParams(wanted);
        window.history.replaceState(null, '', query.size ? `/search?${query}` : '/search');
        if (Object.keys(wanted).length === 0) {
            setResult(null);
            return;
        }
        if (offset > 0) query.set('offset', String(offset));
        const response = await apiGet<Result>(`/api/search?${query}`);
        if (redirectIfUnauthorized(response)) return;
        if (!response.ok) {
            setProblem(httpError(response));
            return;
        }
        setResult(current => (offset > 0 && current
            ? { ...response.data, entries: [...current.entries, ...response.data.entries], accounts: current.accounts, categories: current.categories, events: current.events }
            : response.data));
    }

    useEffect(() => {
        (async () => {
            const [accountList, categoryList, eventList, savedList] = await Promise.all([
                apiGet<Account[]>('/api/accounts'), apiGet<Category[]>('/api/categories'), apiGet<EventChoice[]>('/api/events'), apiGet<Saved[]>('/api/searches'),
            ]);
            if (redirectIfUnauthorized(accountList) || !accountList.ok) return;
            setCategories(categoryList.ok ? categoryList.data : []);
            setEvents(eventList.ok ? eventList.data.map(event => ({ id: event.id, name: event.name })) : []);
            setSaved(savedList.ok ? savedList.data : []);
            setAccounts(accountList.data);
            const fromAddress = clean(Object.fromEntries(new URLSearchParams(window.location.search)));
            if (Object.keys(fromAddress).length > 0) await run(fromAddress);
        })();
        // Once on page load
    }, []);

    if (accounts === null) return null;

    const set = (key: keyof Filters, value: string) => setFilters(current => ({ ...current, [key]: value }));
    const filterCount = KEYS.filter(key => key !== 'q' && filters[key]).length;

    async function save() {
        if (saveName === null) return;
        const response = await apiPost<Saved>('/api/searches', { name: saveName, filters: clean(filters) });
        if (redirectIfUnauthorized(response)) return;
        if (!response.ok) return toast('error', httpError(response));
        setSaved(current => [...current.filter(item => item.id !== response.data.id), response.data].sort((a, b) => a.name.localeCompare(b.name)));
        setSaveName(null);
        toast('success', t('search.savedAs', { name: response.data.name }));
    }

    async function remove(item: Saved) {
        const response = await apiDelete(`/api/searches/${item.id}`);
        if (redirectIfUnauthorized(response)) return;
        if (!response.ok) return toast('error', httpError(response));
        setSaved(current => current.filter(other => other.id !== item.id));
    }

    const amountText = (entry: Entry) => (entry.type === 'expense' ? `-${formatRupees(entry.amount)}` : entry.type === 'income' ? `+${formatRupees(entry.amount)}` : formatRupees(entry.amount));

    return (
        <div id="search-section">
            <div className="page-header">
                <div>
                    <h2>{t('search.title')}</h2>
                    <p>{t('search.subtitle')}</p>
                </div>
            </div>

            <section className="card" aria-labelledby="search-title">
                <h3 id="search-title" className="sr-only">{t('search.title')}</h3>
                <form className="add-row single search-bar" role="search" onSubmit={event => { event.preventDefault(); run(filters); }}>
                    <div className="field">
                        <label htmlFor="search-q">{t('search.words')}</label>
                        <input id="search-q" type="search" maxLength={100} placeholder={t('search.placeholder')} value={filters.q ?? ''}
                            onChange={event => set('q', event.target.value)} />
                    </div>
                    <button type="submit" className="btn btn-primary" data-action="runSearch"><Search aria-hidden="true" /> {t('search.run')}</button>
                </form>
                <details className="search-filters" open={filterCount > 0 || undefined}>
                    <summary className="card-pad"><SlidersHorizontal aria-hidden="true" /> {filterCount > 0 ? t('search.filtersOn', { count: filterCount }) : t('search.filters')}</summary>
                    <div className="card-pad search-filter-grid">
                        <div className="field"><label htmlFor="search-from">{t('search.from')}</label>
                            <input id="search-from" type="date" value={filters.from ?? ''} onChange={event => set('from', event.target.value)} /></div>
                        <div className="field"><label htmlFor="search-to">{t('search.to')}</label>
                            <input id="search-to" type="date" value={filters.to ?? ''} onChange={event => set('to', event.target.value)} /></div>
                        <div className="field"><label htmlFor="search-min">{t('search.min')}</label>
                            <input id="search-min" type="number" inputMode="decimal" min="0" step="0.01" value={filters.min ?? ''} onChange={event => set('min', event.target.value)} /></div>
                        <div className="field"><label htmlFor="search-max">{t('search.max')}</label>
                            <input id="search-max" type="number" inputMode="decimal" min="0" step="0.01" value={filters.max ?? ''} onChange={event => set('max', event.target.value)} /></div>
                        <div className="field"><label htmlFor="search-type">{t('search.type')}</label>
                            <select id="search-type" value={filters.type ?? ''} onChange={event => set('type', event.target.value)}>
                                <option value="">{t('search.any')}</option>
                                <option value="expense">{t('search.types.expense')}</option>
                                <option value="income">{t('search.types.income')}</option>
                                <option value="transfer">{t('search.types.transfer')}</option>
                            </select></div>
                        <div className="field"><label htmlFor="search-account">{t('search.account')}</label>
                            <select id="search-account" value={filters.accountId ?? ''} onChange={event => set('accountId', event.target.value)}>
                                <option value="">{t('search.any')}</option>
                                {accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
                            </select></div>
                        <div className="field"><label htmlFor="search-category">{t('search.category')}</label>
                            <select id="search-category" value={filters.categoryId ?? ''} onChange={event => set('categoryId', event.target.value)}>
                                <option value="">{t('search.any')}</option>
                                {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
                            </select></div>
                        <div className="field"><label htmlFor="search-tag">{t('search.tag')}</label>
                            <input id="search-tag" type="text" maxLength={30} value={filters.tag ?? ''} onChange={event => set('tag', event.target.value)} /></div>
                        <div className="field"><label htmlFor="search-event">{t('search.event')}</label>
                            <select id="search-event" value={filters.eventId ?? ''} onChange={event => set('eventId', event.target.value)}>
                                <option value="">{t('search.any')}</option>
                                {events.map(event => <option key={event.id} value={event.id}>{event.name}</option>)}
                            </select></div>
                    </div>
                    <div className="settings-actions">
                        <button type="button" className="btn btn-primary" data-action="applyFilters" onClick={() => run(filters)}>{t('search.apply')}</button>
                        <button type="button" className="btn btn-secondary" data-action="clearFilters" onClick={() => run({})}>{t('search.clear')}</button>
                    </div>
                </details>
                {saved.length > 0 ? (
                    <div className="card-pad saved-searches" id="saved-searches">
                        <span className="label">{t('search.saved')}</span>
                        <div className="chips">
                            {saved.map(item => (
                                <span key={item.id} className="chip-with-remove">
                                    <button type="button" className="chip" data-saved={item.name} onClick={() => run(clean(item.filters))}>{item.name}</button>
                                    <button type="button" className="chip-remove" aria-label={t('search.removeSaved', { name: item.name })} onClick={() => remove(item)}><X aria-hidden="true" /></button>
                                </span>
                            ))}
                        </div>
                    </div>
                ) : null}
            </section>

            {problem ? <p className="notice warn" id="search-problem" role="alert">{problem}</p> : null}

            {result ? (
                <section className="card" aria-labelledby="search-results-title" id="search-results">
                    <div className="card-head">
                        <h3 id="search-results-title">{t('search.results')}</h3>
                        {saveName === null ? (
                            <button type="button" className="btn btn-secondary btn-sm" data-action="saveSearch" onClick={() => setSaveName(filters.q ?? '')}>
                                <Bookmark aria-hidden="true" /> {t('search.save')}
                            </button>
                        ) : null}
                    </div>
                    {saveName !== null ? (
                        <form className="add-row single" onSubmit={event => { event.preventDefault(); save(); }}>
                            <div className="field">
                                <label htmlFor="search-save-name">{t('search.saveName')}</label>
                                <input id="search-save-name" type="text" maxLength={60} value={saveName} onChange={event => setSaveName(event.target.value)} autoFocus />
                            </div>
                            <button type="submit" className="btn btn-primary" data-action="confirmSaveSearch">{t('search.saveConfirm')}</button>
                        </form>
                    ) : null}
                    {result.accounts.length + result.categories.length + result.events.length > 0 ? (
                        <div className="card-pad search-names" id="search-names">
                            {result.accounts.map(item => <button key={`a${item.id}`} type="button" className="chip" onClick={() => run({ ...filters, q: '', accountId: String(item.id) })}>{t('search.inAccount', { name: item.name })}</button>)}
                            {result.categories.map(item => <button key={`c${item.id}`} type="button" className="chip" onClick={() => run({ ...filters, q: '', categoryId: String(item.id) })}>{t('search.inCategory', { name: item.name })}</button>)}
                            {result.events.map(item => <button key={`e${item.id}`} type="button" className="chip" onClick={() => run({ ...filters, q: '', eventId: String(item.id) })}>{t('search.inEvent', { name: item.name })}</button>)}
                        </div>
                    ) : null}
                    <p className="card-pad search-summary" id="search-summary">
                        {t('search.count', { count: result.total })}
                        {Number(result.totals.expense) > 0 ? ` ${t('search.totalOut', { amount: formatRupees(result.totals.expense) })}` : ''}
                        {Number(result.totals.income) > 0 ? ` ${t('search.totalIn', { amount: formatRupees(result.totals.income) })}` : ''}
                        {Number(result.totals.transfer) > 0 ? ` ${t('search.totalMoved', { amount: formatRupees(result.totals.transfer) })}` : ''}
                    </p>
                    <ul id="search-list" className="settings-list search-list">
                        {result.entries.length === 0 ? <li>{t('search.none')}</li> : result.entries.map(entry => (
                            <li key={entry.id} data-entry={entry.id}>
                                <span className="search-entry">
                                    <span className="what">{entry.description}</span>
                                    <span className="when">
                                        {shortDate(entry.date)} · {entry.toAccount ? t('search.fromTo', { from: entry.account.name, to: entry.toAccount.name }) : entry.account.name}
                                        {entry.category ? ` · ${entry.category.name}` : ''}
                                    </span>
                                    {entry.event || entry.tags.length ? (
                                        <span className="entry-meta">
                                            {entry.event ? <span className="tag event-tag">{entry.event.name}</span> : null}
                                            {entry.tags.map(tag => <span key={tag} className="tag">{tag}</span>)}
                                        </span>
                                    ) : null}
                                </span>
                                <span className={`amount ${entry.type === 'income' ? 'in' : 'out'}`}>{amountText(entry)}</span>
                            </li>
                        ))}
                    </ul>
                    {result.more ? (
                        <div className="settings-actions">
                            <button type="button" className="btn btn-secondary" data-action="moreResults" onClick={() => run(filters, result.entries.length)}>{t('search.more')}</button>
                        </div>
                    ) : null}
                </section>
            ) : null}
        </div>
    );
}
