import type { Metadata } from 'next';
import { ReconcileScreen } from '@/components/reconcile/ReconcileScreen';

export const metadata: Metadata = { title: 'Reconcile - FinDB' };

export default function ReconcilePage() {
    return <ReconcileScreen />;
}
