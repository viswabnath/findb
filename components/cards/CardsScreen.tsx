'use client';

import { useEffect, useState } from 'react';
import { CreditCard, X } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { apiDelete, apiGet, apiPost, apiPut, httpError, redirectIfUnauthorized } from '@/lib/api-client';
import { todayInIndiaClient } from '@/lib/dates';
import { formatRupees } from '@/lib/format';
import { t } from '@/lib/i18n';

/**
 * Credit cards (/api/cards, v2 Phase 4): each card's latest statement (worked out from the
 * entries, or the bank's figures once recorded), what is due and by when, whether the bill was
 * paid in full, only the minimum, or late, and what carrying a balance costs at the card's rate.
 */

type Status = 'nothing_due' | 'paid' | 'minimum_paid' | 'part_paid' | 'unpaid';
interface Statement {
    id: number | null; date: string; dueOn: string; amountDue: string; minimumDue: string; interest: string; fees: string; ledgerAmount: string;
    paid: string; left: string; status: Status; overdue: boolean; carried: string; interestIfCarried: string | null; dueSoon: boolean; daysLeft: number;
}
interface Card {
    id: number; name: string; owed: string; creditLimit: string | null; available: string | null; interestRate: string | null; perHundredMonthly: string | null;
    trueRate: number | null; billingDay: number | null; dueDay: number | null; statement: Statement | null; sinceStatement: string;
    history: { id: number; date: string; dueOn: string; amountDue: string; minimumDue: string }[];
}
type Terms = { billingDay: string; dueDay: string; interestRate: string; rateUnit: 'year' | 'per100month' };
type Recording = { card: Card; statementDate: string; dueOn: string; amountDue: string; minimumDue: string; interest: string; fees: string };

const shortDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const amount = (value: string) => parseFloat(value) || 0;

function StatementBlock({ card }: { card: Card }) {
    const statement = card.statement!;
    const unpaidPart = amount(statement.left) > 0;
    const mismatch = statement.id !== null && Math.abs(amount(statement.ledgerAmount) - amount(statement.amountDue)) >= 1;
    return (
        <div className="card-pad card-statement">
            <p className="card-statement-title">
                <b>{t('cards.statementTitle', { date: shortDate(statement.date) })}</b>{' '}
                <span className="when">{statement.id === null ? t('cards.worked') : t('cards.fromBank')}</span>
            </p>
            <p className="card-due">
                {t('cards.due', { amount: formatRupees(statement.amountDue), date: shortDate(statement.dueOn) })}
                <span className={`tag status-${statement.status}`}>{t(`cards.statuses.${statement.status}`)}</span>
                {statement.dueSoon ? <span className="tag status-overdue">{statement.daysLeft === 0 ? t('cards.dueToday') : t('cards.dueIn', { count: statement.daysLeft })}</span> : null}
            </p>
            {amount(statement.amountDue) > 0 ? <p className="when">{t('cards.minimum', { amount: formatRupees(statement.minimumDue) })} · {t('cards.paidLine', { amount: formatRupees(statement.paid) })}</p> : null}
            {statement.overdue ? <p className="notice danger card-warning" data-warning="overdue">{t('cards.overdue')}</p> : null}
            {amount(statement.carried) > 0 ? (
                <p className="notice warn card-warning" data-warning="carried">
                    {statement.interestIfCarried === null ? t('cards.carriedNoRate', { amount: formatRupees(statement.carried) })
                        : t('cards.carried', { amount: formatRupees(statement.carried), interest: formatRupees(statement.interestIfCarried) })}
                </p>
            ) : null}
            {amount(statement.carried) === 0 && unpaidPart && statement.interestIfCarried !== null && amount(statement.amountDue) > amount(statement.minimumDue) ? (
                <p className="form-note" data-warning="minimum">
                    {t('cards.minimumWarning', { amount: formatRupees(String(amount(statement.amountDue) - amount(statement.minimumDue))), interest: formatRupees(statement.interestIfCarried) })}
                </p>
            ) : null}
            {amount(statement.interest) + amount(statement.fees) > 0 ? <p className="when">{t('cards.chargedLine', { interest: formatRupees(statement.interest), fees: formatRupees(statement.fees) })}</p> : null}
            {mismatch ? <p className="form-note">{t('cards.mismatch', { ledger: formatRupees(statement.ledgerAmount), bank: formatRupees(statement.amountDue) })}</p> : null}
            <p className="when">{t('cards.since', { amount: formatRupees(card.sinceStatement) })}</p>
        </div>
    );
}

export function CardsScreen() {
    const toast = useToast();
    const [cards, setCards] = useState<Card[] | null>(null);
    const [terms, setTerms] = useState<Record<number, Terms>>({});
    const [recording, setRecording] = useState<Recording | null>(null);

    const termsOf = (card: Card): Terms => ({
        billingDay: card.billingDay ? String(card.billingDay) : '', dueDay: card.dueDay ? String(card.dueDay) : '', interestRate: card.interestRate ?? '', rateUnit: 'year',
    });

    useEffect(() => {
        apiGet<Card[]>('/api/cards').then(result => {
            if (redirectIfUnauthorized(result) || !result.ok) return;
            setCards(result.data);
            setTerms(Object.fromEntries(result.data.map(card => [card.id, termsOf(card)])));
        });
        // Once on page load
    }, []);

    if (!cards) return null;
    const replace = (card: Card) => {
        setCards(current => (current ?? []).map(item => (item.id === card.id ? card : item)));
        setTerms(current => ({ ...current, [card.id]: termsOf(card) }));
    };
    const setTerm = (id: number, key: keyof Terms, value: string) => setTerms(current => ({ ...current, [id]: { ...current[id]!, [key]: value } }));

    async function saveTerms(card: Card) {
        const result = await apiPut<Card>(`/api/cards/${card.id}`, terms[card.id]);
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        replace(result.data);
        toast('success', t('cards.termsSaved', { name: card.name }));
    }

    async function saveStatement() {
        if (!recording) return;
        const { card, ...body } = recording;
        const result = await apiPost<Card>(`/api/cards/${card.id}/statements`, body);
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        replace(result.data);
        toast('success', t('cards.recorded', { date: shortDate(recording.statementDate), name: card.name }));
        setRecording(null);
    }

    async function removeStatement(card: Card, id: number) {
        const result = await apiDelete<Card>(`/api/cards/${card.id}/statements/${id}`);
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        replace(result.data);
    }

    const openRecording = (card: Card) => setRecording({
        card, statementDate: card.statement?.date ?? todayInIndiaClient(), dueOn: card.statement?.dueOn ?? '',
        amountDue: card.statement ? String(amount(card.statement.ledgerAmount)) : '', minimumDue: '', interest: '', fees: '',
    });
    const setRecord = (key: keyof Omit<Recording, 'card'>, value: string) => setRecording(current => (current ? { ...current, [key]: value } : current));

    return (
        <div id="cards-section">
            <div className="page-header">
                <div>
                    <h2>{t('cards.title')}</h2>
                    <p>{t('cards.subtitle')}</p>
                </div>
            </div>
            {cards.length === 0 ? <p className="card card-pad empty-note" id="cards-empty">{t('cards.none')}</p> : null}

            {cards.map(card => {
                const form = terms[card.id] ?? termsOf(card);
                return (
                    <section key={card.id} className="card card-box" data-card={card.name} aria-labelledby={`card-${card.id}`}>
                        <div className="card-head">
                            <h3 id={`card-${card.id}`}><span className="icon-tile t-card" aria-hidden="true"><CreditCard /></span>{card.name}</h3>
                            <span className="meta card-owed">{t('cards.owed', { amount: formatRupees(card.owed) })}</span>
                        </div>
                        <div className="card-pad loan-facts">
                            {card.creditLimit !== null ? <p className="when">{t('cards.limitLine', { available: formatRupees(card.available!), limit: formatRupees(card.creditLimit) })}</p> : null}
                            {card.interestRate !== null
                                ? <p className="card-rate">{t('cards.rateLine', { rate: card.interestRate, perHundred: card.perHundredMonthly!, trueRate: card.trueRate! })}</p>
                                : <p className="form-note">{t('cards.noRate')}</p>}
                            {card.billingDay === null && !card.statement ? <p className="notice">{t('cards.setUp')}</p> : null}
                        </div>
                        {card.statement ? <StatementBlock card={card} /> : null}
                        <div className="settings-actions">
                            <button type="button" className="btn btn-secondary btn-sm" data-action="recordStatement" onClick={() => openRecording(card)}>{t('cards.record')}</button>
                        </div>
                        <details className="loan-more" open={card.billingDay === null && !card.statement}>
                            <summary className="card-pad">{t('cards.terms')}</summary>
                            <form className="card-pad card-terms" onSubmit={event => { event.preventDefault(); saveTerms(card); }}>
                                <div className="form-grid two">
                                    <div className="field"><label htmlFor={`billing-${card.id}`}>{t('cards.billingDay')}</label>
                                        <input id={`billing-${card.id}`} className="card-billing-day" type="number" inputMode="numeric" min="1" max="31" value={form.billingDay} onChange={event => setTerm(card.id, 'billingDay', event.target.value)} /></div>
                                    <div className="field"><label htmlFor={`due-${card.id}`}>{t('cards.dueDay')}</label>
                                        <input id={`due-${card.id}`} className="card-due-day" type="number" inputMode="numeric" min="1" max="31" value={form.dueDay} onChange={event => setTerm(card.id, 'dueDay', event.target.value)} /></div>
                                    <div className="field"><label htmlFor={`rate-${card.id}`}>{t('cards.rate')}</label>
                                        <input id={`rate-${card.id}`} className="card-rate-input" type="number" inputMode="decimal" min="0" step="0.01" value={form.interestRate} onChange={event => setTerm(card.id, 'interestRate', event.target.value)} /></div>
                                    <div className="field"><label htmlFor={`unit-${card.id}`}>&nbsp;</label>
                                        <select id={`unit-${card.id}`} value={form.rateUnit} onChange={event => setTerm(card.id, 'rateUnit', event.target.value)}>
                                            <option value="year">{t('cards.rateUnits.year')}</option><option value="per100month">{t('cards.rateUnits.per100month')}</option>
                                        </select></div>
                                </div>
                                <button type="submit" className="btn btn-primary btn-sm" data-action="saveCardTerms">{t('cards.saveTerms')}</button>
                            </form>
                        </details>
                        {card.history.length > 0 ? (
                            <details className="loan-more">
                                <summary className="card-pad">{t('cards.history')} ({card.history.length})</summary>
                                <ul className="loan-history card-pad">
                                    {card.history.map(item => (
                                        <li key={item.id}>
                                            <span>{t('cards.historyLine', { date: shortDate(item.date), amount: formatRupees(item.amountDue), dueOn: shortDate(item.dueOn), minimum: formatRupees(item.minimumDue) })}</span>
                                            <button type="button" className="chip-remove" aria-label={t('cards.remove')} onClick={() => removeStatement(card, item.id)}><X aria-hidden="true" /></button>
                                        </li>
                                    ))}
                                </ul>
                            </details>
                        ) : null}
                    </section>
                );
            })}

            <Modal id="card-statement-modal" title={recording ? t('cards.recordTitle', { name: recording.card.name }) : ''}
                open={recording !== null} closeAction="close-card-statement" onClose={() => setRecording(null)}
                footer={(
                    <>
                        <button type="button" className="btn btn-secondary" data-action="close-card-statement" onClick={() => setRecording(null)}>{t('common.cancel')}</button>
                        <button type="button" className="btn btn-primary" data-action="saveStatement" onClick={saveStatement}>{t('cards.save')}</button>
                    </>
                )}>
                {recording ? (
                    <div className="form-grid two">
                        <div className="field"><label htmlFor="statement-date">{t('cards.statementDate')}</label>
                            <input id="statement-date" type="date" value={recording.statementDate} onChange={event => setRecord('statementDate', event.target.value)} /></div>
                        <div className="field"><label htmlFor="statement-due">{t('cards.dueOn')}</label>
                            <input id="statement-due" type="date" value={recording.dueOn} onChange={event => setRecord('dueOn', event.target.value)} /></div>
                        <div className="field"><label htmlFor="statement-amount">{t('cards.amountDue')}</label>
                            <input id="statement-amount" type="number" inputMode="decimal" min="0" step="0.01" value={recording.amountDue} onChange={event => setRecord('amountDue', event.target.value)} /></div>
                        <div className="field"><label htmlFor="statement-minimum">{t('cards.minimumDue')}</label>
                            <input id="statement-minimum" type="number" inputMode="decimal" min="0" step="0.01" placeholder={t('cards.minimumHint')} value={recording.minimumDue} onChange={event => setRecord('minimumDue', event.target.value)} /></div>
                        <div className="field"><label htmlFor="statement-interest">{t('cards.interest')}</label>
                            <input id="statement-interest" type="number" inputMode="decimal" min="0" step="0.01" value={recording.interest} onChange={event => setRecord('interest', event.target.value)} /></div>
                        <div className="field"><label htmlFor="statement-fees">{t('cards.fees')}</label>
                            <input id="statement-fees" type="number" inputMode="decimal" min="0" step="0.01" value={recording.fees} onChange={event => setRecord('fees', event.target.value)} /></div>
                        <p className="form-note field full">{t('cards.chargesHint')}</p>
                    </div>
                ) : null}
            </Modal>
        </div>
    );
}
