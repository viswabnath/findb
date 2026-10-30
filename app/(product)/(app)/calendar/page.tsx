import type { Metadata } from 'next';
import { CalendarScreen } from '@/components/calendar/CalendarScreen';

export const metadata: Metadata = { title: 'What\'s due - FinDB' };

export default function CalendarPage() {
    return <CalendarScreen />;
}
