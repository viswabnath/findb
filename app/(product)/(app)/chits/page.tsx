import type { Metadata } from 'next';
import { ChitsScreen } from '@/components/people/ChitsScreen';

export const metadata: Metadata = { title: 'Chit funds - FinDB' };

export default function ChitsPage() {
    return <ChitsScreen />;
}
