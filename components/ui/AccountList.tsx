import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { formatRupees } from '@/lib/format';

/**
 * Shared pieces of the design system (v2 Phase 1): a list of accounts with the amount on the
 * right, used on Accounts and later on every screen that lists money. Phone first: at 360 px the
 * name and amount share one line and the actions wrap below.
 */

export function AccountList({ id, empty, emptyIcon: EmptyIcon, children }: { id?: string; empty?: string; emptyIcon?: LucideIcon; children: ReactNode[] }) {
    return (
        <div id={id}>
            {children.length === 0 ? (
                <div className="empty">{EmptyIcon ? <EmptyIcon aria-hidden="true" /> : null}<p>{empty}</p></div>
            ) : (
                <ul className="account-list">{children}</ul>
            )}
        </div>
    );
}

interface RowProps {
    icon: LucideIcon;
    /** The icon tile's colour class: t-bank, t-card, t-cash... */
    tile: string;
    name: string;
    /** A second line under the name */
    sub?: ReactNode;
    amount: string | number;
    /** A small line under the amount */
    amountNote?: ReactNode;
    /** A share from 0 to 1, drawn as a thin bar under the name (a card's limit used) */
    meter?: { share: number; label: string };
    actions?: ReactNode;
    data?: Record<`data-${string}`, string | number>;
    /** Extra classes on the row */
    className?: string;
}

export function AccountRow({ icon: Icon, tile, name, sub, amount, amountNote, meter, actions, data, className }: RowProps) {
    const level = meter ? (meter.share > 0.7 ? 'high' : meter.share > 0.3 ? 'warn' : undefined) : undefined;
    return (
        <li className={`account-row${className ? ` ${className}` : ''}`} {...data}>
            <span className={`icon-tile ${tile}`} aria-hidden="true"><Icon /></span>
            <span className="account-main">
                <span className="account-name">{name}</span>
                {sub ? <span className="account-sub">{sub}</span> : null}
                {meter ? (
                    <span className="meter" role="img" aria-label={meter.label}>
                        <i className={level} style={{ width: `${Math.min(meter.share, 1) * 100}%` }} />
                    </span>
                ) : null}
            </span>
            <span className="account-figure">
                <span className="account-amount">{formatRupees(amount)}</span>
                {amountNote ? <span className="account-sub">{amountNote}</span> : null}
            </span>
            {actions ? <span className="row-actions">{actions}</span> : null}
        </li>
    );
}
