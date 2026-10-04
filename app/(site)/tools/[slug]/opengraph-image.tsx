import { TOOLS, toolBySlug } from '@/components/site/content';
import { OG_SIZE, ogImage } from '@/components/site/og-image';

export const alt = 'A free FinDB money calculator';
export const size = OG_SIZE;
export const contentType = 'image/png';

export function generateStaticParams() {
    return TOOLS.map(tool => ({ slug: tool.slug }));
}

/** Each calculator's link preview: its question, drawn at build time */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
    const tool = toolBySlug((await params).slug)!;
    return ogImage({ eyebrow: `Free tool: ${tool.name}`, title: tool.question, text: 'Free, no sign-up. Everything runs in your browser.' });
}
