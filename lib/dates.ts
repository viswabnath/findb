/**
 * Date helpers for the ported screens. They reproduce the legacy app's behaviour exactly,
 * including its quirks (noted below), so the migration changes nothing users see.
 */

/**
 * Today as YYYY-MM-DD for the date inputs' default. Legacy quirk kept: this is the UTC date,
 * so between midnight and 05:30 IST it is still yesterday.
 */
export function todayUtcIso(now: Date = new Date()): string {
    return now.toISOString().slice(0, 10);
}

/** An API date (ISO timestamp or YYYY-MM-DD) as YYYY-MM-DD in local time, for an <input type="date"> */
export function toDateInputValue(value: string): string {
    const date = new Date(value);
    const valid = Number.isNaN(date.getTime()) ? new Date() : date;
    const month = String(valid.getMonth() + 1).padStart(2, '0');
    const day = String(valid.getDate()).padStart(2, '0');
    return `${valid.getFullYear()}-${month}-${day}`;
}

export const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

/** Years offered by the month filters: 2020 to next year */
export function filterYears(now: Date = new Date()): number[] {
    const years: number[] = [];
    for (let year = 2020; year <= now.getFullYear() + 1; year++) years.push(year);
    return years;
}

/** Today in India as YYYY-MM-DD, wherever the device is and at any hour (entries are dated in India's time) */
export function todayInIndiaClient(now: Date = new Date()): string {
    return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}
