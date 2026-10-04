import { PRIVACY_NOTICE_ITEMS, PRIVACY_NOTICE_VERSION } from '@/lib/privacy-notice';

/** The short privacy notice (lib/privacy-notice.ts), with a link to the full one */
export function PrivacyNotice({ id = 'privacy-notice' }: { id?: string }) {
    const updated = new Date(`${PRIVACY_NOTICE_VERSION}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    return (
        <div id={id} className="privacy-notice" role="region" aria-label="Privacy notice">
            <dl>
                {PRIVACY_NOTICE_ITEMS.map(item => (
                    <div key={item.title}>
                        <dt>{item.title}</dt>
                        <dd>{item.text}</dd>
                    </div>
                ))}
            </dl>
            <p className="privacy-notice-foot">
                The full <a href="/privacy" target="_blank" rel="noopener">privacy notice</a> has the details. Notice of {updated}.
            </p>
        </div>
    );
}
