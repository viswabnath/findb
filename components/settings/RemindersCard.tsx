'use client';

import { useEffect, useState } from 'react';
import { BellRing, X } from 'lucide-react';
import { FoldingCard } from '@/components/ui/FoldingCard';
import { useToast } from '@/components/Toast';
import { apiError, apiGet, apiPost, redirectIfUnauthorized } from '@/lib/api-client';
import { t } from '@/lib/i18n';

/**
 * Reminders by notification (v2 Phase 5, lib/services/reminders.ts): turn them on or off for this
 * device, send a test, and see the other devices that have them. The subscription comes from the
 * browser's push service; the service worker (public/sw.js) shows what arrives.
 */

interface Device { id: number; device: string; createdAt: string; current: boolean }
interface Settings { available: boolean; publicKey: string | null; devices: Device[] }

/** The public key as the browser wants it */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
    const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const bytes = new Uint8Array(new ArrayBuffer(raw.length));
    for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
    return bytes;
}

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const when = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export function RemindersCard() {
    const toast = useToast();
    const [settings, setSettings] = useState<Settings | null>(null);
    const [endpoint, setEndpoint] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    async function load() {
        let current: string | null = null;
        if (supported()) {
            const registration = await navigator.serviceWorker.getRegistration();
            current = (await registration?.pushManager.getSubscription())?.endpoint ?? null;
        }
        setEndpoint(current);
        const result = await apiGet<Settings>(`/api/reminders${current ? `?endpoint=${encodeURIComponent(current)}` : ''}`);
        if (redirectIfUnauthorized(result) || !result.ok) return;
        setSettings(result.data);
    }

    useEffect(() => {
        load();
        // Once on page load
    }, []);

    async function turnOn() {
        if (!settings?.publicKey) return;
        setBusy(true);
        try {
            if (await Notification.requestPermission() !== 'granted') {
                toast('error', t('reminders.settings.blocked'));
                return;
            }
            const registration = await navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready);
            const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(settings.publicKey) });
            const result = await apiPost('/api/reminders/subscribe', subscription.toJSON());
            if (redirectIfUnauthorized(result)) return;
            if (!result.ok) {
                await subscription.unsubscribe().catch(() => undefined);
                toast('error', apiError(result.data, t('reminders.settings.failed')));
                return;
            }
            toast('success', t('reminders.settings.turnedOn'));
            await load();
        } catch {
            toast('error', t('reminders.settings.failed'));
        } finally {
            setBusy(false);
        }
    }

    async function turnOff(device?: Device) {
        setBusy(true);
        try {
            if (!device || device.current) {
                const registration = await navigator.serviceWorker.getRegistration();
                await (await registration?.pushManager.getSubscription())?.unsubscribe();
            }
            const result = await apiPost('/api/reminders/unsubscribe', device ? { id: device.id } : { endpoint });
            if (redirectIfUnauthorized(result)) return;
            toast('success', t('reminders.settings.turnedOff'));
            await load();
        } finally {
            setBusy(false);
        }
    }

    async function test() {
        const result = await apiPost<{ sent: number }>('/api/reminders/test', {});
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', apiError(result.data, t('reminders.settings.failed')));
        toast('success', t('reminders.settings.tested', { count: result.data.sent }));
    }

    if (!settings) return null;
    const on = settings.devices.some(device => device.current);
    return (
        <FoldingCard id="reminders-section" titleId="reminders-title" icon={BellRing} title={t('reminders.settings.title')}>
            <div className="card-pad stack">
                <p className="form-note">{t('reminders.settings.note')}</p>
                {!settings.available ? <p className="notice" id="reminders-unavailable">{t('reminders.settings.unavailable')}</p>
                    : !supported() ? <p className="notice" id="reminders-unsupported">{t('reminders.settings.unsupported')}</p> : (
                        <>
                            <p id="reminders-status">{on ? t('reminders.settings.on') : t('reminders.settings.off')}</p>
                            <div className="settings-actions">
                                {on ? (
                                    <>
                                        <button type="button" className="btn btn-secondary btn-sm" data-action="testReminder" onClick={test} disabled={busy}>{t('reminders.settings.test')}</button>
                                        <button type="button" className="btn btn-secondary btn-sm" data-action="turnOffReminders" onClick={() => turnOff()} disabled={busy}>{t('reminders.settings.turnOff')}</button>
                                    </>
                                ) : (
                                    <button type="button" className="btn btn-primary btn-sm" data-action="turnOnReminders" onClick={turnOn} disabled={busy}>{t('reminders.settings.turnOn')}</button>
                                )}
                            </div>
                        </>
                    )}
                {settings.devices.length > 0 ? (
                    <>
                        <h4>{t('reminders.settings.devices')}</h4>
                        <ul className="loan-history" id="reminder-devices">
                            {settings.devices.map(device => (
                                <li key={device.id}>
                                    <span>{device.device}{device.current ? ` (${t('reminders.settings.thisDevice')})` : ''} · {t('reminders.settings.deviceLine', { date: when(device.createdAt) })}</span>
                                    <button type="button" className="chip-remove" aria-label={t('reminders.settings.remove')} onClick={() => turnOff(device)}><X aria-hidden="true" /></button>
                                </li>
                            ))}
                        </ul>
                    </>
                ) : null}
            </div>
        </FoldingCard>
    );
}
