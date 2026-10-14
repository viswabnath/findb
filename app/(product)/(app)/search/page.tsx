import type { Metadata } from 'next';
import { SearchScreen } from '@/components/search/SearchScreen';

export const metadata: Metadata = { title: 'Search - FinDB' };

export default function SearchPage() {
    return <SearchScreen />;
}
