import type { Metadata } from 'next';
import { pageMetadata } from '@/components/site/page-metadata';
import { CircleCheck, CircleDashed } from 'lucide-react';

export const metadata: Metadata = pageMetadata({
    title: 'Security',
    description: 'How FinDB protects your account and your financial data, today and next.',
    path: '/security',
});

export default function SecurityPage() {
    return (
        <>
            <section className="page-head">
                <div className="wrap">
                    <span className="eyebrow rise">Security</span>
                    <h1 className="rise rise-2">Security Policy</h1>
                    <p className="lede rise rise-3">
                        Your financial records are some of the most personal data you have. This page explains, in plain
                        words, how FinDB protects them today and what is being added next.
                    </p>
                    <p className="updated rise rise-3">Last updated 3 October 2026</p>
                </div>
            </section>

            <section className="section-tight">
                <div className="wrap split">
                    <div className="panel reveal">
                        <h2 style={{ fontSize: '1.5rem' }}>In place today</h2>
                        <ul>
                            <li><CircleCheck size={18} /><span><strong>Encrypted connections.</strong> Everything travels over HTTPS.</span></li>
                            <li><CircleCheck size={18} /><span><strong>Passwords never stored.</strong> Passwords and security answers are kept only as one-way hashes (bcrypt).</span></li>
                            <li><CircleCheck size={18} /><span><strong>Your records only.</strong> Every request is limited to the signed-in user, and entries can only use your own accounts.</span></li>
                            <li><CircleCheck size={18} /><span><strong>Locked database.</strong> Row level security is on for every table, and the database is encrypted at rest by our hosting provider.</span></li>
                            <li><CircleCheck size={18} /><span><strong>Safe sessions.</strong> HTTP-only, same-site cookies that expire after 2 hours; a new session at every login.</span></li>
                            <li><CircleCheck size={18} /><span><strong>Limits on guessing.</strong> Repeated failed logins from one address are paused.</span></li>
                            <li><CircleCheck size={18} /><span><strong>Strict browser rules.</strong> A Content Security Policy and standard security headers on every page.</span></li>
                            <li><CircleCheck size={18} /><span><strong>Every change logged.</strong> Your activity log keeps the old and new value of each change.</span></li>
                        </ul>
                    </div>
                    <div className="panel coming reveal">
                        <h2 style={{ fontSize: '1.5rem' }}>Being added next</h2>
                        <ul>
                            <li><CircleDashed size={18} /><span><strong>Two-step login for everyone,</strong> with a code from an authenticator app such as Google Authenticator, and one-time recovery codes.</span></li>
                            <li><CircleDashed size={18} /><span><strong>Sessions you can see:</strong> every device signed in, with &ldquo;sign out everywhere&rdquo;.</span></li>
                            <li><CircleDashed size={18} /><span><strong>Encrypted sensitive details:</strong> PAN, account, policy and folio numbers are encrypted before they are saved, and shown masked.</span></li>
                            <li><CircleDashed size={18} /><span><strong>Stronger passwords:</strong> long passphrases allowed, and known leaked passwords refused.</span></li>
                            <li><CircleDashed size={18} /><span><strong>Database-enforced privacy:</strong> the database itself refuses to return another user&apos;s rows.</span></li>
                            <li><CircleDashed size={18} /><span><strong>Daily backups,</strong> with a restore that has actually been tested.</span></li>
                        </ul>
                    </div>
                </div>
            </section>

            <section className="section-tight">
                <div className="wrap">
                    <div className="prose reveal">
                        <h2>What FinDB never asks for</h2>
                        <p>
                            FinDB never asks for your net banking password, card number, CVV, UPI PIN or OTP, and never
                            connects to your bank on its own. For Aadhaar, it stores at most the last four digits. If anyone
                            claiming to be FinDB asks for these, it is not us.
                        </p>
                        <h2>Reporting a security problem</h2>
                        <p>
                            If you find a security weakness, please email <strong>support@onemark.co.in</strong> with the
                            details, and give us reasonable time to fix it before sharing it publicly. We will reply, keep you
                            informed, and credit you if you wish.
                        </p>
                        <h2>Vulnerability Management</h2>
                        <p>
                            The code and its dependencies are reviewed and updated regularly, and every change is tested before
                            release, including tests that check one user can never see another user&apos;s data.
                        </p>
                    </div>
                </div>
            </section>
        </>
    );
}
