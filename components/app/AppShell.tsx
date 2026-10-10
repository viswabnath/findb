'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { ArrowLeftRight, CalendarHeart, ChartColumn, History, LogOut, Settings, Wallet, type LucideIcon } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { ConsentScreen } from '@/components/privacy/ConsentScreen';
import { Logo } from '@/components/site/Logo';
import { apiDelete, apiGet, apiPost, onActiveRequestsChange } from '@/lib/api-client';

interface NavItem {
    section: string;
    label: string;
    icon: LucideIcon;
    href: string;
}

/**
 * Every screen is a Next.js page. Links are full page loads so each screen fetches fresh data.
 * The section names and data-action hooks are the former app's (the end-to-end tests use them).
 */
const NAV_ITEMS: NavItem[] = [
    { section: 'setup', label: 'Accounts', icon: Wallet, href: '/setup' },
    { section: 'transactions', label: 'Transactions', icon: ArrowLeftRight, href: '/transactions' },
    { section: 'summary', label: 'Summary', icon: ChartColumn, href: '/summary' },
    { section: 'events', label: 'Events', icon: CalendarHeart, href: '/events' },
    { section: 'activity', label: 'Activity', icon: History, href: '/activity' },
    { section: 'settings', label: 'Settings', icon: Settings, href: '/settings' },
];

/**
 * The logged-in frame: a sidebar on larger screens, a top bar and a bottom tab bar on phones,
 * the logout confirmation, and a thin progress bar while requests run.
 */
export function AppShell({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const [logoutOpen, setLogoutOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [name, setName] = useState('');

    // Set when the account has not agreed to the current privacy notice: the app waits for consent
    const [consentVersion, setConsentVersion] = useState<string | null>(null);
    const [dueNotice, setDueNotice] = useState<{ posted: number; pending: number } | null>(null);
    // Sample data is loaded (lib/services/sample-data.ts): marked on every screen until cleared
    const [sample, setSample] = useState(false);

    useEffect(() => {
        apiGet<{ name?: string; consentNeeded?: boolean; noticeVersion?: string; sampleData?: boolean }>('/api/user').then(result => {
            if (!result.ok) return;
            setName(result.data.name ?? '');
            setSample(result.data.sampleData === true);
            if (result.data.consentNeeded && result.data.noticeVersion) {
                setConsentVersion(result.data.noticeVersion);
                return;
            }
            // Record the automatic repeating entries that fell due, and say what waits to be confirmed
            apiPost<{ posted?: number; pending?: unknown[] }>('/api/recurring/run', {}).then(due => {
                if (!due.ok) return;
                setDueNotice({ posted: due.data.posted ?? 0, pending: due.data.pending?.length ?? 0 });
            });
        });
    }, []);

    // Show the progress bar while requests run, and hide it shortly after the last one
    useEffect(() => {
        let hideTimer: ReturnType<typeof setTimeout> | undefined;
        return onActiveRequestsChange(active => {
            clearTimeout(hideTimer);
            if (active > 0) setBusy(true);
            else hideTimer = setTimeout(() => setBusy(false), 100);
        });
    }, []);

    async function logout() {
        // Go to login even if the request fails
        await apiPost('/api/logout', {}).catch(() => undefined);
        window.location.assign('/login');
    }

    const openLogout = (event: React.MouseEvent) => {
        event.preventDefault();
        setLogoutOpen(true);
    };

    async function clearSample() {
        const result = await apiDelete('/api/sample-data');
        if (result.ok) window.location.assign('/setup');
    }

    const firstName = name.trim().split(/\s+/)[0] ?? '';

    return (
        <>
            <div id="main-app">
                <nav id="nav-bar" aria-label="Main">
                    <a href="/setup" className="sidebar-brand" aria-label="FinDB, accounts"><Logo /></a>
                    <span className="sidebar-label">Your money</span>
                    {NAV_ITEMS.map(({ section, label, icon: Icon, href }) => (
                        <a key={section} href={href} className="nav-link" data-action="showSection" data-section={section}
                            aria-current={pathname === href ? 'page' : undefined}>
                            <Icon aria-hidden="true" />{label}
                        </a>
                    ))}
                    <span className="sidebar-spacer" />
                    {name ? (
                        <div className="sidebar-user">
                            <span className="avatar" aria-hidden="true">{firstName.charAt(0).toUpperCase()}</span>
                            <span>{name}<small>Signed in</small></span>
                        </div>
                    ) : null}
                    <a href="#" className="nav-link logout-link" data-action="logout" onClick={openLogout}>
                        <LogOut aria-hidden="true" />Log out
                    </a>
                </nav>

                <div className="app-main">
                    <header className="app-topbar">
                        <a href="/setup" aria-label="FinDB, accounts"><Logo /></a>
                        <button type="button" className="btn btn-secondary btn-sm logout-link" data-action="logout" onClick={openLogout}>
                            <LogOut aria-hidden="true" /> Log out
                        </button>
                    </header>

                    <main className="app-content">
                        {!consentVersion && sample ? (
                            <div id="sample-banner" className="notice warn sample-banner" role="status">
                                <span><b>Sample data.</b> You are looking at a sample family&apos;s money, not your own. Nothing here is real.</span>
                                <button type="button" className="btn btn-secondary btn-sm" data-action="clearSample" onClick={clearSample}>Clear sample data</button>
                            </div>
                        ) : null}
                        {!consentVersion && dueNotice && (dueNotice.posted > 0 || dueNotice.pending > 0) && pathname !== '/transactions' ? (
                            <div id="repeating-notice" className="notice" role="status">
                                {dueNotice.posted > 0 ? `${dueNotice.posted} repeating ${dueNotice.posted === 1 ? 'entry was' : 'entries were'} recorded. ` : ''}
                                {dueNotice.pending > 0 ? <><a href="/transactions#repeating-section">{dueNotice.pending} to confirm</a> on Transactions.</> : null}
                            </div>
                        ) : null}
                        {consentVersion
                            ? <ConsentScreen noticeVersion={consentVersion} onAgreed={() => window.location.reload()} onLogout={logout} />
                            : children}
                    </main>

                    <footer className="app-footer">
                        <nav aria-label="FinDB">
                            <a href="/">FinDB home</a>
                            <a href="/tools">Free tools</a>
                            <a href="/security">Security</a>
                            <a href="/privacy">Privacy</a>
                            <a href="/terms">Terms</a>
                        </nav>
                        <span>Information, not financial advice.</span>
                    </footer>
                </div>

                <nav className="tabbar" aria-label="Main, mobile">
                    {NAV_ITEMS.map(({ section, label, icon: Icon, href }) => (
                        <a key={section} href={href} data-section={section} aria-current={pathname === href ? 'page' : undefined}>
                            <Icon aria-hidden="true" />{label}
                        </a>
                    ))}
                </nav>
            </div>

            <Modal
                id="logout-confirmation-modal"
                title="Log out of FinDB?"
                open={logoutOpen}
                small
                closeAction="close-logout-confirmation"
                onClose={() => setLogoutOpen(false)}
                footer={(
                    <>
                        <button type="button" data-action="close-logout-confirmation" className="btn btn-secondary" onClick={() => setLogoutOpen(false)}>
                            Cancel
                        </button>
                        <button type="button" data-action="confirm-logout" className="btn btn-primary" onClick={logout}>
                            <LogOut aria-hidden="true" /> Log out
                        </button>
                    </>
                )}
            >
                <p id="logout-confirmation-message">You will need to log in again to see your accounts.</p>
            </Modal>

            <div id="global-loader" className={`loader-overlay${busy ? '' : ' hidden'}`} role="progressbar" aria-label="Loading" aria-hidden={!busy} />
        </>
    );
}
