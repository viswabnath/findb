import { llmsIndex } from '@/lib/llms-text';

// Built once at deploy time and served from the CDN
export const dynamic = 'force-static';

/** A short Markdown index of the website for AI assistants (the llms.txt convention) */
export function GET() {
    return new Response(llmsIndex(), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
