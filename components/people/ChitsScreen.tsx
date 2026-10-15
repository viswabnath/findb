'use client';

import { useEffect, useState } from 'react';
import { CircleDollarSign, Plus, X } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { apiDelete, apiGet, apiPost, httpError, redirectIfUnauthorized } from '@/lib/api-client';
import { todayInIndiaClient } from '@/lib/dates';
import { formatRupees } from '@/lib/format';
import { t } from '@/lib/i18n';

/**
 * Chit funds (/api/chits, v2 Phase 3): each chit's next payment (the contribution less the month's
 * dividend), the auctions, what is saved in it or still owed after winning, and its true yearly
 * return or cost compared with an RD or a personal loan. Informal chits carry a risk note.
 */

interface Account { id: number; type: string; name: string }
interface Chit {
    id: number; name: string; organiserKind: 'registered' | 'informal'; organiser: string | null; registration: string | null; value: string; members: number;
    months: number; contribution: string; balance: string; monthsPaid: number; next: { month: number; date: string; amount: string; dividendKnown: boolean } | null;
    missed: number; won: { month: number; discount: string; deductions: string; net: string } | null;
    outcome: { role: 'saver' | 'borrower'; yearlyRate: number; gain: string; assumedMonth: number };
    instalments: { id: number; month: number; paid: string; dividend: string }[]; auctions: { id: number; month: number; discount: string; dividend: string; wonByUser: boolean }[];
    finished: boolean;
}
type Recording = { chit: Chit; kind: 'pay' | 'auction'; month: string; accountId: string; date: string; dividend: string; discount: string; won: boolean; deductions: string };

const MONEY = ['bank', 'cash', 'credit_card', 'wallet', 'meal_card'];
const shortDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const EMPTY = { name: '', organiserKind: 'registered', organiser: '', registration: '', value: '', members: '', months: '', contribution: '', commissionPercent: '5', startedOn: '', auctionDay: '' };

export function ChitsScreen() {
    const toast = useToast();
    const [chits, setChits] = useState<Chit[] | null>(null);
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [form, setForm] = useState(EMPTY);
    const [recording, setRecording] = useState<Recording | null>(null);

    async function load() {
        const result = await apiGet<Chit[]>('/api/chits');
        if (redirectIfUnauthorized(result) || !result.ok) return;
        setChits(result.data);
    }

    useEffect(() => {
        load();
        apiGet<Account[]>('/api/accounts').then(result => { if (result.ok) setAccounts(result.data.filter(account => MONEY.includes(account.type))); });
        // Once on page load
    }, []);

    if (!chits) return null;
    const firstAccount = String(accounts[0]?.id ?? '');
    const set = (key: keyof typeof EMPTY, value: string) => setForm(current => ({ ...current, [key]: value }));
    const replace = (chit: Chit) => setChits(current => (current ?? []).map(item => (item.id === chit.id ? chit : item)));

    async function addChit() {
        const result = await apiPost<Chit>('/api/chits', { ...form, members: Number(form.members), months: Number(form.months || form.members) });
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        toast('success', t('chits.added', { name: result.data.name }));
        setForm(EMPTY);
        await load();
    }

    async function save() {
        if (!recording) return;
        const { chit, kind } = recording;
        const result = kind === 'pay'
            ? await apiPost<Chit>(`/api/chits/${chit.id}/instalments`, { month: Number(recording.month), accountId: Number(recording.accountId), date: recording.date, dividend: recording.dividend })
            : await apiPost<Chit>(`/api/chits/${chit.id}/auctions`, {
                month: Number(recording.month), heldOn: recording.date, discount: recording.discount, wonByUser: recording.won,
                deductions: recording.deductions, accountId: recording.won ? Number(recording.accountId) : undefined,
            });
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        replace(result.data);
        toast('success', kind === 'pay'
            ? t('chits.paidDone', { month: recording.month, amount: formatRupees(result.data.instalments.find(item => String(item.month) === recording.month)?.paid ?? '0') })
            : t('chits.auctionDone', { month: recording.month }));
        setRecording(null);
    }

    async function removeRecord(chit: Chit, kind: 'instalments' | 'auctions', id: number) {
        const result = await apiDelete<Chit>(`/api/chits/${chit.id}/${kind}/${id}`);
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        replace(result.data);
    }

    async function removeChit(chit: Chit) {
        const result = await apiDelete(`/api/chits/${chit.id}`);
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        await load();
    }

    const open = (chit: Chit, kind: 'pay' | 'auction') => {
        const nextAuction = Math.max(0, ...chit.auctions.map(item => item.month)) + 1;
        setRecording({
            chit, kind, month: String(kind === 'pay' ? chit.next?.month ?? 1 : Math.min(nextAuction, chit.months)), accountId: firstAccount,
            date: todayInIndiaClient(), dividend: '', discount: '', won: false, deductions: '',
        });
    };

    return (
        <div id="chits-section">
            <div className="page-header">
                <div>
                    <h2>{t('chits.title')}</h2>
                    <p>{t('chits.subtitle')}</p>
                </div>
            </div>
            {chits.length === 0 ? <p className="card card-pad empty-note" id="chits-empty">{t('chits.none')}</p> : null}

            {chits.map(chit => {
                const balance = parseFloat(chit.balance);
                return (
                    <section key={chit.id} className="card chit-card" data-chit={chit.name} aria-labelledby={`chit-${chit.id}`}>
                        <div className="card-head">
                            <h3 id={`chit-${chit.id}`}><span className="icon-tile t-wealth" aria-hidden="true"><CircleDollarSign /></span>{chit.name}</h3>
                            <span className="meta chit-balance">{balance < 0 ? t('chits.owed', { amount: formatRupees(String(-balance)) }) : t('chits.saved', { amount: formatRupees(chit.balance) })}</span>
                        </div>
                        <div className="card-pad loan-facts">
                            <p>{t('chits.facts', { value: formatRupees(chit.value), members: chit.members, months: chit.months, contribution: formatRupees(chit.contribution) })}</p>
                            {chit.organiserKind === 'informal'
                                ? <p className="notice warn chit-informal">{t('chits.informal')}</p>
                                : <p className="when">{[chit.organiser, t('chits.registeredLine', { registration: chit.registration ? ` ${chit.registration}` : '' })].filter(Boolean).join(' · ')}</p>}
                            <p className="when">{t('chits.progress', { paid: chit.monthsPaid, months: chit.months })}</p>
                            {chit.next ? (
                                <p className="chit-next">{t('chits.nextDue', { month: chit.next.month, amount: formatRupees(chit.next.amount), date: shortDate(chit.next.date) })}
                                    {!chit.next.dividendKnown ? ` ${t('chits.dividendPending')}` : ''}</p>
                            ) : null}
                            {chit.missed > 0 ? <p className="notice warn">{t('chits.missed', { count: chit.missed })}</p> : null}
                            {chit.won ? <p className="chit-won">{t('chits.wonLine', { month: chit.won.month, net: formatRupees(chit.won.net), discount: formatRupees(chit.won.discount), deductions: formatRupees(chit.won.deductions) })}</p> : null}
                            <p className="chit-outcome">
                                {chit.outcome.role === 'saver'
                                    ? t('chits.outcomeSaver', { rate: chit.outcome.yearlyRate, gain: formatRupees(chit.outcome.gain), assumed: chit.won ? '' : t('chits.assumedLast') })
                                    : t('chits.outcomeBorrower', { rate: chit.outcome.yearlyRate, gain: formatRupees(String(-parseFloat(chit.outcome.gain))) })}
                            </p>
                            <p className="form-note">{t('chits.compare')}</p>
                        </div>
                        {!chit.finished ? (
                            <div className="settings-actions">
                                {chit.next ? <button type="button" className="btn btn-primary btn-sm" data-action="payChit" onClick={() => open(chit, 'pay')}>{t('chits.pay')}</button> : null}
                                <button type="button" className="btn btn-secondary btn-sm" data-action="recordAuction" onClick={() => open(chit, 'auction')}>{t('chits.auction')}</button>
                            </div>
                        ) : null}
                        <details className="loan-more">
                            <summary className="card-pad">{t('chits.history')} ({chit.instalments.length + chit.auctions.length})</summary>
                            <ul className="loan-history">
                                {[...chit.auctions.map(item => ({ key: `a${item.id}`, month: item.month, kind: 'auctions' as const, id: item.id,
                                    text: t('chits.auctionLine', { month: item.month, discount: formatRupees(item.discount), dividend: formatRupees(item.dividend), won: item.wonByUser ? t('chits.wonPart') : '' }) })),
                                ...chit.instalments.map(item => ({ key: `i${item.id}`, month: item.month, kind: 'instalments' as const, id: item.id,
                                    text: t('chits.paymentLine', { month: item.month, amount: formatRupees(item.paid), dividend: parseFloat(item.dividend) > 0 ? t('chits.dividendPart', { amount: formatRupees(item.dividend) }) : '' }) }))]
                                    .sort((a, b) => a.month - b.month || a.kind.localeCompare(b.kind)).map(item => (
                                        <li key={item.key}>
                                            <span>{item.text}</span>
                                            <button type="button" className="chip-remove" aria-label={t('chits.removeRecord')} onClick={() => removeRecord(chit, item.kind, item.id)}><X aria-hidden="true" /></button>
                                        </li>
                                    ))}
                            </ul>
                            <div className="settings-actions"><button type="button" className="btn-link" onClick={() => removeChit(chit)}>{t('chits.remove')}</button></div>
                        </details>
                    </section>
                );
            })}

            <form className="card card-pad loan-form" onSubmit={event => { event.preventDefault(); addChit(); }}>
                <h3><span className="icon-tile t-wealth" aria-hidden="true"><Plus /></span>{t('chits.add')}</h3>
                <div className="form-grid two">
                    <div className="field"><label htmlFor="chit-name">{t('chits.name')}</label><input id="chit-name" type="text" maxLength={80} placeholder={t('chits.namePlaceholder')} value={form.name} onChange={event => set('name', event.target.value)} /></div>
                    <div className="field"><label htmlFor="chit-organiser-kind">{t('chits.organiserKind')}</label>
                        <select id="chit-organiser-kind" value={form.organiserKind} onChange={event => set('organiserKind', event.target.value)}>
                            <option value="registered">{t('chits.organiserKinds.registered')}</option><option value="informal">{t('chits.organiserKinds.informal')}</option>
                        </select></div>
                    <div className="field"><label htmlFor="chit-organiser">{t('chits.organiser')}</label><input id="chit-organiser" type="text" maxLength={100} value={form.organiser} onChange={event => set('organiser', event.target.value)} /></div>
                    {form.organiserKind === 'registered' ? (
                        <div className="field"><label htmlFor="chit-registration">{t('chits.registration')}</label><input id="chit-registration" type="text" maxLength={100} value={form.registration} onChange={event => set('registration', event.target.value)} /></div>
                    ) : null}
                    <div className="field"><label htmlFor="chit-value">{t('chits.value')}</label><input id="chit-value" type="number" inputMode="decimal" min="1" step="0.01" value={form.value} onChange={event => set('value', event.target.value)} /></div>
                    <div className="field"><label htmlFor="chit-members">{t('chits.members')}</label><input id="chit-members" type="number" inputMode="numeric" min="2" max="200" value={form.members} onChange={event => set('members', event.target.value)} /></div>
                    <div className="field"><label htmlFor="chit-months">{t('chits.months')}</label><input id="chit-months" type="number" inputMode="numeric" min="2" max="200" placeholder={form.members} value={form.months} onChange={event => set('months', event.target.value)} /></div>
                    <div className="field"><label htmlFor="chit-contribution">{t('chits.contribution')}</label><input id="chit-contribution" type="number" inputMode="decimal" min="0" step="0.01" value={form.contribution} onChange={event => set('contribution', event.target.value)} /></div>
                    <div className="field"><label htmlFor="chit-commission">{t('chits.commission')}</label><input id="chit-commission" type="number" inputMode="decimal" min="0" max="10" step="0.01" value={form.commissionPercent} onChange={event => set('commissionPercent', event.target.value)} /></div>
                    <div className="field"><label htmlFor="chit-start">{t('chits.startedOn')}</label><input id="chit-start" type="date" value={form.startedOn} onChange={event => set('startedOn', event.target.value)} /></div>
                    <div className="field"><label htmlFor="chit-auction-day">{t('chits.auctionDay')}</label><input id="chit-auction-day" type="number" inputMode="numeric" min="1" max="31" value={form.auctionDay} onChange={event => set('auctionDay', event.target.value)} /></div>
                </div>
                <button type="submit" className="btn btn-primary" data-action="addChit"><Plus aria-hidden="true" /> {t('chits.save')}</button>
            </form>

            <Modal id="chit-record-modal" title={recording ? `${recording.kind === 'pay' ? t('chits.pay') : t('chits.auction')}: ${recording.chit.name}` : ''}
                open={recording !== null} closeAction="close-chit-record" onClose={() => setRecording(null)}
                footer={(
                    <>
                        <button type="button" className="btn btn-secondary" data-action="close-chit-record" onClick={() => setRecording(null)}>{t('common.cancel')}</button>
                        <button type="button" className="btn btn-primary" data-action="saveChitRecord" onClick={save}>{t('chits.record')}</button>
                    </>
                )}>
                {recording ? (
                    <div className="form-grid two">
                        <div className="field"><label htmlFor="record-month">{t('chits.month')}</label>
                            <input id="record-month" type="number" inputMode="numeric" min="1" max={recording.chit.months} value={recording.month} onChange={event => setRecording({ ...recording, month: event.target.value })} /></div>
                        <div className="field"><label htmlFor="record-date">{recording.kind === 'pay' ? t('chits.date') : t('chits.heldOn')}</label>
                            <input id="record-date" type="date" value={recording.date} onChange={event => setRecording({ ...recording, date: event.target.value })} /></div>
                        {recording.kind === 'pay' ? (
                            <>
                                <div className="field"><label htmlFor="record-account">{t('chits.account')}</label>
                                    <select id="record-account" value={recording.accountId} onChange={event => setRecording({ ...recording, accountId: event.target.value })}>{accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></div>
                                <div className="field"><label htmlFor="record-dividend">{t('chits.dividend')}</label>
                                    <input id="record-dividend" type="number" inputMode="decimal" min="0" step="0.01"
                                        placeholder={recording.chit.auctions.find(item => String(item.month) === recording.month)?.dividend ?? '0'}
                                        value={recording.dividend} onChange={event => setRecording({ ...recording, dividend: event.target.value })} /></div>
                            </>
                        ) : (
                            <>
                                <div className="field full"><label htmlFor="record-discount">{t('chits.discount')}</label>
                                    <input id="record-discount" type="number" inputMode="decimal" min="0" step="0.01" value={recording.discount} onChange={event => setRecording({ ...recording, discount: event.target.value })} /></div>
                                {!recording.chit.won ? (
                                    <label className="check-line field full">
                                        <input type="checkbox" id="record-won" checked={recording.won} onChange={event => setRecording({ ...recording, won: event.target.checked })} />
                                        {t('chits.wonByUser')}
                                    </label>
                                ) : null}
                                {recording.won ? (
                                    <>
                                        <div className="field"><label htmlFor="record-deductions">{t('chits.deductions')}</label>
                                            <input id="record-deductions" type="number" inputMode="decimal" min="0" step="0.01" value={recording.deductions} onChange={event => setRecording({ ...recording, deductions: event.target.value })} /></div>
                                        <div className="field"><label htmlFor="record-into">{t('chits.intoAccount')}</label>
                                            <select id="record-into" value={recording.accountId} onChange={event => setRecording({ ...recording, accountId: event.target.value })}>{accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></div>
                                    </>
                                ) : null}
                            </>
                        )}
                    </div>
                ) : null}
            </Modal>
        </div>
    );
}
