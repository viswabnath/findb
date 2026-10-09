'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, CalendarHeart, Pencil, Plus, Trash2 } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { apiDelete, apiGet, apiPost, apiPut, httpError, redirectIfUnauthorized } from '@/lib/api-client';
import { formatRupees } from '@/lib/format';

/**
 * Events and projects (/api/events): a wedding, a trip, building a house. Each shows what it cost
 * by category, what was received for it, the net cost, the budget against what was spent, which
 * accounts paid, and a timeline of its entries. Entries are given an event on the Transactions screen.
 */

interface EventSummary {
    id: number; name: string; startsOn: string | null; endsOn: string | null; budget: string | null; oneOff: boolean; notes: string | null;
    spent: string; received: string; netCost: string; budgetLeft: string | null; entries: number;
}
interface Line { id: number; name: string; amount: string; type?: string }
interface TimelineEntry { id: number; type: string; date: string; description: string; amount: string; account: { name: string }; category: { name: string } | null }
interface EventDetail extends EventSummary {
    spentByCategory: Line[]; receivedByCategory: Line[]; paidFrom: Line[]; timeline: TimelineEntry[];
}
interface Draft { id: number | null; name: string; startsOn: string; endsOn: string; budget: string; oneOff: boolean; notes: string }

const EMPTY: Draft = { id: null, name: '', startsOn: '', endsOn: '', budget: '', oneOff: true, notes: '' };
const day = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

function dates(event: EventSummary): string {
    if (event.startsOn && event.endsOn) return `${day(event.startsOn)} to ${day(event.endsOn)}`;
    if (event.startsOn) return `From ${day(event.startsOn)}`;
    if (event.endsOn) return `Until ${day(event.endsOn)}`;
    return 'No dates';
}

function BudgetMeter({ event }: { event: EventSummary }) {
    if (event.budget === null) return null;
    const budget = parseFloat(event.budget);
    const spent = parseFloat(event.spent);
    const share = budget > 0 ? Math.min(spent / budget, 1) : 1;
    const over = budget >= 0 && spent > budget;
    return (
        <div className="event-budget">
            <span className="meter"><i className={over ? 'high' : share > 0.8 ? 'warn' : undefined} style={{ width: `${share * 100}%` }} /></span>
            <span className="account-note">
                {over ? `${formatRupees(spent - budget)} over the budget of ${formatRupees(budget)}` : `${formatRupees(event.budgetLeft ?? 0)} left of ${formatRupees(budget)}`}
            </span>
        </div>
    );
}

export function EventsScreen() {
    const toast = useToast();
    const [events, setEvents] = useState<EventSummary[] | null>(null);
    const [detail, setDetail] = useState<EventDetail | null>(null);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [pendingRemove, setPendingRemove] = useState<EventSummary | null>(null);

    const load = useCallback(async () => {
        const result = await apiGet<EventSummary[]>('/api/events');
        if (redirectIfUnauthorized(result) || !result.ok) return;
        setEvents(result.data);
    }, []);

    useEffect(() => {
        load();
        // Once on page load; the buttons reload afterwards
    }, []);

    async function open(id: number) {
        const result = await apiGet<EventDetail>(`/api/events/${id}`);
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        setDetail(result.data);
    }

    async function save() {
        if (!draft) return;
        if (!draft.name.trim()) return toast('error', 'Please enter a name');
        const body = { name: draft.name, startsOn: draft.startsOn, endsOn: draft.endsOn, budget: draft.budget, oneOff: draft.oneOff, notes: draft.notes };
        const result = draft.id === null ? await apiPost('/api/events', body) : await apiPut(`/api/events/${draft.id}`, body);
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        toast('success', draft.id === null ? 'Event added' : 'Event updated');
        const editedId = draft.id;
        setDraft(null);
        await load();
        if (editedId !== null && detail?.id === editedId) await open(editedId);
    }

    async function remove() {
        if (!pendingRemove) return;
        const result = await apiDelete(`/api/events/${pendingRemove.id}`);
        if (redirectIfUnauthorized(result)) return;
        setPendingRemove(null);
        if (!result.ok) return toast('error', httpError(result));
        toast('success', `${pendingRemove.name} removed`);
        setDetail(null);
        await load();
    }

    if (events === null) return null;

    const editButton = (event: EventSummary) => (
        <button type="button" className="icon-btn" data-action="edit-event" data-id={event.id}
            onClick={() => setDraft({
                id: event.id, name: event.name, startsOn: event.startsOn ?? '', endsOn: event.endsOn ?? '',
                budget: event.budget === null ? '' : String(parseFloat(event.budget)), oneOff: event.oneOff, notes: event.notes ?? '',
            })}>
            <Pencil aria-hidden="true" /> Edit
        </button>
    );

    const totals = events.reduce((sum, event) => sum + parseFloat(event.netCost), 0);

    return (
        <div id="events-section">
            <div className="page-header">
                <div>
                    <h2>Events and projects</h2>
                    <p>A wedding, a trip, building a house: see what each one really cost. Give an entry an event on the Transactions screen.</p>
                </div>
                <button type="button" className="btn btn-primary" data-action="newEvent" onClick={() => setDraft({ ...EMPTY })}>
                    <Plus aria-hidden="true" /> New event
                </button>
            </div>

            {detail ? (
                <section id="event-detail" className="card" aria-labelledby="event-detail-title">
                    <div className="card-head">
                        <h3 id="event-detail-title">
                            <button type="button" className="icon-btn" data-action="closeEvent" onClick={() => setDetail(null)} aria-label="Back to all events">
                                <ArrowLeft aria-hidden="true" />
                            </button>
                            {detail.name}
                        </h3>
                        <span className="row-actions">
                            {editButton(detail)}
                            <button type="button" className="icon-btn danger" data-action="remove-event" data-id={detail.id} onClick={() => setPendingRemove(detail)}>
                                <Trash2 aria-hidden="true" /> Remove
                            </button>
                        </span>
                    </div>
                    <div className="card-pad stack">
                        <p className="sub">{dates(detail)}{detail.oneOff ? ', a one-off, left out of regular spending' : ''}</p>
                        <div className="stats three">
                            <div className="stat"><span className="stat-top">Spent</span><span className="stat-value" id="event-spent">{formatRupees(detail.spent)}</span></div>
                            <div className="stat"><span className="stat-top">Received</span><span className="stat-value" id="event-received">{formatRupees(detail.received)}</span></div>
                            <div className="stat hero"><span className="stat-top">Net cost to you</span><span className="stat-value" id="event-net-cost">{formatRupees(detail.netCost)}</span></div>
                        </div>
                        <BudgetMeter event={detail} />
                        <div className="event-columns">
                            <div>
                                <h4>Spent by category</h4>
                                <ul className="settings-list" id="event-by-category">
                                    {detail.spentByCategory.length === 0 ? <li>Nothing spent yet</li> : detail.spentByCategory.map(line => (
                                        <li key={line.id}><span className="what">{line.name}</span><span>{formatRupees(line.amount)}</span></li>
                                    ))}
                                </ul>
                            </div>
                            <div>
                                <h4>Paid from</h4>
                                <ul className="settings-list" id="event-paid-from">
                                    {detail.paidFrom.length === 0 ? <li>Nothing paid yet</li> : detail.paidFrom.map(line => (
                                        <li key={line.id}><span className="what">{line.name}</span><span>{formatRupees(line.amount)}</span></li>
                                    ))}
                                </ul>
                                {detail.receivedByCategory.length > 0 ? (
                                    <>
                                        <h4>Received</h4>
                                        <ul className="settings-list">
                                            {detail.receivedByCategory.map(line => (
                                                <li key={line.id}><span className="what">{line.name}</span><span>{formatRupees(line.amount)}</span></li>
                                            ))}
                                        </ul>
                                    </>
                                ) : null}
                            </div>
                        </div>
                        <h4>Timeline</h4>
                        <ul className="settings-list" id="event-timeline">
                            {detail.timeline.length === 0 ? <li>No entries yet. Choose this event when you add an entry.</li> : detail.timeline.map(entry => (
                                <li key={entry.id}>
                                    <div>
                                        <span className="what">{entry.description}</span>
                                        <div className="when">{day(entry.date)}, {entry.category?.name ?? 'Transfer'}, {entry.account.name}</div>
                                    </div>
                                    <span className={entry.type === 'income' ? 'amount in' : 'amount out'}>{formatRupees(entry.amount)}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </section>
            ) : (
                <section className="card" aria-labelledby="events-title">
                    <div className="card-head">
                        <h3 id="events-title"><span className="icon-tile t-bank" aria-hidden="true"><CalendarHeart /></span>All events</h3>
                        <span className="meta">Net cost of all: {formatRupees(totals)}</span>
                    </div>
                    <ul id="events-list" className="settings-list">
                        {events.length === 0 ? <li>No events yet. Add one for a wedding, a trip or a big purchase.</li> : events.map(event => (
                            <li key={event.id} data-event={event.id}>
                                <div className="event-row">
                                    <button type="button" className="btn-link event-name" data-action="openEvent" data-id={event.id} onClick={() => open(event.id)}>{event.name}</button>
                                    <div className="when">{dates(event)}; {event.entries} {event.entries === 1 ? 'entry' : 'entries'}</div>
                                    <BudgetMeter event={event} />
                                </div>
                                <span className="event-cost">
                                    <strong>{formatRupees(event.netCost)}</strong>
                                    <span className="when">spent {formatRupees(event.spent)}, received {formatRupees(event.received)}</span>
                                </span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            <Modal id="event-modal" title={draft?.id === null ? 'New event' : 'Edit event'} open={draft !== null} closeAction="close-event" onClose={() => setDraft(null)}
                footer={(
                    <>
                        <button type="button" data-action="close-event" className="btn btn-secondary" onClick={() => setDraft(null)}>Cancel</button>
                        <button type="button" data-action="save-event" className="btn btn-primary" onClick={save}>Save</button>
                    </>
                )}>
                <form className="form-grid two" onSubmit={event => { event.preventDefault(); save(); }}>
                    <div className="field span-2">
                        <label htmlFor="event-name">Name</label>
                        <input type="text" id="event-name" maxLength={80} placeholder="Sister's wedding" value={draft?.name ?? ''}
                            onChange={event => setDraft(current => current && { ...current, name: event.target.value })} />
                    </div>
                    <div className="field">
                        <label htmlFor="event-starts">Starts (optional)</label>
                        <input type="date" id="event-starts" value={draft?.startsOn ?? ''}
                            onChange={event => setDraft(current => current && { ...current, startsOn: event.target.value })} />
                    </div>
                    <div className="field">
                        <label htmlFor="event-ends">Ends (optional)</label>
                        <input type="date" id="event-ends" value={draft?.endsOn ?? ''}
                            onChange={event => setDraft(current => current && { ...current, endsOn: event.target.value })} />
                    </div>
                    <div className="field">
                        <label htmlFor="event-budget">Budget (₹, optional)</label>
                        <input type="number" id="event-budget" inputMode="decimal" min="0" step="0.01" value={draft?.budget ?? ''}
                            onChange={event => setDraft(current => current && { ...current, budget: event.target.value })} />
                    </div>
                    <label className="check-line">
                        <input type="checkbox" id="event-one-off" checked={draft?.oneOff ?? true}
                            onChange={event => setDraft(current => current && { ...current, oneOff: event.target.checked })} />
                        A one-off: leave it out of regular spending
                    </label>
                    <div className="field span-2">
                        <label htmlFor="event-notes">Notes (optional)</label>
                        <input type="text" id="event-notes" maxLength={500} value={draft?.notes ?? ''}
                            onChange={event => setDraft(current => current && { ...current, notes: event.target.value })} />
                    </div>
                </form>
            </Modal>

            <Modal id="remove-event-modal" title="Remove this event?" small open={pendingRemove !== null} closeAction="close-remove-event" onClose={() => setPendingRemove(null)}
                footer={(
                    <>
                        <button type="button" data-action="close-remove-event" className="btn btn-secondary" onClick={() => setPendingRemove(null)}>Cancel</button>
                        <button type="button" data-action="confirm-remove-event" className="btn btn-danger" onClick={remove}><Trash2 aria-hidden="true" /> Remove</button>
                    </>
                )}>
                <p className="lead">Remove {pendingRemove?.name}?</p>
                <p>Its entries stay, still marked with it. It will not be offered for new entries.</p>
            </Modal>
        </div>
    );
}
