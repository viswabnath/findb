import type { Metadata } from 'next';
import { pageMetadata } from '@/components/site/page-metadata';

export const metadata: Metadata = pageMetadata({
    title: 'Privacy',
    description: 'What FinDB collects, why, where it is kept, and your rights over it.',
    path: '/privacy',
});

export default function PrivacyPage() {
    return (
        <>
            <section className="page-head">
                <div className="wrap">
                    <span className="eyebrow rise">Privacy</span>
                    <h1 className="rise rise-2">Privacy Guide</h1>
                    <p className="lede rise rise-3">
                        Short version: FinDB collects only what it needs to work, uses it only to show you your own money,
                        and never sells or shares it.
                    </p>
                    <p className="updated rise rise-3">Last updated 4 October 2026</p>
                </div>
            </section>

            <section className="section-tight">
                <div className="wrap">
                    <div className="prose reveal">
                        <h2>What we collect</h2>
                        <ul>
                            <li><strong>Your account:</strong> your name, username and email, and your password and security answer stored only as one-way hashes.</li>
                            <li><strong>Your financial records:</strong> the accounts, balances and entries you add yourself.</li>
                            <li><strong>Your activity log:</strong> a record of each change you make, so you can see your own history.</li>
                            <li><strong>Your sign-in security:</strong> your two-step login key, encrypted; your recovery codes, only as one-way hashes; and your recent logins and signed-in devices, described by browser and device type (such as &ldquo;Chrome on Android&rdquo;), with no IP address or location. Login history older than a year is deleted.</li>
                            <li><strong>Basic technical logs:</strong> errors and request information our hosting providers keep for a short time to run and secure the service.</li>
                        </ul>

                        <h2>What we do not collect</h2>
                        <ul>
                            <li>No bank, card or UPI passwords, PINs or OTPs, ever.</li>
                            <li>No advertising or tracking cookies. FinDB sets two cookies when you log in: one that keeps you signed in, and one that only tells the website to show &ldquo;Open FinDB&rdquo; instead of &ldquo;Log in&rdquo;. Both end when you log out or after two hours. Between your password and your two-step code, a third cookie holds the unfinished login for at most ten minutes.</li>
                            <li>No contacts, location or SMS from your phone.</li>
                            <li>Your password is never sent anywhere. To refuse known leaked passwords, FinDB sends only the first five characters of a one-way hash of it to the free Pwned Passwords service, and checks the answer itself.</li>
                        </ul>

                        <h2>How we use it</h2>
                        <p>
                            Only to provide FinDB to you: to show your balances, summaries and history, and to keep your account
                            secure. We never sell your data to third parties, never share it with advertisers, lenders or
                            insurers, and never use it to choose products to sell you. Your financial information is strictly
                            for your personal use within FinDB.
                        </p>

                        <h2>Where it is kept</h2>
                        <p>
                            FinDB runs on Vercel in Mumbai, and your data is stored in a Supabase Postgres database in Mumbai,
                            India, encrypted at rest. It is backed up every night; each backup is encrypted before it is stored,
                            kept for 30 days, and can be read only with a key held by FinDB.
                        </p>

                        <h2>Your rights</h2>
                        <p>
                            Under India&apos;s Digital Personal Data Protection Act, 2023, you can ask to see, correct, export or
                            erase your data. You can edit your records and export your activity log in the app today. A full
                            export and self-service account deletion are part of the public launch; until then, email{' '}
                            <strong>support@onemark.co.in</strong> and we will do it for you.
                        </p>

                        <h2>How long we keep it</h2>
                        <p>
                            For as long as you have an account. When you delete your account, your data is deleted with it,
                            apart from what the law requires us to keep.
                        </p>

                        <h2>Questions or complaints</h2>
                        <p>
                            Email <strong>support@onemark.co.in</strong>. If we change this guide in a way that matters, we
                            will tell you in the app before it takes effect.
                        </p>
                    </div>
                </div>
            </section>
        </>
    );
}
