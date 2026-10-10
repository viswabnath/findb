'use client';

import { useEffect, useState } from 'react';
import { Database, History, KeyRound, LogOut, MonitorSmartphone } from 'lucide-react';
import { RecoveryCodes } from '@/components/auth/TwoFactor';
import { useToast } from '@/components/Toast';
import { apiDelete, apiError, apiGet, apiPost, redirectIfUnauthorized } from '@/lib/api-client';
import { PRIVACY_CONTACT } from '@/lib/privacy-notice';
import { t } from '@/lib/i18n';
import { CategoriesCard } from './CategoriesCard';
import { ModulesCard } from './ModulesCard';
import { ThemeCard } from './ThemeCard';
import { ProfileCard } from './ProfileCard';

/**
 * Account security (docs/security.md): two-factor login and recovery codes, the devices signed
 * in, and the login history. Rendered once its data has loaded, so every button is live.
 */

interface Status { enabledAt: string | null; recoveryCodesLeft: number }
interface Session { id: string; device: string; createdAt: string | null; lastSeenAt: string | null; current: boolean }
interface LoginEvent { event: string; device: string; at: string }
interface MyData {
    consent: { noticeVersion: string; givenAt: string | null; withdrawnAt: string | null };
    tables: { table: string; holds: string; purpose: string; retention: string; rows: number }[];
}

const EVENTS = ['signed_in', 'wrong_password', 'wrong_code', 'recovery_code_used', 'two_factor_enabled', 'recovery_codes_created',
    'signed_out_session', 'signed_out_everywhere', 'password_changed'] as const;
const eventText = (event: string) => (EVENTS as readonly string[]).includes(event) ? t(`settings.history.events.${event as typeof EVENTS[number]}`) : event;

const WARNING_EVENTS = new Set(['wrong_password', 'wrong_code']);

function when(value: string | null): string {
    if (!value) return t('settings.unknown');
    return new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function SettingsScreen() {
    const toast = useToast();
    const [status, setStatus] = useState<Status | null>(null);
    const [sessions, setSessions] = useState<Session[]>([]);
    const [history, setHistory] = useState<LoginEvent[]>([]);
    const [code, setCode] = useState('');
    const [newCodes, setNewCodes] = useState<string[] | null>(null);
    const [myData, setMyData] = useState<MyData | null>(null);
    const [confirmWithdraw, setConfirmWithdraw] = useState(false);

    async function load() {
        const [statusResult, sessionsResult, historyResult, dataResult] = await Promise.all([
            apiGet<Status>('/api/two-factor'), apiGet<Session[]>('/api/sessions'), apiGet<LoginEvent[]>('/api/login-history'),
            apiGet<MyData>('/api/privacy'),
        ]);
        if ([statusResult, sessionsResult, historyResult, dataResult].some(result => redirectIfUnauthorized(result))) return;
        if (dataResult.ok) setMyData(dataResult.data);
        setStatus(statusResult.data);
        setSessions(Array.isArray(sessionsResult.data) ? sessionsResult.data : []);
        setHistory(Array.isArray(historyResult.data) ? historyResult.data : []);
    }

    useEffect(() => {
        load();
        // Once on page load; the buttons reload afterwards
    }, []);

    if (status === null) return null;

    async function regenerate() {
        const result = await apiPost<{ recoveryCodes?: string[] }>('/api/two-factor/recovery-codes', { code: code.replace(/\s/g, '') });
        if (redirectIfUnauthorized(result)) return;
        setCode('');
        if (result.ok && result.data.recoveryCodes) setNewCodes(result.data.recoveryCodes);
        else toast('error', apiError(result.data, t('settings.twoFactor.failed')));
    }

    async function signOut(session: Session) {
        const result = await apiDelete(`/api/sessions/${encodeURIComponent(session.id)}`);
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) {
            toast('error', apiError(result.data, t('settings.sessions.failed')));
            return;
        }
        if (session.current) {
            window.location.assign('/login');
            return;
        }
        toast('success', t('settings.sessions.signedOut', { device: session.device }));
        load();
    }

    async function withdrawConsent() {
        const result = await apiPost('/api/privacy/withdraw', {});
        if (!result.ok && !redirectIfUnauthorized(result)) {
            toast('error', apiError(result.data, t('settings.data.withdrawFailed')));
            return;
        }
        window.location.assign('/login');
    }

    async function signOutEverywhere() {
        const result = await apiDelete('/api/sessions');
        if (!result.ok && !redirectIfUnauthorized(result)) {
            toast('error', apiError(result.data, t('settings.sessions.everywhereFailed')));
            return;
        }
        window.location.assign('/login');
    }

    return (
        <div id="settings-section">
            <div className="page-header">
                <div>
                    <h2>{t('settings.title')}</h2>
                    <p>{t('settings.subtitle')}</p>
                </div>
            </div>

            <div className="stack">
                <ModulesCard />

                <ThemeCard />

                <ProfileCard />

                <CategoriesCard />

                <section className="card" aria-labelledby="two-factor-title">
                    <div className="card-head">
                        <h3 id="two-factor-title"><span className="icon-tile t-bank" aria-hidden="true"><KeyRound /></span>{t('settings.twoFactor.title')}</h3>
                        <span className="meta" id="two-factor-status">{status.enabledAt ? t('settings.twoFactor.onSince', { date: when(status.enabledAt) }) : t('settings.twoFactor.notSetUp')}</span>
                    </div>
                    {newCodes ? (
                        <div className="card-pad">
                            <RecoveryCodes codes={newCodes} doneLabel={t('settings.twoFactor.done')} onDone={() => { setNewCodes(null); load(); }} />
                        </div>
                    ) : (
                        <>
                            <p className="card-pad" id="recovery-codes-left">
                                {t('settings.twoFactor.codesLeft', { count: status.recoveryCodesLeft })}
                            </p>
                            <form className="settings-form" onSubmit={event => { event.preventDefault(); regenerate(); }}>
                                <div className="field">
                                    <label htmlFor="regenerate-code">{t('settings.twoFactor.codeLabel')}</label>
                                    <input id="regenerate-code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={7}
                                        value={code} onChange={event => setCode(event.target.value)} />
                                </div>
                                <button type="submit" className="btn btn-secondary" data-action="regenerateRecoveryCodes">{t('settings.twoFactor.makeNew')}</button>
                            </form>
                        </>
                    )}
                </section>

                <section className="card" aria-labelledby="sessions-title">
                    <div className="card-head">
                        <h3 id="sessions-title"><span className="icon-tile t-bank" aria-hidden="true"><MonitorSmartphone /></span>{t('settings.sessions.title')}</h3>
                        <span className="meta">{t('settings.sessions.count', { count: sessions.length })}</span>
                    </div>
                    <ul id="sessions-list" className="settings-list">
                        {sessions.map(session => (
                            <li key={session.id} data-session={session.id}>
                                <div>
                                    <span className="what">{session.device}</span>
                                    {session.current ? <span className="this-device">{t('settings.sessions.thisDevice')}</span> : null}
                                    <div className="when">{t('settings.sessions.when', { signedIn: when(session.createdAt), lastUsed: when(session.lastSeenAt) })}</div>
                                </div>
                                <button type="button" className="btn btn-secondary btn-sm" data-action="signOutSession" onClick={() => signOut(session)}>
                                    {t('settings.sessions.signOut')}
                                </button>
                            </li>
                        ))}
                    </ul>
                    <div className="settings-actions">
                        <button type="button" className="btn btn-danger" data-action="signOutEverywhere" onClick={signOutEverywhere}>
                            <LogOut aria-hidden="true" /> {t('settings.sessions.everywhere')}
                        </button>
                    </div>
                </section>

                <section className="card" aria-labelledby="history-title">
                    <div className="card-head">
                        <h3 id="history-title"><span className="icon-tile t-bank" aria-hidden="true"><History /></span>{t('settings.history.title')}</h3>
                        <span className="meta">{t('settings.history.last', { count: history.length })}</span>
                    </div>
                    <ul id="login-history" className="settings-list">
                        {history.map((item, index) => (
                            <li key={`${item.at}-${index}`} className={WARNING_EVENTS.has(item.event) ? 'warning' : undefined}>
                                <div>
                                    <span className="what">{eventText(item.event)}</span>
                                    <div className="when">{item.device}</div>
                                </div>
                                <span className="when">{when(item.at)}</span>
                            </li>
                        ))}
                    </ul>
                </section>

                {myData ? (
                    <section className="card" aria-labelledby="my-data-title">
                        <div className="card-head">
                            <h3 id="my-data-title"><span className="icon-tile t-bank" aria-hidden="true"><Database /></span>{t('settings.data.title')}</h3>
                            <span className="meta" id="consent-status">
                                {myData.consent.givenAt && !myData.consent.withdrawnAt ? t('settings.data.consentGiven', { date: when(myData.consent.givenAt) }) : t('settings.data.noConsent')}
                            </span>
                        </div>
                        <p className="card-pad">
                            {t('settings.data.intro')} <a href="/privacy">{t('settings.data.noticeLink')}</a>{t('settings.data.introRest', { email: PRIVACY_CONTACT })}
                        </p>
                        <ul id="my-data-list" className="settings-list">
                            {myData.tables.map(item => (
                                <li key={item.table} data-table={item.table}>
                                    <div>
                                        <span className="what">{item.holds}</span>
                                        <div className="when">{t('settings.data.kept', { purpose: item.purpose, retention: item.retention.toLowerCase() })}</div>
                                    </div>
                                    <span className="when">{t('settings.data.records', { count: item.rows })}</span>
                                </li>
                            ))}
                        </ul>
                        <div className="settings-actions">
                            {confirmWithdraw ? (
                                <div className="stack">
                                    <p id="withdraw-consent-warning">
                                        {t('settings.data.withdrawWarning', { email: PRIVACY_CONTACT })}
                                    </p>
                                    <div className="settings-actions consent-actions">
                                        <button type="button" className="btn btn-danger" data-action="confirmWithdrawConsent" onClick={withdrawConsent}>{t('settings.data.withdraw')}</button>
                                        <button type="button" className="btn btn-secondary" data-action="cancelWithdrawConsent" onClick={() => setConfirmWithdraw(false)}>{t('settings.data.keep')}</button>
                                    </div>
                                </div>
                            ) : (
                                <button type="button" className="btn btn-secondary" data-action="withdrawConsent" onClick={() => setConfirmWithdraw(true)}>
                                    {t('settings.data.withdraw')}
                                </button>
                            )}
                        </div>
                    </section>
                ) : null}
            </div>
        </div>
    );
}
