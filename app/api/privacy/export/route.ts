import { withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { exportData, exportZip } from '@/lib/services/account';

// ?format=json (one file) or csv (a ZIP of one CSV a table): everything FinDB holds about the user
export const GET = withUser(async (request, userId) => {
    const day = new Date().toISOString().slice(0, 10);
    if (request.nextUrl.searchParams.get('format') === 'csv') {
        return new Response(new Uint8Array(await exportZip(db(), userId)), {
            headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="findb-data-${day}.zip"`, 'Cache-Control': 'no-store' },
        });
    }
    return new Response(JSON.stringify(await exportData(db(), userId), null, 2), {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="findb-data-${day}.json"`, 'Cache-Control': 'no-store' },
    });
});
