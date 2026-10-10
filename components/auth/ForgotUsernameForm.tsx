'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthButton, AuthForm, AuthHead, AuthShell, Field, type AuthMessage } from './AuthShell';
import { PREFILL_USERNAME_KEY } from './LoginForm';
import { useToast } from '@/components/Toast';
import { apiError, apiPost } from '@/lib/api-client';
import { isValidEmail, requireValue, securityQuestionText } from '@/lib/auth-validation';
import { t } from '@/lib/i18n';

/**
 * Two steps: the email, then the answer to the account's security question. The API shows a
 * question for any email, so this screen cannot be used to find out who has an account.
 */
export function ForgotUsernameForm() {
    const router = useRouter();
    const toast = useToast();
    const [email, setEmail] = useState('');
    const [question, setQuestion] = useState<string | null>(null);
    const [answer, setAnswer] = useState('');
    const [message, setMessage] = useState<AuthMessage | null>(null);

    async function showQuestion() {
        try {
            const value = requireValue(email, 'Email');
            if (!isValidEmail(value)) {
                throw new Error(t('auth.forgotUsername.badEmail'));
            }
            const result = await apiPost<{ success?: boolean; securityQuestion?: string }>('/api/forgot-username', { email: value });
            if (result.data.success && result.data.securityQuestion) {
                setEmail(value);
                setQuestion(securityQuestionText(result.data.securityQuestion));
            } else {
                toast('error', apiError(result.data, t('auth.forgotUsername.failed')));
            }
        } catch (error) {
            toast('error', error instanceof Error ? error.message : t('auth.forgotUsername.failed'));
        }
    }

    async function findUsername() {
        try {
            const securityAnswer = requireValue(answer, 'Security Answer');
            const result = await apiPost<{ success?: boolean; username?: string }>('/api/forgot-username', { email, securityAnswer });
            if (result.data.success && result.data.username) {
                const username = result.data.username;
                const text = t('auth.forgotUsername.found', { username });
                setMessage({ kind: 'success', text });
                toast('success', text);
                // Like the legacy app: return to login with the username filled in
                setTimeout(() => {
                    sessionStorage.setItem(PREFILL_USERNAME_KEY, username);
                    router.push('/login');
                }, 2000);
            } else {
                const text = apiError(result.data, t('auth.forgotUsername.failed'));
                setMessage({ kind: 'error', text });
                toast('error', text);
            }
        } catch (error) {
            toast('error', error instanceof Error ? error.message : t('auth.forgotUsername.failed'));
        }
    }

    const backToLogin = (
        <p className="auth-alt">
            {t('auth.remembered')}{' '}
            <AuthButton action="showLogin" className="btn-link" onClick={() => router.push('/login')}>{t('auth.backToLogin')}</AuthButton>
        </p>
    );

    return (
        <AuthShell message={message}>
            {question === null ? (
                <AuthForm id="forgot-username-form" onSubmit={showQuestion}>
                    <AuthHead step={t('auth.step1')} title={t('auth.forgotUsername.title')}>{t('auth.forgotUsername.lead1')}</AuthHead>
                    <Field
                        id="forgot-username-email-input"
                        label={t('auth.email')}
                        type="email"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={event => setEmail(event.target.value)}
                    />
                    <AuthButton action="forgotUsername" submit className="btn btn-primary btn-block">{t('auth.continue')}</AuthButton>
                    {backToLogin}
                </AuthForm>
            ) : (
                <AuthForm id="forgot-username-answer-form" onSubmit={findUsername}>
                    <AuthHead step={t('auth.step2')} title={t('auth.forgotUsername.title')}>{t('auth.forgotUsername.lead2')}</AuthHead>
                    <div className="question-box">
                        <small>{t('auth.securityQuestion')}</small>
                        <span id="forgot-username-question">{question}</span>
                    </div>
                    <Field
                        id="forgot-username-answer"
                        label={t('auth.yourAnswer')}
                        type="text"
                        autoComplete="off"
                        required
                        value={answer}
                        onChange={event => setAnswer(event.target.value)}
                    />
                    <AuthButton action="verifyUsernameRecovery" submit className="btn btn-primary btn-block">{t('auth.forgotUsername.submit')}</AuthButton>
                    {backToLogin}
                </AuthForm>
            )}
        </AuthShell>
    );
}
