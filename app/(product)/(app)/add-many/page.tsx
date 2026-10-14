import type { Metadata } from 'next';
import { AddManyScreen } from '@/components/entries/AddManyScreen';

export const metadata: Metadata = { title: 'Add many entries - FinDB' };

export default function AddManyPage() {
    return <AddManyScreen />;
}
