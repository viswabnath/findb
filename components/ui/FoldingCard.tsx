'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';

/**
 * A card that folds behind its heading (design system, v2 Phase 1), for long screens such as
 * Settings. On a phone it starts folded, so the screen opens as a short list of headings; on a
 * larger screen it starts open. Rendered on the client only (inside a screen that waits for its
 * data), so the starting state never differs between server and browser.
 */

const PHONE = '(max-width: 640px)';

interface Props {
    id: string;
    titleId: string;
    icon: LucideIcon;
    /** The icon tile's colour class: t-bank, t-wealth... */
    tile?: string;
    title: string;
    meta?: ReactNode;
    metaId?: string;
    children: ReactNode;
}

export function FoldingCard({ id, titleId, icon: Icon, tile = 't-bank', title, meta, metaId, children }: Props) {
    const [open, setOpen] = useState(() => typeof window === 'undefined' || !window.matchMedia(PHONE).matches);
    return (
        <details id={id} className="card fold" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
            <summary className="card-head">
                <h3 id={titleId}><span className={`icon-tile ${tile}`} aria-hidden="true"><Icon /></span>{title}</h3>
                <span className="fold-end">
                    {meta ? <span className="meta" id={metaId}>{meta}</span> : null}
                    <ChevronDown className="fold-chevron" aria-hidden="true" />
                </span>
            </summary>
            {children}
        </details>
    );
}
