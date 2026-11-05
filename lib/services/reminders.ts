import type { Pool } from 'pg';
import { logActivity } from '../activity-log';
import { pushPublicKey, pushSender, type PushMessage, type PushSender } from '../push';
import { RequestError } from '../transaction';
import { t } from '../i18n';
import { reminderParts, shortList, type ReminderParts } from '../../src/core/reminders';
import { dueCalendar } from './calendar';
import { listRewards } from './rewards';
import { todayInIndia } from './recurring';
import { describeUserAgent } from './security';

/**
 * Reminders by push notification (v2 Phase 5, migration 0037; email waits for a domain). A device
 * turns them on in Settings and gives its push subscription. Once a day (app/api/cron/reminders,
 * a Vercel cron job) each user with a subscription gets one notification naming what is overdue,
 * due today and due tomorrow (from the calendar, and reward points expiring within a week), without
 * amounts, since it shows on a locked screen. The day is recorded so a repeated run sends nothing.
 */

type Body = Record<string, unknown>;

/** Reward points expiring within this many days are in the daily reminder */
const POINTS_REMIND_DAYS = 7;

export interface Device { id: number; device: string; createdAt: string; lastSentAt: string | null; current: boolean }

const text = (value: unknown, max: number) => (typeof value === 'string' && value.length > 0 && value.length <= max ? value : null);

export function reminderSettings(): { available: boolean; publicKey: string | null } {
    const publicKey = pushPublicKey();
    return { available: publicKey !== null, publicKey };
}

export async function listDevices(pool: Pool, userId: number, endpoint?: string | null): Promise<Device[]> {
    const result = await pool.query(
        'SELECT id, endpoint, user_agent, created_at, last_sent_at FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    return result.rows.map(row => ({
        id: Number(row.id), device: describeUserAgent(row.user_agent), createdAt: new Date(row.created_at).toISOString(),
        lastSentAt: row.last_sent_at ? new Date(row.last_sent_at).toISOString() : null, current: endpoint ? row.endpoint === endpoint : false,
    }));
}

/**
 * { endpoint, keys: { p256dh, auth } }: this device's subscription. Runs as the owner: the same
 * browser signed in as someone else before hands its subscription over, so it is removed from
 * whoever had it first (explicit user filters everywhere else).
 */
export async function subscribe(owner: Pool, userId: number, body: Body, userAgent: string | null): Promise<void> {
    const endpoint = text(body.endpoint, 1000);
    const keys = (body.keys ?? {}) as Record<string, unknown>;
    const p256dh = text(keys.p256dh, 200);
    const auth = text(keys.auth, 100);
    if (!endpoint || !/^https:\/\//.test(endpoint) || !p256dh || !auth) throw new RequestError(400, t('errors.reminders.badSubscription'));
    await owner.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
    await owner.query('INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) VALUES ($1, $2, $3, $4, $5)',
        [userId, endpoint, p256dh, auth, userAgent?.slice(0, 300) ?? null]);
    await logActivity(owner, userId, 'created', 'reminders', userId, `Turned on reminders on ${describeUserAgent(userAgent)}`, null, null, { device: describeUserAgent(userAgent) });
}

/** { endpoint } or { id }: stop reminders on one device */
export async function unsubscribe(pool: Pool, userId: number, body: Body): Promise<void> {
    const endpoint = text(body.endpoint, 1000);
    const id = /^\d+$/.test(String(body.id ?? '')) ? Number(body.id) : null;
    if (!endpoint && id === null) throw new RequestError(400, t('errors.reminders.badSubscription'));
    const removed = await pool.query('DELETE FROM push_subscriptions WHERE user_id = $1 AND (endpoint = $2 OR id = $3) RETURNING user_agent', [userId, endpoint, id]);
    if (removed.rows.length > 0) {
        await logActivity(pool, userId, 'deleted', 'reminders', userId, `Turned off reminders on ${describeUserAgent(removed.rows[0].user_agent)}`, null, null, null);
    }
}

/** The notification for a day's reminder */
export function reminderMessage(parts: ReminderParts): PushMessage {
    const line = (key: 'overdue' | 'today' | 'tomorrow', names: string[]) => {
        if (names.length === 0) return null;
        const { names: list, more } = shortList(names);
        return t(`reminders.push.${key}`, { names: list }) + (more > 0 ? t('reminders.push.more', { count: more }) : '');
    };
    return {
        title: t('reminders.push.title', { count: parts.count }),
        body: [line('overdue', parts.overdue), line('today', parts.today), line('tomorrow', parts.tomorrow)].filter(Boolean).join(' '),
        url: '/calendar', tag: 'findb-reminder',
    };
}

/** What a user's reminder would say today; null with nothing due */
export async function reminderFor(pool: Pool, userId: number, today = todayInIndia()): Promise<ReminderParts | null> {
    const calendar = await dueCalendar(pool, userId, today);
    const points = (await listRewards(pool, userId)).flatMap(card => card.points.expiring
        .filter(item => item.daysLeft <= POINTS_REMIND_DAYS)
        .map(item => ({ date: today, title: t('reminders.points', { name: card.name, points: item.points }), direction: 'none' as const, overdue: false })));
    return reminderParts([...calendar.items, ...points], today);
}

/** A test notification to the user's devices */
export async function sendTest(pool: Pool, userId: number): Promise<{ sent: number }> {
    const sender = pushSender();
    if (!sender) throw new RequestError(503, t('errors.reminders.notSetUp'));
    const devices = await pool.query('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1', [userId]);
    if (devices.rows.length === 0) throw new RequestError(400, t('errors.reminders.noDevice'));
    let sent = 0;
    for (const device of devices.rows) {
        const result = await sender.send(device, { title: t('reminders.push.testTitle'), body: t('reminders.push.testBody'), url: '/settings', tag: 'findb-test' });
        if (result === 'gone') await pool.query('DELETE FROM push_subscriptions WHERE id = $1 AND user_id = $2', [device.id, userId]);
        if (result === 'sent') sent += 1;
    }
    return { sent };
}

/**
 * The daily run: everyone with a device and no reminder yet today. Runs as the owner with explicit
 * user filters (there is no signed-in user). Returns how many users were reminded.
 */
export async function runReminders(owner: Pool, today = todayInIndia(), sender: PushSender | null = pushSender()): Promise<{ users: number; reminded: number; sent: number; gone: number }> {
    if (!sender) throw new RequestError(503, t('errors.reminders.notSetUp'));
    const users = await owner.query(
        `SELECT DISTINCT s.user_id FROM push_subscriptions s
         WHERE NOT EXISTS (SELECT 1 FROM reminders_sent r WHERE r.user_id = s.user_id AND r.sent_on = $1)`, [today]);
    let reminded = 0;
    let sent = 0;
    let gone = 0;
    for (const row of users.rows) {
        const userId = Number(row.user_id);
        let parts: ReminderParts | null;
        try {
            parts = await reminderFor(owner, userId, today);
        } catch (error) {
            console.warn(`Warning: reminder for user ${userId} not worked out:`, (error as Error).message);
            continue;
        }
        if (!parts) continue;
        const message = reminderMessage(parts);
        const devices = await owner.query('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1', [userId]);
        let any = false;
        for (const device of devices.rows) {
            const result = await sender.send(device, message);
            if (result === 'sent') {
                any = true;
                sent += 1;
                await owner.query('UPDATE push_subscriptions SET last_sent_at = now() WHERE id = $1 AND user_id = $2', [device.id, userId]);
            } else if (result === 'gone') {
                gone += 1;
                await owner.query('DELETE FROM push_subscriptions WHERE id = $1 AND user_id = $2', [device.id, userId]);
            }
        }
        if (any) {
            reminded += 1;
            await owner.query('INSERT INTO reminders_sent (user_id, sent_on, items) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [userId, today, parts.count]);
        }
    }
    return { users: users.rows.length, reminded, sent, gone };
}
