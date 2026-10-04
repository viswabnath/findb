import { llmsFull } from '@/lib/llms-text';

// Built once at deploy time and served from the CDN
export const dynamic = 'force-static';

/** The whole website as one Markdown document for AI assistants */
export function GET() {
    return new Response(llmsFull(), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
