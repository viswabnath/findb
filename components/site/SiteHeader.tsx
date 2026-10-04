'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowRight, ChevronDown, Menu, X } from 'lucide-react';
import { FEATURES, GROUPS, STATUS_LABELS } from './content';
import { FeatureIcon } from './FeatureIcon';
import { Logo } from './Logo';

export const NAV_LINKS = [
    { href: '/tools', label: 'Free tools' },
    { href: '/security', label: 'Security' },
    { href: '/roadmap', label: 'Roadmap' },
    { href: '/download', label: 'Get the app' },
];

/** Whether the browser holds the signed-in hint cookie set at login (lib/session.ts) */
function hasSignedInHint(): boolean {
    return document.cookie.split('; ').some(part => part === 'findb_signed_in=1');
}

/**
 * The website's top bar: a Features menu grouped by category, the other links, and the sign-in
 * actions. On phones the links fold into a full-screen menu, and "Start free" moves to a bar fixed
 * to the bottom of the screen. Someone signed in sees "Open FinDB" instead; the pages are static,
 * so that is read from a cookie in the browser after the page loads.
 */
export function SiteHeader() {
    const pathname = usePathname();
    const [signedIn, setSignedIn] = useState(false);
    useEffect(() => setSignedIn(hasSignedInHint()), []);
    const [menuOpen, setMenuOpen] = useState(false);
    const [featuresOpen, setFeaturesOpen] = useState(false);
    const featuresRef = useRef<HTMLDivElement>(null);

    // Close everything on navigation
    useEffect(() => {
        setMenuOpen(false);
        setFeaturesOpen(false);
    }, [pathname]);

    // Escape closes either menu; a click outside closes the Features menu
    useEffect(() => {
        if (!menuOpen && !featuresOpen) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setMenuOpen(false);
                setFeaturesOpen(false);
            }
        };
        const onClick = (event: MouseEvent) => {
            if (featuresRef.current && !featuresRef.current.contains(event.target as Node)) setFeaturesOpen(false);
        };
        document.addEventListener('keydown', onKey);
        document.addEventListener('mousedown', onClick);
        if (menuOpen) document.body.classList.add('menu-open');
        return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('mousedown', onClick);
            document.body.classList.remove('menu-open');
        };
    }, [menuOpen, featuresOpen]);

    const isCurrent = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
    const primary = signedIn
        ? { href: '/setup', label: 'Open FinDB' }
        : { href: '/register', label: 'Start free' };

    return (
        <>
            <header className="site-header">
                <div className="site-header-inner">
                    <Link href="/" className="home-link" aria-label="FinDB home">
                        <Logo />
                    </Link>

                    <nav className="site-nav" aria-label="Main">
                        <div className="nav-item" ref={featuresRef}>
                            <button
                                type="button"
                                className={`nav-trigger${isCurrent('/features') ? ' current' : ''}`}
                                aria-expanded={featuresOpen}
                                aria-controls="features-menu"
                                onClick={() => setFeaturesOpen(value => !value)}
                            >
                                Features <ChevronDown size={16} aria-hidden="true" />
                            </button>
                            {featuresOpen && (
                                <div id="features-menu" className="mega">
                                    {GROUPS.filter(group => group.id !== 'family').map(group => (
                                        <div key={group.id} className="mega-group">
                                            <h3>{group.name}</h3>
                                            {FEATURES.filter(feature => feature.group === group.id || (group.id === 'protect' && feature.group === 'family')).map(feature => (
                                                <Link key={feature.slug} href={`/features/${feature.slug}`}>
                                                    <FeatureIcon name={feature.icon} size={18} tile="sm" />
                                                    <span>
                                                        <b>{feature.name}</b>
                                                        <small>{feature.status === 'available' ? 'Available now' : STATUS_LABELS[feature.status]}</small>
                                                    </span>
                                                </Link>
                                            ))}
                                        </div>
                                    ))}
                                    <div className="mega-foot">
                                        <span className="soon">Every feature page says whether it is available now, in development or planned.</span>
                                        <Link className="text-link" href="/features">All features <ArrowRight size={16} /></Link>
                                    </div>
                                </div>
                            )}
                        </div>
                        {NAV_LINKS.map(link => (
                            <Link key={link.href} href={link.href} aria-current={isCurrent(link.href) ? 'page' : undefined}>
                                {link.label}
                            </Link>
                        ))}
                    </nav>

                    <div className="header-actions">
                        {!signedIn && <a className="btn btn-ghost btn-sm" href="/login">Log in</a>}
                        <a className="btn btn-primary btn-sm" href={primary.href}>{primary.label}</a>
                        <button
                            type="button"
                            className="menu-button"
                            aria-expanded={menuOpen}
                            aria-controls="mobile-menu"
                            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                            onClick={() => setMenuOpen(value => !value)}
                        >
                            {menuOpen ? <X size={22} /> : <Menu size={22} />}
                        </button>
                    </div>
                </div>

                <div id="mobile-menu" className="mobile-menu" hidden={!menuOpen}>
                    <nav aria-label="Main, mobile">
                        {NAV_LINKS.map(link => (
                            <Link key={link.href} href={link.href} aria-current={isCurrent(link.href) ? 'page' : undefined}>
                                {link.label}
                            </Link>
                        ))}
                        <Link href="/faq" aria-current={isCurrent('/faq') ? 'page' : undefined}>Questions</Link>
                        {!signedIn && <a href="/login">Log in</a>}
                        {GROUPS.map(group => (
                            <div key={group.id}>
                                <h3>{group.name}</h3>
                                {FEATURES.filter(feature => feature.group === group.id).map(feature => (
                                    <Link key={feature.slug} href={`/features/${feature.slug}`} aria-current={isCurrent(`/features/${feature.slug}`) ? 'page' : undefined}>
                                        <FeatureIcon name={feature.icon} size={16} tile="sm" />
                                        {feature.name}
                                    </Link>
                                ))}
                            </div>
                        ))}
                    </nav>
                </div>
            </header>

            <div className="bottom-bar">
                {!signedIn && <a className="btn btn-ghost" href="/login">Log in</a>}
                <a className="btn btn-primary" href={primary.href}>{primary.label}</a>
            </div>
        </>
    );
}
