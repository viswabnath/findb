/**
 * Share to FinDB, before the service worker is installed: the phone posted the shared item here
 * instead of to the worker (public/sw.js), which normally keeps it on the phone. Nothing is read or
 * stored; /share says to open FinDB once and share again.
 */
export async function POST(): Promise<Response> {
    return new Response(null, { status: 303, headers: { Location: '/share?again=1' } });
}
