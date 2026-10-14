'use client';

import { useEffect, useState } from 'react';
import { SunMoon } from 'lucide-react';
import { t } from '@/lib/i18n';
import { FoldingCard } from '@/components/ui/FoldingCard';
import { parseTheme, themeCookie, THEMES, type Theme } from '@/lib/theme';

/**
 * Light, dark, or the device's setting (lib/theme.ts). The choice is a cookie, so the server
 * renders every later page in it; here it also applies at once.
 */
export function ThemeCard() {
    const [theme, setTheme] = useState<Theme | null>(null);

    useEffect(() => {
        setTheme(parseTheme(document.documentElement.dataset.theme));
    }, []);

    function choose(next: Theme) {
        setTheme(next);
        document.cookie = themeCookie(next, window.location.protocol === 'https:');
        if (next === 'system') delete document.documentElement.dataset.theme;
        else document.documentElement.dataset.theme = next;
    }

    if (theme === null) return null;

    return (
        <FoldingCard id="appearance-section" titleId="appearance-title" icon={SunMoon} title={t('settings.appearance.title')}>
            <div className="card-pad">
                <p className="form-note">{t('settings.appearance.note')}</p>
                <div className="theme-choice" role="radiogroup" aria-labelledby="appearance-title">
                    {THEMES.map(option => (
                        <label key={option}>
                            <input type="radio" name="theme" value={option} data-theme-option={option} checked={theme === option} onChange={() => choose(option)} />
                            {t(`settings.appearance.${option}`)}
                        </label>
                    ))}
                </div>
            </div>
        </FoldingCard>
    );
}
