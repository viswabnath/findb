import { t } from './i18n';

/**
 * The privacy notice a user agrees to (India's Digital Personal Data Protection Act, 2023;
 * docs/privacy.md). The sign-up form and the consent screen show these items, and the privacy page
 * gives the full version. Each consent is recorded with PRIVACY_NOTICE_VERSION, so a change that
 * matters gets a new version and everyone is asked again.
 */

/** The date the notice last changed in a way that needs consent again */
export const PRIVACY_NOTICE_VERSION = '2026-10-04';

export const PRIVACY_CONTACT = 'support@onemark.co.in';

const ITEMS = ['who', 'keeps', 'why', 'where', 'rights'] as const;

/** The short notice: what is collected, why, and the user's rights, in plain words (messages/en.ts) */
export const PRIVACY_NOTICE_ITEMS: ReadonlyArray<{ title: string; text: string }> = ITEMS.map(item => ({
    title: t(`privacyNotice.${item}.title`),
    text: t(`privacyNotice.${item}.text`, { email: PRIVACY_CONTACT }),
}));
