import type { Metadata } from 'next';

/**
 * A website page's metadata: its title and description, its canonical address (so search engines
 * index one address per page), and the same title and description for link previews. The preview
 * image comes from the nearest opengraph-image file.
 */
export function pageMetadata({ title, description, path }: { title?: string; description: string; path: string }): Metadata {
    return {
        ...(title ? { title } : {}),
        description,
        alternates: { canonical: path },
        openGraph: {
            type: 'website',
            siteName: 'FinDB',
            locale: 'en_IN',
            url: path,
            title: title ? `${title} | FinDB` : 'FinDB: track every rupee your family owns and owes. Free.',
            description,
        },
    };
}
