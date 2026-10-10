'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthButton, AuthForm, AuthHead, AuthShell, Field, PasswordField } from './AuthShell';
import { TwoFactorSetup, TwoFactorVerify } from './TwoFactor';
import { useToast } from '@/components/Toast';
import { apiError, apiPost } from '@/lib/api-client';
import { isValidUsername, requireValue } from '@/lib/auth-validation';
import { t } from '@/lib/i18n';

/** Set by the forgot-username screen so the login form opens with the username filled in */
export const PREFILL_USERNAME_KEY = 'findb:prefill-username';

export function LoginForm() {
    const router = useRouter();
    const toast = useToast();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    // After the right password: the code from the app, or setting the app up the first time
    const [step, setStep] = useState<'password' | 'verify' | 'setup'>('password');

    useEffect(() => {
        const prefill = sessionStorage.getItem(PREFILL_USERNAME_KEY);
        if (prefill) {
            sessionStorage.removeItem(PREFILL_USERNAME_KEY);
            setUsername(prefill);
        }
    }, []);

    async function login() {
        try {
            const name = requireValue(username, 'Username');
            const secret = requireValue(password, 'Password');
            if (!isValidUsername(name)) {
                throw new Error(t('auth.login.badUsername'));
            }
            const result = await apiPost<{ success?: boolean; twoFactor?: 'verify' | 'setup' }>('/api/login', { username: name, password: secret });
            if (result.data.success) {
                setPassword('');
                setStep(result.data.twoFactor === 'setup' ? 'setup' : 'verify');
            } else {
                toast('error', apiError(result.data, t('auth.login.failed')));
            }
        } catch (error) {
            toast('error', error instanceof Error ? error.message : t('auth.login.failed'));
        }
    }

    // A full page load once signed in: the session just changed
    const done = () => window.location.assign('/setup');
    const expired = () => setStep('password');
    if (step === 'verify') return <AuthShell><TwoFactorVerify onDone={done} onExpired={expired} /></AuthShell>;
    if (step === 'setup') return <AuthShell><TwoFactorSetup onDone={done} onExpired={expired} /></AuthShell>;

    return (
        <AuthShell>
            <AuthForm id="login-form" onSubmit={login}>
                <AuthHead title={t('auth.login.title')}>{t('auth.login.lead')}</AuthHead>
                <div className="form-grid">
                    <Field
                        id="login-username"
                        label={t('auth.username')}
                        type="text"
                        autoComplete="username"
                        autoCapitalize="none"
                        required
                        value={username}
                        onChange={event => setUsername(event.target.value)}
                        help={t('auth.usernameHelp')}
                        aside={<AuthButton action="showForgotUsername" className="btn-link" onClick={() => router.push('/forgot-username')}>{t('auth.login.forgotUsername')}</AuthButton>}
                    />
                    <PasswordField
                        id="login-password"
                        label={t('auth.password')}
                        autoComplete="current-password"
                        required
                        value={password}
                        onChange={event => setPassword(event.target.value)}
                        aside={<AuthButton action="showForgotPassword" className="btn-link" onClick={() => router.push('/forgot-password')}>{t('auth.login.forgotPassword')}</AuthButton>}
                    />
                </div>
                <AuthButton action="login" submit className="btn btn-primary btn-block">{t('auth.login.submit')}</AuthButton>
                <p className="auth-alt">
                    {t('auth.login.newHere')}{' '}
                    <AuthButton action="showRegister" className="btn-link" onClick={() => router.push('/register')}>{t('auth.login.create')}</AuthButton>
                </p>
            </AuthForm>
        </AuthShell>
    );
}
