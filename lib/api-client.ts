/**
 * Minimal browser client for the JSON API (served by the legacy Express app until N3).
 * Same-origin requests, so the session cookie is sent automatically.
 */

export interface ApiResult<T> {
    ok: boolean;
    status: number;
    data: T;
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

// In-flight request count, so the app shell can show the "Processing..." overlay like the legacy app
let activeRequests = 0;
const listeners = new Set<(active: number) => void>();

function setActive(delta: number) {
    activeRequests = Math.max(0, activeRequests + delta);
    listeners.forEach(listener => listener(activeRequests));
}

/** Subscribe to the number of requests in flight; returns an unsubscribe function */
export function onActiveRequestsChange(listener: (active: number) => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

async function request<T>(method: Method, path: string, body?: unknown): Promise<ApiResult<T>> {
    setActive(1);
    try {
        const form = body instanceof FormData;
        const response = await fetch(path, {
            method,
            credentials: 'same-origin',
            // A form (a file upload) sets its own multipart type
            headers: body === undefined || form ? undefined : { 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : form ? body : JSON.stringify(body),
        });
        const data = (await response.json().catch(() => ({}))) as T;
        return { ok: response.ok, status: response.status, data };
    } finally {
        setActive(-1);
    }
}

export const apiGet = <T>(path: string) => request<T>('GET', path);
export const apiPost = <T>(path: string, body: unknown) => request<T>('POST', path, body);
export const apiPut = <T>(path: string, body: unknown) => request<T>('PUT', path, body);
export const apiDelete = <T>(path: string) => request<T>('DELETE', path);
/** A multipart form, such as a file and its details */
export const apiUpload = <T>(path: string, form: FormData) => request<T>('POST', path, form);

/** Error text from an API error body, with a fallback (legacy: "HTTP error! status: N") */
export function apiError(data: unknown, fallback: string): string {
    if (data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string') {
        return (data as { error: string }).error;
    }
    return fallback;
}

/** The API's error text, or the legacy fallback "HTTP error! status: N" */
export function httpError(result: ApiResult<unknown>): string {
    return apiError(result.data, `HTTP error! status: ${result.status}`);
}

/** A 401 means the session ended: go to the login page */
export function redirectIfUnauthorized(result: ApiResult<unknown>): boolean {
    if (result.status === 401) {
        window.location.replace('/login');
        return true;
    }
    return false;
}
