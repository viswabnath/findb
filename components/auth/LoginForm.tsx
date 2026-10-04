'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthButton, AuthForm, AuthHead, AuthShell, Field, PasswordField } from './AuthShell';
import { TwoFactorSetup, TwoFactorVerify } from './TwoFactor';
import { useToast } from '@/components/Toast';
import { apiError, apiPost } from '@/lib/api-client';
import { isValidUsername, requireValue } from '@/lib/auth-validation';

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
                throw new Error('Invalid username format. Username can only contain letters, numbers, and underscores');
            }
            const result = await apiPost<{ success?: boolean; twoFactor?: 'verify' | 'setup' }>('/api/login', { username: name, password: secret });
            if (result.data.success) {
                setPassword('');
                setStep(result.data.twoFactor === 'setup' ? 'setup' : 'verify');
            } else {
                toast('error', apiError(result.data, 'Login failed'));
            }
        } catch (error) {
            toast('error', error instanceof Error ? error.message : 'Login failed');
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
                <AuthHead title="Welcome back">Log in to see your accounts.</AuthHead>
                <div className="form-grid">
                    <Field
                        id="login-username"
                        label="Username"
                        type="text"
                        autoComplete="username"
                        autoCapitalize="none"
                        required
                        value={username}
                        onChange={event => setUsername(event.target.value)}
                        help="Letters, numbers and underscores"
                        aside={<AuthButton action="showForgotUsername" className="btn-link" onClick={() => router.push('/forgot-username')}>Forgot username?</AuthButton>}
                    />
                    <PasswordField
                        id="login-password"
                        label="Password"
                        autoComplete="current-password"
                        required
                        value={password}
                        onChange={event => setPassword(event.target.value)}
                        aside={<AuthButton action="showForgotPassword" className="btn-link" onClick={() => router.push('/forgot-password')}>Forgot password?</AuthButton>}
                    />
                </div>
                <AuthButton action="login" submit className="btn btn-primary btn-block">Log in</AuthButton>
                <p className="auth-alt">
                    New to FinDB?{' '}
                    <AuthButton action="showRegister" className="btn-link" onClick={() => router.push('/register')}>Create a free account</AuthButton>
                </p>
            </AuthForm>
        </AuthShell>
    );
}
