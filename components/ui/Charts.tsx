'use client';

import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatRupees } from '@/lib/format';

/**
 * Charts (design system, v2 Phase 1), drawn as SVG by Recharts. Colours come from CSS tokens
 * (--chart-in, --chart-out in app.css, checked for colour blindness in light and dark), applied by
 * class so a theme change repaints them. Bars carry their value as text and a hover tooltip, and
 * every chart sits next to a list of the same numbers, so nothing depends on colour alone.
 */

export interface ChartRow { label: string; amount: number; tone?: 'in' | 'out' }

const compact = (value: number) => {
    const abs = Math.abs(value);
    if (abs >= 1e7) return `₹${(value / 1e7).toFixed(1)} Cr`;
    if (abs >= 1e5) return `₹${(value / 1e5).toFixed(1)} L`;
    if (abs >= 1e3) return `₹${(value / 1e3).toFixed(1)}k`;
    return `₹${Math.round(value)}`;
};

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartRow }[] }) {
    const row = payload?.[0]?.payload;
    if (!active || !row) return null;
    return (
        <div className="chart-tooltip">
            <span>{row.label}</span>
            <b>{formatRupees(row.amount)}</b>
        </div>
    );
}

/** Horizontal bars, largest first as given; one row per item. `label` names the chart for screen readers. */
export function BarList({ rows, label, labelWidth = 120 }: { rows: ChartRow[]; label: string; labelWidth?: number }) {
    const height = rows.length * 38 + 12;
    return (
        <div className="chart" role="img" aria-label={label}>
            <ResponsiveContainer width="100%" height={height}>
                <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 64, bottom: 4, left: 4 }} barCategoryGap={10}>
                    <XAxis type="number" hide domain={[0, 'dataMax']} />
                    <YAxis type="category" dataKey="label" width={labelWidth} tickLine={false} axisLine={false}
                        tick={{ fill: 'currentColor', fontSize: 13 }} interval={0} />
                    <Tooltip content={<ChartTooltip />} cursor={{ className: 'chart-cursor' }} isAnimationActive={false} />
                    <Bar dataKey="amount" radius={[0, 4, 4, 0]} isAnimationActive={false} shape={props => {
                        const { x, y, width, height: barHeight, payload } = props as { x: number; y: number; width: number; height: number; payload: ChartRow };
                        const radius = Math.min(4, width);
                        return (
                            <path className={`chart-bar ${payload.tone ?? 'out'}`}
                                d={`M${x},${y} h${Math.max(width - radius, 0)} a${radius},${radius} 0 0 1 ${radius},${radius} v${Math.max(barHeight - 2 * radius, 0)} a${radius},${radius} 0 0 1 -${radius},${radius} h-${Math.max(width - radius, 0)} Z`} />
                        );
                    }}>
                        <LabelList dataKey="amount" position="right" className="chart-value" formatter={value => compact(Number(value))} />
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}
