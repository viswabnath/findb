'use client';

import { useEffect, useState } from 'react';
import { FileText, Upload } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { apiGet, redirectIfUnauthorized } from '@/lib/api-client';
import { t } from '@/lib/i18n';
import { sizeText, uploadFile, type VaultDocument } from './DocumentsScreen';

/**
 * The documents of one entry (a receipt, an invoice), from the Transactions screen: those linked
 * to it, and a new one uploaded straight onto it, named and dated like the entry.
 */

interface Props {
    entry: { id: number; description: string; date: string } | null;
    onClose: () => void;
}

export function AttachDocuments({ entry, onClose }: Props) {
    const toast = useToast();
    const [documents, setDocuments] = useState<VaultDocument[]>([]);
    const [uploading, setUploading] = useState(false);

    async function load(entryId: number) {
        const result = await apiGet<{ documents: VaultDocument[] }>(`/api/documents?entryId=${entryId}`);
        if (redirectIfUnauthorized(result) || !result.ok) return;
        setDocuments(result.data.documents);
    }

    useEffect(() => {
        setDocuments([]);
        if (entry) load(entry.id);
    }, [entry]);

    async function attach(file: File | undefined) {
        if (!file || !entry) return;
        setUploading(true);
        const result = await uploadFile(file, { kind: 'receipt', title: entry.description, date: entry.date }, [{ type: 'entry', id: entry.id }]);
        setUploading(false);
        if (!result.ok) return result.error ? toast('error', result.error) : undefined;
        toast('success', t('documents.uploaded', { title: result.document.title }));
        await load(entry.id);
    }

    return (
        <Modal id="attach-documents-modal" title={t('documents.attachTitle', { description: entry?.description ?? '' })} open={entry !== null} closeAction="close-attach-documents"
            onClose={onClose}
            footer={<button type="button" className="btn btn-secondary" data-action="close-attach-documents" onClick={onClose}>{t('common.close')}</button>}>
            <ul className="settings-list" id="attached-documents">
                {documents.length === 0 ? <li>{t('documents.noneAttached')}</li> : documents.map(item => (
                    <li key={item.id} data-document={item.title}>
                        <span><FileText className="inline-icon" aria-hidden="true" /> <span className="what">{item.title}</span> <span className="when">{sizeText(item.size)}</span></span>
                        <a className="btn btn-secondary btn-sm" href={`/api/documents/${item.id}/file`} target="_blank" rel="noopener">{t('documents.open')}</a>
                    </li>
                ))}
            </ul>
            <div className="field attach-upload">
                <label htmlFor="attach-file"><Upload className="inline-icon" aria-hidden="true" /> {uploading ? t('documents.uploading') : t('documents.attach')}</label>
                <input id="attach-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={uploading}
                    onChange={event => { attach(event.target.files?.[0]); event.target.value = ''; }} />
                <span className="field-hint">{t('documents.fileHint')}</span>
            </div>
        </Modal>
    );
}
