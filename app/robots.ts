import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site-url';

/** Private: the logged-in app, the sign-in screens and the API */
const PRIVATE = ['/api/', '/setup', '/transactions', '/summary', '/activity', '/settings', '/welcome', '/login', '/register', '/forgot-username', '/forgot-password'];

/**
 * Search engines and AI assistants are welcome to read the website, including llms.txt; the app and
 * the API are off limits. The AI crawlers are named so that allowing them is an explicit choice.
 */
const AI_CRAWLERS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended', 'Bingbot'];

export default function robots(): MetadataRoute.Robots {
    return {
        rules: [
            { userAgent: '*', allow: '/', disallow: PRIVATE },
            { userAgent: AI_CRAWLERS, allow: '/', disallow: PRIVATE },
        ],
        sitemap: `${SITE_URL}/sitemap.xml`,
        host: SITE_URL,
    };
}
