'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthButton, AuthForm, AuthHead, AuthShell, Field, PasswordField, PasswordRules, type AuthMessage } from './AuthShell';
import { useToast } from '@/components/Toast';
import { apiError, apiPost } from '@/lib/api-client';
import { isValidEmail, isValidUsername, passwordProblem, requireValue, securityQuestionText } from '@/lib/auth-validation';
import { t } from '@/lib/i18n';

interface ResetTarget {
    /** { username } or { email }, sent again with the answer */
    account: { username: string } | { email: string };
    question: string;
}

/**
 * Two steps, as in the legacy app: the username or email, then the security question. The API
 * shows a question for any username or email, so this screen does not reveal who has an account.
 */
export function ForgotPasswordForm() {
    const router = useRouter();
    const toast = useToast();
    const [identifier, setIdentifier] = useState('');
    const [target, setTarget] = useState<ResetTarget | null>(null);
    const [answer, setAnswer] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [message, setMessage] = useState<AuthMessage | null>(null);

    async function requestReset() {
        try {
            const input = requireValue(identifier, 'Username or Email');
            const isEmail = isValidEmail(input);
            if (!isEmail && !isValidUsername(input)) {
                throw new Error(t('auth.forgotPassword.badIdentifier'));
            }
            const account = isEmail ? { email: input } : { username: input };
            const result = await apiPost<{ success?: boolean; securityQuestion?: string }>('/api/forgot-password', account);
            if (result.data.success && result.data.securityQuestion) {
                setTarget({ account, question: securityQuestionText(result.data.securityQuestion) });
                setMessage(null);
            } else {
                toast('error', apiError(result.data, t('auth.forgotPassword.failed')));
            }
        } catch (error) {
            toast('error', error instanceof Error ? error.message : t('auth.forgotPassword.failed'));
        }
    }

    async function resetPassword() {
        if (!target) return;
        try {
            const securityAnswer = requireValue(answer, 'Security Answer');
            const password = requireValue(newPassword, 'New Password');
            const confirm = requireValue(confirmPassword, 'Confirm Password');
            const problem = passwordProblem(password);
            if (problem) {
                throw new Error(problem);
            }
            if (password !== confirm) {
                throw new Error(t('auth.forgotPassword.mismatch'));
            }
            const result = await apiPost<{ success?: boolean }>('/api/reset-password', {
                ...target.account,
                securityAnswer,
                newPassword: password,
            });
            if (result.data.success) {
                const text = t('auth.forgotPassword.done');
                setMessage({ kind: 'success', text });
                toast('success', text);
                setTimeout(() => router.push('/login'), 2000);
            } else {
                const text = apiError(result.data, t('auth.forgotPassword.failed'));
                setMessage({ kind: 'error', text });
                toast('error', text);
            }
        } catch (error) {
            toast('error', error instanceof Error ? error.message : t('auth.forgotPassword.failed'));
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
            {target === null ? (
                <AuthForm id="forgot-password-form" onSubmit={requestReset}>
                    <AuthHead step={t('auth.step1')} title={t('auth.forgotPassword.title')}>{t('auth.forgotPassword.lead1')}</AuthHead>
                    <Field
                        id="forgot-username-email"
                        label={t('auth.forgotPassword.identifier')}
                        type="text"
                        autoComplete="username"
                        autoCapitalize="none"
                        required
                        value={identifier}
                        onChange={event => setIdentifier(event.target.value)}
                        help={t('auth.forgotPassword.identifierHelp')}
                    />
                    <AuthButton action="requestPasswordReset" submit className="btn btn-primary btn-block">{t('auth.continue')}</AuthButton>
                    {backToLogin}
                </AuthForm>
            ) : (
                <AuthForm id="reset-password-form" onSubmit={resetPassword}>
                    <AuthHead step={t('auth.step2')} title={t('auth.forgotPassword.title2')}>{t('auth.forgotPassword.lead2')}</AuthHead>
                    <div className="question-box">
                        <small>{t('auth.securityQuestion')}</small>
                        <span id="reset-security-question">{target.question}</span>
                    </div>
                    <div className="form-grid">
                        <Field
                            id="reset-security-answer"
                            label={t('auth.yourAnswer')}
                            type="text"
                            autoComplete="off"
                            required
                            value={answer}
                            onChange={event => setAnswer(event.target.value)}
                        />
                        <PasswordField
                            id="reset-new-password"
                            label={t('auth.forgotPassword.newPassword')}
                            autoComplete="new-password"
                            required
                            value={newPassword}
                            onChange={event => setNewPassword(event.target.value)}
                        >
                            <PasswordRules password={newPassword} />
                        </PasswordField>
                        <PasswordField
                            id="reset-confirm-password"
                            label={t('auth.forgotPassword.confirm')}
                            autoComplete="new-password"
                            required
                            value={confirmPassword}
                            onChange={event => setConfirmPassword(event.target.value)}
                        />
                    </div>
                    <AuthButton action="resetPassword" submit className="btn btn-primary btn-block">{t('auth.forgotPassword.submit')}</AuthButton>
                    {backToLogin}
                </AuthForm>
            )}
        </AuthShell>
    );
}
