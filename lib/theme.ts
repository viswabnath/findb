/**
 * The app's light or dark look (design system, v2 Phase 1). "system" follows the device; light
 * and dark are the user's choice in Settings, kept in a cookie so the server renders the page in
 * that theme from the first paint (no inline script is allowed under the CSP).
 */

export const THEME_COOKIE = 'findb_theme';
export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = typeof THEMES[number];

export function parseTheme(value: string | undefined | null): Theme {
    return value === 'light' || value === 'dark' ? value : 'system';
}

/** The cookie that keeps a choice for a year ("system" removes it) */
export function themeCookie(theme: Theme, secure: boolean): string {
    const base = `${THEME_COOKIE}=${theme}; Path=/; SameSite=Lax${secure ? '; Secure' : ''}`;
    return theme === 'system' ? `${THEME_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure ? '; Secure' : ''}` : `${base}; Max-Age=31536000`;
}
