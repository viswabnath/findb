'use client';

import { useEffect, useMemo, useState } from 'react';
import { Columns3, FileUp, History, ListChecks, Undo2 } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { FoldingCard } from '@/components/ui/FoldingCard';
import { apiDelete, apiGet, apiPost, httpError, redirectIfUnauthorized } from '@/lib/api-client';
import { formatRupees, signedRupees } from '@/lib/format';
import { t } from '@/lib/i18n';
import { readStatementFile, StatementFileError, type FileKind } from '@/lib/statement-file';
import {
    MAX_IMPORT_ROWS, closingBalance, detectLayout, layoutSignature, mappingProblem, paiseText, readRows,
    type Mapping, type Preset, type StatementRow, type Table,
} from '@/src/core/statement';
import { ColumnsEditor } from './ColumnsEditor';

/**
 * Import a bank or card statement (/api/imports, v2 Phase 2). The file is read here, in the
 * browser (lib/statement-file.ts), and never uploaded: the rows go to the review, which flags
 * duplicates, transfers and categories, and the rows the user keeps are saved as one import.
 */

interface Account { id: number; type: string; name: string; balance: string }
interface Category { id: number; kind: 'income' | 'expense'; name: string; key: string | null; fallback: boolean }
interface Profile { signature: string; presetKey: string | null; mapping: Mapping; accountId: number | null }
type Action = { type: 'category'; categoryId: number | null } | { type: 'transfer'; accountId: number } | { type: 'replace'; entryId: number };
interface Match { entryId: number; accountId: number; accountName: string; date: string; description: string; categoryName: string }
interface ReviewRow {
    line: number; date: string; description: string; amount: string;
    duplicate: { entryId: number; date: string; description: string; sameDescription: boolean } | null;
    repeated: boolean; action: Action; reason: 'history' | 'keyword' | 'atm' | 'card_payment' | 'match' | null; match: Match | null;
}
interface Review { account: { id: number; name: string; type: string; balance: string }; rows: ReviewRow[]; balanceAfter: string }
interface Choice { include: boolean; description: string; action: string }
interface ImportBatch {
    id: number; account: { id: number; name: string }; imported: number; active: number; from: string | null; to: string | null;
    createdAt: string; undoneAt: string | null;
}
interface ImportResult {
    batchId: number; imported: number; transfers: number; replaced: number; account: { id: number; name: string; balance: string };
    closing: { date: string; balance: string; findb: string; difference: string } | null;
}
interface LoadedFile { name: string; kind: FileKind; table: Table }
interface Layout { headerRow: number; header: string[]; preset: Preset | null; mapping: Mapping | null; saved: boolean }

const day = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const CARD_INCOME_KEYS = ['refund', 'cashback'];

/** The select's value for an action: c:<category>, t:<account>, r:<entry> */
function encode(action: Action, fallback: number | undefined): string {
    if (action.type === 'transfer') return `t:${action.accountId}`;
    if (action.type === 'replace') return `r:${action.entryId}`;
    return `c:${action.categoryId ?? fallback ?? ''}`;
}

function decode(value: string): Action {
    const [kind, id] = value.split(':');
    if (kind === 't') return { type: 'transfer', accountId: Number(id) };
    if (kind === 'r') return { type: 'replace', entryId: Number(id) };
    return { type: 'category', categoryId: id ? Number(id) : null };
}

/** Rupees text to paise, exactly (the API's amounts have two decimals) */
const toPaise = (amount: string) => {
    const negative = amount.startsWith('-');
    const [whole = '0', fraction = ''] = amount.replace('-', '').split('.');
    const paise = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
    return negative ? -paise : paise;
};

export function ImportScreen() {
    const toast = useToast();
    const [accounts, setAccounts] = useState<Account[] | null>(null);
    const [categories, setCategories] = useState<Category[]>([]);
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [history, setHistory] = useState<ImportBatch[]>([]);
    const [accountId, setAccountId] = useState('');
    const [file, setFile] = useState<LoadedFile | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [layout, setLayout] = useState<Layout | null>(null);
    const [editing, setEditing] = useState(false);
    const [parsed, setParsed] = useState<{ rows: StatementRow[]; skipped: number; tooMany: boolean } | null>(null);
    const [review, setReview] = useState<Review | null>(null);
    const [choices, setChoices] = useState<Choice[]>([]);
    const [result, setResult] = useState<ImportResult | null>(null);
    const [saving, setSaving] = useState(false);
    const [undoing, setUndoing] = useState<{ batch: ImportBatch; reconciled: string | null } | null>(null);
    // A PDF waiting for its password; the password lives only in this field and is cleared once used
    const [locked, setLocked] = useState<File | null>(null);
    const [password, setPassword] = useState('');

    async function loadHistory() {
        const result = await apiGet<ImportBatch[]>('/api/imports');
        if (result.ok) setHistory(result.data);
    }

    useEffect(() => {
        (async () => {
            const [accountList, categoryList, profileList] = await Promise.all([
                apiGet<Account[]>('/api/accounts'), apiGet<Category[]>('/api/categories'), apiGet<Profile[]>('/api/imports/profiles'),
            ]);
            if (redirectIfUnauthorized(accountList) || !accountList.ok) return;
            setCategories(categoryList.ok ? categoryList.data : []);
            setProfiles(profileList.ok ? profileList.data : []);
            const wanted = new URLSearchParams(window.location.search).get('account');
            setAccountId(String(accountList.data.find(account => String(account.id) === wanted)?.id
                ?? accountList.data.find(account => account.type === 'bank')?.id ?? accountList.data[0]?.id ?? ''));
            setAccounts(accountList.data);
            await loadHistory();
        })();
        // Once on page load
    }, []);

    const account = accounts?.find(item => String(item.id) === accountId) ?? null;
    const accountKind = account?.type === 'credit_card' ? 'card' : 'bank';
    const fallbacks = useMemo(() => ({
        income: categories.find(category => category.kind === 'income' && category.fallback)?.id,
        expense: categories.find(category => category.kind === 'expense' && category.fallback)?.id,
    }), [categories]);

    function resetReview() {
        setReview(null);
        setChoices([]);
        setResult(null);
    }

    /** Read the rows with these columns and send them for review */
    async function readAndReview(table: Table, headerRow: number, mapping: Mapping, forAccount: string) {
        const read = readRows(table, headerRow, mapping);
        setParsed(read);
        resetReview();
        if (read.rows.length === 0) {
            setProblem(t('imports.problems.noRows'));
            setEditing(true);
            return;
        }
        setProblem(null);
        const response = await apiPost<Review>('/api/imports/preview', {
            accountId: Number(forAccount),
            rows: read.rows.map(row => ({ line: row.line, date: row.date, description: row.description || t('imports.noDescription'), narration: row.narration, amount: paiseText(row.paise) })),
        });
        if (redirectIfUnauthorized(response)) return;
        if (!response.ok) {
            setProblem(httpError(response));
            return;
        }
        setReview(response.data);
        setChoices(response.data.rows.map(row => ({
            include: row.duplicate === null,
            description: row.description,
            action: encode(row.action, toPaise(row.amount) > 0 ? fallbacks.income : fallbacks.expense),
        })));
    }

    /** Find the layout (a saved column choice first), then review */
    async function analyse(loaded: LoadedFile, forAccount: string) {
        const kind = accounts?.find(item => String(item.id) === forAccount)?.type === 'credit_card' ? 'card' : 'bank';
        const found = detectLayout(loaded.table, kind);
        resetReview();
        setParsed(null);
        if (!found) {
            setLayout(null);
            setProblem(t('imports.problems.notStatement'));
            return;
        }
        const saved = profiles.find(profile => profile.signature === layoutSignature(found.header));
        const mapping = saved && mappingProblem(saved.mapping, found.header.length) === null ? saved.mapping : found.mapping;
        setLayout({ ...found, mapping, saved: Boolean(saved && mapping === saved.mapping) });
        if (!mapping) {
            setProblem(null);
            setEditing(true);
            return;
        }
        setEditing(false);
        await readAndReview(loaded.table, found.headerRow, mapping, forAccount);
    }

    async function chooseFile(chosen: File | undefined, withPassword?: string) {
        if (!chosen) return;
        setProblem(null);
        try {
            const { table, kind } = await readStatementFile(chosen, withPassword);
            setLocked(null);
            setPassword('');
            const loaded = { name: chosen.name, kind, table };
            setFile(loaded);
            await analyse(loaded, accountId);
        } catch (error) {
            const problem = error instanceof StatementFileError ? error.problem : 'unreadable';
            setFile(null);
            setLayout(null);
            resetReview();
            setPassword('');
            setLocked(problem === 'pdfPassword' || problem === 'pdfWrongPassword' ? chosen : null);
            setProblem(t(`imports.problems.${problem}`));
        }
    }

    async function changeAccount(id: string) {
        setAccountId(id);
        if (file) await analyse(file, id);
    }

    async function useColumns(headerRow: number, mapping: Mapping) {
        if (!file) return;
        const header = file.table[headerRow] ?? [];
        setLayout({ headerRow, header, preset: null, mapping, saved: false });
        setEditing(false);
        await readAndReview(file.table, headerRow, mapping, accountId);
    }

    function startOver() {
        setFile(null);
        setLayout(null);
        setParsed(null);
        setProblem(null);
        setEditing(false);
        setLocked(null);
        setPassword('');
        resetReview();
    }

    const update = (index: number, change: Partial<Choice>) => setChoices(current => current.map((choice, i) => (i === index ? { ...choice, ...change } : choice)));

    async function save() {
        if (!review || !file || !layout?.mapping || !parsed) return;
        const kept = review.rows.map((row, index) => ({ row, choice: choices[index]! })).filter(item => item.choice.include);
        const closing = closingBalance(parsed.rows);
        setSaving(true);
        const response = await apiPost<ImportResult>('/api/imports', {
            accountId: review.account.id,
            fileKind: file.kind,
            rowsInFile: parsed.rows.length,
            closingBalance: closing ? { date: closing.date, amount: paiseText(closing.paise) } : null,
            layout: { signature: layoutSignature(layout.header), presetKey: layout.preset?.key ?? null, mapping: layout.mapping },
            rows: kept.map(({ row, choice }) => ({
                line: row.line, date: row.date, description: choice.description.trim() || t('imports.noDescription'), amount: row.amount, action: decode(choice.action),
            })),
        });
        setSaving(false);
        if (redirectIfUnauthorized(response)) return;
        if (!response.ok) return toast('error', httpError(response));
        // The column choice is remembered for this layout's next statement
        const signature = layoutSignature(layout.header);
        setProfiles(current => [{ signature, presetKey: layout.preset?.key ?? null, mapping: layout.mapping!, accountId: review.account.id },
            ...current.filter(profile => profile.signature !== signature)]);
        setResult(response.data);
        setReview(null);
        setFile(null);
        setLayout(null);
        setParsed(null);
        await loadHistory();
    }

    async function undo(confirmReconciled: boolean) {
        if (!undoing) return;
        const response = await apiDelete<{ undone: number }>(`/api/imports/${undoing.batch.id}${confirmReconciled ? '?confirmReconciled=true' : ''}`);
        if (redirectIfUnauthorized(response)) return;
        if (response.status === 409) {
            setUndoing({ ...undoing, reconciled: httpError(response) });
            return;
        }
        setUndoing(null);
        if (!response.ok) return toast('error', httpError(response));
        toast('success', t('imports.undoDone', { count: response.data.undone }));
        if (result?.batchId === undoing.batch.id) setResult(null);
        await loadHistory();
    }

    if (accounts === null) return null;

    const selected = choices.filter(choice => choice.include).length;
    const duplicates = review?.rows.filter(row => row.duplicate).length ?? 0;
    const after = review ? review.rows.reduce((sum, row, index) => sum + (choices[index]?.include ? toPaise(row.amount) : 0), toPaise(review.account.balance)) : 0;
    const closing = parsed ? closingBalance(parsed.rows) : null;
    const dates = parsed?.rows.map(row => row.date).sort() ?? [];

    return (
        <div id="import-section">
            <div className="page-header">
                <div>
                    <h2>{t('imports.title')}</h2>
                    <p>{t('imports.subtitle')}</p>
                </div>
            </div>

            <section className="card" aria-labelledby="import-file-title">
                <div className="card-head">
                    <h3 id="import-file-title"><span className="icon-tile t-bank" aria-hidden="true"><FileUp /></span>{t('imports.file')}</h3>
                </div>
                <div className="add-row other-add-row">
                    <div className="field">
                        <label htmlFor="import-account">{t('imports.account')}</label>
                        <select id="import-account" value={accountId} onChange={event => changeAccount(event.target.value)}>
                            {accounts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                        </select>
                    </div>
                    <div className="field">
                        <label htmlFor="import-file">{t('imports.choose')}</label>
                        <input id="import-file" type="file" accept=".csv,.txt,.xls,.xlsx,.pdf,text/csv,application/pdf"
                            onChange={event => { chooseFile(event.target.files?.[0]); event.target.value = ''; }} />
                    </div>
                </div>
                <p className="card-pad form-note import-privacy">{t('imports.privacy')} {t('imports.formats', { max: MAX_IMPORT_ROWS })}</p>
                {problem ? <p className="notice warn import-problem" id="import-problem" role="alert">{problem}</p> : null}
                {locked ? (
                    <form className="add-row single import-password" onSubmit={event => { event.preventDefault(); chooseFile(locked, password); }}>
                        <div className="field">
                            <label htmlFor="import-password">{t('imports.password')}</label>
                            <input id="import-password" type="password" autoComplete="off" value={password} onChange={event => setPassword(event.target.value)} />
                            <span className="field-hint">{t('imports.passwordHelp')}</span>
                        </div>
                        <button type="submit" className="btn btn-primary" data-action="openPdf" disabled={password === ''}>{t('imports.open')}</button>
                    </form>
                ) : null}
            </section>

            {file && layout ? (
                <section className="card" aria-labelledby="import-columns-title" id="import-columns">
                    <div className="card-head">
                        <h3 id="import-columns-title"><span className="icon-tile t-wealth" aria-hidden="true"><Columns3 /></span>{t('imports.columns')}</h3>
                        <span className="meta" id="import-layout">
                            {editing || !layout.mapping ? t('imports.layoutUnknown')
                                : layout.saved ? t('imports.layoutSaved')
                                    : layout.preset ? t('imports.layoutKnown', { bank: layout.preset.bank, kind: t(`imports.kinds.${layout.preset.kind}`) })
                                        : t('imports.layoutFound')}
                        </span>
                    </div>
                    {editing ? (
                        <ColumnsEditor key={`${file.name}-${layout.headerRow}`} table={file.table} headerRow={layout.headerRow} mapping={layout.mapping}
                            accountKind={accountKind} onUse={useColumns} />
                    ) : (
                        <div className="card-pad import-columns-summary">
                            <p id="import-read-count">
                                {parsed && dates.length > 0 ? t('imports.readCount', { count: parsed.rows.length, from: day(dates[0]!), to: day(dates[dates.length - 1]!) }) : ''}
                                {parsed && parsed.skipped > 0 ? t('imports.skipped', { count: parsed.skipped }) : ''}
                            </p>
                            {parsed?.tooMany ? <p className="notice warn">{t('imports.tooMany', { max: MAX_IMPORT_ROWS })}</p> : null}
                            <button type="button" className="btn btn-secondary btn-sm" data-action="changeColumns" onClick={() => setEditing(true)}>{t('imports.change')}</button>
                        </div>
                    )}
                </section>
            ) : null}

            {review ? (
                <section className="card" aria-labelledby="import-review-title" id="import-review">
                    <div className="card-head">
                        <h3 id="import-review-title"><span className="icon-tile t-income" aria-hidden="true"><ListChecks /></span>{t('imports.review')}</h3>
                        <span className="meta" id="import-selected">{t('imports.selected', { selected, total: review.rows.length })}</span>
                    </div>
                    <div className="card-pad import-summary">
                        {duplicates > 0 ? <p id="import-duplicates">{t('imports.duplicates', { count: duplicates })}</p> : null}
                        <p id="import-balances">
                            {t('imports.balances', { account: review.account.name, now: formatRupees(review.account.balance), after: formatRupees(paiseText(after)) })}
                            {closing ? ` ${t('imports.statementEnds', { amount: formatRupees(paiseText(closing.paise)), date: day(closing.date) })}` : ''}
                        </p>
                    </div>
                    <ul id="import-rows" className="import-rows">
                        {review.rows.map((row, index) => {
                            const choice = choices[index]!;
                            const paise = toPaise(row.amount);
                            const kind = paise > 0 ? 'income' : 'expense';
                            const cardCredit = review.account.type === 'credit_card' && kind === 'income';
                            const options = categories.filter(category => category.kind === kind && (!cardCredit || CARD_INCOME_KEYS.includes(category.key ?? '')));
                            const others = accounts.filter(item => item.id !== review.account.id);
                            const chosen = decode(choice.action);
                            return (
                                <li key={row.line} data-line={row.line} className={`import-row${row.duplicate ? ' is-duplicate' : ''}${choice.include ? '' : ' is-left-out'}`}>
                                    <label className="select-entry">
                                        <input type="checkbox" data-action="includeRow" checked={choice.include} aria-label={t('imports.include', { line: row.line })}
                                            onChange={event => update(index, { include: event.target.checked })} />
                                        <span className="when">{day(row.date)}</span>
                                    </label>
                                    <span className={paise > 0 ? 'amount in' : 'amount out'}>{signedRupees(row.amount)}</span>
                                    <input className="import-description" aria-label={t('imports.descriptionLabel', { line: row.line })} maxLength={200}
                                        value={choice.description} onChange={event => update(index, { description: event.target.value })} />
                                    <select className="import-action" data-action="rowAction" aria-label={t('imports.recordAs')} value={choice.action}
                                        onChange={event => update(index, { action: event.target.value })}>
                                        <optgroup label={kind === 'income' ? t('imports.asIncome') : t('imports.asSpending')}>
                                            {options.map(category => <option key={category.id} value={`c:${category.id}`}>{category.name}</option>)}
                                        </optgroup>
                                        <optgroup label={t('imports.asTransfer')}>
                                            {others.map(item => (
                                                <option key={item.id} value={`t:${item.id}`}>
                                                    {paise > 0 ? t('imports.transferFrom', { name: item.name }) : t('imports.transferTo', { name: item.name })}
                                                </option>
                                            ))}
                                            {row.match ? (
                                                <option value={`r:${row.match.entryId}`}>
                                                    {t('imports.replaceMatch', { account: row.match.accountName, description: row.match.description, date: day(row.match.date) })}
                                                </option>
                                            ) : null}
                                        </optgroup>
                                    </select>
                                    <div className="import-notes">
                                        {row.duplicate ? <p className="import-note warn" data-note="duplicate">{t('imports.duplicate', { description: row.duplicate.description, date: day(row.duplicate.date) })}</p> : null}
                                        {row.repeated ? <p className="import-note" data-note="repeated">{t('imports.repeated')}</p> : null}
                                        {row.reason === 'match' && row.match && chosen.type === 'replace' ? (
                                            <p className="import-note" data-note="match">{t('imports.reasons.match', { description: row.match.description, account: row.match.accountName, date: day(row.match.date) })}</p>
                                        ) : row.reason && row.reason !== 'match' && choice.action === encode(row.action, kind === 'income' ? fallbacks.income : fallbacks.expense) ? (
                                            <p className="import-note" data-note={row.reason}>{t(`imports.reasons.${row.reason}`)}</p>
                                        ) : null}
                                        {row.match && chosen.type !== 'replace' ? (
                                            <p className="import-note" data-note="possible-match">{t('imports.possibleMatch', { description: row.match.description, account: row.match.accountName, date: day(row.match.date) })}</p>
                                        ) : null}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                    <div className="settings-actions">
                        <button type="button" className="btn btn-primary" data-action="importRows" disabled={selected === 0 || saving} onClick={save}>
                            {t('imports.importRows', { count: selected })}
                        </button>
                        <button type="button" className="btn btn-secondary" data-action="startOver" onClick={startOver}>{t('imports.startOver')}</button>
                    </div>
                </section>
            ) : null}

            {result ? (
                <section className="card" aria-labelledby="import-done-title" id="import-done">
                    <div className="card-head">
                        <h3 id="import-done-title"><span className="icon-tile t-income" aria-hidden="true"><ListChecks /></span>{t('imports.done')}</h3>
                    </div>
                    <div className="card-pad">
                        <p id="import-done-text">
                            {t('imports.doneText', { count: result.imported, account: result.account.name })}
                            {result.transfers > 0 ? t('imports.doneTransfers', { count: result.transfers }) : ''}
                            {result.replaced > 0 ? t('imports.doneReplaced', { count: result.replaced }) : ''}.
                        </p>
                        {result.closing ? (
                            <p id="import-closing" className={toPaise(result.closing.difference) === 0 ? 'ok' : 'notice warn'}>
                                {toPaise(result.closing.difference) === 0
                                    ? t('imports.closingMatches', { amount: formatRupees(result.closing.balance), date: day(result.closing.date) })
                                    : t('imports.closingDiffers', {
                                        date: day(result.closing.date), statement: formatRupees(result.closing.balance), findb: formatRupees(result.closing.findb),
                                        difference: formatRupees(result.closing.difference),
                                    })}
                            </p>
                        ) : null}
                    </div>
                    <div className="settings-actions">
                        <a className="btn btn-primary" href="/transactions">{t('imports.viewTransactions')}</a>
                        <a className="btn btn-secondary" href={`/reconcile?account=${result.account.id}`}>{t('imports.reconcile')}</a>
                    </div>
                </section>
            ) : null}

            <FoldingCard id="import-history" titleId="import-history-title" icon={History} tile="t-wealth" title={t('imports.history')}>
                <ul id="import-history-list" className="settings-list">
                    {history.length === 0 ? <li>{t('imports.historyNone')}</li> : history.map(batch => (
                        <li key={batch.id} data-import={batch.id}>
                            <span>
                                <span className="what">{t('imports.historyItem', { account: batch.account.name, count: batch.imported })}</span>
                                <span className="when"> {t('imports.historyPeriod', {
                                    from: batch.from ? day(batch.from) : '', to: batch.to ? day(batch.to) : '', when: day(batch.createdAt.slice(0, 10)),
                                })}</span>
                            </span>
                            {batch.undoneAt ? <span className="tag">{t('imports.undone')}</span> : (
                                <button type="button" className="btn btn-secondary btn-sm" data-action="undoImport" onClick={() => setUndoing({ batch, reconciled: null })}>
                                    <Undo2 aria-hidden="true" /> {t('imports.undo')}
                                </button>
                            )}
                        </li>
                    ))}
                </ul>
            </FoldingCard>

            <Modal
                id="undo-import-modal"
                title={t('imports.undoTitle')}
                open={undoing !== null}
                small
                closeAction="close-undo-import"
                onClose={() => setUndoing(null)}
                footer={(
                    <>
                        <button type="button" className="btn btn-secondary" data-action="close-undo-import" onClick={() => setUndoing(null)}>{t('common.cancel')}</button>
                        <button type="button" className="btn btn-primary" data-action="confirm-undo-import" onClick={() => undo(Boolean(undoing?.reconciled))}>
                            {undoing?.reconciled ? t('imports.undoAnyway') : t('imports.undo')}
                        </button>
                    </>
                )}
            >
                <p id="undo-import-text">{undoing?.reconciled ?? t('imports.undoText', { count: undoing?.batch.active ?? 0 })}</p>
            </Modal>
        </div>
    );
}
