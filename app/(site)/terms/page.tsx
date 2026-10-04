import type { Metadata } from 'next';
import { pageMetadata } from '@/components/site/page-metadata';

export const metadata: Metadata = pageMetadata({
    title: 'Terms',
    description: 'The terms for using FinDB, in plain language.',
    path: '/terms',
});

export default function TermsPage() {
    return (
        <>
            <section className="page-head">
                <div className="wrap">
                    <span className="eyebrow rise">Terms</span>
                    <h1 className="rise rise-2">Terms of Service</h1>
                    <p className="lede rise rise-3">The agreement for using FinDB, written to be read, not skipped.</p>
                    <p className="updated rise rise-3">Last updated 3 October 2026</p>
                </div>
            </section>

            <section className="section-tight">
                <div className="wrap">
                    <div className="prose reveal">
                        <h2>Acceptance of Terms</h2>
                        <p>
                            By creating an account or using FinDB, you agree to these terms. If you do not agree, please do not
                            use FinDB.
                        </p>

                        <h2>What FinDB is</h2>
                        <p>
                            FinDB is a free tool for recording and understanding your own money. It never moves money, never
                            connects to your bank on its own, and does not hold funds for anyone.
                        </p>

                        <h2>Not financial advice</h2>
                        <p>
                            FinDB shows information and rule-based calculations, and explains the rules it uses. It is not
                            investment, tax or legal advice. For personal advice, consult a SEBI-registered investment adviser
                            or a qualified tax professional.
                        </p>

                        <h2>User Responsibility</h2>
                        <p>
                            You are responsible for keeping your login details safe and for all activity under your account,
                            and for the accuracy of what you enter. Use FinDB only for your own or your household&apos;s finances,
                            and do not try to access anyone else&apos;s data or disrupt the service.
                        </p>

                        <h2>Free, and provided as it is</h2>
                        <p>
                            FinDB is free. We work hard to keep it accurate and available, but we cannot guarantee it will
                            always be error-free or uninterrupted. Features may change as FinDB develops; we will tell you about
                            changes that affect you.
                        </p>

                        <h2>Limitation of Liability</h2>
                        <p>
                            While we strive for complete accuracy, FinDB and OneMark are not liable for financial decisions
                            made based on the information in the app. Please cross-check important figures with your official
                            bank and lender statements.
                        </p>

                        <h2>Your data</h2>
                        <p>
                            Your data stays yours. How we handle it is described in the Privacy Guide. You can stop using FinDB
                            at any time and ask for your data to be exported or deleted.
                        </p>

                        <h2>Contact</h2>
                        <p>Questions about these terms: <strong>support@onemark.co.in</strong>.</p>
                    </div>
                </div>
            </section>
        </>
    );
}
