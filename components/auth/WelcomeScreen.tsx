'use client';

import { useEffect, useState } from 'react';
import { ChevronRight, Layers, PiggyBank, SlidersHorizontal, TrendingDown, type LucideIcon } from 'lucide-react';
import { AuthButton } from './AuthShell';
import { HydrationGate } from '@/components/HydrationGate';
import { useToast } from '@/components/Toast';
import { apiError, apiGet, apiPut } from '@/lib/api-client';
import { MODULES, PRESETS } from '@/lib/modules';
import { t } from '@/lib/i18n';

const PRESET_LOOK: Record<string, { icon: LucideIcon; tile: string; recommended?: boolean }> = {
    spending: { icon: TrendingDown, tile: 't-expense' },
    savings: { icon: PiggyBank, tile: 't-income', recommended: true },
    everything: { icon: Layers, tile: 't-bank' },
};

/**
 * Shown right after registration: the user picks what to track (a preset or their own mix of
 * modules, lib/modules.ts), then continues to the app. Settings can change it later.
 */
export function WelcomeScreen() {
    const toast = useToast();
    const [name, setName] = useState('');
    const [custom, setCustom] = useState(false);
    const [chosen, setChosen] = useState<string[]>(['income', 'spending']);

    useEffect(() => {
        apiGet<{ name?: string }>('/api/user').then(result => {
            if (!result.ok) {
                // Not logged in: the welcome step only makes sense right after registering
                window.location.replace('/login');
                return;
            }
            setName(result.data.name ?? '');
        });
    }, []);

    async function save(modules: string[]) {
        const result = await apiPut('/api/modules', { modules });
        if (result.ok) {
            window.location.assign('/setup');
        } else {
            toast('error', apiError(result.data, t('auth.welcome.failed')));
        }
    }

    function toggle(key: string, on: boolean) {
        setChosen(value => on ? [...value, key] : value.filter(item => item !== key));
    }

    return (
        <div id="welcome-section" className="auth-card">
            <div className="auth-head">
                <span className="auth-step">{t('auth.welcome.created')}</span>
                <h1>{t('auth.welcome.title')}{name ? <>, <span id="user-name">{name}</span></> : null}</h1>
                <p>{t('auth.welcome.lead')}</p>
            </div>
            <HydrationGate>
                {custom ? (
                    <form id="welcome-custom" className="module-choices" onSubmit={event => { event.preventDefault(); save(chosen); }}>
                        {MODULES.map(module => (
                            <label key={module.key} className="module-choice">
                                <input type="checkbox" data-module={module.key} checked={chosen.includes(module.key)}
                                    onChange={event => toggle(module.key, event.target.checked)} />
                                <span>
                                    <b>{module.name}{module.available ? null : <span className="tag">{t('auth.welcome.comingSoon')}</span>}</b>
                                    <small>{module.line}</small>
                                </span>
                            </label>
                        ))}
                        <div className="module-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setCustom(false)}>{t('auth.welcome.back')}</button>
                            <button type="submit" className="btn btn-primary" data-action="saveModules">{t('auth.welcome.continue')}</button>
                        </div>
                    </form>
                ) : (
                    <div className="choice-list">
                        {PRESETS.map(preset => {
                            const look = PRESET_LOOK[preset.key] ?? { icon: Layers, tile: 't-bank' };
                            const Icon = look.icon;
                            return (
                                <AuthButton
                                    key={preset.key}
                                    action="choosePreset"
                                    data-preset={preset.key}
                                    className={`choice${look.recommended ? ' recommended' : ''}`}
                                    onClick={() => save(preset.modules)}
                                >
                                    <span className={`icon-tile ${look.tile}`} aria-hidden="true"><Icon /></span>
                                    <span>
                                        <b>{preset.name}{look.recommended ? <span className="tag">{t('auth.welcome.recommended')}</span> : null}</b>
                                        <small>{preset.line}</small>
                                    </span>
                                    <ChevronRight className="chev" aria-hidden="true" />
                                </AuthButton>
                            );
                        })}
                        <AuthButton action="chooseOwn" className="choice" onClick={() => setCustom(true)}>
                            <span className="icon-tile t-wealth" aria-hidden="true"><SlidersHorizontal /></span>
                            <span>
                                <b>{t('auth.welcome.own')}</b>
                                <small>{t('auth.welcome.ownLine')}</small>
                            </span>
                            <ChevronRight className="chev" aria-hidden="true" />
                        </AuthButton>
                    </div>
                )}
            </HydrationGate>
        </div>
    );
}
