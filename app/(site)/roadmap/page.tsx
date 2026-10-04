import type { Metadata } from 'next';
import { pageMetadata } from '@/components/site/page-metadata';
import { ROADMAP } from '@/components/site/content';
import { StatusBadge } from '@/components/site/StatusBadge';

export const metadata: Metadata = pageMetadata({
    title: 'Roadmap',
    description: 'What FinDB does today, what is being built now, and what comes next.',
    path: '/roadmap',
});

export default function RoadmapPage() {
    return (
        <>
            <section className="page-head">
                <div className="wrap">
                    <span className="eyebrow rise">Roadmap</span>
                    <h1 className="rise rise-2">Built in the open, one solid step at a time.</h1>
                    <p className="lede rise rise-3">
                        FinDB grows in stages. Each stage is finished, tested and reviewed before the next one starts, so
                        what you rely on keeps working. This is the order, not a promise of dates.
                    </p>
                </div>
            </section>

            <section className="section-tight">
                <div className="wrap">
                    <ol className="timeline">
                        {ROADMAP.map(stage => (
                            <li key={stage.title} className={`${stage.status} reveal`}>
                                <div className="timeline-head">
                                    <h2>{stage.title}</h2>
                                    <StatusBadge status={stage.status} />
                                </div>
                                <p>{stage.summary}</p>
                                <ul className="chips">
                                    {stage.items.map(item => <li key={item}>{item}</li>)}
                                </ul>
                            </li>
                        ))}
                    </ol>
                </div>
            </section>
        </>
    );
}
