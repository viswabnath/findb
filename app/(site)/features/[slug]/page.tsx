import type { Metadata } from 'next';
import { pageMetadata } from '@/components/site/page-metadata';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, CircleCheck, CircleDashed, Lightbulb } from 'lucide-react';
import { FEATURES, featureBySlug } from '@/components/site/content';
import { FeatureIcon } from '@/components/site/FeatureIcon';
import { StatusBadge } from '@/components/site/StatusBadge';
import { JsonLd, breadcrumbs } from '@/components/site/JsonLd';

interface Props {
    params: Promise<{ slug: string }>;
}

/** Every feature page is built at deploy time; any other address is a 404 */
export const dynamicParams = false;

export function generateStaticParams() {
    return FEATURES.map(item => ({ slug: item.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const feature = featureBySlug((await params).slug);
    return feature ? pageMetadata({ title: feature.name, description: feature.short, path: `/features/${feature.slug}` }) : {};
}

const STATUS_NOTE = {
    available: 'You can use this in FinDB today.',
    building: 'This is being built now, and arrives before or at the public launch.',
    planned: 'This is planned for after the public launch.',
};

export default async function FeaturePage({ params }: Props) {
    const feature = featureBySlug((await params).slug);
    if (!feature) notFound();

    const index = FEATURES.indexOf(feature);
    const previous = FEATURES[(index - 1 + FEATURES.length) % FEATURES.length]!;
    const next = FEATURES[(index + 1) % FEATURES.length]!;
    const available = feature.status === 'available';

    return (
        <>
            <JsonLd data={breadcrumbs([{ name: 'Features', path: '/features' }, { name: feature.name, path: `/features/${feature.slug}` }])} />
            <section className="page-head">
                <div className="wrap">
                    <nav className="crumbs rise" aria-label="Breadcrumb">
                        <Link href="/features">Features</Link>
                        <span aria-hidden="true">/</span>
                        <span aria-current="page">{feature.name}</span>
                    </nav>
                    <div className="feature-hero rise rise-2">
                        <FeatureIcon name={feature.icon} size={28} tile="lg" />
                        <StatusBadge status={feature.status} />
                    </div>
                    <h1 className="rise rise-2">{feature.name}</h1>
                    <p className="lede rise rise-3">{feature.summary}</p>
                    <p className="updated rise rise-3">{STATUS_NOTE[feature.status]}</p>
                </div>
            </section>

            <section className="section-tight">
                <div className="wrap feature-layout">
                    <div>
                        <div className="block reveal">
                            <h2>{available ? 'What you can do today' : 'What you will be able to do'}</h2>
                            <ul className="points">
                                {feature.points.map(point => (
                                    <li key={point}><CircleCheck size={20} aria-hidden="true" /><span>{point}</span></li>
                                ))}
                            </ul>
                        </div>
                        {feature.next && (
                            <div className="block reveal">
                                <h2>Coming next</h2>
                                <ul className="points next">
                                    {feature.next.map(point => (
                                        <li key={point}><CircleDashed size={20} aria-hidden="true" /><span>{point}</span></li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>

                    <div>
                        <div className="block reveal">
                            <h2>A real example</h2>
                            <div className="slip">
                                <span className="slip-title">{feature.example.title}</span>
                                <ol>
                                    {feature.example.lines.map(line => <li key={line}>{line}</li>)}
                                </ol>
                                <div className="slip-result">
                                    <Lightbulb size={20} aria-hidden="true" />
                                    <span>{feature.example.result}</span>
                                </div>
                            </div>
                        </div>
                        {feature.terms && (
                            <div className="block reveal">
                                <h2>In plain words</h2>
                                <dl className="terms">
                                    {feature.terms.map(term => (
                                        <div key={term.term}>
                                            <dt>{term.term}</dt>
                                            <dd>{term.meaning}</dd>
                                        </div>
                                    ))}
                                </dl>
                            </div>
                        )}
                    </div>
                </div>
            </section>

            <section className="section-tight">
                <div className="wrap">
                    <nav className="pager" aria-label="More features">
                        <Link href={`/features/${previous.slug}`}>
                            <small>Previous</small>
                            <b>{previous.name}</b>
                        </Link>
                        <Link href={`/features/${next.slug}`} className="next">
                            <small>Next</small>
                            <b>{next.name}</b>
                        </Link>
                    </nav>
                </div>
            </section>

            <section className="section-tight">
                <div className="wrap">
                    <div className="cta reveal">
                        <h2>{available ? 'Try it now, free.' : 'Start with the basics today.'}</h2>
                        <p>
                            {available
                                ? 'Create an account in a minute. Nothing is connected to your bank.'
                                : 'Track your accounts and spending now, and this arrives as an update. Free for everyone.'}
                        </p>
                        <div className="hero-actions">
                            <a className="btn btn-light btn-lg" href="/register">Start free <ArrowRight size={18} className="go" /></a>
                            <Link className="btn btn-outline-light btn-lg" href="/roadmap">See the roadmap</Link>
                        </div>
                    </div>
                </div>
            </section>
        </>
    );
}
