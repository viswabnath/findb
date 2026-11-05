import type { Metadata } from 'next';
import { ShareScreen } from '@/components/share/ShareScreen';

export const metadata: Metadata = { title: 'Shared to FinDB - FinDB' };

export default function SharePage() {
    return <ShareScreen />;
}
