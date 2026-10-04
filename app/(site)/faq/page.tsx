import type { Metadata } from 'next';
import { pageMetadata } from '@/components/site/page-metadata';
import { FAQ } from '@/components/site/content';
import { FaqList } from '@/components/site/FaqList';
import { JsonLd } from '@/components/site/JsonLd';

export const metadata: Metadata = pageMetadata({
    title: 'Questions',
    description: 'Is FinDB free? Does it connect to my bank? Is my data safe? Plain answers to common questions.',
    path: '/faq',
});

export default function FaqPage() {
    return (
        <>
            <JsonLd data={{
                '@type': 'FAQPage',
                mainEntity: FAQ.map(item => ({ '@type': 'Question', name: item.q, acceptedAnswer: { '@type': 'Answer', text: item.a } })),
            }} />
            <section className="page-head">
                <div className="wrap narrow">
                    <span className="eyebrow rise">Questions</span>
                    <h1 className="rise rise-2">Plain answers to fair questions.</h1>
                    <p className="lede rise rise-3">
                        A money app should earn your trust before it gets your data. Here is everything people usually ask.
                    </p>
                </div>
            </section>
            <section className="section-tight">
                <div className="wrap narrow">
                    <FaqList items={FAQ} />
                </div>
            </section>
        </>
    );
}
