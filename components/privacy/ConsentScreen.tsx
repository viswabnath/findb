'use client';

import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { PrivacyNotice } from './PrivacyNotice';
import { useToast } from '@/components/Toast';
import { apiError, apiPost } from '@/lib/api-client';

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
        else toast('error', apiError(result.data, 'Your consent could not be saved'));
    }

    return (
        <div id="consent-section">
            <div className="page-header">
                <div>
                    <h2>Before you continue</h2>
                    <p>FinDB now asks everyone to read how it handles their data and to agree, as India&apos;s data protection law requires.</p>
                </div>
            </div>
            <section className="card card-pad stack" aria-labelledby="consent-title">
                <h3 id="consent-title" className="consent-title"><span className="icon-tile t-bank" aria-hidden="true"><ShieldCheck /></span>Privacy notice</h3>
                <PrivacyNotice />
                <label className="check-line">
                    <input id="consent-agree" type="checkbox" checked={agreed} onChange={event => setAgreed(event.target.checked)} />
                    I have read the privacy notice and agree to FinDB using my data as it describes
                </label>
                <div className="settings-actions consent-actions">
                    <button type="button" className="btn btn-primary" data-action="giveConsent" disabled={!agreed} onClick={agree}>Agree and continue</button>
                    <button type="button" className="btn btn-secondary" data-action="consentLogout" onClick={onLogout}>Log out</button>
                </div>
            </section>
        </div>
    );
}
