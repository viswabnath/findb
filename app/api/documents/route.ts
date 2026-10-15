import { withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { listDocuments, uploadDocument } from '@/lib/services/documents';

// ?entryId=|accountId=|eventId= (optional): the user's documents, newest first, with the space used
export const GET = withUser(async (request, userId) => {
    const params = request.nextUrl.searchParams;
    return Response.json(await listDocuments(db(), userId, { entryId: params.get('entryId'), accountId: params.get('accountId'), eventId: params.get('eventId') }));
});

// multipart/form-data: file, kind, title, date, expiresOn, notes, links (JSON [{ type, id }])
export const POST = withUser(async (request, userId) => {
    let form: FormData;
    try {
        form = await request.formData();
    } catch {
        form = new FormData();
    }
    const fields = Object.fromEntries([...form.entries()].filter(([, value]) => typeof value === 'string'));
    const file = form.get('file');
    return Response.json(await uploadDocument(db(), userId, file instanceof File ? file : null, fields));
});
