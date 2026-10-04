import type { Metadata } from 'next';
import { pageMetadata } from '@/components/site/page-metadata';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { LogoMark } from '@/components/site/Logo';

export const metadata: Metadata = pageMetadata({
    title: 'About',
    description: 'Why FinDB exists, what it believes, and who builds it.',
    path: '/about',
});

const PRINCIPLES = [
    { title: 'Honest numbers', text: 'Money is recorded the way an accountant would, so nothing is counted twice and every balance can be checked.' },
    { title: 'Plain language', text: 'If a screen needs a finance degree to understand, the screen is wrong. Every term is explained where it appears.' },
    { title: 'Private by design', text: 'No ads, no selling data, no product offers. FinDB has nothing to sell you, so it has no reason to look.' },
    { title: 'Free for everyone', text: 'Every feature for every person. FinDB is built to cost almost nothing to run, so it can stay that way.' },
    { title: 'Made for India', text: 'Lakhs and crores, gold by weight, chits, PF, meal cards and the way Indian families share money.' },
    { title: 'Simple first', text: 'You see only what you chose to track. Everything else waits until you need it.' },
];

export default function AboutPage() {
    return (
        <>
            <section className="page-head">
                <div className="wrap">
                    <span className="eyebrow rise">About</span>
                    <h1 className="rise rise-2">About FinDB</h1>
                    <p className="lede rise rise-3">
                        FinDB, short for Finance Dashboard, exists to answer one question for every Indian family: where
                        does our money really stand?
                    </p>
                </div>
            </section>

            <section className="section-tight">
                <div className="wrap split">
                    <div className="prose reveal">
                        <h2 style={{ marginTop: 0 }}>Our Vision</h2>
                        <p>
                            Most people know their bank balance and little else. The gold in the locker, the chit with
                            relatives, the PF from work, the loan to a cousin and the plot in the village rarely appear in one
                            place, so nobody can say whether the family is doing well.
                        </p>
                        <p>
                            FinDB brings it all together, keeps it accurate, and explains it in plain words, without
                            selling anything along the way.
                        </p>
                    </div>
                    <div className="panel reveal" style={{ justifyItems: 'start' }}>
                        <LogoMark size={56} title="FinDB logo" />
                        <h3>The mark</h3>
                        <p style={{ color: 'var(--muted)' }}>
                            The F of FinDB, drawn like a ledger: its two bars are the same length, because every rupee
                            that goes out goes in somewhere else. The gold block on the bottom line is what you keep.
                        </p>
                    </div>
                </div>
            </section>

            <section className="section-tight">
                <div className="wrap">
                    <div className="section-head">
                        <span className="eyebrow">What we believe</span>
                        <h2>Six principles behind every screen.</h2>
                    </div>
                    <div className="feature-grid">
                        {PRINCIPLES.map(principle => (
                            <div key={principle.title} className="feature-card reveal">
                                <h3>{principle.title}</h3>
                                <p>{principle.text}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            <section className="section-tight">
                <div className="wrap">
                    <div className="prose reveal">
                        <h2>Powered by OneMark</h2>
                        <p>
                            FinDB is built in India by{' '}
                            <a href="https://www.onemark.co.in" target="_blank" rel="noopener noreferrer">OneMark</a>. Questions,
                            ideas and feedback are always welcome at{' '}
                            <strong>support@onemark.co.in</strong>.
                        </p>
                        <p>
                            <Link className="text-link" href="/roadmap">See what we are building next <ArrowRight size={16} /></Link>
                        </p>
                    </div>
                </div>
            </section>
        </>
    );
}
