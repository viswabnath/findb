'use client';

import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { apiDelete, apiGet, apiPost, apiPut, httpError, redirectIfUnauthorized } from '@/lib/api-client';
import { t } from '@/lib/i18n';

/**
 * Income and spending categories (/api/categories): rename them, mark spending essential or
 * discretionary, add your own, remove the ones you do not use. The fallbacks ("Uncategorised",
 * "Other income") are built in.
 */

interface Category { id: number; kind: 'income' | 'expense'; name: string; essential: boolean | null; fallback: boolean }

export function CategoriesCard() {
    const toast = useToast();
    const [categories, setCategories] = useState<Category[] | null>(null);
    const [form, setForm] = useState({ kind: 'expense' as 'income' | 'expense', name: '', essential: false });
    const [rename, setRename] = useState<{ id: number; name: string } | null>(null);
    const [pendingRemove, setPendingRemove] = useState<Category | null>(null);

    const load = useCallback(async () => {
        const result = await apiGet<Category[]>('/api/categories');
        if (redirectIfUnauthorized(result) || !result.ok) return;
        setCategories(result.data);
    }, []);

    useEffect(() => {
        load();
        // Once on page load; the buttons reload afterwards
    }, []);

    async function add() {
        if (!form.name.trim()) return toast('error', t('settings.categories.needName'));
        const result = await apiPost('/api/categories', { kind: form.kind, name: form.name, essential: form.kind === 'expense' ? form.essential : undefined });
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        toast('success', t('settings.categories.added', { name: form.name.trim() }));
        setForm(current => ({ ...current, name: '', essential: false }));
        await load();
    }

    async function update(id: number, body: Record<string, unknown>, message: string) {
        const result = await apiPut(`/api/categories/${id}`, body);
        if (redirectIfUnauthorized(result)) return false;
        if (!result.ok) {
            toast('error', httpError(result));
            return false;
        }
        toast('success', message);
        await load();
        return true;
    }

    async function remove() {
        if (!pendingRemove) return;
        const result = await apiDelete(`/api/categories/${pendingRemove.id}`);
        if (redirectIfUnauthorized(result)) return;
        setPendingRemove(null);
        if (!result.ok) return toast('error', httpError(result));
        toast('success', t('settings.categories.removed', { name: pendingRemove.name }));
        await load();
    }

    if (categories === null) return null;

    const list = (kind: 'income' | 'expense') => (
        <ul id={`${kind}-categories`} className="settings-list">
            {categories.filter(category => category.kind === kind).map(category => (
                <li key={category.id} data-category={category.id}>
                    <div>
                        <span className="what">{category.name}</span>
                        {category.fallback ? <div className="when">{t('settings.categories.builtIn')}</div> : null}
                    </div>
                    <span className="row-actions">
                        {kind === 'expense' && !category.fallback ? (
                            <label className="check-line essential-toggle">
                                <input type="checkbox" data-action="toggleEssential" data-id={category.id} checked={category.essential === true}
                                    onChange={event => update(category.id, { essential: event.target.checked },
                                        t(event.target.checked ? 'settings.categories.nowEssential' : 'settings.categories.nowDiscretionary', { name: category.name }))} />
                                {t('settings.categories.essential')}
                            </label>
                        ) : null}
                        {!category.fallback ? (
                            <>
                                <button type="button" className="icon-btn" data-action="renameCategory" data-id={category.id}
                                    onClick={() => setRename({ id: category.id, name: category.name })}>
                                    <Pencil aria-hidden="true" /> {t('settings.categories.rename')}
                                </button>
                                <button type="button" className="icon-btn danger" data-action="removeCategory" data-id={category.id}
                                    onClick={() => setPendingRemove(category)}>
                                    <Trash2 aria-hidden="true" /> {t('common.remove')}
                                </button>
                            </>
                        ) : null}
                    </span>
                </li>
            ))}
        </ul>
    );

    return (
        <section id="categories-section" className="card" aria-labelledby="categories-title">
            <div className="card-head">
                <h3 id="categories-title"><span className="icon-tile t-bank" aria-hidden="true"><Tags /></span>{t('settings.categories.title')}</h3>
                <span className="meta">{t('settings.categories.count', { count: categories.length })}</span>
            </div>
            <p className="card-pad form-note">{t('settings.categories.note')}</p>
            <form className="add-row other-add-row" onSubmit={event => { event.preventDefault(); add(); }}>
                <div className="field">
                    <label htmlFor="new-category-kind">{t('settings.categories.for')}</label>
                    <select id="new-category-kind" value={form.kind} onChange={event => setForm(current => ({ ...current, kind: event.target.value as 'income' | 'expense' }))}>
                        <option value="expense">{t('settings.categories.spending')}</option>
                        <option value="income">{t('settings.categories.income')}</option>
                    </select>
                </div>
                <div className="field">
                    <label htmlFor="new-category-name">{t('settings.categories.name')}</label>
                    <input type="text" id="new-category-name" placeholder={t('settings.categories.namePlaceholder')} maxLength={60} value={form.name}
                        onChange={event => setForm(current => ({ ...current, name: event.target.value }))} />
                </div>
                {form.kind === 'expense' ? (
                    <label className="check-line">
                        <input type="checkbox" id="new-category-essential" checked={form.essential}
                            onChange={event => setForm(current => ({ ...current, essential: event.target.checked }))} />
                        {t('settings.categories.essential')}
                    </label>
                ) : null}
                <button type="submit" className="btn btn-primary" data-action="addCategory"><Plus aria-hidden="true" /> {t('common.add')}</button>
            </form>
            <h4 className="settings-subhead">{t('settings.categories.spending')}</h4>
            {list('expense')}
            <h4 className="settings-subhead">{t('settings.categories.income')}</h4>
            {list('income')}

            <Modal id="rename-category-modal" title={t('settings.categories.renameTitle')} small open={rename !== null} closeAction="close-rename-category" onClose={() => setRename(null)}
                footer={(
                    <>
                        <button type="button" data-action="close-rename-category" className="btn btn-secondary" onClick={() => setRename(null)}>{t('common.cancel')}</button>
                        <button type="button" data-action="save-category" className="btn btn-primary"
                            onClick={async () => { if (rename && await update(rename.id, { name: rename.name }, t('settings.categories.renamed'))) setRename(null); }}>
                            {t('settings.categories.save')}
                        </button>
                    </>
                )}>
                <div className="field">
                    <label htmlFor="rename-category-name">{t('settings.categories.name')}</label>
                    <input type="text" id="rename-category-name" maxLength={60} value={rename?.name ?? ''}
                        onChange={event => setRename(current => current && { ...current, name: event.target.value })} />
                </div>
            </Modal>

            <Modal id="remove-category-modal" title={t('settings.categories.removeTitle')} small open={pendingRemove !== null} closeAction="close-remove-category"
                onClose={() => setPendingRemove(null)}
                footer={(
                    <>
                        <button type="button" data-action="close-remove-category" className="btn btn-secondary" onClick={() => setPendingRemove(null)}>{t('common.cancel')}</button>
                        <button type="button" data-action="confirm-remove-category" className="btn btn-danger" onClick={remove}><Trash2 aria-hidden="true" /> {t('common.remove')}</button>
                    </>
                )}>
                <p className="lead">{t('settings.categories.removeQuestion', { name: pendingRemove?.name ?? '' })}</p>
                <p>{t('settings.categories.removeNote')}</p>
            </Modal>
        </section>
    );
}
