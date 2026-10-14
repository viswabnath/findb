'use client';

import { useState } from 'react';
import { t } from '@/lib/i18n';
import { signedRupees } from '@/lib/format';
import { mappingProblem, paiseText, readRows, type DateOrder, type Mapping, type MappingField, type Table } from '@/src/core/statement';

/**
 * Choose which column of a statement holds what, for a layout FinDB does not know (or to correct
 * one it found). The first rows read with the choice are shown as it changes.
 */

const FIELDS: { field: MappingField; required?: boolean }[] = [
    { field: 'date', required: true }, { field: 'description', required: true }, { field: 'debit' }, { field: 'credit' },
    { field: 'amount' }, { field: 'direction' }, { field: 'balance' }, { field: 'reference' },
];

const EMPTY: Mapping = {
    date: 0, description: 1, debit: null, credit: null, amount: null, direction: null, balance: null, reference: null, dateOrder: 'dmy', positive: 'in',
};

const day = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

interface Props {
    table: Table;
    headerRow: number;
    mapping: Mapping | null;
    accountKind: 'bank' | 'card';
    onUse: (headerRow: number, mapping: Mapping) => void;
}

export function ColumnsEditor({ table, headerRow, mapping, accountKind, onUse }: Props) {
    const [row, setRow] = useState(headerRow);
    const [draft, setDraft] = useState<Mapping>(mapping ?? { ...EMPTY, positive: accountKind === 'card' ? 'out' : 'in' });
    const header = table[row] ?? [];
    const columns = Math.max(header.length, ...table.slice(row + 1, row + 20).map(cells => cells.length));
    const problem = mappingProblem(draft, columns);
    const sample = problem ? [] : readRows(table, row, draft, 3).rows;

    const set = (field: MappingField, value: string) => setDraft(current => ({ ...current, [field]: value === '' ? null : Number(value) }));
    const columnName = (index: number) => (header[index]?.trim() ? header[index]!.trim() : t('imports.column', { number: index + 1 }));

    return (
        <div id="import-columns-editor" className="card-pad import-columns">
            <div className="import-columns-grid">
                <div className="field">
                    <label htmlFor="import-header-line">{t('imports.headerLine')}</label>
                    <input id="import-header-line" type="number" min={1} max={table.length} value={row + 1}
                        onChange={event => setRow(Math.min(Math.max(Number(event.target.value) - 1, 0), Math.max(table.length - 1, 0)))} />
                </div>
                {FIELDS.map(({ field, required }) => (
                    <div className="field" key={field}>
                        <label htmlFor={`import-column-${field}`}>{t(`imports.fields.${field}`)}</label>
                        <select id={`import-column-${field}`} data-field={field} value={draft[field] ?? ''} onChange={event => set(field, event.target.value)}>
                            {required ? null : <option value="">{t('imports.none')}</option>}
                            {Array.from({ length: columns }, (_, index) => <option key={index} value={index}>{columnName(index)}</option>)}
                        </select>
                    </div>
                ))}
                <div className="field">
                    <label htmlFor="import-date-order">{t('imports.dateOrder')}</label>
                    <select id="import-date-order" value={draft.dateOrder} onChange={event => setDraft(current => ({ ...current, dateOrder: event.target.value as DateOrder }))}>
                        {(['dmy', 'mdy', 'ymd'] as const).map(order => <option key={order} value={order}>{t(`imports.dateOrders.${order}`)}</option>)}
                    </select>
                </div>
                {draft.amount !== null && draft.direction === null ? (
                    <div className="field">
                        <label htmlFor="import-positive">{t('imports.positive')}</label>
                        <select id="import-positive" value={draft.positive} onChange={event => setDraft(current => ({ ...current, positive: event.target.value as 'in' | 'out' }))}>
                            <option value="in">{t('imports.positives.in')}</option>
                            <option value="out">{t('imports.positives.out')}</option>
                        </select>
                    </div>
                ) : null}
            </div>
            <p className="form-note import-sample-title">{t('imports.sample')}</p>
            {problem ? (
                <p className="notice warn" id="import-columns-problem">
                    {problem === 'date' || problem === 'description' || problem === 'amount' ? t(`imports.missing.${problem}`) : t('imports.missing.other')}
                </p>
            ) : sample.length === 0 ? (
                <p className="notice warn" id="import-columns-problem">{t('imports.sampleNone')}</p>
            ) : (
                <ul className="settings-list import-sample">
                    {sample.map(item => (
                        <li key={item.line}>
                            <span><span className="what">{item.description || t('imports.noDescription')}</span> <span className="when">{day(item.date)}</span></span>
                            <span className={item.paise > 0 ? 'amount in' : 'amount out'}>{signedRupees(paiseText(item.paise))}</span>
                        </li>
                    ))}
                </ul>
            )}
            <div className="settings-actions">
                <button type="button" className="btn btn-primary" data-action="useColumns" disabled={problem !== null || sample.length === 0}
                    onClick={() => onUse(row, draft)}>
                    {t('imports.useColumns')}
                </button>
            </div>
        </div>
    );
}
