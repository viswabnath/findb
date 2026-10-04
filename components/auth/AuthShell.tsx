'use client';

import { useState, type ComponentProps, type FormEvent, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { HydrationGate } from '@/components/HydrationGate';

export interface AuthMessage {
    kind: 'error' | 'success';
    text: string;
}

/**
 * The frame of a sign-in form: the form itself and #auth-message under it. The forms keep the
 * former app's ids and data-action hooks, which the end-to-end tests use.
 */
export function AuthShell({ message, children }: { message?: AuthMessage | null; children: ReactNode }) {
    return (
        <div id="auth-section" className="auth-card">
            <HydrationGate>{children}</HydrationGate>
            <div id="auth-message" className={message?.kind ?? 'error'} role="status">{message?.text ?? ''}</div>
        </div>
    );
}

/** A form whose Enter key runs `onSubmit` (the page never reloads) */
export function AuthForm({ id, onSubmit, children }: { id: string; onSubmit: () => void; children: ReactNode }) {
    return (
        <form
            id={id}
            className="auth-card"
            noValidate
            onSubmit={(event: FormEvent) => {
                event.preventDefault();
                onSubmit();
            }}
        >
            {children}
        </form>
    );
}

/** The heading block of a sign-in form */
export function AuthHead({ step, title, children }: { step?: string; title: string; children?: ReactNode }) {
    return (
        <div className="auth-head">
            {step ? <span className="auth-step">{step}</span> : null}
            <h1>{title}</h1>
            {children ? <p>{children}</p> : null}
        </div>
    );
}

type AuthButtonProps = Omit<ComponentProps<'button'>, 'type'> & {
    action: string;
    submit?: boolean;
};

/**
 * A button that does not take focus on mousedown: inputs show help while focused, and if a
 * click blurred the input first, the help would vanish and move the button before mouseup.
 */
export function AuthButton({ action, submit, children, ...props }: AuthButtonProps) {
    return (
        <button type={submit ? 'submit' : 'button'} data-action={action} onMouseDown={event => event.preventDefault()} {...props}>
            {children}
        </button>
    );
}

type FieldProps = ComponentProps<'input'> & {
    id: string;
    label: string;
    /** Shown while the input has focus */
    help?: ReactNode;
    /** Something on the right of the label, such as a "Forgot?" link */
    aside?: ReactNode;
};

/** A labelled input, with help text shown while it has focus */
export function Field({ id, label, help, aside, ...props }: FieldProps) {
    const [focused, setFocused] = useState(false);
    return (
        <div className="field">
            <div className="field-row">
                <label htmlFor={id}>{label}</label>
                {aside}
            </div>
            <input
                id={id}
                aria-describedby={help ? `${id}-help` : undefined}
                {...props}
                onFocus={event => { setFocused(true); props.onFocus?.(event); }}
                onBlur={event => { setFocused(false); props.onBlur?.(event); }}
            />
            {help ? <small id={`${id}-help`} className={`field-hint${focused ? '' : ' sr-only'}`}>{help}</small> : null}
        </div>
    );
}

/** A labelled password input with a Show / Hide button */
export function PasswordField({ id, label, aside, children, ...props }: Omit<ComponentProps<'input'>, 'type'> & {
    id: string;
    label: string;
    aside?: ReactNode;
    children?: ReactNode;
}) {
    const [visible, setVisible] = useState(false);
    return (
        <div className="field">
            <div className="field-row">
                <label htmlFor={id}>{label}</label>
                {aside}
            </div>
            <div className="password-field">
                <input id={id} type={visible ? 'text' : 'password'} {...props} />
                <button
                    type="button"
                    className="reveal-button"
                    aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
                    aria-pressed={visible}
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => setVisible(value => !value)}
                >
                    {visible ? 'Hide' : 'Show'}
                </button>
            </div>
            {children}
        </div>
    );
}

/** The password rules (lib/auth-validation.ts), ticked off as the user types */
export function PasswordRules({ password }: { password: string }) {
    const rules = [
        { ok: password.length >= 8 && password.length <= 64, text: '8 to 64 characters' },
        { ok: password.length >= 16 || (/[A-Z]/.test(password) && /[a-z]/.test(password)), text: 'Upper and lower case letters' },
        { ok: password.length >= 16 || /[0-9]/.test(password), text: 'A number' },
        { ok: password.length >= 16 || /[^A-Za-z0-9]/.test(password), text: 'A symbol, such as @ or #' },
    ];
    return (
        <>
            <ul className="rules" aria-label="Password rules">
                {rules.map(rule => (
                    <li key={rule.text} className={rule.ok ? 'ok' : undefined}>
                        <Check aria-hidden="true" />
                        {rule.text}
                        <span className="sr-only">{rule.ok ? ', done' : ', not yet'}</span>
                    </li>
                ))}
            </ul>
            <small className="field-hint">Or use a passphrase of 16 characters or more, such as four unrelated words: then any characters will do.</small>
        </>
    );
}
