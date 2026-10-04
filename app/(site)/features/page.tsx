import type { Metadata } from 'next';
import { pageMetadata } from '@/components/site/page-metadata';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { FEATURES, GROUPS } from '@/components/site/content';
import { FeatureIcon } from '@/components/site/FeatureIcon';
import { StatusBadge } from '@/components/site/StatusBadge';

export const metadata: Metadata = pageMetadata({
    title: 'Features',
    description: 'Everything FinDB tracks: accounts, spending, statement import, loans, chit funds, credit cards, gold, property, savings, insurance, tax and your net worth.',
    path: '/features',
});

export default function FeaturesPage() {
    return (
        <>
            <section className="page-head">
                <div className="wrap">
                    <span className="eyebrow rise">Features</span>
                    <h1 className="rise rise-2">Everything your money touches, in one place.</h1>
                    <p className="lede rise rise-3">
                        Fourteen parts in five groups, each explained in plain words with a real example. Turn on only the
                        ones you need. Every card says whether it is available now, in development or planned.
                    </p>
                </div>
            </section>

            <section className="section-tight">
                <div className="wrap">
                    {GROUPS.map(group => {
                        const features = FEATURES.filter(feature => feature.group === group.id);
                        // Pick a layout every row fills: 3s in threes, 2 or 1 in halves, 5 as two wide and three narrow
                        const columns = features.length === 5 ? ' six' : features.length % 3 === 0 ? '' : ' two';
                        return (
                            <div key={group.id} className="group-block" aria-labelledby={`group-${group.id}`}>
                                <div className="group-title">
                                    <h2 id={`group-${group.id}`}>{group.name}</h2>
                                    <p>{group.text}</p>
                                </div>
                                <div className={`feature-grid${columns}`}>
                                    {features.map(feature => (
                                        <Link
                                            key={feature.slug}
                                            href={`/features/${feature.slug}`}
                                            className={`feature-card reveal${feature.status === 'available' || features.length === 1 ? ' wide' : ''}`}
                                        >
                                            <div className="feature-card-top">
                                                <FeatureIcon name={feature.icon} />
                                                <StatusBadge status={feature.status} />
                                            </div>
                                            <h3>{feature.name}</h3>
                                            <p>{feature.short}</p>
                                            <span className="more">Learn more <ArrowRight size={16} /></span>
                                        </Link>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </section>
        </>
    );
}
