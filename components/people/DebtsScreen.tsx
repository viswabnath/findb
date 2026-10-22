'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Gauge, TriangleAlert } from 'lucide-react';
import { simulatePayoff, type Debt, type DebtKind, type PayoffPlan } from '@/src/core/debts';
import { addMonths } from '@/src/core/loans';
import { apiGet, redirectIfUnauthorized } from '@/lib/api-client';
import { todayInIndiaClient } from '@/lib/dates';
import { formatRupees } from '@/lib/format';
import { t } from '@/lib/i18n';

/**
 * Debt review (/api/debts, v2 Phase 3): every debt ranked by its true yearly cost with what kind of
 * debt it is, the EMI-to-income ratio, the warnings, and a payoff simulator comparing highest-rate-first
 * with smallest-balance-first for an extra amount each month (worked out here, in src/core/debts.ts).
 */

interface DebtLine { key: string; name: string; kind: DebtKind; balance: string; yearlyRate: number; monthly: string; assumedRate: boolean; dangerous: boolean; href: string }
interface Review {
    debts: DebtLine[]; total: string; dangerousTotal: string; monthlyPayments: string; monthlyIncome: string | null; emiRatio: number | null;
    warnings: { kind: string; level: 'warn' | 'danger'; text: string; href: string }[];
    limits: { emiHigh: number; emiDanger: number; dangerousRate: number };
}

const paise = (rupees: string) => Math.round((parseFloat(rupees) || 0) * 100);
const rupees = (amount: number) => formatRupees(amount / 100);
const monthYear = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });

function PlanCard({ id, title, note, plan, names, debts }: { id: string; title: string; note: string; plan: PayoffPlan; names: Map<string, string>; debts: number }) {
    return (
        <div className="card card-pad debt-plan" id={id}>
            <span className="label">{title}</span>
            <span className="form-note">{note}</span>
            {plan.clears ? (
                <>
                    <b className="debt-free">{t('debts.simulator.free', { date: monthYear(addMonths(todayInIndiaClient(), plan.months)) })}</b>
                    <span>{t('debts.simulator.months', { count: plan.months })} · {t('debts.simulator.interest', { amount: rupees(plan.totalInterest) })}</span>
                </>
            ) : <span className="notice warn">{t('debts.simulator.never')}</span>}
            {debts > 1 ? <span className="when">{t('debts.simulator.firstOrder', { names: plan.order.map(key => names.get(key)).join(', ') })}</span> : null}
        </div>
    );
}

export function DebtsScreen() {
    const [review, setReview] = useState<Review | null>(null);
    const [extra, setExtra] = useState('');

    useEffect(() => {
        apiGet<Review>('/api/debts').then(result => {
            if (redirectIfUnauthorized(result) || !result.ok) return;
            setReview(result.data);
        });
        // Once on page load
    }, []);

    if (!review) return null;
    const debts: Debt[] = review.debts.map(debt => ({ key: debt.key, name: debt.name, kind: debt.kind, balance: paise(debt.balance), yearlyRate: debt.yearlyRate, monthly: paise(debt.monthly) }));
    const extraPaise = Math.max(paise(extra), 0);
    const highest = simulatePayoff(debts, extraPaise, 'highest_rate');
    const smallest = simulatePayoff(debts, extraPaise, 'smallest_balance');
    const names = new Map(review.debts.map(debt => [debt.key, debt.name]));
    const saved = smallest.totalInterest - highest.totalInterest;
    const ratioClass = review.emiRatio === null ? '' : review.emiRatio > review.limits.emiDanger ? ' danger' : review.emiRatio > review.limits.emiHigh ? ' warn' : '';

    return (
        <div id="debts-section">
            <div className="page-header">
                <div>
                    <h2>{t('debts.title')}</h2>
                    <p>{t('debts.subtitle')}</p>
                </div>
            </div>

            <div className="people-totals debt-totals">
                <div className="card card-pad" id="debts-total"><span className="label">{t('debts.total')}</span><b className="amount">{formatRupees(review.total)}</b>
                    <span className="when">{t('debts.dangerous', { rate: review.limits.dangerousRate })}: {formatRupees(review.dangerousTotal)}</span></div>
                <div className="card card-pad" id="debts-ratio"><span className="label">{t('debts.ratio')}</span>
                    <b className={`amount${ratioClass}`}>{review.emiRatio === null ? '-' : `${review.emiRatio}%`}</b>
                    <span className="when">{review.emiRatio === null ? t('debts.ratioNone') : `${t('debts.monthly')}: ${formatRupees(review.monthlyPayments)}`}</span></div>
            </div>
            <p className="form-note debt-note">{t('debts.ratioNote', { high: review.limits.emiHigh, danger: review.limits.emiDanger })}</p>

            {review.warnings.length > 0 ? (
                <section className="card" id="debt-warnings" aria-labelledby="debt-warnings-title">
                    <div className="card-head"><h3 id="debt-warnings-title"><span className="icon-tile t-expense" aria-hidden="true"><TriangleAlert /></span>{t('debts.warningsTitle')}</h3></div>
                    <ul className="debt-warnings">
                        {review.warnings.map((warning, index) => (
                            <li key={index} className={`notice ${warning.level}`} data-warning={warning.kind}>
                                <span>{warning.text}</span> <Link href={warning.href} className="btn-link">{t('debts.open')}</Link>
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}

            {review.debts.length === 0 ? <p className="card card-pad empty-note" id="debts-empty">{t('debts.none')}</p> : (
                <>
                    <section className="card" aria-labelledby="debt-rank-title">
                        <div className="card-head"><h3 id="debt-rank-title"><span className="icon-tile t-wealth" aria-hidden="true"><Gauge /></span>{t('debts.rankTitle')}</h3></div>
                        <p className="form-note card-pad debt-note">{t('debts.rankNote')}</p>
                        <ol className="debt-rank" id="debt-rank">
                            {review.debts.map(debt => (
                                <li key={debt.key} data-debt={debt.name}>
                                    <div className="debt-line">
                                        <span className="what">{debt.name}{debt.dangerous ? <span className="tag status-overdue">{t('debts.costly')}</span> : null}</span>
                                        <b className="amount">{formatRupees(debt.balance)}</b>
                                    </div>
                                    <span className="when debt-rate">
                                        {t(`debts.kinds.${debt.kind}`)} · {t('debts.rate', { rate: debt.yearlyRate })}{debt.assumedRate ? ` (${t('debts.assumed')})` : ''} · {parseFloat(debt.monthly) > 0 ? t('debts.perMonth', { amount: formatRupees(debt.monthly) }) : t('debts.noPayment')}
                                    </span>
                                    <span className="form-note">{t(`debts.explain.${debt.kind}`)}</span>
                                </li>
                            ))}
                        </ol>
                    </section>

                    <section className="card card-pad debt-simulator" aria-labelledby="debt-sim-title">
                        <h3 id="debt-sim-title">{t('debts.simulator.title')}</h3>
                        <p className="form-note">{t('debts.simulator.note')}</p>
                        <div className="field">
                            <label htmlFor="debt-extra">{t('debts.simulator.extra')}</label>
                            <input id="debt-extra" type="number" inputMode="decimal" min="0" step="100" value={extra} onChange={event => setExtra(event.target.value)} />
                        </div>
                        <div className="debt-plans">
                            <PlanCard id="plan-highest" title={t('debts.simulator.highest')} note={t('debts.simulator.highestNote')} plan={highest} names={names} debts={debts.length} />
                            <PlanCard id="plan-smallest" title={t('debts.simulator.smallest')} note={t('debts.simulator.smallestNote')} plan={smallest} names={names} debts={debts.length} />
                        </div>
                        {highest.clears && smallest.clears ? (
                            <p className="debt-saved" id="debt-saved">{saved > 0 ? t('debts.simulator.saves', { amount: rupees(saved) }) : t('debts.simulator.same')}</p>
                        ) : null}
                    </section>
                </>
            )}
        </div>
    );
}
