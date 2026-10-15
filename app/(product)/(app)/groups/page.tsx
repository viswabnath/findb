import type { Metadata } from 'next';
import { GroupsScreen } from '@/components/people/GroupsScreen';

export const metadata: Metadata = { title: 'Groups - FinDB' };

export default function GroupsPage() {
    return <GroupsScreen />;
}
