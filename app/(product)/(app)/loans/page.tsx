import type { Metadata } from 'next';
import { LoansScreen } from '@/components/people/LoansScreen';

export const metadata: Metadata = { title: 'Loans - FinDB' };

export default function LoansPage() {
    return <LoansScreen />;
}
