import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { TOOLS, toolBySlug } from '@/components/site/content';
import { ToolIcon } from '@/components/site/FeatureIcon';
import { ToolCalculator } from '@/components/site/tools/Calculators';

interface Props {
    params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const tool = toolBySlug((await params).slug);
    return tool ? { title: tool.name, description: tool.short } : {};
}

/** How each tool works, in plain words, and where FinDB tracks the same thing */
const ABOUT: Record<string, { how: string[]; feature: { href: string; label: string } }> = {
    'emi-calculator': {
        how: [
            'An EMI (equated monthly instalment) stays the same every month, but what it pays for changes. Early on, most of it is interest; towards the end, most of it reduces the loan.',
            'That is why paying a little extra in the first few years saves the most interest.',
            'Interest is often quoted as rupees per ₹100 a month. ₹1 per ₹100 a month is 12% a year, so a yearly rate divided by 12 gives the rupees per ₹100 a month. Note that a lender quoting "per hundred" may charge it on the full amount every month, which costs more than an EMI loan at the same rate, because an EMI loan charges interest only on what is still owed.',
        ],
        feature: { href: '/features/loans', label: 'Track your loans in FinDB' },
    },
    'loan-payoff': {
        how: [
            'If you have money left over each month, putting it on the loan with the highest interest rate saves the most. This is called the avalanche method.',
            'When that loan closes, its EMI joins the extra for the next loan, so you clear each one faster than the last.',
        ],
        feature: { href: '/features/loans', label: 'See dangerous-debt ranking in FinDB' },
    },
    'fd-calculator': {
        how: [
            'Most Indian banks add interest to a fixed deposit every quarter, and the next quarter\'s interest is earned on that too. This is compounding.',
            'Senior citizens usually get about 0.5% more. Interest is added to your income and taxed at your slab rate.',
        ],
        feature: { href: '/features/savings', label: 'Track deposits in FinDB' },
    },
    'rd-calculator': {
        how: [
            'In a recurring deposit you put in the same amount every month. Each instalment earns interest only for the months it stays with the bank, so the first instalment earns the most.',
            'An RD is a simple way to save for something with a date: a bike, a trip, school fees.',
        ],
        feature: { href: '/features/savings', label: 'Set goals in FinDB' },
    },
    'sip-calculator': {
        how: [
            'A SIP (systematic investment plan) invests a fixed amount in a mutual fund every month. Over many years, growth on growth can add up to more than what you put in.',
            'The return you enter is an assumption. Equity funds have returned around 10% to 14% a year over long periods, but never in a straight line.',
        ],
        feature: { href: '/features/investments', label: 'Track investments in FinDB' },
    },
    'gold-value': {
        how: [
            'Gold\'s purity is measured in karats out of 24. 22 karat jewellery is 91.6% gold, which is why it carries the 916 hallmark.',
            'Value = weight x purity x today\'s 24 karat rate. Check the BIS hallmark on jewellery to be sure of its purity.',
        ],
        feature: { href: '/features/investments', label: 'Track your gold by weight in FinDB' },
    },
    'chit-fund': {
        how: [
            'Every month each member pays an instalment, and one member takes the pool through an auction. The discount they give up, minus the organiser\'s commission, is shared by everyone as a dividend.',
            'Taking the money early is like borrowing; taking it late is like saving. The yearly rate shows which, and by how much.',
        ],
        feature: { href: '/features/loans', label: 'Track chits in FinDB' },
    },
    inflation: {
        how: [
            'Inflation is prices rising over time. At 5% a year, what costs ₹100 today costs about ₹163 in 10 years.',
            'Money kept as cash, or in an account paying less than inflation, buys less every year even though the number stays the same.',
        ],
        feature: { href: '/features/health-check', label: 'See your money against inflation in FinDB' },
    },
};

export default async function ToolPage({ params }: Props) {
    const tool = toolBySlug((await params).slug);
    if (!tool) notFound();
    const about = ABOUT[tool.slug]!;
    const others = TOOLS.filter(other => other.slug !== tool.slug).slice(0, 4);

    return (
        <>
            <section className="page-head">
                <div className="wrap">
                    <nav className="crumbs rise" aria-label="Breadcrumb">
                        <Link href="/tools">Free tools</Link>
                        <span aria-hidden="true">/</span>
                        <span aria-current="page">{tool.name}</span>
                    </nav>
                    <div className="feature-hero rise rise-2">
                        <ToolIcon name={tool.icon} size={28} tile="lg" />
                    </div>
                    <h1 className="rise rise-2">{tool.question}</h1>
                    <p className="lede rise rise-3">{tool.short}</p>
                </div>
            </section>

            <section className="section-tight" aria-label={tool.name}>
                <div className="wrap">
                    <ToolCalculator slug={tool.slug} />
                </div>
            </section>

            <section className="section-tight">
                <div className="wrap split">
                    <div className="prose">
                        <h2 style={{ marginTop: 0 }}>How it works</h2>
                        {about.how.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
                        <p className="updated">An estimate for information, not financial advice or an offer.</p>
                    </div>
                    <div className="panel">
                        <h2>Keep track of it</h2>
                        <p style={{ color: 'var(--muted)' }}>FinDB keeps your real numbers up to date, free.</p>
                        <Link className="text-link" href={about.feature.href}>{about.feature.label} <ArrowRight size={16} /></Link>
                    </div>
                </div>
            </section>

            <section className="section-tight" aria-labelledby="more-tools">
                <div className="wrap">
                    <h2 id="more-tools" style={{ fontSize: 'clamp(1.35rem, 2.4vw, 1.75rem)', marginBottom: 18 }}>More free tools</h2>
                    <div className="tool-grid">
                        {others.map(other => (
                            <Link key={other.slug} href={`/tools/${other.slug}`} className="tool-card">
                                <ToolIcon name={other.icon} />
                                <h3>{other.name}</h3>
                                <p>{other.short}</p>
                            </Link>
                        ))}
                    </div>
                </div>
            </section>
        </>
    );
}
