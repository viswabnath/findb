import { FEATURES, GROUPS, STATUS_LABELS, featureBySlug } from '@/components/site/content';
import { OG_SIZE, ogImage } from '@/components/site/og-image';

export const alt = 'A FinDB feature';
export const size = OG_SIZE;
export const contentType = 'image/png';

export function generateStaticParams() {
    return FEATURES.map(feature => ({ slug: feature.slug }));
}

/** Each feature's link preview: its name, group and status, drawn at build time */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
    const feature = featureBySlug((await params).slug)!;
    const group = GROUPS.find(candidate => candidate.id === feature.group)!;
    return ogImage({ eyebrow: `${group.name}: ${STATUS_LABELS[feature.status]}`, title: feature.name, text: group.text });
}
