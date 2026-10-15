/**
 * Loans backed by an asset (v2 plan, Phase 3): what the pledged asset is worth, how much of it the
 * loan takes (loan-to-value), and the margin risk of a gold loan as the gold price moves. Lenders
 * ask for more gold, or part payment, when the loan grows past their limit of the gold's value
 * (RBI caps it at 75% for most gold loans; the user can set their lender's).
 */
import { goldValue, type Karat } from './calculators';

export const KARATS: readonly Karat[] = [24, 22, 18, 14];
/** The loan-to-value limit used when the lender's is not given, % */
export const DEFAULT_LTV_LIMIT = 75;
/** Warn this many points before the limit */
export const NEAR_MARGIN = 5;

export type MarginRisk = 'ok' | 'near' | 'margin';

/** Gold's value in paise from its weight (grams), purity and the 24 karat rate (paise a gram) */
export function goldValuePaise(grams: number, karat: Karat, rate24Paise: number): number {
    return Math.round(goldValue(grams, karat, rate24Paise).value);
}

/**
 * The loan against the asset: owed (with any interest due) as a % of the asset's value, and the
 * risk: 'margin' past the limit, 'near' within NEAR_MARGIN points of it.
 */
export function marginState(owedPaise: number, valuePaise: number, limit = DEFAULT_LTV_LIMIT): { ltv: number; risk: MarginRisk; headroom: number } {
    if (valuePaise <= 0) return { ltv: 0, risk: owedPaise > 0 ? 'margin' : 'ok', headroom: 0 };
    const ltv = Math.round((owedPaise * 10000) / valuePaise) / 100;
    const risk: MarginRisk = ltv > limit ? 'margin' : ltv > limit - NEAR_MARGIN ? 'near' : 'ok';
    // How much the gold's value could fall before the limit is reached
    const headroom = Math.max(valuePaise - Math.ceil((owedPaise * 100) / limit), 0);
    return { ltv, risk, headroom };
}
