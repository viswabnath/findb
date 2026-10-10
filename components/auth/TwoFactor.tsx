'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { AuthButton, AuthForm, AuthHead, Field } from './AuthShell';
import { QrCode } from '@/components/site/QrCode';
import { useToast } from '@/components/Toast';
import { apiError, apiGet, apiPost } from '@/lib/api-client';
import { t } from '@/lib/i18n';

/**
 * The two-factor steps of a login (docs/security.md): entering a code from the authenticator app,
 * and setting the app up the first time. A 401 means the pending login expired (ten minutes), so
 * the user starts again from the password.
 */

const EXPIRED_STATUS = 401;

/** Step two of a login: the code from the app, or a recovery code */
export function TwoFactorVerify({ onDone, onExpired }: { onDone: () => void; onExpired: () => void }) {
    const toast = useToast();
    const [useRecovery, setUseRecovery] = useState(false);
    const [code, setCode] = useState('');

    async function verify() {
        const body = useRecovery ? { recoveryCode: code.trim() } : { code: code.replace(/\s/g, '') };
        const result = await apiPost<{ success?: boolean }>('/api/login/two-factor', body);
        if (result.data.success) {
            onDone();
            return;
        }
        toast('error', apiError(result.data, t('auth.twoFactor.failed')));
        if (result.status === EXPIRED_STATUS) onExpired();
        setCode('');
    }

    return (
        <AuthForm id="two-factor-form" onSubmit={verify}>
            <AuthHead step={t('auth.step2')} title={t('auth.twoFactor.title')}>
                {useRecovery
                    ? t('auth.twoFactor.leadRecovery')
                    : t('auth.twoFactor.leadApp')}
            </AuthHead>
            <div className="form-grid">
                {useRecovery ? (
                    <Field id="recovery-code" label={t('auth.twoFactor.recoveryCode')} type="text" autoComplete="off" autoCapitalize="none" required
                        placeholder="xxxxx-xxxxx" value={code} onChange={event => setCode(event.target.value)} />
                ) : (
                    <Field id="two-factor-code" label={t('auth.twoFactor.code')} type="text" inputMode="numeric" autoComplete="one-time-code"
                        pattern="[0-9 ]*" maxLength={7} required value={code} onChange={event => setCode(event.target.value)} />
                )}
            </div>
            <AuthButton action="verifyTwoFactor" submit className="btn btn-primary btn-block">{t('auth.twoFactor.submit')}</AuthButton>
            <p className="auth-alt">
                <AuthButton action="useRecoveryCode" className="btn-link" onClick={() => { setUseRecovery(value => !value); setCode(''); }}>
                    {useRecovery ? t('auth.twoFactor.useApp') : t('auth.twoFactor.useRecovery')}
                </AuthButton>
            </p>
        </AuthForm>
    );
}

/** The secret in groups of four, easier to type into an app by hand */
const grouped = (secret: string) => secret.match(/.{1,4}/g)?.join(' ') ?? secret;

/** First-time setup: scan the code, confirm with one code, then save the recovery codes */
export function TwoFactorSetup({ onDone, onExpired }: { onDone: () => void; onExpired: () => void }) {
    const toast = useToast();
    const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
    const [code, setCode] = useState('');
    const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

    useEffect(() => {
        apiGet<{ secret?: string; otpauthUri?: string }>('/api/two-factor/setup').then(result => {
            if (result.ok && result.data.secret && result.data.otpauthUri) {
                setSetup({ secret: result.data.secret, otpauthUri: result.data.otpauthUri });
                return;
            }
            toast('error', apiError(result.data, t('auth.twoFactor.setupFailed')));
            if (result.status === EXPIRED_STATUS) onExpired();
        });
        // Once, when the step opens
    }, []);

    async function confirm() {
        const result = await apiPost<{ success?: boolean; recoveryCodes?: string[] }>('/api/two-factor/setup', { code: code.replace(/\s/g, '') });
        if (result.data.success && result.data.recoveryCodes) {
            setRecoveryCodes(result.data.recoveryCodes);
            return;
        }
        toast('error', apiError(result.data, t('auth.twoFactor.codeFailed')));
        if (result.status === EXPIRED_STATUS) onExpired();
        setCode('');
    }

    if (recoveryCodes) return <RecoveryCodes codes={recoveryCodes} onDone={onDone} />;
    if (!setup) return null;

    return (
        <AuthForm id="two-factor-setup-form" onSubmit={confirm}>
            <AuthHead step={t('auth.twoFactor.setupStep')} title={t('auth.twoFactor.setupTitle')}>{t('auth.twoFactor.setupLead')}</AuthHead>
            <ol className="setup-steps">
                <li>{t('auth.twoFactor.install')}</li>
                <li>{t('auth.twoFactor.scan')}
                    <div className="qr-box"><QrCode text={setup.otpauthUri} label={t('auth.twoFactor.qrLabel')} /></div>
                    <span className="setup-key-label">{t('auth.twoFactor.cannotScan')}</span>
                    <code id="two-factor-secret" className="setup-key" data-secret={setup.secret}>{grouped(setup.secret)}</code>
                </li>
                <li>{t('auth.twoFactor.enter')}</li>
            </ol>
            <div className="form-grid">
                <Field id="two-factor-setup-code" label={t('auth.twoFactor.code')} type="text" inputMode="numeric" autoComplete="one-time-code"
                    pattern="[0-9 ]*" maxLength={7} required value={code} onChange={event => setCode(event.target.value)} />
            </div>
            <AuthButton action="confirmTwoFactor" submit className="btn btn-primary btn-block">{t('auth.twoFactor.turnOn')}</AuthButton>
        </AuthForm>
    );
}

/** Download the codes as a text file, made in the browser (nothing is sent anywhere) */
export function downloadRecoveryCodes(codes: string[]) {
    const text = [t('auth.twoFactor.fileTitle'), t('auth.twoFactor.fileNote'), '', ...codes, ''].join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    link.download = 'findb-recovery-codes.txt';
    link.click();
    URL.revokeObjectURL(link.href);
}

/** The recovery codes, shown once, with a confirmation that they were saved */
export function RecoveryCodes({ codes, onDone, doneLabel = t('auth.twoFactor.continue') }: { codes: string[]; onDone: () => void; doneLabel?: string }) {
    const [saved, setSaved] = useState(false);
    return (
        <div id="recovery-codes-step" className="auth-card">
            <AuthHead step={t('auth.twoFactor.savedStep')} title={t('auth.twoFactor.savedTitle')}>{t('auth.twoFactor.savedLead')}</AuthHead>
            <ul id="recovery-codes" className="recovery-codes">
                {codes.map(code => <li key={code}><code>{code}</code></li>)}
            </ul>
            <button type="button" className="btn btn-secondary btn-block" data-action="downloadRecoveryCodes" onClick={() => downloadRecoveryCodes(codes)}>
                <Download aria-hidden="true" /> {t('auth.twoFactor.download')}
            </button>
            <label className="check-line">
                <input id="recovery-codes-saved" type="checkbox" checked={saved} onChange={event => setSaved(event.target.checked)} />
                {t('auth.twoFactor.saved')}
            </label>
            <button type="button" className="btn btn-primary btn-block" data-action="finishTwoFactor" disabled={!saved} onClick={onDone}>{doneLabel}</button>
        </div>
    );
}
