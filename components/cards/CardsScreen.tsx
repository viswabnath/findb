'use client';

import { useEffect, useState } from 'react';
import { CreditCard, Gift, Layers, Plus, X } from 'lucide-react';
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
    line: { id: number; name: string; limit: string; available: string } | null; blocked: string;
    history: { id: number; date: string; dueOn: string; amountDue: string; minimumDue: string }[];
}
interface Line { id: number; name: string; limit: string; owed: string; available: string; cards: { id: number; name: string }[] }
const EMPTY_LINE = { name: '', limit: '', cardIds: [] as number[] };
type RewardKind = 'earned' | 'redeemed' | 'expired' | 'cashback';
interface Rewards {
    id: number; name: string; pointValue: string | null;
    points: { balance: number; value: string | null; expiring: { expiresOn: string; points: number; daysLeft: number }[]; lapsed: number };
    cashback: { thisYear: string; byYear: { year: string; amount: string }[] };
    compare: { spent: string; rewards: string; rate: number | null; pointsUnvalued: boolean };
    history: { id: number; kind: RewardKind; date: string; points: number; amount: string; expiresOn: string | null; into: string | null }[];
}
interface MoneyAccount { id: number; type: string; name: string }
type RewardForm = { card: Card; kind: RewardKind; date: string; points: string; amount: string; expiresOn: string; intoAccountId: string };
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

function RewardsBlock({ card, rewards, pointValue, onPointValue, onSavePointValue, onRecord, onRemove }: {
    card: Card; rewards: Rewards | undefined; pointValue: string; onPointValue: (value: string) => void; onSavePointValue: () => void; onRecord: () => void; onRemove: (id: number) => void;
}) {
    if (!rewards) return null;
    const { points, cashback } = rewards;
    return (
        <div className="card-pad card-statement card-rewards">
            <p className="card-statement-title"><b>{t('cards.rewards.title')}</b></p>
            <p className="reward-points">{points.value === null ? t('cards.rewards.points', { points: points.balance }) : t('cards.rewards.pointsValue', { points: points.balance, value: formatRupees(points.value) })}</p>
            {points.value !== null ? <p className="form-note">{t('cards.rewards.valueNote')}</p> : null}
            {points.expiring.map(item => (
                <p key={item.expiresOn} className="notice warn" data-warning="points">{t('cards.rewards.expiring', { points: item.points, date: shortDate(item.expiresOn) })}</p>
            ))}
            {points.lapsed > 0 ? <p className="form-note">{t('cards.rewards.lapsed', { points: points.lapsed })}</p> : null}
            <p className="when reward-cashback">{t('cards.rewards.cashbackYear', { amount: formatRupees(cashback.thisYear) })}</p>
            <div className="settings-actions"><button type="button" className="btn btn-secondary btn-sm" data-action="recordReward" onClick={onRecord}>{t('cards.rewards.record')}</button></div>
            <form className="card-terms reward-value" onSubmit={event => { event.preventDefault(); onSavePointValue(); }}>
                <div className="field"><label htmlFor={`point-value-${card.id}`}>{t('cards.rewards.pointValue')}</label>
                    <input id={`point-value-${card.id}`} className="point-value" type="number" inputMode="decimal" min="0" max="100" step="0.01" placeholder={t('cards.rewards.pointValueHint')}
                        value={pointValue} onChange={event => onPointValue(event.target.value)} /></div>
                <button type="submit" className="btn btn-secondary btn-sm" data-action="savePointValue">{t('cards.rewards.savePointValue')}</button>
            </form>
            {rewards.history.length > 0 ? (
                <details>
                    <summary>{t('cards.rewards.history')} ({rewards.history.length})</summary>
                    <ul className="loan-history">
                        {rewards.history.map(item => (
                            <li key={item.id}>
                                <span>{t(`cards.rewards.historyLine.${item.kind}`, { date: shortDate(item.date), points: item.points, amount: formatRupees(item.amount) })}
                                    {item.into ? t('cards.rewards.intoPart', { name: item.into }) : ''}</span>
                                <button type="button" className="chip-remove" aria-label={t('cards.rewards.remove')} onClick={() => onRemove(item.id)}><X aria-hidden="true" /></button>
                            </li>
                        ))}
                    </ul>
                </details>
            ) : null}
        </div>
    );
}

export function CardsScreen() {
    const toast = useToast();
    const [cards, setCards] = useState<Card[] | null>(null);
    const [terms, setTerms] = useState<Record<number, Terms>>({});
    const [recording, setRecording] = useState<Recording | null>(null);
    const [lines, setLines] = useState<Line[]>([]);
    const [newLine, setNewLine] = useState(EMPTY_LINE);
    const [rewards, setRewards] = useState<Rewards[]>([]);
    const [money, setMoney] = useState<MoneyAccount[]>([]);
    const [rewardForm, setRewardForm] = useState<RewardForm | null>(null);
    const [pointValues, setPointValues] = useState<Record<number, string>>({});

    const termsOf = (card: Card): Terms => ({
        billingDay: card.billingDay ? String(card.billingDay) : '', dueDay: card.dueDay ? String(card.dueDay) : '', interestRate: card.interestRate ?? '', rateUnit: 'year',
    });

    useEffect(() => {
        apiGet<Card[]>('/api/cards').then(result => {
            if (redirectIfUnauthorized(result) || !result.ok) return;
            setCards(result.data);
            setTerms(Object.fromEntries(result.data.map(card => [card.id, termsOf(card)])));
        });
        apiGet<Line[]>('/api/cards/lines').then(result => { if (result.ok) setLines(result.data); });
        apiGet<Rewards[]>('/api/cards/rewards').then(result => {
            if (!result.ok) return;
            setRewards(result.data);
            setPointValues(Object.fromEntries(result.data.map(item => [item.id, item.pointValue ?? ''])));
        });
        apiGet<MoneyAccount[]>('/api/accounts').then(result => { if (result.ok) setMoney(result.data.filter(account => account.type === 'bank' || account.type === 'credit_card')); });
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

    const replaceRewards = (item: Rewards) => {
        setRewards(current => current.map(old => (old.id === item.id ? item : old)));
        setPointValues(current => ({ ...current, [item.id]: item.pointValue ?? '' }));
    };

    async function saveReward() {
        if (!rewardForm) return;
        const { card, ...body } = rewardForm;
        const result = await apiPost<Rewards>(`/api/cards/${card.id}/rewards`, { ...body, intoAccountId: Number(body.intoAccountId) || undefined });
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        replaceRewards(result.data);
        toast('success', t('cards.rewards.recorded', { name: card.name }));
        setRewardForm(null);
        await reload();
    }

    async function savePointValue(card: Card) {
        const result = await apiPut<Rewards>(`/api/cards/${card.id}/rewards`, { pointValue: pointValues[card.id] ?? '' });
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        replaceRewards(result.data);
        toast('success', t('cards.termsSaved', { name: card.name }));
    }

    async function removeReward(card: Card, id: number) {
        const result = await apiDelete<Rewards>(`/api/cards/${card.id}/rewards/${id}`);
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        replaceRewards(result.data);
        await reload();
    }

    const setReward = (key: keyof Omit<RewardForm, 'card'>, value: string) => setRewardForm(current => (current ? { ...current, [key]: value } : current));

    async function reload() {
        const [cardList, lineList] = await Promise.all([apiGet<Card[]>('/api/cards'), apiGet<Line[]>('/api/cards/lines')]);
        if (cardList.ok) setCards(cardList.data);
        if (lineList.ok) setLines(lineList.data);
    }

    async function addLine() {
        const result = await apiPost<Line>('/api/cards/lines', newLine);
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        toast('success', t('cards.lines.added', { name: result.data.name }));
        setNewLine(EMPTY_LINE);
        await reload();
    }

    async function removeLine(line: Line) {
        const result = await apiDelete(`/api/cards/lines/${line.id}`);
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        toast('success', t('cards.lines.removed', { name: line.name }));
        await reload();
    }

    const toggleLineCard = (id: number) => setNewLine(current => ({
        ...current, cardIds: current.cardIds.includes(id) ? current.cardIds.filter(item => item !== id) : [...current.cardIds, id],
    }));

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
                            {amount(card.blocked) > 0 ? <p className="when card-blocked"><a href="/loans">{t('cards.blockedLine', { amount: formatRupees(card.blocked) })}</a></p> : null}
                            {card.line ? <p className="when card-line">{t('cards.lineLine', { line: card.line.name, available: formatRupees(card.line.available), limit: formatRupees(card.line.limit) })}</p> : null}
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
                        <RewardsBlock card={card} rewards={rewards.find(item => item.id === card.id)}
                            pointValue={pointValues[card.id] ?? ''} onPointValue={value => setPointValues(current => ({ ...current, [card.id]: value }))}
                            onSavePointValue={() => savePointValue(card)} onRemove={id => removeReward(card, id)}
                            onRecord={() => setRewardForm({ card, kind: 'earned', date: todayInIndiaClient(), points: '', amount: '', expiresOn: '', intoAccountId: String(card.id) })} />
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

            {cards.length > 1 ? (
                <section className="card" id="credit-lines" aria-labelledby="credit-lines-title">
                    <div className="card-head"><h3 id="credit-lines-title"><span className="icon-tile t-card" aria-hidden="true"><Layers /></span>{t('cards.lines.title')}</h3></div>
                    <p className="card-pad form-note card-link">{t('cards.lines.note')}</p>
                    {lines.length === 0 ? <p className="card-pad empty-note card-link">{t('cards.lines.none')}</p> : (
                        <ul className="loan-history card-pad credit-line-list">
                            {lines.map(line => (
                                <li key={line.id} data-line={line.name}>
                                    <span><b>{line.name}</b> · {t('cards.lines.facts', { owed: formatRupees(line.owed), limit: formatRupees(line.limit), available: formatRupees(line.available) })}
                                        {' · '}{t('cards.lines.cards', { names: line.cards.map(card => card.name).join(', ') })}</span>
                                    <button type="button" className="chip-remove" aria-label={t('cards.lines.remove')} onClick={() => removeLine(line)}><X aria-hidden="true" /></button>
                                </li>
                            ))}
                        </ul>
                    )}
                    <form className="card-pad card-terms" onSubmit={event => { event.preventDefault(); addLine(); }}>
                        <h4>{t('cards.lines.add')}</h4>
                        <div className="form-grid two">
                            <div className="field"><label htmlFor="line-name">{t('cards.lines.name')}</label>
                                <input id="line-name" type="text" maxLength={80} placeholder={t('cards.lines.namePlaceholder')} value={newLine.name} onChange={event => setNewLine(current => ({ ...current, name: event.target.value }))} /></div>
                            <div className="field"><label htmlFor="line-limit">{t('cards.lines.limit')}</label>
                                <input id="line-limit" type="number" inputMode="decimal" min="1" step="0.01" value={newLine.limit} onChange={event => setNewLine(current => ({ ...current, limit: event.target.value }))} /></div>
                        </div>
                        <fieldset className="field">
                            <legend className="label">{t('cards.lines.choose')}</legend>
                            <div className="chips">
                                {cards.filter(card => !card.line).map(card => (
                                    <button key={card.id} type="button" className="chip" aria-pressed={newLine.cardIds.includes(card.id)} data-line-card={card.name}
                                        onClick={() => toggleLineCard(card.id)}>{card.name}</button>
                                ))}
                            </div>
                        </fieldset>
                        <button type="submit" className="btn btn-primary btn-sm" data-action="addLine"><Plus aria-hidden="true" /> {t('cards.lines.save')}</button>
                    </form>
                </section>
            ) : null}

            {rewards.length > 1 ? (
                <section className="card" id="card-compare" aria-labelledby="card-compare-title">
                    <div className="card-head"><h3 id="card-compare-title"><span className="icon-tile t-income" aria-hidden="true"><Gift /></span>{t('cards.rewards.compareTitle')}</h3></div>
                    <p className="card-pad form-note card-link">{t('cards.rewards.compareNote')}</p>
                    <ol className="debt-rank">
                        {[...rewards].sort((a, b) => (b.compare.rate ?? -1) - (a.compare.rate ?? -1)).map(item => (
                            <li key={item.id} data-compare={item.name}>
                                <div className="debt-line"><span className="what">{item.name}</span>
                                    <b className="amount">{item.compare.rate === null ? '-' : `${item.compare.rate}%`}</b></div>
                                <span className="when">
                                    {item.compare.rate === null ? t('cards.rewards.compareNone')
                                        : t('cards.rewards.compareLine', { rate: item.compare.rate, rewards: formatRupees(item.compare.rewards), spent: formatRupees(item.compare.spent) })}
                                    {item.compare.pointsUnvalued ? ` (${t('cards.rewards.unvalued')})` : ''}
                                </span>
                            </li>
                        ))}
                    </ol>
                </section>
            ) : null}

            <Modal id="card-reward-modal" title={rewardForm ? t('cards.rewards.recordTitle', { name: rewardForm.card.name }) : ''}
                open={rewardForm !== null} closeAction="close-card-reward" onClose={() => setRewardForm(null)}
                footer={(
                    <>
                        <button type="button" className="btn btn-secondary" data-action="close-card-reward" onClick={() => setRewardForm(null)}>{t('common.cancel')}</button>
                        <button type="button" className="btn btn-primary" data-action="saveReward" onClick={saveReward}>{t('cards.rewards.save')}</button>
                    </>
                )}>
                {rewardForm ? (
                    <div className="form-grid two">
                        <div className="field"><label htmlFor="reward-kind">{t('cards.rewards.kind')}</label>
                            <select id="reward-kind" value={rewardForm.kind} onChange={event => setReward('kind', event.target.value)}>
                                {(['earned', 'redeemed', 'expired', 'cashback'] as const).map(kind => <option key={kind} value={kind}>{t(`cards.rewards.kinds.${kind}`)}</option>)}
                            </select></div>
                        <div className="field"><label htmlFor="reward-date">{t('cards.rewards.date')}</label>
                            <input id="reward-date" type="date" value={rewardForm.date} onChange={event => setReward('date', event.target.value)} /></div>
                        {rewardForm.kind !== 'cashback' ? (
                            <div className="field"><label htmlFor="reward-points">{t('cards.rewards.pointsLabel')}</label>
                                <input id="reward-points" type="number" inputMode="decimal" min="0" step="0.01" value={rewardForm.points} onChange={event => setReward('points', event.target.value)} /></div>
                        ) : null}
                        {rewardForm.kind === 'earned' ? (
                            <div className="field"><label htmlFor="reward-expires">{t('cards.rewards.expiresOn')}</label>
                                <input id="reward-expires" type="date" value={rewardForm.expiresOn} onChange={event => setReward('expiresOn', event.target.value)} /></div>
                        ) : null}
                        {rewardForm.kind === 'cashback' || rewardForm.kind === 'redeemed' ? (
                            <>
                                <div className="field"><label htmlFor="reward-amount">{rewardForm.kind === 'cashback' ? t('cards.rewards.amount') : t('cards.rewards.redeemedAmount')}</label>
                                    <input id="reward-amount" type="number" inputMode="decimal" min="0" step="0.01" value={rewardForm.amount} onChange={event => setReward('amount', event.target.value)} /></div>
                                <div className="field"><label htmlFor="reward-into">{t('cards.rewards.into')}</label>
                                    <select id="reward-into" value={rewardForm.intoAccountId} onChange={event => setReward('intoAccountId', event.target.value)}>
                                        {money.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
                                    </select></div>
                                <p className="form-note field full">{t('cards.rewards.incomeNote')}</p>
                            </>
                        ) : null}
                    </div>
                ) : null}
            </Modal>

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
