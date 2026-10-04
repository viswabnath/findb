import type { Metadata } from 'next';
import { pageMetadata } from '@/components/site/page-metadata';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { TOOLS } from '@/components/site/content';
import { ToolIcon } from '@/components/site/FeatureIcon';

export const metadata: Metadata = pageMetadata({
    title: 'Free money calculators',
    description: 'Free EMI, loan payoff, FD, RD, SIP, gold value, chit fund and inflation calculators for India. No sign-up; nothing you type leaves your browser.',
    path: '/tools',
});

export default function ToolsPage() {
    return (
        <>
            <section className="page-head">
                <div className="wrap">
                    <span className="eyebrow rise">Free tools</span>
                    <h1 className="rise rise-2">Money calculators made for India.</h1>
                    <p className="lede rise rise-3">
                        Work out an EMI, plan which loan to close first, or check what your gold is worth. Free, no sign-up,
                        and everything runs in your browser: nothing you type is sent anywhere.
                    </p>
                </div>
            </section>
            <section className="section-tight">
                <div className="wrap tool-grid">
                    {TOOLS.map(tool => (
                        <Link key={tool.slug} href={`/tools/${tool.slug}`} className="tool-card reveal">
                            <ToolIcon name={tool.icon} />
                            <h2 style={{ fontSize: '1.1rem' }}>{tool.name}</h2>
                            <p>{tool.short}</p>
                            <span className="more">Open <ArrowRight size={15} /></span>
                        </Link>
                    ))}
                </div>
            </section>
        </>
    );
}
