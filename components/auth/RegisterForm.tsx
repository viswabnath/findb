'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthButton, AuthForm, AuthHead, AuthShell, Field, PasswordField, PasswordRules } from './AuthShell';
import { TwoFactorSetup } from './TwoFactor';
import { PrivacyNotice } from '@/components/privacy/PrivacyNotice';
import { useToast } from '@/components/Toast';
import { apiError, apiPost } from '@/lib/api-client';
import { SECURITY_QUESTIONS, validateRegistration, type RegistrationInput } from '@/lib/auth-validation';
import { t } from '@/lib/i18n';

const EMPTY: RegistrationInput = {
    name: '', username: '', email: '', password: '', confirmPassword: '', securityQuestion: '', securityAnswer: '',
};

export function RegisterForm() {
    const router = useRouter();
    const toast = useToast();
    const [form, setForm] = useState<RegistrationInput>(EMPTY);
    // After registering, two-factor setup; the account is signed in once it is confirmed
    const [settingUp, setSettingUp] = useState(false);
    // Consent to the privacy notice is required, and recorded with the account
    const [acceptPrivacyNotice, setAcceptPrivacyNotice] = useState(false);
    const field = (key: keyof RegistrationInput) => ({
        value: form[key],
        onChange: (event: { target: { value: string } }) => setForm(current => ({ ...current, [key]: event.target.value })),
    });

    async function register() {
        try {
            const data = validateRegistration(form);
            if (!acceptPrivacyNotice) throw new Error(t('auth.register.needConsent'));
            const result = await apiPost<{ success?: boolean }>('/api/register', { ...data, acceptPrivacyNotice });
            if (result.data.success) {
                setSettingUp(true);
            } else {
                toast('error', apiError(result.data, t('auth.register.failed')));
            }
        } catch (error) {
            toast('error', error instanceof Error ? error.message : t('auth.register.failed'));
        }
    }

    if (settingUp) {
        // Next they choose what to track. A full page load, like after login: the session just
        // changed, and a client-side push was occasionally lost here (seen in the end-to-end runs)
        return (
            <AuthShell>
                <TwoFactorSetup onDone={() => window.location.assign('/welcome')}
                    onExpired={() => { toast('error', t('auth.register.finishSetup')); router.push('/login'); }} />
            </AuthShell>
        );
    }

    return (
        <AuthShell>
            <AuthForm id="register-form" onSubmit={register}>
                <AuthHead title={t('auth.register.title')}>{t('auth.register.lead')}</AuthHead>
                <div className="form-grid">
                    <div className="form-grid two">
                        <Field id="register-name" label={t('auth.register.name')} type="text" autoComplete="name" required {...field('name')} />
                        <Field id="register-username" label={t('auth.username')} type="text" autoComplete="username" autoCapitalize="none" required
                            help={t('auth.usernameHelp')} {...field('username')} />
                    </div>
                    <Field id="register-email" label={t('auth.email')} type="email" autoComplete="email" required {...field('email')} />
                    <PasswordField id="register-password" label={t('auth.password')} autoComplete="new-password" required {...field('password')}>
                        <PasswordRules password={form.password} />
                    </PasswordField>
                    <PasswordField id="register-confirm-password" label={t('auth.register.confirm')} autoComplete="new-password" required {...field('confirmPassword')} />

                    <span className="auth-section-title">{t('auth.register.recovery')}</span>
                    <span className="auth-section-note">{t('auth.register.recoveryNote')}</span>
                    <div className="field">
                        <label htmlFor="register-security-question">{t('auth.securityQuestion')}</label>
                        <select id="register-security-question" required {...field('securityQuestion')}>
                            <option value="">{t('auth.register.chooseQuestion')}</option>
                            {SECURITY_QUESTIONS.map(question => (
                                <option key={question.value} value={question.value}>{question.label}</option>
                            ))}
                        </select>
                    </div>
                    <Field id="register-security-answer" label={t('auth.yourAnswer')} type="text" autoComplete="off" required {...field('securityAnswer')} />

                    <span className="auth-section-title">{t('auth.register.privacy')}</span>
                    <PrivacyNotice id="register-privacy-notice" />
                    <label className="check-line">
                        <input id="register-privacy-consent" type="checkbox" checked={acceptPrivacyNotice}
                            onChange={event => setAcceptPrivacyNotice(event.target.checked)} />
                        {t('auth.register.agree')}
                    </label>
                </div>
                <AuthButton action="register" submit className="btn btn-primary btn-block">{t('auth.register.submit')}</AuthButton>
                <p className="auth-alt">
                    {t('auth.register.haveAccount')}{' '}
                    <AuthButton action="showLogin" className="btn-link" onClick={() => router.push('/login')}>{t('auth.register.logIn')}</AuthButton>
                </p>
            </AuthForm>
        </AuthShell>
    );
}
