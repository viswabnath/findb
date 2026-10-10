'use client';

import { useEffect, type ReactNode } from 'react';
import { t } from '@/lib/i18n';

interface ModalProps {
    id: string;
    title: string;
    open: boolean;
    /** data-action of the close (x) button, kept from the former app's markup */
    closeAction: string;
    onClose: () => void;
    footer: ReactNode;
    small?: boolean;
    children: ReactNode;
}

/** A dialog over the page: closes with the x button, a click outside it, or Escape */
export function Modal({ id, title, open, closeAction, onClose, footer, small, children }: ModalProps) {
    useEffect(() => {
        if (!open) return;
        const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        document.body.classList.add('no-scroll');
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.classList.remove('no-scroll');
        };
    }, [open, onClose]);

    return (
        <div
            id={id}
            className={`modal-overlay${open ? '' : ' hidden'}`}
            onClick={event => { if (event.target === event.currentTarget) onClose(); }}
        >
            <div className={`modal-content${small ? ' modal-small' : ''}`} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
                <div className="modal-header">
                    <h3 id={`${id}-title`}>{title}</h3>
                    <button type="button" className="modal-close" data-action={closeAction} aria-label={t('shell.close')} onClick={onClose}>&times;</button>
                </div>
                <div className="modal-body">{children}</div>
                <div className="modal-footer">{footer}</div>
            </div>
        </div>
    );
}
