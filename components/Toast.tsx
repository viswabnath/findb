'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle, Info } from 'lucide-react';
import { t } from '@/lib/i18n';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
    id: number;
    type: ToastType;
    message: string;
    visible: boolean;
}

const ICONS = {
    success: <CheckCircle className="icon-success" />,
    error: <AlertCircle className="icon-error" />,
    info: <Info className="icon-info" />,
    warning: <AlertTriangle className="icon-warning" />,
} as const;

const DURATION_MS = 4000;

const ToastContext = createContext<(type: ToastType, message: string) => void>(() => {});

/** Toast messages, styled by app/(product)/app.css. Messages are text, never HTML. */
export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<ToastItem[]>([]);
    const nextId = useRef(0);

    const dismiss = useCallback((id: number) => {
        setToasts(current => current.filter(toast => toast.id !== id));
    }, []);

    const show = useCallback((type: ToastType, message: string) => {
        const id = ++nextId.current;
        setToasts(current => [...current, { id, type, message, visible: false }]);
        // Next frame: add toast-show so the CSS transition runs
        setTimeout(() => setToasts(current => current.map(t => (t.id === id ? { ...t, visible: true } : t))), 10);
        setTimeout(() => dismiss(id), DURATION_MS);
    }, [dismiss]);

    return (
        <ToastContext.Provider value={show}>
            {children}
            <div id="toast-container" className="toast-container">
                {toasts.map(toast => (
                    <div key={toast.id} id={`toast-${toast.id}`} className={`toast toast-${toast.type}${toast.visible ? ' toast-show' : ''}`}>
                        <div className="toast-content">
                            <span className="toast-icon">{ICONS[toast.type]}</span>
                            <span className="toast-message">{toast.message}</span>
                            <button className="toast-close" type="button" aria-label={t('shell.dismiss')} onClick={() => dismiss(toast.id)}>
                                <span>&times;</span>
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
}

export function useToast() {
    return useContext(ToastContext);
}

