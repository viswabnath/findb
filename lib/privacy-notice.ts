/**
 * The privacy notice a user agrees to (India's Digital Personal Data Protection Act, 2023;
 * docs/privacy.md). The sign-up form and the consent screen show these items, and the privacy page
 * gives the full version. Each consent is recorded with PRIVACY_NOTICE_VERSION, so a change that
 * matters gets a new version and everyone is asked again.
 */

/** The date the notice last changed in a way that needs consent again */
export const PRIVACY_NOTICE_VERSION = '2026-10-04';

export const PRIVACY_CONTACT = 'support@onemark.co.in';

/** The short notice: what is collected, why, and the user's rights, in plain words */
export const PRIVACY_NOTICE_ITEMS: ReadonlyArray<{ title: string; text: string }> = [
    {
        title: 'Who is responsible',
        text: 'FinDB, made by OneMark, decides how your data is used and is responsible for it.',
    },
    {
        title: 'What FinDB keeps',
        text: 'Your name, username and email; your password, security answer and recovery codes only as one-way hashes; your two-step login key, encrypted; the accounts and entries you add; a log of your changes and logins, with no IP address or location.',
    },
    {
        title: 'Why',
        text: 'Only to show you your own money and keep your account safe. Never sold, never shared with advertisers, lenders or insurers, and never used to sell you products.',
    },
    {
        title: 'Where',
        text: 'In Mumbai, India, encrypted at rest, with encrypted nightly backups kept for 30 days.',
    },
    {
        title: 'Your rights',
        text: `See, correct, export or erase your data; withdraw this consent at any time in Settings, as easily as you gave it; nominate someone to act for you; and complain to us at ${PRIVACY_CONTACT}, and then, if needed, to the Data Protection Board of India.`,
    },
];
