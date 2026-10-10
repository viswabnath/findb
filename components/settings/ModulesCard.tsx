'use client';

import { useEffect, useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { apiGet, apiPut, httpError, redirectIfUnauthorized } from '@/lib/api-client';
import { MODULES } from '@/lib/modules';
import { t } from '@/lib/i18n';

/** What FinDB tracks (/api/modules): switching a module off hides it and keeps its data */
export function ModulesCard() {
    const toast = useToast();
    const [modules, setModules] = useState<string[] | null>(null);

    useEffect(() => {
        apiGet<{ modules: string[] }>('/api/modules').then(result => {
            if (redirectIfUnauthorized(result)) return;
            if (result.ok) setModules(result.data.modules);
        });
    }, []);

    async function toggle(key: string, on: boolean) {
        if (!modules) return;
        const next = on ? [...modules, key] : modules.filter(item => item !== key);
        const result = await apiPut<{ modules: string[] }>('/api/modules', { modules: next });
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        setModules(result.data.modules);
        const name = MODULES.find(module => module.key === key)?.name;
        toast('success', t(on ? 'settings.modules.on' : 'settings.modules.off', { name: name ?? '' }));
    }

    if (modules === null) return null;

    return (
        <section id="modules-section" className="card" aria-labelledby="modules-title">
            <div className="card-head">
                <h3 id="modules-title"><span className="icon-tile t-wealth" aria-hidden="true"><LayoutGrid /></span>{t('settings.modules.title')}</h3>
            </div>
            <p className="card-pad form-note">{t('settings.modules.note')}</p>
            <div className="card-pad module-choices">
                {MODULES.map(module => (
                    <label key={module.key} className="module-choice">
                        <input type="checkbox" data-module={module.key} checked={modules.includes(module.key)}
                            onChange={event => toggle(module.key, event.target.checked)} />
                        <span>
                            <b>{module.name}{module.available ? null : <span className="tag">{t('settings.modules.comingSoon')}</span>}</b>
                            <small>{module.line}</small>
                        </span>
                    </label>
                ))}
            </div>
        </section>
    );
}
