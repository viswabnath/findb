import type { Metadata } from 'next';
import { DebtsScreen } from '@/components/people/DebtsScreen';

export const metadata: Metadata = { title: 'Debt review - FinDB' };

export default function DebtsPage() {
    return <DebtsScreen />;
}
