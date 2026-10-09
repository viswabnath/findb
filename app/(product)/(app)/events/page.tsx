import type { Metadata } from 'next';
import { EventsScreen } from '@/components/events/EventsScreen';

export const metadata: Metadata = { title: 'Events - FinDB' };

export default function EventsPage() {
    return <EventsScreen />;
}
