import { OG_SIZE, ogImage } from '@/components/site/og-image';

export const alt = 'FinDB: track every rupee your family owns and owes. Free.';
export const size = OG_SIZE;
export const contentType = 'image/png';

/** The default link preview for every website page without its own */
export default function Image() {
    return ogImage({
        eyebrow: 'Free personal finance app for India',
        title: 'Track every rupee your family owns and owes.',
        text: 'Bank accounts, cards, cash, loans, gold and savings in one place, explained in plain words.',
    });
}
