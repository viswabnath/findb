import type { Metadata } from 'next';
import Link from 'next/link';
import { pageMetadata } from '@/components/site/page-metadata';
import {
    ArrowRight, Ban, ChartColumn, CircleCheck, History, KeyRound, LockKeyhole, ServerOff, ShieldCheck, Wallet, Receipt,
} from 'lucide-react';
import { FAQ, FEATURES, GROUPS, TOOLS } from '@/components/site/content';
import { FeatureIcon, ToolIcon } from '@/components/site/FeatureIcon';
import { HeroPhones } from '@/components/site/HeroPhones';
import { ScenarioExplorer } from '@/components/site/ScenarioExplorer';
import { FaqList } from '@/components/site/FaqList';
import { QrCode } from '@/components/site/QrCode';
import { InstallButton } from '@/components/site/InstallButton';
import { StoreBadges } from '@/components/site/StoreBadges';
import { SITE_URL } from '@/lib/site-url';
import { JsonLd, ORGANIZATION } from '@/components/site/JsonLd';

export const metadata: Metadata = pageMetadata({
    description: 'FinDB is a free personal finance app made for India. Track bank accounts, cards, cash, loans, gold and savings in plain words, and use free EMI, FD, RD, SIP and chit fund calculators. No ads; your data is never sold.',
    path: '/',
});

/** What works in the app today, in the words a new user would use */
const TODAY = [
    { icon: Wallet, colour: 'c-income', title: 'All your accounts', text: 'Banks, credit cards and cash with today\'s balance, always up to date.', href: '/features/accounts' },
    { icon: Receipt, colour: 'c-food', title: 'Income and spending', text: 'Add what comes in and goes out. Every balance updates by itself.', href: '/features/spending' },
    { icon: ChartColumn, colour: 'c-bill', title: 'Your month at a glance', text: 'What you earned, spent and saved, and where each account ended.', href: '/features/spending' },
    { icon: History, colour: 'c-loan', title: 'Every change recorded', text: 'An activity log with the old and new value of each change, and CSV export.', href: '/features/accounts' },
];

export default function HomePage() {
    const coming = FEATURES.filter(feature => feature.status !== 'available');
    return (
        <>
            <JsonLd data={{
                '@graph': [
                    ORGANIZATION,
                    { '@type': 'WebSite', '@id': `${SITE_URL}/#website`, name: 'FinDB', url: SITE_URL, inLanguage: 'en-IN', publisher: { '@id': `${SITE_URL}/#organization` } },
                    {
                        '@type': 'WebApplication',
                        name: 'FinDB',
                        url: SITE_URL,
                        applicationCategory: 'FinanceApplication',
                        operatingSystem: 'Any (web browser); installable on Android, iPhone, iPad and computers',
                        description: 'A free personal finance dashboard made for India: bank accounts, cards, cash, income and expenses today, with loans, chit funds, gold, property, savings and tax planned.',
                        offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR' },
                        isAccessibleForFree: true,
                        inLanguage: 'en-IN',
                        publisher: { '@id': `${SITE_URL}/#organization` },
                    },
                ],
            }} />
            <section className="hero">
                <div className="wrap hero-grid">
                    <div className="hero-copy">
                        <span className="eyebrow rise">Free personal finance app for India</span>
                        <h1 className="rise rise-2">Track every rupee your family owns and owes. <span className="accent">Free.</span></h1>
                        <p className="lede rise rise-3">
                            Bank accounts, cards, cash, loans, gold and savings in one place, explained in plain words.
                            No ads, and your data is never sold.
                        </p>
                        <div className="hero-actions rise rise-4">
                            <a className="btn btn-primary btn-lg" href="/register">Start free <ArrowRight size={18} className="go" /></a>
                            <Link className="btn btn-ghost btn-lg" href="/tools/emi-calculator">Try the EMI calculator</Link>
                        </div>
                        <ul className="badges rise rise-5" aria-label="Promises">
                            <li><CircleCheck size={17} />Free for everyone</li>
                            <li><CircleCheck size={17} />No ads, ever</li>
                            <li><CircleCheck size={17} />No bank passwords</li>
                            <li><CircleCheck size={17} />Made in India</li>
                        </ul>
                    </div>
                    <HeroPhones />
                </div>
            </section>

            <section className="section-tight" aria-labelledby="today-title">
                <div className="wrap">
                    <div className="section-head-row">
                        <div className="section-head">
                            <span className="eyebrow">Ready today</span>
                            <h2 id="today-title">Start with the basics in two minutes.</h2>
                        </div>
                        <a className="text-link" href="/register">Create your free account <ArrowRight size={16} /></a>
                    </div>
                    <div className="today-grid">
                        {TODAY.map(item => {
                            const Icon = item.icon;
                            return (
                                <Link key={item.title} href={item.href} className="today-card reveal">
                                    <span className={`icon-tile ${item.colour}`} aria-hidden="true"><Icon size={22} /></span>
                                    <h3>{item.title}</h3>
                                    <p>{item.text}</p>
                                </Link>
                            );
                        })}
                    </div>
                </div>
            </section>

            <section className="section section-alt" aria-labelledby="tools-title">
                <div className="wrap">
                    <div className="section-head-row">
                        <div className="section-head">
                            <span className="eyebrow">Free tools, no sign-up</span>
                            <h2 id="tools-title">Money calculators made for India.</h2>
                            <p className="lede">EMIs, deposits, SIPs, gold and chits. Everything runs in your browser; nothing you type is sent anywhere.</p>
                        </div>
                        <Link className="text-link" href="/tools">All tools <ArrowRight size={16} /></Link>
                    </div>
                    <div className="tool-grid">
                        {TOOLS.map(tool => (
                            <Link key={tool.slug} href={`/tools/${tool.slug}`} className="tool-card reveal">
                                <ToolIcon name={tool.icon} />
                                <h3>{tool.name}</h3>
                                <p>{tool.short}</p>
                                <span className="more">Open <ArrowRight size={15} /></span>
                            </Link>
                        ))}
                    </div>
                </div>
            </section>

            <section className="section" aria-labelledby="explorer-title">
                <div className="wrap">
                    <div className="section-head">
                        <span className="eyebrow">Recorded correctly</span>
                        <h2 id="explorer-title">Every rupee goes somewhere. FinDB shows where.</h2>
                        <p className="lede">
                            Withdrawing cash is not spending. Gold for your family is not spent money. Pick a situation and
                            see how FinDB keeps your numbers right.
                        </p>
                    </div>
                    <div className="reveal">
                        <ScenarioExplorer />
                    </div>
                </div>
            </section>

            <section className="section section-alt" aria-labelledby="soon-title">
                <div className="wrap">
                    <div className="section-head-row">
                        <div className="section-head">
                            <span className="eyebrow">Coming soon</span>
                            <h2 id="soon-title">One place for everything your money touches.</h2>
                            <p className="lede">Statement import, loans and chits, gold, deposits, tax and more are on the way, free for everyone.</p>
                        </div>
                        <Link className="text-link" href="/roadmap">See the roadmap <ArrowRight size={16} /></Link>
                    </div>
                    <div className="soon-groups">
                        {GROUPS.map(group => {
                            const items = coming.filter(feature => feature.group === group.id);
                            if (items.length === 0) return null;
                            return (
                                <div key={group.id} className="soon-group reveal">
                                    <h3>{group.name}</h3>
                                    <ul>
                                        {items.map(feature => (
                                            <li key={feature.slug}>
                                                <Link href={`/features/${feature.slug}`}>
                                                    <FeatureIcon name={feature.icon} size={16} tile="sm" />
                                                    {feature.name}
                                                </Link>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </section>

            <section className="section band" aria-labelledby="privacy-title">
                <div className="wrap">
                    <div className="section-head">
                        <span className="eyebrow">Private by design</span>
                        <h2 id="privacy-title">Your money is personal. FinDB keeps it that way.</h2>
                        <p className="lede">FinDB is free and sells nothing, so it has no reason to look at your data.</p>
                    </div>
                    <div className="trust-grid">
                        <div className="trust-item reveal">
                            <ServerOff size={26} />
                            <h3>No bank passwords</h3>
                            <p>Never asks for net banking passwords, PINs or OTPs, and never moves money.</p>
                        </div>
                        <div className="trust-item reveal">
                            <LockKeyhole size={26} />
                            <h3>Only you see your data</h3>
                            <p>Every request is limited to your own records, and the database blocks everyone else.</p>
                        </div>
                        <div className="trust-item reveal">
                            <KeyRound size={26} />
                            <h3>Two-step login, next</h3>
                            <p>A code from an authenticator app at every login. Free, with no SMS needed.</p>
                        </div>
                        <div className="trust-item reveal">
                            <ShieldCheck size={26} />
                            <h3>Yours to take or delete</h3>
                            <p>Export your data whenever you like, and delete it with your account.</p>
                        </div>
                    </div>
                    <ul className="never" aria-label="What FinDB will never do">
                        <li><Ban size={16} />No ads</li>
                        <li><Ban size={16} />No selling data</li>
                        <li><Ban size={16} />No loan or card offers</li>
                        <li><Ban size={16} />No commissions</li>
                    </ul>
                    <p style={{ marginTop: 26 }}>
                        <Link className="btn btn-on-band" href="/security">How FinDB protects you <ArrowRight size={18} className="go" /></Link>
                    </p>
                </div>
            </section>

            <section className="section" aria-labelledby="app-title">
                <div className="wrap get-app">
                    <div className="section-head" style={{ marginBottom: 0 }}>
                        <span className="eyebrow">Phone, tablet and computer</span>
                        <h2 id="app-title">Install FinDB from your browser.</h2>
                        <p className="lede">
                            No app store needed. Add FinDB to your home screen and it opens like any other app. Apps for
                            iPhone and Android are coming.
                        </p>
                        <div className="hero-actions">
                            <InstallButton />
                            <Link className="btn btn-ghost" href="/download">How to install</Link>
                        </div>
                        <StoreBadges />
                    </div>
                    <div className="qr-card reveal">
                        <QrCode text={SITE_URL} label="QR code to open FinDB on your phone" />
                        <p><b>On a computer?</b> Scan this with your phone camera to open FinDB there, then add it to your home screen.</p>
                    </div>
                </div>
            </section>

            <section className="section-tight" aria-labelledby="faq-title">
                <div className="wrap narrow">
                    <div className="section-head center">
                        <span className="eyebrow">Questions</span>
                        <h2 id="faq-title">Fair questions about a money app.</h2>
                    </div>
                    <FaqList items={FAQ.slice(0, 5)} />
                    <p style={{ marginTop: 22, textAlign: 'center' }}>
                        <Link className="text-link" href="/faq">All questions <ArrowRight size={16} /></Link>
                    </p>
                </div>
            </section>

            <section className="section-tight">
                <div className="wrap">
                    <div className="cta reveal">
                        <h2>See where your money really stands.</h2>
                        <p>Free for everyone. Sign up in a minute; nothing is connected to your bank.</p>
                        <div className="hero-actions">
                            <a className="btn btn-light btn-lg" href="/register">Create your free account <ArrowRight size={18} className="go" /></a>
                            <Link className="btn btn-outline-light btn-lg" href="/tools">Try the free tools</Link>
                        </div>
                    </div>
                </div>
            </section>
        </>
    );
}
