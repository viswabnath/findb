'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, Compass } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { apiDelete, apiGet, apiPost, httpError, redirectIfUnauthorized } from '@/lib/api-client';

interface NextStep { kind: string; text: string; href?: string; label: string }

/** The one clear next step (/api/next-step), above the Accounts screen's figures */
export function NextStepCard() {
    const toast = useToast();
    const [step, setStep] = useState<NextStep | null>(null);

    useEffect(() => {
        apiGet<NextStep>('/api/next-step').then(result => {
            if (redirectIfUnauthorized(result)) return;
            if (result.ok) setStep(result.data);
        });
    }, []);

    async function sample(load: boolean) {
        const result = load ? await apiPost('/api/sample-data', {}) : await apiDelete('/api/sample-data');
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        // Every screen and figure changes, and the banner appears or goes: start again from Accounts
        window.location.assign('/setup');
    }

    // With sample data loaded, the banner at the top already says what to do
    if (step === null || step.kind === 'sample') return null;

    return (
        <section id="next-step" className="next-step" data-step={step.kind} aria-label="Next step">
            <span className="icon-tile t-income" aria-hidden="true"><Compass /></span>
            <p>{step.text}</p>
            <div className="next-step-actions">
                {step.kind === 'sample' ? (
                    <button type="button" className="btn btn-secondary" data-action="clearSampleStep" onClick={() => sample(false)}>{step.label}</button>
                ) : (
                    <>
                        {step.kind === 'start' ? (
                            <button type="button" className="btn btn-secondary" data-action="loadSample" onClick={() => sample(true)}>Try sample data</button>
                        ) : null}
                        <a className="btn btn-primary" href={step.href} data-action="nextStep">{step.label} <ArrowRight aria-hidden="true" /></a>
                    </>
                )}
            </div>
        </section>
    );
}
