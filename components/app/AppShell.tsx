'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { ArrowLeftRight, CalendarHeart, ChartColumn, History, LogOut, Settings, Wallet, type LucideIcon } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { t } from '@/lib/i18n';
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
    { section: 'setup', label: t('nav.accounts'), icon: Wallet, href: '/setup' },
    { section: 'transactions', label: t('nav.transactions'), icon: ArrowLeftRight, href: '/transactions' },
    { section: 'summary', label: t('nav.summary'), icon: ChartColumn, href: '/summary' },
    { section: 'events', label: t('nav.events'), icon: CalendarHeart, href: '/events' },
    { section: 'activity', label: t('nav.activity'), icon: History, href: '/activity' },
    { section: 'settings', label: t('nav.settings'), icon: Settings, href: '/settings' },
];
// Phones: five tabs fit at 360 px with whole labels; Settings is in the top bar instead
const TAB_ITEMS = NAV_ITEMS.filter(item => item.section !== 'settings');

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
                <nav id="nav-bar" aria-label={t('shell.main')}>
                    <a href="/setup" className="sidebar-brand" aria-label={t('shell.brand')}><Logo /></a>
                    <span className="sidebar-label">{t('shell.yourMoney')}</span>
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
                            <span>{name}<small>{t('shell.signedIn')}</small></span>
                        </div>
                    ) : null}
                    <a href="#" className="nav-link logout-link" data-action="logout" onClick={openLogout}>
                        <LogOut aria-hidden="true" />{t('shell.logOut')}
                    </a>
                </nav>

                <div className="app-main">
                    <header className="app-topbar">
                        <a href="/setup" aria-label={t('shell.brand')}><Logo /></a>
                        <span className="topbar-actions">
                            <a href="/settings" className="btn btn-secondary btn-sm" data-section="settings" aria-current={pathname === '/settings' ? 'page' : undefined}
                                aria-label={t('nav.settings')}>
                                <Settings aria-hidden="true" />
                            </a>
                            <button type="button" className="btn btn-secondary btn-sm logout-link" data-action="logout" onClick={openLogout}>
                                <LogOut aria-hidden="true" /> {t('shell.logOut')}
                            </button>
                        </span>
                    </header>

                    <main className="app-content">
                        {!consentVersion && sample ? (
                            <div id="sample-banner" className="notice warn sample-banner" role="status">
                                <span><b>{t('shell.sample')}</b> {t('shell.sampleText')}</span>
                                <button type="button" className="btn btn-secondary btn-sm" data-action="clearSample" onClick={clearSample}>{t('shell.clearSample')}</button>
                            </div>
                        ) : null}
                        {!consentVersion && dueNotice && (dueNotice.posted > 0 || dueNotice.pending > 0) && pathname !== '/transactions' ? (
                            <div id="repeating-notice" className="notice" role="status">
                                {dueNotice.posted > 0 ? t('shell.recorded', { count: dueNotice.posted }) : ''}
                                {dueNotice.pending > 0 ? <><a href="/transactions#repeating-section">{t('shell.toConfirm', { count: dueNotice.pending })}</a>{t('shell.onTransactions')}</> : null}
                            </div>
                        ) : null}
                        {consentVersion
                            ? <ConsentScreen noticeVersion={consentVersion} onAgreed={() => window.location.reload()} onLogout={logout} />
                            : children}
                    </main>

                    <footer className="app-footer">
                        <nav aria-label={t('shell.footer.label')}>
                            <a href="/">{t('shell.footer.home')}</a>
                            <a href="/tools">{t('shell.footer.tools')}</a>
                            <a href="/security">{t('shell.footer.security')}</a>
                            <a href="/privacy">{t('shell.footer.privacy')}</a>
                            <a href="/terms">{t('shell.footer.terms')}</a>
                        </nav>
                        <span>{t('shell.notAdvice')}</span>
                    </footer>
                </div>

                <nav className="tabbar" aria-label={t('shell.mainMobile')}>
                    {TAB_ITEMS.map(({ section, label, icon: Icon, href }) => (
                        <a key={section} href={href} data-section={section} aria-current={pathname === href ? 'page' : undefined}>
                            <Icon aria-hidden="true" />{label}
                        </a>
                    ))}
                </nav>
            </div>

            <Modal
                id="logout-confirmation-modal"
                title={t('shell.logoutTitle')}
                open={logoutOpen}
                small
                closeAction="close-logout-confirmation"
                onClose={() => setLogoutOpen(false)}
                footer={(
                    <>
                        <button type="button" data-action="close-logout-confirmation" className="btn btn-secondary" onClick={() => setLogoutOpen(false)}>
                            {t('common.cancel')}
                        </button>
                        <button type="button" data-action="confirm-logout" className="btn btn-primary" onClick={logout}>
                            <LogOut aria-hidden="true" /> {t('shell.logOut')}
                        </button>
                    </>
                )}
            >
                <p id="logout-confirmation-message">{t('shell.logoutText')}</p>
            </Modal>

            <div id="global-loader" className={`loader-overlay${busy ? '' : ' hidden'}`} role="progressbar" aria-label={t('shell.loading')} aria-hidden={!busy} />
        </>
    );
}
