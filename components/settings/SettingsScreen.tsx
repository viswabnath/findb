'use client';

import { useEffect, useState } from 'react';
import { History, KeyRound, LogOut, MonitorSmartphone } from 'lucide-react';
import { RecoveryCodes } from '@/components/auth/TwoFactor';
import { useToast } from '@/components/Toast';
import { apiDelete, apiError, apiGet, apiPost, redirectIfUnauthorized } from '@/lib/api-client';

/**
 * Account security (docs/security.md): two-factor login and recovery codes, the devices signed
 * in, and the login history. Rendered once its data has loaded, so every button is live.
 */

interface Status { enabledAt: string | null; recoveryCodesLeft: number }
interface Session { id: string; device: string; createdAt: string | null; lastSeenAt: string | null; current: boolean }
interface LoginEvent { event: string; device: string; at: string }

const EVENT_TEXT: Record<string, string> = {
    signed_in: 'Logged in',
    wrong_password: 'Wrong password entered',
    wrong_code: 'Wrong two-factor code entered',
    recovery_code_used: 'Recovery code used',
    two_factor_enabled: 'Two-factor login turned on',
    recovery_codes_created: 'New recovery codes made',
    signed_out_session: 'A device was signed out',
    signed_out_everywhere: 'Signed out everywhere',
    password_changed: 'Password changed',
};

const WARNING_EVENTS = new Set(['wrong_password', 'wrong_code']);

function when(value: string | null): string {
    if (!value) return 'Unknown';
    return new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function SettingsScreen() {
    const toast = useToast();
    const [status, setStatus] = useState<Status | null>(null);
    const [sessions, setSessions] = useState<Session[]>([]);
    const [history, setHistory] = useState<LoginEvent[]>([]);
    const [code, setCode] = useState('');
    const [newCodes, setNewCodes] = useState<string[] | null>(null);

    async function load() {
        const [statusResult, sessionsResult, historyResult] = await Promise.all([
            apiGet<Status>('/api/two-factor'), apiGet<Session[]>('/api/sessions'), apiGet<LoginEvent[]>('/api/login-history'),
        ]);
        if ([statusResult, sessionsResult, historyResult].some(result => redirectIfUnauthorized(result))) return;
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
        else toast('error', apiError(result.data, 'New recovery codes could not be made'));
    }

    async function signOut(session: Session) {
        const result = await apiDelete(`/api/sessions/${encodeURIComponent(session.id)}`);
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) {
            toast('error', apiError(result.data, 'That device could not be signed out'));
            return;
        }
        if (session.current) {
            window.location.assign('/login');
            return;
        }
        toast('success', `${session.device} is signed out`);
        load();
    }

    async function signOutEverywhere() {
        const result = await apiDelete('/api/sessions');
        if (!result.ok && !redirectIfUnauthorized(result)) {
            toast('error', apiError(result.data, 'Could not sign out everywhere'));
            return;
        }
        window.location.assign('/login');
    }

    return (
        <div id="settings-section">
            <div className="page-header">
                <div>
                    <h2>Settings</h2>
                    <p>Keep your account safe: two-factor login, the devices signed in, and recent logins.</p>
                </div>
            </div>

            <div className="stack">
                <section className="card" aria-labelledby="two-factor-title">
                    <div className="card-head">
                        <h3 id="two-factor-title"><span className="icon-tile t-bank" aria-hidden="true"><KeyRound /></span>Two-factor login</h3>
                        <span className="meta" id="two-factor-status">{status.enabledAt ? `On since ${when(status.enabledAt)}` : 'Not set up'}</span>
                    </div>
                    {newCodes ? (
                        <div className="card-pad">
                            <RecoveryCodes codes={newCodes} doneLabel="Done" onDone={() => { setNewCodes(null); load(); }} />
                        </div>
                    ) : (
                        <>
                            <p className="card-pad" id="recovery-codes-left">
                                {status.recoveryCodesLeft} of 10 recovery codes left. New codes replace all the old ones; enter a code
                            from your app to make them.
                            </p>
                            <form className="settings-form" onSubmit={event => { event.preventDefault(); regenerate(); }}>
                                <div className="field">
                                    <label htmlFor="regenerate-code">6-digit code from your app</label>
                                    <input id="regenerate-code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={7}
                                        value={code} onChange={event => setCode(event.target.value)} />
                                </div>
                                <button type="submit" className="btn btn-secondary" data-action="regenerateRecoveryCodes">Make new recovery codes</button>
                            </form>
                        </>
                    )}
                </section>

                <section className="card" aria-labelledby="sessions-title">
                    <div className="card-head">
                        <h3 id="sessions-title"><span className="icon-tile t-bank" aria-hidden="true"><MonitorSmartphone /></span>Signed-in devices</h3>
                        <span className="meta">{sessions.length} {sessions.length === 1 ? 'device' : 'devices'}</span>
                    </div>
                    <ul id="sessions-list" className="settings-list">
                        {sessions.map(session => (
                            <li key={session.id} data-session={session.id}>
                                <div>
                                    <span className="what">{session.device}</span>
                                    {session.current ? <span className="this-device">This device</span> : null}
                                    <div className="when">Signed in {when(session.createdAt)}; last used {when(session.lastSeenAt)}</div>
                                </div>
                                <button type="button" className="btn btn-secondary btn-sm" data-action="signOutSession" onClick={() => signOut(session)}>
                                Sign out
                                </button>
                            </li>
                        ))}
                    </ul>
                    <div className="settings-actions">
                        <button type="button" className="btn btn-danger" data-action="signOutEverywhere" onClick={signOutEverywhere}>
                            <LogOut aria-hidden="true" /> Sign out everywhere
                        </button>
                    </div>
                </section>

                <section className="card" aria-labelledby="history-title">
                    <div className="card-head">
                        <h3 id="history-title"><span className="icon-tile t-bank" aria-hidden="true"><History /></span>Recent logins</h3>
                        <span className="meta">Last {history.length}</span>
                    </div>
                    <ul id="login-history" className="settings-list">
                        {history.map((item, index) => (
                            <li key={`${item.at}-${index}`} className={WARNING_EVENTS.has(item.event) ? 'warning' : undefined}>
                                <div>
                                    <span className="what">{EVENT_TEXT[item.event] ?? item.event}</span>
                                    <div className="when">{item.device}</div>
                                </div>
                                <span className="when">{when(item.at)}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            </div>
        </div>
    );
}
