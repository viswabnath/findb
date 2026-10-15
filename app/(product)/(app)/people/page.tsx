import type { Metadata } from 'next';
import { PeopleScreen } from '@/components/people/PeopleScreen';

export const metadata: Metadata = { title: 'People - FinDB' };

export default function PeoplePage() {
    return <PeopleScreen />;
}
