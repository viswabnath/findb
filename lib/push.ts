import webpush from 'web-push';

/**
 * Sending push notifications (v2 Phase 5, free: the browsers' own push services). The keys
 * (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY) identify FinDB to those services; VAPID_SUBJECT is a contact
 * for them (the site address by default). A test server without keys gets a sender that sends
 * nothing and reports success, so the suites run without outside calls.
 */

export interface PushTarget {
    endpoint: string;
    p256dh: string;
    auth: string;
}

export interface PushMessage {
    title: string;
    body: string;
    /** The screen the notification opens */
    url: string;
    /** Notifications with the same tag replace each other (one reminder a day, not a pile) */
    tag: string;
}

/** sent, or gone (the subscription expired or was revoked: delete it), or failed (try again another day) */
export type PushResult = 'sent' | 'gone' | 'failed';

export interface PushSender {
    send(target: PushTarget, message: PushMessage): Promise<PushResult>;
}

class WebPushSender implements PushSender {
    constructor(publicKey: string, privateKey: string, subject: string) {
        webpush.setVapidDetails(subject, publicKey, privateKey);
    }

    async send(target: PushTarget, message: PushMessage): Promise<PushResult> {
        try {
            await webpush.sendNotification({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
                JSON.stringify(message), { TTL: 12 * 60 * 60, urgency: 'normal', timeout: 10_000 });
            return 'sent';
        } catch (error) {
            const status = (error as { statusCode?: number }).statusCode;
            if (status === 404 || status === 410) return 'gone';
            console.warn('Warning: push not sent:', status ?? (error as Error).message);
            return 'failed';
        }
    }
}

class NoSender implements PushSender {
    async send(): Promise<PushResult> {
        return 'sent';
    }
}

/** The public key browsers subscribe with; null when push is not set up */
export function pushPublicKey(): string | null {
    return process.env.VAPID_PUBLIC_KEY || null;
}

let sender: PushSender | null = null;

export function pushSender(): PushSender | null {
    if (sender) return sender;
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    if (publicKey && privateKey) {
        sender = new WebPushSender(publicKey, privateKey, process.env.VAPID_SUBJECT || 'https://findb-app.vercel.app');
    } else if (process.env.REQUIRE_TEST_SCHEMA === 'true') {
        sender = new NoSender();
    }
    return sender;
}
