'use client';

import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { apiDelete, apiGet, apiPost, apiPut, httpError, redirectIfUnauthorized } from '@/lib/api-client';

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
        if (!form.name.trim()) return toast('error', 'Please enter a category name');
        const result = await apiPost('/api/categories', { kind: form.kind, name: form.name, essential: form.kind === 'expense' ? form.essential : undefined });
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        toast('success', `${form.name.trim()} added`);
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
        toast('success', `${pendingRemove.name} removed`);
        await load();
    }

    if (categories === null) return null;

    const list = (kind: 'income' | 'expense') => (
        <ul id={`${kind}-categories`} className="settings-list">
            {categories.filter(category => category.kind === kind).map(category => (
                <li key={category.id} data-category={category.id}>
                    <div>
                        <span className="what">{category.name}</span>
                        {category.fallback ? <div className="when">Built in: entries without a category</div> : null}
                    </div>
                    <span className="row-actions">
                        {kind === 'expense' && !category.fallback ? (
                            <label className="check-line essential-toggle">
                                <input type="checkbox" data-action="toggleEssential" data-id={category.id} checked={category.essential === true}
                                    onChange={event => update(category.id, { essential: event.target.checked },
                                        `${category.name} is now ${event.target.checked ? 'essential' : 'discretionary'}`)} />
                                Essential
                            </label>
                        ) : null}
                        {!category.fallback ? (
                            <>
                                <button type="button" className="icon-btn" data-action="renameCategory" data-id={category.id}
                                    onClick={() => setRename({ id: category.id, name: category.name })}>
                                    <Pencil aria-hidden="true" /> Rename
                                </button>
                                <button type="button" className="icon-btn danger" data-action="removeCategory" data-id={category.id}
                                    onClick={() => setPendingRemove(category)}>
                                    <Trash2 aria-hidden="true" /> Remove
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
                <h3 id="categories-title"><span className="icon-tile t-bank" aria-hidden="true"><Tags /></span>Categories</h3>
                <span className="meta">{categories.length} categories</span>
            </div>
            <p className="card-pad form-note">
                Essential spending (rent, groceries, bills) is what you would still pay in a lean month; FinDB uses it for your emergency
                fund. Removing a category keeps it on the entries that already use it.
            </p>
            <form className="add-row other-add-row" onSubmit={event => { event.preventDefault(); add(); }}>
                <div className="field">
                    <label htmlFor="new-category-kind">For</label>
                    <select id="new-category-kind" value={form.kind} onChange={event => setForm(current => ({ ...current, kind: event.target.value as 'income' | 'expense' }))}>
                        <option value="expense">Spending</option>
                        <option value="income">Income</option>
                    </select>
                </div>
                <div className="field">
                    <label htmlFor="new-category-name">Name</label>
                    <input type="text" id="new-category-name" placeholder="For example Pets" maxLength={60} value={form.name}
                        onChange={event => setForm(current => ({ ...current, name: event.target.value }))} />
                </div>
                {form.kind === 'expense' ? (
                    <label className="check-line">
                        <input type="checkbox" id="new-category-essential" checked={form.essential}
                            onChange={event => setForm(current => ({ ...current, essential: event.target.checked }))} />
                        Essential
                    </label>
                ) : null}
                <button type="submit" className="btn btn-primary" data-action="addCategory"><Plus aria-hidden="true" /> Add</button>
            </form>
            <h4 className="settings-subhead">Spending</h4>
            {list('expense')}
            <h4 className="settings-subhead">Income</h4>
            {list('income')}

            <Modal id="rename-category-modal" title="Rename category" small open={rename !== null} closeAction="close-rename-category" onClose={() => setRename(null)}
                footer={(
                    <>
                        <button type="button" data-action="close-rename-category" className="btn btn-secondary" onClick={() => setRename(null)}>Cancel</button>
                        <button type="button" data-action="save-category" className="btn btn-primary"
                            onClick={async () => { if (rename && await update(rename.id, { name: rename.name }, 'Category renamed')) setRename(null); }}>
                            Save
                        </button>
                    </>
                )}>
                <div className="field">
                    <label htmlFor="rename-category-name">Name</label>
                    <input type="text" id="rename-category-name" maxLength={60} value={rename?.name ?? ''}
                        onChange={event => setRename(current => current && { ...current, name: event.target.value })} />
                </div>
            </Modal>

            <Modal id="remove-category-modal" title="Remove this category?" small open={pendingRemove !== null} closeAction="close-remove-category"
                onClose={() => setPendingRemove(null)}
                footer={(
                    <>
                        <button type="button" data-action="close-remove-category" className="btn btn-secondary" onClick={() => setPendingRemove(null)}>Cancel</button>
                        <button type="button" data-action="confirm-remove-category" className="btn btn-danger" onClick={remove}><Trash2 aria-hidden="true" /> Remove</button>
                    </>
                )}>
                <p className="lead">Remove {pendingRemove?.name}?</p>
                <p>Entries already in it keep it. It will not be offered for new entries.</p>
            </Modal>
        </section>
    );
}
