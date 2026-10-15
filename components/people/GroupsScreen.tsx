'use client';

import { useEffect, useState } from 'react';
import { Plus, Receipt, Scale, UsersRound, X } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { apiDelete, apiGet, apiPost, httpError, redirectIfUnauthorized } from '@/lib/api-client';
import { todayInIndiaClient } from '@/lib/dates';
import { formatRupees } from '@/lib/format';
import { t } from '@/lib/i18n';

/**
 * Shared expenses and groups (/api/groups, v2 Phase 3): trips and flatmates. Who paid and who
 * shares each cost, split equally, by amounts, percentages or shares; each member's balance and the
 * fewest payments that settle everyone; and what the user spent against what the group spent.
 */

interface Person { id: number; name: string }
interface Account { id: number; type: string; name: string }
interface Category { id: number; kind: 'income' | 'expense'; name: string }
interface EventChoice { id: number; name: string }
interface Member { key: string; personId: number | null; name: string; balance: string }
interface Expense {
    id: number; date: string; description: string; amount: string; paidBy: string; paidByName: string; splitMethod: string;
    category: { id: number; name: string } | null; yourShare: string; shares: { member: string; name: string; share: string }[];
}
interface Settlement { id: number; date: string; from: string; fromName: string; to: string; toName: string; amount: string }
interface Group {
    id: number; name: string; event: { id: number; name: string } | null; members: Member[]; yourBalance: string;
    plan: { from: string; fromName: string; to: string; toName: string; amount: string }[];
    yourCost: string; groupCost: string; byCategory: { name: string; yours: string; group: string }[]; expenses: Expense[]; settlements: Settlement[];
}
type Split = 'equal' | 'exact' | 'percent' | 'shares';

const MONEY = ['bank', 'cash', 'credit_card', 'wallet', 'meal_card'];
const shortDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

function balanceLine(balance: string): string {
    const value = parseFloat(balance);
    if (value > 0) return t('groups.isOwed', { amount: formatRupees(balance) });
    if (value < 0) return t('groups.owes', { amount: formatRupees(String(-value)) });
    return t('groups.settled');
}

export function GroupsScreen() {
    const toast = useToast();
    const [groups, setGroups] = useState<Group[] | null>(null);
    const [people, setPeople] = useState<Person[]>([]);
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [events, setEvents] = useState<EventChoice[]>([]);
    const [openId, setOpenId] = useState<number | null>(null);
    const [newGroup, setNewGroup] = useState({ name: '', members: [] as number[], eventId: '' });
    const [cost, setCost] = useState({ description: '', amount: '', date: todayInIndiaClient(), paidBy: 'you', accountId: '', categoryId: '', split: 'equal' as Split, treat: false });
    const [parts, setParts] = useState<Record<string, { on: boolean; value: string }>>({});
    const [settle, setSettle] = useState({ from: '', to: '', amount: '', accountId: '', date: todayInIndiaClient() });

    async function load() {
        const result = await apiGet<Group[]>('/api/groups');
        if (redirectIfUnauthorized(result) || !result.ok) return;
        setGroups(result.data);
    }

    useEffect(() => {
        load();
        apiGet<{ people: Person[] }>('/api/people').then(result => { if (result.ok) setPeople(result.data.people.map(item => ({ id: item.id, name: item.name }))); });
        apiGet<Account[]>('/api/accounts').then(result => {
            if (!result.ok) return;
            const money = result.data.filter(account => MONEY.includes(account.type));
            setAccounts(money);
            setCost(current => ({ ...current, accountId: String(money[0]?.id ?? '') }));
            setSettle(current => ({ ...current, accountId: String(money[0]?.id ?? '') }));
        });
        apiGet<Category[]>('/api/categories').then(result => { if (result.ok) setCategories(result.data.filter(category => category.kind === 'expense')); });
        apiGet<EventChoice[]>('/api/events').then(result => { if (result.ok) setEvents(result.data.map(item => ({ id: item.id, name: item.name }))); });
        const wanted = Number(new URLSearchParams(window.location.search).get('group'));
        if (wanted) setOpenId(wanted);
        // Once on page load
    }, []);

    const group = groups?.find(item => item.id === openId) ?? null;

    // Everyone shares a new cost equally, until the user changes it
    useEffect(() => {
        if (!group) return;
        setParts(Object.fromEntries(group.members.map(member => [member.key, { on: true, value: '' }])));
        // When another group opens
    }, [openId, groups?.length]);

    if (!groups) return null;

    async function createGroup() {
        const result = await apiPost<Group>('/api/groups', { name: newGroup.name, memberIds: newGroup.members, eventId: newGroup.eventId || null });
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        setNewGroup({ name: '', members: [], eventId: '' });
        await load();
        setOpenId(result.data.id);
    }

    const replace = (updated: Group) => setGroups(current => (current ?? []).map(item => (item.id === updated.id ? updated : item)));

    async function addCost() {
        if (!group) return;
        const chosen = Object.entries(parts).filter(([, part]) => part.on).map(([member, part]) => ({ member, value: part.value }));
        const result = await apiPost<Group>(`/api/groups/${group.id}/expenses`, {
            description: cost.description, amount: cost.amount, date: cost.date, paidBy: cost.paidBy,
            accountId: cost.paidBy === 'you' ? Number(cost.accountId) : undefined, categoryId: cost.categoryId || null,
            split: cost.split, treat: cost.treat, parts: chosen,
        });
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        replace(result.data);
        toast('success', t('groups.costAdded', { description: cost.description }));
        setCost(current => ({ ...current, description: '', amount: '', treat: false }));
    }

    async function removeCost(expense: Expense) {
        if (!group) return;
        const result = await apiDelete<Group>(`/api/groups/${group.id}/expenses/${expense.id}`);
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        replace(result.data);
    }

    async function recordSettlement(from = settle.from, to = settle.to, amount = settle.amount) {
        if (!group) return;
        const result = await apiPost<Group>(`/api/groups/${group.id}/settlements`, {
            from, to, amount, date: settle.date, accountId: from === 'you' || to === 'you' ? Number(settle.accountId) : undefined,
        });
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        replace(result.data);
        toast('success', t('groups.settledUp', { amount: formatRupees(amount) }));
        setSettle(current => ({ ...current, amount: '' }));
    }

    async function removeSettlement(item: Settlement) {
        if (!group) return;
        const result = await apiDelete<Group>(`/api/groups/${group.id}/settlements/${item.id}`);
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        replace(result.data);
    }

    const valueLabel = (split: Split) => (split === 'exact' ? t('groups.values.exact') : split === 'percent' ? t('groups.values.percent') : t('groups.values.shares'));

    return (
        <div id="groups-section">
            <div className="page-header">
                <div>
                    <h2>{t('groups.title')}</h2>
                    <p>{t('groups.subtitle')}</p>
                    <span className="page-header-links"><a className="btn btn-secondary btn-sm" href="/people">{t('groups.toPeople')}</a></span>
                </div>
            </div>

            {group === null ? (
                <>
                    <ul className="group-list" id="group-list">
                        {groups.length === 0 ? <li className="card card-pad empty-note">{t('groups.none')}</li> : groups.map(item => (
                            <li key={item.id} className="card group-card" data-group={item.name}>
                                <button type="button" className="group-open" data-action="openGroup" onClick={() => setOpenId(item.id)}>
                                    <span className="what">{item.name}</span>
                                    <span className="when">{t('groups.members', { count: item.members.length - 1 })} · {t('groups.yourShareOf', { yours: formatRupees(item.yourCost), group: formatRupees(item.groupCost) })}</span>
                                    <span className="group-balance">{balanceLine(item.yourBalance)}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                    <form className="card card-pad group-new" onSubmit={event => { event.preventDefault(); createGroup(); }}>
                        <h3><span className="icon-tile t-bank" aria-hidden="true"><UsersRound /></span>{t('groups.new')}</h3>
                        <div className="field">
                            <label htmlFor="group-name">{t('groups.name')}</label>
                            <input id="group-name" type="text" maxLength={80} placeholder={t('groups.namePlaceholder')} value={newGroup.name} onChange={event => setNewGroup({ ...newGroup, name: event.target.value })} />
                        </div>
                        <fieldset className="field">
                            <legend className="label">{t('groups.who')}</legend>
                            {people.length === 0 ? <p className="form-note"><a href="/people">{t('groups.addPeopleFirst')}</a></p> : (
                                <div className="chips">
                                    {people.map(person => (
                                        <button key={person.id} type="button" className="chip" aria-pressed={newGroup.members.includes(person.id)} data-person={person.name}
                                            onClick={() => setNewGroup({ ...newGroup, members: newGroup.members.includes(person.id) ? newGroup.members.filter(id => id !== person.id) : [...newGroup.members, person.id] })}>
                                            {person.name}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </fieldset>
                        <div className="field">
                            <label htmlFor="group-event">{t('groups.event')}</label>
                            <select id="group-event" value={newGroup.eventId} onChange={event => setNewGroup({ ...newGroup, eventId: event.target.value })}>
                                <option value="">{t('groups.noEvent')}</option>
                                {events.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                            </select>
                        </div>
                        <button type="submit" className="btn btn-primary" data-action="createGroup"><Plus aria-hidden="true" /> {t('groups.create')}</button>
                    </form>
                </>
            ) : (
                <div id="group-detail" data-group={group.name}>
                    <button type="button" className="btn-link" data-action="backToGroups" onClick={() => setOpenId(null)}>{t('groups.back')}</button>
                    <section className="card" aria-labelledby="group-balances-title">
                        <div className="card-head">
                            <h3 id="group-balances-title"><span className="icon-tile t-bank" aria-hidden="true"><Scale /></span>{group.name}</h3>
                            <span className="meta" id="group-your-balance">{balanceLine(group.yourBalance)}</span>
                        </div>
                        <ul className="settings-list" id="group-members">
                            {group.members.map(member => (
                                <li key={member.key} data-member={member.name}><span className="what">{member.name}</span><span>{balanceLine(member.balance)}</span></li>
                            ))}
                        </ul>
                        {group.plan.length > 0 ? (
                            <div className="card-pad group-plan">
                                <span className="label">{t('groups.plan')}</span>
                                <ul id="group-plan">
                                    {group.plan.map(move => (
                                        <li key={`${move.from}-${move.to}`}>
                                            <span>{t('groups.pays', { from: move.fromName, to: move.toName, amount: formatRupees(move.amount) })}</span>
                                            <button type="button" className="btn btn-secondary btn-sm" data-action="recordPlan" onClick={() => recordSettlement(move.from, move.to, move.amount)}>
                                                {t('groups.markPaid')}
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                                <p className="form-note">{t('groups.planNote')}</p>
                            </div>
                        ) : null}
                    </section>

                    <section className="card" aria-labelledby="group-add-title">
                        <div className="card-head"><h3 id="group-add-title"><span className="icon-tile t-income" aria-hidden="true"><Receipt /></span>{t('groups.addCost')}</h3></div>
                        <form className="card-pad group-cost-form" onSubmit={event => { event.preventDefault(); addCost(); }}>
                            <div className="form-grid two">
                                <div className="field">
                                    <label htmlFor="cost-description">{t('groups.what')}</label>
                                    <input id="cost-description" type="text" maxLength={200} value={cost.description} onChange={event => setCost({ ...cost, description: event.target.value })} />
                                </div>
                                <div className="field">
                                    <label htmlFor="cost-amount">{t('groups.amount')}</label>
                                    <input id="cost-amount" type="number" inputMode="decimal" min="0.01" step="0.01" value={cost.amount} onChange={event => setCost({ ...cost, amount: event.target.value })} />
                                </div>
                                <div className="field">
                                    <label htmlFor="cost-paid-by">{t('groups.paidBy')}</label>
                                    <select id="cost-paid-by" value={cost.paidBy} onChange={event => setCost({ ...cost, paidBy: event.target.value })}>
                                        {group.members.map(member => <option key={member.key} value={member.key}>{member.name}</option>)}
                                    </select>
                                </div>
                                {cost.paidBy === 'you' ? (
                                    <div className="field">
                                        <label htmlFor="cost-account">{t('groups.fromAccount')}</label>
                                        <select id="cost-account" value={cost.accountId} onChange={event => setCost({ ...cost, accountId: event.target.value })}>
                                            {accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
                                        </select>
                                    </div>
                                ) : null}
                                <div className="field">
                                    <label htmlFor="cost-date">{t('groups.date')}</label>
                                    <input id="cost-date" type="date" value={cost.date} onChange={event => setCost({ ...cost, date: event.target.value })} />
                                </div>
                                <div className="field">
                                    <label htmlFor="cost-category">{t('groups.category')}</label>
                                    <select id="cost-category" value={cost.categoryId} onChange={event => setCost({ ...cost, categoryId: event.target.value })}>
                                        <option value="">{t('groups.uncategorised')}</option>
                                        {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
                                    </select>
                                </div>
                            </div>
                            <label className="check-line">
                                <input type="checkbox" id="cost-treat" checked={cost.treat} onChange={event => setCost({ ...cost, treat: event.target.checked })} />
                                {t('groups.treat')}
                            </label>
                            {!cost.treat ? (
                                <fieldset className="field group-split">
                                    <legend className="label">{t('groups.split')}</legend>
                                    <div className="segmented" role="radiogroup" aria-label={t('groups.split')}>
                                        {(['equal', 'exact', 'percent', 'shares'] as Split[]).map(split => (
                                            <button key={split} type="button" role="radio" aria-checked={cost.split === split} data-split={split} onClick={() => setCost({ ...cost, split })}>
                                                {t(`groups.splits.${split}`)}
                                            </button>
                                        ))}
                                    </div>
                                    <ul className="group-parts" id="group-parts">
                                        {group.members.map(member => (
                                            <li key={member.key} data-part={member.name}>
                                                <label className="check-line">
                                                    <input type="checkbox" checked={parts[member.key]?.on ?? true}
                                                        onChange={event => setParts({ ...parts, [member.key]: { on: event.target.checked, value: parts[member.key]?.value ?? '' } })} />
                                                    {member.name}
                                                </label>
                                                {cost.split !== 'equal' && (parts[member.key]?.on ?? true) ? (
                                                    <input type="number" inputMode="decimal" min="0" step={cost.split === 'shares' ? 1 : 0.01} aria-label={`${valueLabel(cost.split)}: ${member.name}`}
                                                        value={parts[member.key]?.value ?? ''} onChange={event => setParts({ ...parts, [member.key]: { on: true, value: event.target.value } })} />
                                                ) : null}
                                            </li>
                                        ))}
                                    </ul>
                                </fieldset>
                            ) : null}
                            <button type="submit" className="btn btn-primary" data-action="addCost"><Plus aria-hidden="true" /> {t('groups.add')}</button>
                        </form>
                    </section>

                    <section className="card" aria-labelledby="group-costs-title">
                        <div className="card-head">
                            <h3 id="group-costs-title">{t('groups.costs')}</h3>
                            <span className="meta" id="group-cost">{t('groups.yourShareOf', { yours: formatRupees(group.yourCost), group: formatRupees(group.groupCost) })}</span>
                        </div>
                        <ul className="settings-list" id="group-expenses">
                            {group.expenses.length === 0 ? <li>{t('groups.noCosts')}</li> : group.expenses.map(expense => (
                                <li key={expense.id} data-expense={expense.description}>
                                    <span className="search-entry">
                                        <span className="what">{expense.description}</span>
                                        <span className="when">{shortDate(expense.date)} · {t('groups.paidLine', { name: expense.paidByName, amount: formatRupees(expense.amount) })}
                                            {parseFloat(expense.yourShare) > 0 ? ` · ${t('groups.yourPart', { amount: formatRupees(expense.yourShare) })}` : ''}</span>
                                    </span>
                                    <button type="button" className="chip-remove" data-action="removeCost" aria-label={t('groups.removeCost', { description: expense.description })} onClick={() => removeCost(expense)}>
                                        <X aria-hidden="true" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                        {group.byCategory.length > 0 ? (
                            <table className="data-table group-categories" id="group-categories">
                                <thead><tr><th>{t('groups.category')}</th><th>{t('groups.yours')}</th><th>{t('groups.everyone')}</th></tr></thead>
                                <tbody>
                                    {group.byCategory.map(row => (
                                        <tr key={row.name}><td>{row.name}</td><td className="amount">{formatRupees(row.yours)}</td><td className="amount">{formatRupees(row.group)}</td></tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : null}
                    </section>

                    <section className="card" aria-labelledby="group-settle-title">
                        <div className="card-head"><h3 id="group-settle-title">{t('groups.settleUp')}</h3></div>
                        <form className="card-pad form-grid two" onSubmit={event => { event.preventDefault(); recordSettlement(); }}>
                            <div className="field">
                                <label htmlFor="settle-from">{t('groups.from')}</label>
                                <select id="settle-from" value={settle.from} onChange={event => setSettle({ ...settle, from: event.target.value })}>
                                    <option value="">{t('groups.choose')}</option>
                                    {group.members.map(member => <option key={member.key} value={member.key}>{member.name}</option>)}
                                </select>
                            </div>
                            <div className="field">
                                <label htmlFor="settle-to">{t('groups.to')}</label>
                                <select id="settle-to" value={settle.to} onChange={event => setSettle({ ...settle, to: event.target.value })}>
                                    <option value="">{t('groups.choose')}</option>
                                    {group.members.map(member => <option key={member.key} value={member.key}>{member.name}</option>)}
                                </select>
                            </div>
                            <div className="field">
                                <label htmlFor="settle-amount">{t('groups.amount')}</label>
                                <input id="settle-amount" type="number" inputMode="decimal" min="0.01" step="0.01" value={settle.amount} onChange={event => setSettle({ ...settle, amount: event.target.value })} />
                            </div>
                            <div className="field">
                                <label htmlFor="settle-account">{t('groups.yourAccount')}</label>
                                <select id="settle-account" value={settle.accountId} onChange={event => setSettle({ ...settle, accountId: event.target.value })}>
                                    {accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
                                </select>
                            </div>
                            <button type="submit" className="btn btn-primary" data-action="recordSettlement">{t('groups.record')}</button>
                        </form>
                        <ul className="settings-list" id="group-settlements">
                            {group.settlements.map(item => (
                                <li key={item.id}>
                                    <span>{shortDate(item.date)} · {t('groups.paid', { from: item.fromName, to: item.toName, amount: formatRupees(item.amount) })}</span>
                                    <button type="button" className="chip-remove" aria-label={t('groups.removeSettlement')} onClick={() => removeSettlement(item)}><X aria-hidden="true" /></button>
                                </li>
                            ))}
                        </ul>
                    </section>
                </div>
            )}
        </div>
    );
}
