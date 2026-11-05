'use client';

import { useEffect, useState } from 'react';
import { Share2 } from 'lucide-react';
import { OPEN_QUICK_ADD, type QuickPreset } from '@/components/app/QuickAdd';
import { t } from '@/lib/i18n';
import { isStatementFile, takeShared } from '@/lib/shared-item';
import { readSms } from '@/src/core/sms';

/**
 * Shared to FinDB from another app (v2 Phase 5; the service worker keeps what was shared on this
 * phone): a statement file goes to Import, a picture opens quick add to be read, and a bank SMS is
 * read here and opens quick add filled in. Nothing is saved until the user saves the entry.
 */
type State = 'looking' | 'opened' | 'statement' | 'nothing' | 'unreadable' | 'again';

export function ShareScreen() {
    const [state, setState] = useState<State>('looking');

    useEffect(() => {
        (async () => {
            if (new URLSearchParams(window.location.search).get('again') === '1') return setState('again');
            const peek = await takeShared(true);
            if (!peek) return setState('nothing');
            if (peek.file && isStatementFile(peek.file)) {
                // Import takes the file from the phone's cache itself
                setState('statement');
                window.location.assign('/import?shared=1');
                return;
            }
            const shared = await takeShared();
            let preset: QuickPreset | null = null;
            if (shared?.file && shared.file.type.startsWith('image/')) preset = { file: shared.file };
            else if (shared && (shared.text || shared.title)) {
                const sms = readSms(`${shared.title} ${shared.text}`.trim());
                if (sms.amount) preset = { sms };
            }
            if (!preset) return setState('unreadable');
            setState('opened');
            window.dispatchEvent(new CustomEvent<QuickPreset>(OPEN_QUICK_ADD, { detail: preset }));
        })();
    }, []);

    return (
        <div id="share-section">
            <div className="page-header">
                <div>
                    <h2>{t('share.title')}</h2>
                    <p>{t('share.subtitle')}</p>
                </div>
            </div>
            <section className="card card-pad stack" aria-live="polite">
                <p id="share-status"><span className="icon-tile t-bank" aria-hidden="true"><Share2 /></span> {t(`share.states.${state}`)}</p>
                {state !== 'looking' && state !== 'statement' ? <p className="form-note">{t('share.how')}</p> : null}
                <div className="settings-actions">
                    <a className="btn btn-secondary btn-sm" href="/transactions">{t('share.toTransactions')}</a>
                </div>
            </section>
        </div>
    );
}
