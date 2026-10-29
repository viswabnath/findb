import type { Metadata } from 'next';
import { CardsScreen } from '@/components/cards/CardsScreen';

export const metadata: Metadata = { title: 'Credit cards - FinDB' };

export default function CardsPage() {
    return <CardsScreen />;
}
