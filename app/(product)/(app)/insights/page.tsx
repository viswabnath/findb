import type { Metadata } from 'next';
import { InsightsScreen } from '@/components/insights/InsightsScreen';

export const metadata: Metadata = { title: 'Insights - FinDB' };

export default function InsightsPage() {
    return <InsightsScreen />;
}
