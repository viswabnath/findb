import { SITE_URL } from '@/lib/site-url';

/**
 * Structured data (schema.org JSON-LD) that tells search engines and AI assistants what a page is:
 * the organisation, the app, its questions and answers, its calculators. It is data, not a script:
 * browsers do not run it, so the page's script policy does not apply. "<" is escaped so no text in
 * the data can close the tag.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
    return (
        <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify({ '@context': 'https://schema.org', ...data }).replace(/</g, '\\u003c') }}
        />
    );
}

export const ORGANIZATION = {
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: 'FinDB',
    url: SITE_URL,
    logo: `${SITE_URL}/icons/icon-512.png`,
    parentOrganization: { '@type': 'Organization', name: 'OneMark', url: 'https://www.onemark.co.in' },
};

/** Breadcrumbs for a page under a section, for example Free tools > EMI calculator */
export function breadcrumbs(items: { name: string; path: string }[]) {
    return {
        '@type': 'BreadcrumbList',
        itemListElement: items.map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.name, item: `${SITE_URL}${item.path}` })),
    };
}
