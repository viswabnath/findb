import type { Metadata } from 'next';
import { DocumentsScreen } from '@/components/documents/DocumentsScreen';

export const metadata: Metadata = { title: 'Documents - FinDB' };

export default function DocumentsPage() {
    return <DocumentsScreen />;
}
