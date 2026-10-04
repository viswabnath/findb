import type { Metadata } from 'next';
import { SettingsScreen } from '@/components/settings/SettingsScreen';

export const metadata: Metadata = { title: 'Settings - FinDB' };

export default function SettingsPage() {
    return <SettingsScreen />;
}
