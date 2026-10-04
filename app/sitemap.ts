import type { MetadataRoute } from 'next';
import { FEATURES, TOOLS } from '@/components/site/content';
import { SITE_URL } from '@/lib/site-url';

/** Every website page, including one per feature and per calculator, dated with this build */
export default function sitemap(): MetadataRoute.Sitemap {
    const lastModified = new Date();
    const pages = ['', '/features', '/tools', '/roadmap', '/download', '/faq', '/security', '/privacy', '/terms', '/about'];
    return [
        ...pages.map(path => ({ url: `${SITE_URL}${path}`, lastModified, changeFrequency: 'weekly' as const, priority: path ? 0.7 : 1 })),
        ...FEATURES.map(feature => ({ url: `${SITE_URL}/features/${feature.slug}`, lastModified, changeFrequency: 'monthly' as const, priority: 0.6 })),
        ...TOOLS.map(tool => ({ url: `${SITE_URL}/tools/${tool.slug}`, lastModified, changeFrequency: 'monthly' as const, priority: 0.8 })),
    ];
}
