import { withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { documentFile } from '@/lib/services/documents';

/** The [id] segment: a document's id */
type Context = { params: Promise<{ id: string }> };

// The file, decrypted: pictures open in the browser, PDFs download (?download=1 downloads any)
export const GET = withUser<Context>(async (request, userId, context) => {
    const { id } = await context.params;
    const { bytes, mimeType, fileName } = await documentFile(db(), userId, id);
    const inline = mimeType.startsWith('image/') && request.nextUrl.searchParams.get('download') !== '1';
    return new Response(new Uint8Array(bytes), {
        headers: {
            'Content-Type': mimeType,
            'Content-Length': String(bytes.length),
            'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${fileName.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
            'Cache-Control': 'private, no-store',
        },
    });
});
