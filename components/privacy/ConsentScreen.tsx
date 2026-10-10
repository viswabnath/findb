'use client';

import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { PrivacyNotice } from './PrivacyNotice';
import { useToast } from '@/components/Toast';
import { apiError, apiPost } from '@/lib/api-client';
import { t } from '@/lib/i18n';

/**
 * Shown instead of the app to an account that has not agreed to the current privacy notice: one
 * from before the notice, or one that withdrew consent. Agreeing records the consent and opens the
 * app; logging out leaves everything as it is.
 */
export function ConsentScreen({ noticeVersion, onAgreed, onLogout }: { noticeVersion: string; onAgreed: () => void; onLogout: () => void }) {
    const toast = useToast();
    const [agreed, setAgreed] = useState(false);

    async function agree() {
        const result = await apiPost<{ success?: boolean }>('/api/privacy/consent', { noticeVersion });
        if (result.data.success) onAgreed();
        else toast('error', apiError(result.data, t('auth.consent.failed')));
    }

    return (
        <div id="consent-section">
            <div className="page-header">
                <div>
                    <h2>{t('auth.consent.title')}</h2>
                    <p>{t('auth.consent.lead')}</p>
                </div>
            </div>
            <section className="card card-pad stack" aria-labelledby="consent-title">
                <h3 id="consent-title" className="consent-title"><span className="icon-tile t-bank" aria-hidden="true"><ShieldCheck /></span>{t('auth.consent.notice')}</h3>
                <PrivacyNotice />
                <label className="check-line">
                    <input id="consent-agree" type="checkbox" checked={agreed} onChange={event => setAgreed(event.target.checked)} />
                    {t('auth.consent.agree')}
                </label>
                <div className="settings-actions consent-actions">
                    <button type="button" className="btn btn-primary" data-action="giveConsent" disabled={!agreed} onClick={agree}>{t('auth.consent.submit')}</button>
                    <button type="button" className="btn btn-secondary" data-action="consentLogout" onClick={onLogout}>{t('auth.consent.logOut')}</button>
                </div>
            </section>
        </div>
    );
}
