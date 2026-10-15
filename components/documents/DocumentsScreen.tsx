'use client';

import { useEffect, useState } from 'react';
import { FileText, FolderLock, Pencil, Trash2, Upload } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { apiDelete, apiGet, apiPut, apiUpload, httpError, redirectIfUnauthorized } from '@/lib/api-client';
import { compressImage } from '@/lib/compress-image';
import { todayInIndiaClient } from '@/lib/dates';
import { t } from '@/lib/i18n';

/**
 * The document vault (/api/documents, v2 Phase 2): upload receipts, statements, policies and other
 * papers (photos are shrunk on this device first), give each a type, date and expiry, link it to
 * an account or event, and find a financial year's papers together. Files are encrypted by FinDB
 * and kept in private storage; opening one decrypts it for this session only.
 */

export const DOCUMENT_KINDS = ['receipt', 'statement', 'invoice', 'policy', 'loan', 'property', 'warranty', 'certificate', 'tax', 'other'] as const;
type Kind = typeof DOCUMENT_KINDS[number];
interface Link { type: 'entry' | 'account' | 'event'; id: number; name: string }
export interface VaultDocument {
    id: number; kind: Kind; title: string; date: string | null; financialYear: string | null; expiresOn: string | null; notes: string | null;
    fileName: string; mimeType: string; size: number; createdAt: string; links: Link[];
}
interface Vault { documents: VaultDocument[]; used: number; limit: number }
interface Choice { id: number; name: string }

export const sizeText = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const shortDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const MAX_FILE = 2 * 1024 * 1024;
const daysUntil = (date: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${todayInIndiaClient()}T00:00:00Z`)) / 86_400_000);

/** Shrink a photo, check the size, and upload it with its details */
export async function uploadFile(file: File, fields: Record<string, string>, links: { type: string; id: number }[]) {
    const ready = await compressImage(file);
    if (ready.size > MAX_FILE) return { ok: false as const, error: t('documents.tooLarge') };
    const form = new FormData();
    form.set('file', ready, ready.name);
    for (const [key, value] of Object.entries(fields)) if (value) form.set(key, value);
    form.set('links', JSON.stringify(links));
    const result = await apiUpload<VaultDocument>('/api/documents', form);
    if (redirectIfUnauthorized(result)) return { ok: false as const, error: '' };
    return result.ok ? { ok: true as const, document: result.data } : { ok: false as const, error: httpError(result) };
}

export function DocumentsScreen() {
    const toast = useToast();
    const [vault, setVault] = useState<Vault | null>(null);
    const [accounts, setAccounts] = useState<Choice[]>([]);
    const [events, setEvents] = useState<Choice[]>([]);
    const [file, setFile] = useState<File | null>(null);
    const [form, setForm] = useState({ kind: 'receipt' as Kind, title: '', date: '', expiresOn: '', notes: '', accountId: '', eventId: '' });
    const [uploading, setUploading] = useState(false);
    const [filter, setFilter] = useState({ kind: '', year: '' });
    const [editing, setEditing] = useState<VaultDocument | null>(null);
    const [removing, setRemoving] = useState<VaultDocument | null>(null);

    async function load() {
        const result = await apiGet<Vault>('/api/documents');
        if (redirectIfUnauthorized(result) || !result.ok) return;
        setVault(result.data);
    }

    useEffect(() => {
        load();
        apiGet<Choice[]>('/api/accounts').then(result => { if (result.ok) setAccounts(result.data.map(item => ({ id: item.id, name: item.name }))); });
        apiGet<Choice[]>('/api/events').then(result => { if (result.ok) setEvents(result.data.map(item => ({ id: item.id, name: item.name }))); });
        // Once on page load
    }, []);

    if (!vault) return null;

    async function upload() {
        if (!file) return toast('error', t('documents.chooseFile'));
        setUploading(true);
        const links = [
            ...(form.accountId ? [{ type: 'account', id: Number(form.accountId) }] : []),
            ...(form.eventId ? [{ type: 'event', id: Number(form.eventId) }] : []),
        ];
        const result = await uploadFile(file, { kind: form.kind, title: form.title, date: form.date, expiresOn: form.expiresOn, notes: form.notes }, links);
        setUploading(false);
        if (!result.ok) return result.error ? toast('error', result.error) : undefined;
        toast('success', t('documents.uploaded', { title: result.document.title }));
        setFile(null);
        setForm(current => ({ ...current, title: '', date: '', expiresOn: '', notes: '' }));
        await load();
    }

    async function saveEdit() {
        if (!editing) return;
        const result = await apiPut<VaultDocument>(`/api/documents/${editing.id}`, {
            kind: editing.kind, title: editing.title, date: editing.date ?? '', expiresOn: editing.expiresOn ?? '', notes: editing.notes ?? '',
        });
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        setEditing(null);
        await load();
    }

    async function remove() {
        if (!removing) return;
        const result = await apiDelete(`/api/documents/${removing.id}`);
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        toast('success', t('documents.deleted', { title: removing.title }));
        setRemoving(null);
        await load();
    }

    const years = [...new Set(vault.documents.map(item => item.financialYear).filter((year): year is string => Boolean(year)))].sort().reverse();
    const shown = vault.documents.filter(item => (!filter.kind || item.kind === filter.kind) && (!filter.year || item.financialYear === filter.year));
    const expiring = vault.documents.filter(item => item.expiresOn && daysUntil(item.expiresOn) <= 30).sort((a, b) => a.expiresOn!.localeCompare(b.expiresOn!));
    const percent = Math.min(100, Math.round((vault.used * 100) / vault.limit));

    return (
        <div id="documents-section">
            <div className="page-header">
                <div>
                    <h2>{t('documents.title')}</h2>
                    <p>{t('documents.subtitle')}</p>
                </div>
            </div>

            {expiring.length > 0 ? (
                <div className="notice warn" id="documents-expiring" role="status">
                    {expiring.map(item => (
                        <p key={item.id}>
                            {daysUntil(item.expiresOn!) < 0
                                ? t('documents.expired', { title: item.title, date: shortDate(item.expiresOn!) })
                                : t('documents.expires', { title: item.title, date: shortDate(item.expiresOn!), count: daysUntil(item.expiresOn!) })}
                        </p>
                    ))}
                </div>
            ) : null}

            <section className="card" aria-labelledby="documents-upload-title">
                <div className="card-head">
                    <h3 id="documents-upload-title"><span className="icon-tile t-bank" aria-hidden="true"><Upload /></span>{t('documents.add')}</h3>
                    <span className="meta" id="documents-used">{t('documents.used', { used: sizeText(vault.used), limit: sizeText(vault.limit) })}</span>
                </div>
                <div className="card-pad documents-meter">
                    <div className="budget-bar" role="progressbar" aria-label={t('documents.space')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                        <span style={{ width: `${percent}%` }} />
                    </div>
                </div>
                <form className="card-pad documents-form" onSubmit={event => { event.preventDefault(); upload(); }}>
                    <div className="field documents-file">
                        <label htmlFor="document-file">{t('documents.file')}</label>
                        <input id="document-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp"
                            onChange={event => setFile(event.target.files?.[0] ?? null)} />
                        <span className="field-hint">{t('documents.fileHint')}</span>
                    </div>
                    <div className="field">
                        <label htmlFor="document-kind">{t('documents.kind')}</label>
                        <select id="document-kind" value={form.kind} onChange={event => setForm(current => ({ ...current, kind: event.target.value as Kind }))}>
                            {DOCUMENT_KINDS.map(kind => <option key={kind} value={kind}>{t(`documents.kinds.${kind}`)}</option>)}
                        </select>
                    </div>
                    <div className="field">
                        <label htmlFor="document-title">{t('documents.name')}</label>
                        <input id="document-title" type="text" maxLength={120} placeholder={file?.name ?? ''} value={form.title}
                            onChange={event => setForm(current => ({ ...current, title: event.target.value }))} />
                    </div>
                    <div className="field">
                        <label htmlFor="document-date">{t('documents.date')}</label>
                        <input id="document-date" type="date" value={form.date} onChange={event => setForm(current => ({ ...current, date: event.target.value }))} />
                    </div>
                    <div className="field">
                        <label htmlFor="document-expiry">{t('documents.expiry')}</label>
                        <input id="document-expiry" type="date" value={form.expiresOn} onChange={event => setForm(current => ({ ...current, expiresOn: event.target.value }))} />
                    </div>
                    <div className="field">
                        <label htmlFor="document-account">{t('documents.account')}</label>
                        <select id="document-account" value={form.accountId} onChange={event => setForm(current => ({ ...current, accountId: event.target.value }))}>
                            <option value="">{t('documents.none')}</option>
                            {accounts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                        </select>
                    </div>
                    <div className="field">
                        <label htmlFor="document-event">{t('documents.event')}</label>
                        <select id="document-event" value={form.eventId} onChange={event => setForm(current => ({ ...current, eventId: event.target.value }))}>
                            <option value="">{t('documents.none')}</option>
                            {events.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                        </select>
                    </div>
                    <div className="field documents-notes">
                        <label htmlFor="document-notes">{t('documents.notes')}</label>
                        <input id="document-notes" type="text" maxLength={500} value={form.notes} onChange={event => setForm(current => ({ ...current, notes: event.target.value }))} />
                    </div>
                    <div className="documents-submit">
                        <button type="submit" className="btn btn-primary" data-action="uploadDocument" disabled={uploading || !file}>
                            <Upload aria-hidden="true" /> {uploading ? t('documents.uploading') : t('documents.upload')}
                        </button>
                    </div>
                </form>
                <p className="card-pad form-note documents-privacy">{t('documents.privacy')}</p>
            </section>

            <section className="card" aria-labelledby="documents-list-title">
                <div className="card-head">
                    <h3 id="documents-list-title"><span className="icon-tile t-wealth" aria-hidden="true"><FolderLock /></span>{t('documents.yours')}</h3>
                    <span className="meta">{t('documents.count', { count: vault.documents.length })}</span>
                </div>
                {vault.documents.length > 0 ? (
                    <div className="card-pad documents-filters">
                        <div className="field">
                            <label htmlFor="documents-filter-kind">{t('documents.kind')}</label>
                            <select id="documents-filter-kind" value={filter.kind} onChange={event => setFilter(current => ({ ...current, kind: event.target.value }))}>
                                <option value="">{t('documents.all')}</option>
                                {DOCUMENT_KINDS.map(kind => <option key={kind} value={kind}>{t(`documents.kinds.${kind}`)}</option>)}
                            </select>
                        </div>
                        <div className="field">
                            <label htmlFor="documents-filter-year">{t('documents.year')}</label>
                            <select id="documents-filter-year" value={filter.year} onChange={event => setFilter(current => ({ ...current, year: event.target.value }))}>
                                <option value="">{t('documents.all')}</option>
                                {years.map(year => <option key={year} value={year}>{t('documents.fy', { year })}</option>)}
                            </select>
                        </div>
                    </div>
                ) : null}
                <ul id="documents-list" className="settings-list search-list">
                    {shown.length === 0 ? <li>{vault.documents.length === 0 ? t('documents.empty') : t('documents.noneMatch')}</li> : shown.map(item => (
                        <li key={item.id} data-document={item.title}>
                            <span className="search-entry">
                                <span className="what"><FileText className="inline-icon" aria-hidden="true" /> {item.title}</span>
                                <span className="when">
                                    {t(`documents.kinds.${item.kind}`)}
                                    {item.date ? ` · ${shortDate(item.date)}` : ''}
                                    {item.financialYear ? ` · ${t('documents.fy', { year: item.financialYear })}` : ''}
                                    {` · ${sizeText(item.size)}`}
                                    {item.expiresOn ? ` · ${t('documents.expiresOn', { date: shortDate(item.expiresOn) })}` : ''}
                                </span>
                                {item.links.length > 0 ? (
                                    <span className="entry-meta">{item.links.map(link => <span key={`${link.type}${link.id}`} className="tag">{link.name}</span>)}</span>
                                ) : null}
                            </span>
                            <span className="document-actions">
                                <a className="btn btn-secondary btn-sm" data-action="openDocument" href={`/api/documents/${item.id}/file`} target="_blank" rel="noopener">{t('documents.open')}</a>
                                <button type="button" className="btn btn-secondary btn-sm" data-action="editDocument" aria-label={t('documents.edit', { title: item.title })} onClick={() => setEditing(item)}>
                                    <Pencil aria-hidden="true" />
                                </button>
                                <button type="button" className="btn btn-secondary btn-sm" data-action="deleteDocument" aria-label={t('documents.delete', { title: item.title })} onClick={() => setRemoving(item)}>
                                    <Trash2 aria-hidden="true" />
                                </button>
                            </span>
                        </li>
                    ))}
                </ul>
            </section>

            <Modal id="edit-document-modal" title={t('documents.editTitle')} open={editing !== null} closeAction="close-edit-document" onClose={() => setEditing(null)}
                footer={(
                    <>
                        <button type="button" className="btn btn-secondary" data-action="close-edit-document" onClick={() => setEditing(null)}>{t('common.cancel')}</button>
                        <button type="button" className="btn btn-primary" data-action="saveDocument" onClick={saveEdit}>{t('documents.save')}</button>
                    </>
                )}>
                {editing ? (
                    <div className="form-grid two">
                        <div className="field">
                            <label htmlFor="edit-document-title">{t('documents.name')}</label>
                            <input id="edit-document-title" type="text" maxLength={120} value={editing.title} onChange={event => setEditing({ ...editing, title: event.target.value })} />
                        </div>
                        <div className="field">
                            <label htmlFor="edit-document-kind">{t('documents.kind')}</label>
                            <select id="edit-document-kind" value={editing.kind} onChange={event => setEditing({ ...editing, kind: event.target.value as Kind })}>
                                {DOCUMENT_KINDS.map(kind => <option key={kind} value={kind}>{t(`documents.kinds.${kind}`)}</option>)}
                            </select>
                        </div>
                        <div className="field">
                            <label htmlFor="edit-document-date">{t('documents.date')}</label>
                            <input id="edit-document-date" type="date" value={editing.date ?? ''} onChange={event => setEditing({ ...editing, date: event.target.value || null })} />
                        </div>
                        <div className="field">
                            <label htmlFor="edit-document-expiry">{t('documents.expiry')}</label>
                            <input id="edit-document-expiry" type="date" value={editing.expiresOn ?? ''} onChange={event => setEditing({ ...editing, expiresOn: event.target.value || null })} />
                        </div>
                    </div>
                ) : null}
            </Modal>

            <Modal id="delete-document-modal" title={t('documents.deleteTitle')} open={removing !== null} small closeAction="close-delete-document" onClose={() => setRemoving(null)}
                footer={(
                    <>
                        <button type="button" className="btn btn-secondary" data-action="close-delete-document" onClick={() => setRemoving(null)}>{t('common.cancel')}</button>
                        <button type="button" className="btn btn-danger" data-action="confirmDeleteDocument" onClick={remove}>{t('documents.deleteConfirm')}</button>
                    </>
                )}>
                <p>{removing ? t('documents.deleteText', { title: removing.title }) : ''}</p>
            </Modal>
        </div>
    );
}
