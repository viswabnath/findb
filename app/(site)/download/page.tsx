import type { Metadata } from 'next';
import { pageMetadata } from '@/components/site/page-metadata';
import { ArrowRight, Monitor, Smartphone, TabletSmartphone } from 'lucide-react';
import { InstallButton } from '@/components/site/InstallButton';
import { QrCode } from '@/components/site/QrCode';
import { StoreBadges } from '@/components/site/StoreBadges';
import { SITE_URL } from '@/lib/site-url';

export const metadata: Metadata = pageMetadata({
    title: 'Get the app',
    description: 'Use FinDB on your phone, tablet or computer. Install it from your browser and it opens like an app.',
    path: '/download',
});

export default function DownloadPage() {
    return (
        <>
            <section className="page-head">
                <div className="wrap get-app">
                    <div className="section-head" style={{ marginBottom: 0 }}>
                        <span className="eyebrow rise">Get the app</span>
                        <h1 className="rise rise-2">No app store needed. It installs from your browser.</h1>
                        <p className="lede rise rise-3">
                            FinDB runs in your browser on any phone, tablet or computer. Add it to your home screen and it
                            opens full screen like any other app, takes almost no space, and is always up to date.
                        </p>
                        <div className="hero-actions rise rise-4">
                            <InstallButton />
                            <a className="btn btn-ghost" href="/register">Create your free account <ArrowRight size={18} className="go" /></a>
                        </div>
                        <StoreBadges />
                    </div>
                    <div className="qr-card rise rise-4">
                        <QrCode text={SITE_URL} label="QR code to open FinDB on your phone" />
                        <p><b>On a computer?</b> Scan this with your phone camera to open FinDB on your phone, then follow the steps below.</p>
                    </div>
                </div>
            </section>

            <section className="section-tight" aria-labelledby="install-title">
                <div className="wrap">
                    <div className="section-head">
                        <h2 id="install-title">Add FinDB to your home screen</h2>
                        <p className="lede">Open FinDB in your browser first, then follow the steps for your device.</p>
                    </div>
                    <div className="platforms">
                        <div className="platform reveal">
                            <span className="icon-tile c-income" aria-hidden="true"><Smartphone size={24} /></span>
                            <h3>Android phone or tablet</h3>
                            <ol>
                                <li><span>Open FinDB in <b>Chrome</b>.</span></li>
                                <li><span>Tap the <b>menu</b> (three dots, top right).</span></li>
                                <li><span>Tap <b>Install app</b> or <b>Add to Home screen</b>.</span></li>
                                <li><span>Confirm. FinDB appears with your other apps.</span></li>
                            </ol>
                        </div>
                        <div className="platform reveal">
                            <span className="icon-tile c-bill" aria-hidden="true"><TabletSmartphone size={24} /></span>
                            <h3>iPhone or iPad</h3>
                            <ol>
                                <li><span>Open FinDB in <b>Safari</b>.</span></li>
                                <li><span>Tap the <b>Share</b> button (a square with an arrow).</span></li>
                                <li><span>Scroll down and tap <b>Add to Home Screen</b>.</span></li>
                                <li><span>Tap <b>Add</b>. FinDB appears on your home screen.</span></li>
                            </ol>
                        </div>
                        <div className="platform reveal">
                            <span className="icon-tile c-loan" aria-hidden="true"><Monitor size={24} /></span>
                            <h3>Windows, Mac or Linux</h3>
                            <ol>
                                <li><span>Open FinDB in <b>Chrome</b> or <b>Edge</b>.</span></li>
                                <li><span>Click the <b>install</b> icon at the right end of the address bar.</span></li>
                                <li><span>Click <b>Install</b>. FinDB opens in its own window.</span></li>
                            </ol>
                        </div>
                    </div>
                </div>
            </section>

            <section className="section-tight">
                <div className="wrap split">
                    <div className="panel coming reveal">
                        <h2>Coming at launch</h2>
                        <ul>
                            <li><ArrowRight size={18} /><span>Add entries with no signal; they sync when you are back online</span></li>
                            <li><ArrowRight size={18} /><span>Reminders as phone notifications</span></li>
                            <li><ArrowRight size={18} /><span>Share a bank SMS, receipt photo or UPI screenshot straight into FinDB</span></li>
                            <li><ArrowRight size={18} /><span>Apps for iPhone and Android, with the same account</span></li>
                        </ul>
                    </div>
                    <div className="panel reveal">
                        <h2>Works on</h2>
                        <ul>
                            <li><ArrowRight size={18} /><span>Chrome or Edge, version 111 or later, on Android, Windows, Mac and Linux</span></li>
                            <li><ArrowRight size={18} /><span>Safari 16.4 or later on iPhone, iPad and Mac</span></li>
                            <li><ArrowRight size={18} /><span>Firefox 111 or later</span></li>
                        </ul>
                    </div>
                </div>
            </section>
        </>
    );
}
