'use client';

import { useEffect, useRef, useState } from 'react';
import { ScanText } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { apiGet, apiPost, httpError, redirectIfUnauthorized } from '@/lib/api-client';
import { formatRupees } from '@/lib/format';
import { t } from '@/lib/i18n';
import { todayInIndiaClient } from '@/lib/dates';
import { budgetWarning } from '@/lib/budget-alert';
import { readReceipt } from '@/lib/receipt-reader';
import { uploadFile } from '@/components/documents/DocumentsScreen';

/**
 * Quick add (v2 Phase 2, faster entry): an amount, the account and a category, from any screen.
 * The most used categories are one tap; the description is the category's name unless a note is
 * typed. The account last used is remembered on this device. Screens that list entries reload on
 * the "findb:entries-changed" event it sends.
 */

interface Account { id: number; type: string; name: string }
interface Category { id: number; kind: 'income' | 'expense'; name: string; fallback: boolean }
type Kind = 'expense' | 'income';

export const ENTRIES_CHANGED = 'findb:entries-changed';
const LAST_ACCOUNT = 'findb_quick_account';
const RELOAD_PATHS = ['/setup', '/summary', '/events', '/reconcile'];

function remembered(): string {
    try {
        return window.localStorage.getItem(LAST_ACCOUNT) ?? '';
    } catch {
        return '';
    }
}

const SAVED_MESSAGE = 'findb_quick_saved';

/** A message to show after the page reloads (this tab only) */
function keepMessage(message: string): void {
    try {
        window.sessionStorage.setItem(SAVED_MESSAGE, message);
    } catch {
        // Without storage the message is simply not shown
    }
}

/** The message kept before a reload, once */
export function takeSavedMessage(): string | null {
    try {
        const message = window.sessionStorage.getItem(SAVED_MESSAGE);
        window.sessionStorage.removeItem(SAVED_MESSAGE);
        return message;
    } catch {
        return null;
    }
}

function remember(accountId: string): void {
    try {
        window.localStorage.setItem(LAST_ACCOUNT, accountId);
    } catch {
        // Private windows may refuse storage; the default account is used next time
    }
}

interface Props {
    open: boolean;
    onClose: () => void;
    /** What the user tracks: income only, spending only, or both */
    kinds: Kind[];
}

export function QuickAdd({ open, onClose, kinds }: Props) {
    const toast = useToast();
    const amountRef = useRef<HTMLInputElement>(null);
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [frequent, setFrequent] = useState<Record<Kind, Category[]>>({ expense: [], income: [] });
    const [kind, setKind] = useState<Kind>(kinds[0] ?? 'expense');
    const [form, setForm] = useState({ amount: '', accountId: '', categoryId: '', note: '', date: '' });
    const [saving, setSaving] = useState(false);
    // A receipt photo or UPI screenshot read on this device: what it said, and whether to keep it
    const [receipt, setReceipt] = useState<{ file: File; keep: boolean; note: string; readAs: string | null } | null>(null);
    const [reading, setReading] = useState<number | null>(null);

    useEffect(() => {
        if (!open) return;
        setForm(current => ({ ...current, amount: '', note: '', date: todayInIndiaClient() }));
        setReceipt(null);
        setReading(null);
        (async () => {
            const [accountList, categoryList, spending, income] = await Promise.all([
                apiGet<Account[]>('/api/accounts'), apiGet<Category[]>('/api/categories'),
                apiGet<Category[]>('/api/categories/frequent?kind=expense'), apiGet<Category[]>('/api/categories/frequent?kind=income'),
            ]);
            if (redirectIfUnauthorized(accountList) || !accountList.ok) return;
            setAccounts(accountList.data);
            setCategories(categoryList.ok ? categoryList.data : []);
            setFrequent({ expense: spending.ok ? spending.data : [], income: income.ok ? income.data : [] });
            const last = remembered();
            // The account used last, else the first (banks come first)
            const account = accountList.data.find(item => String(item.id) === last) ?? accountList.data[0];
            setForm(current => ({ ...current, accountId: String(account?.id ?? '') }));
        })();
        amountRef.current?.focus();
    }, [open]);

    // Income goes onto a card only as a refund or cashback: quick add leaves cards out of income
    const usable = accounts.filter(account => kind === 'expense' || account.type !== 'credit_card');
    const accountId = usable.some(account => String(account.id) === form.accountId) ? form.accountId : String(usable[0]?.id ?? '');
    const chips = frequent[kind];
    const chosen = categories.find(category => String(category.id) === form.categoryId && category.kind === kind) ?? null;

    function switchKind(next: Kind) {
        setKind(next);
        setForm(current => ({ ...current, categoryId: '' }));
    }

    /** Read a receipt or screenshot and fill in what it says, for the user to check */
    async function read(file: File | undefined) {
        if (!file) return;
        setReading(0);
        try {
            const result = await readReceipt(file, progress => setReading(progress));
            setKind('expense');
            setForm(current => ({
                ...current, amount: result.amount ?? current.amount, date: result.date ?? current.date, note: result.merchant ?? current.note,
            }));
            const found = [result.amount ? t('quickAdd.receipt.amount') : null, result.date ? t('quickAdd.receipt.date') : null,
                result.merchant ? t('quickAdd.receipt.merchant') : null].filter(Boolean).join(', ');
            setReceipt({ file, keep: true, note: found ? t('quickAdd.receipt.found', { found }) : t('quickAdd.receipt.nothing'), readAs: result.readAs });
            if (result.merchant) {
                const suggestion = await apiGet<{ category: Category | null }>(`/api/categories/suggest?${new URLSearchParams({ kind: 'expense', description: result.merchant })}`);
                if (suggestion.ok && suggestion.data.category) setForm(current => ({ ...current, categoryId: String(suggestion.data.category!.id) }));
            }
        } catch {
            setReceipt({ file, keep: true, note: t('quickAdd.receipt.failed'), readAs: null });
        } finally {
            setReading(null);
        }
    }

    async function save() {
        const amount = form.amount.trim();
        if (!amount || !(Number(amount) > 0)) return toast('error', t('quickAdd.needAmount'));
        if (!chosen) return toast('error', t('quickAdd.needCategory'));
        setSaving(true);
        const result = await apiPost<{ id: number }>('/api/entries', {
            type: kind, date: form.date, amount, accountId: Number(accountId), categoryId: chosen.id,
            description: form.note.trim() || chosen.name,
        });
        setSaving(false);
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        remember(accountId);
        const message = t(kind === 'income' ? 'quickAdd.savedIncome' : 'quickAdd.savedExpense', { amount: formatRupees(amount), category: chosen.name });
        let warning = kind === 'expense' ? await budgetWarning(chosen.id, form.date) : null;
        // The receipt goes into Documents, on the new entry
        if (receipt?.keep) {
            const kept = await uploadFile(receipt.file, { kind: 'receipt', title: form.note.trim() || chosen.name, date: form.date }, [{ type: 'entry', id: result.data.id }]);
            if (!kept.ok && kept.error) warning = [warning, t('quickAdd.receipt.notKept', { reason: kept.error })].filter(Boolean).join(' ');
        }
        onClose();
        // Screens showing balances or totals without listening for the event start again, and
        // show the message once they have
        if (RELOAD_PATHS.includes(window.location.pathname)) {
            keepMessage(warning ? `${message}. ${warning}` : message);
            window.location.reload();
            return;
        }
        toast('success', message);
        if (warning) toast('warning', warning);
        window.dispatchEvent(new CustomEvent(ENTRIES_CHANGED));
    }

    return (
        <Modal
            id="quick-add-modal"
            title={t('quickAdd.title')}
            open={open}
            small
            closeAction="close-quick-add"
            onClose={onClose}
            footer={(
                <>
                    <button type="button" className="btn btn-secondary" data-action="close-quick-add" onClick={onClose}>{t('common.cancel')}</button>
                    <button type="submit" form="quick-add-form" className="btn btn-primary" data-action="saveQuickAdd" disabled={saving}>{t('quickAdd.save')}</button>
                </>
            )}
        >
            <form id="quick-add-form" className="quick-add" onSubmit={event => { event.preventDefault(); save(); }}>
                {kinds.length > 1 ? (
                    <div className="segmented" role="radiogroup" aria-label={t('quickAdd.kind')}>
                        {kinds.map(item => (
                            <button key={item} type="button" role="radio" aria-checked={kind === item} data-kind={item} onClick={() => switchKind(item)}>
                                {t(`quickAdd.kinds.${item}`)}
                            </button>
                        ))}
                    </div>
                ) : null}
                {kinds.includes('expense') ? (
                    <div className="quick-receipt">
                        <input id="quick-receipt" className="sr-only" type="file" accept="image/*" disabled={reading !== null}
                            onChange={event => { read(event.target.files?.[0]); event.target.value = ''; }} />
                        <label htmlFor="quick-receipt" className="btn btn-secondary btn-sm" data-action="readReceipt" aria-disabled={reading !== null}>
                            <ScanText aria-hidden="true" /> {reading !== null ? t('quickAdd.receipt.reading', { percent: Math.round(reading * 100) }) : t('quickAdd.receipt.read')}
                        </label>
                        {receipt ? (
                            <>
                                <p className="form-note" id="quick-receipt-note" role="status">{receipt.note}</p>
                                {receipt.readAs ? (
                                    <p className="form-note quick-receipt-check" id="quick-receipt-readas">
                                        {t('quickAdd.receipt.rupee', { amount: form.amount, readAs: receipt.readAs })}{' '}
                                        <button type="button" className="btn-link" data-action="useReadAs"
                                            onClick={() => { setForm(current => ({ ...current, amount: receipt.readAs! })); setReceipt({ ...receipt, readAs: null }); }}>
                                            {t('quickAdd.receipt.useReadAs', { readAs: receipt.readAs })}
                                        </button>
                                    </p>
                                ) : null}
                                <label className="check-line">
                                    <input type="checkbox" id="quick-receipt-keep" checked={receipt.keep} onChange={event => setReceipt({ ...receipt, keep: event.target.checked })} />
                                    {t('quickAdd.receipt.keep')}
                                </label>
                            </>
                        ) : <p className="form-note">{t('quickAdd.receipt.hint')}</p>}
                    </div>
                ) : null}
                <div className="field">
                    <label htmlFor="quick-amount">{t('quickAdd.amount')}</label>
                    <input ref={amountRef} id="quick-amount" className="quick-amount" type="number" inputMode="decimal" min="0.01" step="0.01"
                        value={form.amount} onChange={event => setForm(current => ({ ...current, amount: event.target.value }))} />
                </div>
                <fieldset className="field quick-categories">
                    <legend className="label">{t('quickAdd.category')}</legend>
                    <div className="chips">
                        {chips.map(category => (
                            <button key={category.id} type="button" className="chip" aria-pressed={form.categoryId === String(category.id)}
                                data-category={category.name} onClick={() => setForm(current => ({ ...current, categoryId: String(category.id) }))}>
                                {category.name}
                            </button>
                        ))}
                    </div>
                    <select id="quick-category" aria-label={t('quickAdd.otherCategory')} value={chips.some(chip => String(chip.id) === form.categoryId) ? '' : form.categoryId}
                        onChange={event => setForm(current => ({ ...current, categoryId: event.target.value }))}>
                        <option value="">{t('quickAdd.otherCategory')}</option>
                        {categories.filter(category => category.kind === kind).map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
                    </select>
                </fieldset>
                <div className="form-grid two">
                    <div className="field">
                        <label htmlFor="quick-account">{kind === 'income' ? t('quickAdd.into') : t('quickAdd.from')}</label>
                        <select id="quick-account" value={accountId} onChange={event => setForm(current => ({ ...current, accountId: event.target.value }))}>
                            {usable.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
                        </select>
                    </div>
                    <div className="field">
                        <label htmlFor="quick-date">{t('quickAdd.date')}</label>
                        <input id="quick-date" type="date" value={form.date} onChange={event => setForm(current => ({ ...current, date: event.target.value }))} />
                    </div>
                </div>
                <div className="field">
                    <label htmlFor="quick-note">{t('quickAdd.note')}</label>
                    <input id="quick-note" type="text" maxLength={200} placeholder={chosen?.name ?? ''} value={form.note}
                        onChange={event => setForm(current => ({ ...current, note: event.target.value }))} />
                </div>
            </form>
        </Modal>
    );
}
