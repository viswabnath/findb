import type { Metadata } from 'next';
import { ImportScreen } from '@/components/import/ImportScreen';

export const metadata: Metadata = { title: 'Import a statement - FinDB' };

export default function ImportPage() {
    return <ImportScreen />;
}
