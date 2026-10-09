'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, UserRound } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { apiDelete, apiGet, apiPost, apiPut, httpError, redirectIfUnauthorized } from '@/lib/api-client';

/**
 * The profile (/api/profile) and dependants: all optional. PAN and demat account IDs are stored
 * encrypted and only ever shown masked; Aadhaar is at most its last four digits.
 */

interface Profile {
    dateOfBirth: string | null; city: string | null; taxResidency: string | null; panMasked: string | null;
    aadhaarLast4: string | null; dematAccounts: { broker: string; accountMasked: string }[];
}
interface Dependant { id: number; relationship: string; name: string; dateOfBirth: string | null }

const RELATIONSHIPS: Record<string, string> = { spouse: 'Spouse', child: 'Child', parent: 'Parent', other: 'Other' };

export function ProfileCard() {
    const toast = useToast();
    const [profile, setProfile] = useState<Profile | null>(null);
    const [dependants, setDependants] = useState<Dependant[]>([]);
    const [form, setForm] = useState({ dateOfBirth: '', city: '', taxResidency: '', pan: '', aadhaarLast4: '' });
    const [demat, setDemat] = useState({ broker: '', accountId: '' });
    const [dependant, setDependant] = useState({ relationship: 'spouse', name: '', dateOfBirth: '' });

    const load = useCallback(async () => {
        const [profileResult, dependantsResult] = await Promise.all([apiGet<Profile>('/api/profile'), apiGet<Dependant[]>('/api/profile/dependants')]);
        if (redirectIfUnauthorized(profileResult) || redirectIfUnauthorized(dependantsResult)) return;
        if (profileResult.ok) {
            setProfile(profileResult.data);
            setForm({
                dateOfBirth: profileResult.data.dateOfBirth ?? '', city: profileResult.data.city ?? '', taxResidency: profileResult.data.taxResidency ?? '',
                pan: '', aadhaarLast4: profileResult.data.aadhaarLast4 ?? '',
            });
        }
        if (dependantsResult.ok) setDependants(dependantsResult.data);
    }, []);

    useEffect(() => {
        load();
        // Once on page load; the buttons reload afterwards
    }, []);

    async function save(body: Record<string, unknown>, message: string) {
        const result = await apiPut<Profile>('/api/profile', body);
        if (redirectIfUnauthorized(result)) return false;
        if (!result.ok) {
            toast('error', httpError(result));
            return false;
        }
        toast('success', message);
        await load();
        return true;
    }

    async function saveDetails() {
        // PAN only when a new one is typed: the stored one is never sent to the browser
        await save({
            dateOfBirth: form.dateOfBirth, city: form.city, taxResidency: form.taxResidency, aadhaarLast4: form.aadhaarLast4,
            ...(form.pan.trim() ? { pan: form.pan } : {}),
        }, 'Profile saved');
    }

    async function addDemat() {
        if (!profile) return;
        // The stored IDs are never sent to the browser, so a new list cannot be rebuilt here from masked ones:
        // the API adds to it when given only the new account
        const result = await apiPost<Profile>('/api/profile/demat', demat);
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        toast('success', 'Demat account added');
        setDemat({ broker: '', accountId: '' });
        await load();
    }

    async function removeDemat(index: number) {
        const result = await apiDelete(`/api/profile/demat/${index}`);
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        await load();
    }

    async function addDependant() {
        const result = await apiPost('/api/profile/dependants', dependant);
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        toast('success', `${dependant.name.trim()} added`);
        setDependant({ relationship: 'child', name: '', dateOfBirth: '' });
        await load();
    }

    async function removeDependant(item: Dependant) {
        const result = await apiDelete(`/api/profile/dependants/${item.id}`);
        if (redirectIfUnauthorized(result)) return;
        if (!result.ok) return toast('error', httpError(result));
        await load();
    }

    if (profile === null) return null;

    return (
        <section id="profile-section" className="card" aria-labelledby="profile-title">
            <div className="card-head">
                <h3 id="profile-title"><span className="icon-tile t-bank" aria-hidden="true"><UserRound /></span>Profile</h3>
                <span className="meta">All optional</span>
            </div>
            <p className="card-pad form-note">
                Used for age-based rules (such as senior citizen interest), tax and your financial review. PAN and account IDs are
                encrypted before they are saved and only ever shown masked; FinDB keeps at most the last four digits of Aadhaar.
            </p>
            <form className="card-pad form-grid two" onSubmit={event => { event.preventDefault(); saveDetails(); }}>
                <div className="field">
                    <label htmlFor="profile-dob">Date of birth</label>
                    <input type="date" id="profile-dob" value={form.dateOfBirth} onChange={event => setForm(value => ({ ...value, dateOfBirth: event.target.value }))} />
                </div>
                <div className="field">
                    <label htmlFor="profile-city">City</label>
                    <input type="text" id="profile-city" maxLength={80} value={form.city} onChange={event => setForm(value => ({ ...value, city: event.target.value }))} />
                </div>
                <div className="field">
                    <label htmlFor="profile-residency">Tax residency</label>
                    <select id="profile-residency" value={form.taxResidency} onChange={event => setForm(value => ({ ...value, taxResidency: event.target.value }))}>
                        <option value="">Not set</option>
                        <option value="resident">Resident</option>
                        <option value="nri">Non-resident (NRI)</option>
                        <option value="rnor">Resident but not ordinarily resident (RNOR)</option>
                    </select>
                </div>
                <div className="field">
                    <label htmlFor="profile-pan">PAN {profile.panMasked ? <span className="sub" id="profile-pan-masked">(saved: {profile.panMasked})</span> : null}</label>
                    <input type="text" id="profile-pan" maxLength={10} autoComplete="off" placeholder={profile.panMasked ? 'Type a new PAN to replace it' : 'ABCDE1234F'}
                        value={form.pan} onChange={event => setForm(value => ({ ...value, pan: event.target.value.toUpperCase() }))} />
                </div>
                <div className="field">
                    <label htmlFor="profile-aadhaar">Aadhaar, last four digits only</label>
                    <input type="text" id="profile-aadhaar" inputMode="numeric" maxLength={4} autoComplete="off" value={form.aadhaarLast4}
                        onChange={event => setForm(value => ({ ...value, aadhaarLast4: event.target.value.replace(/\D/g, '') }))} />
                </div>
                <div className="field profile-actions">
                    <button type="submit" className="btn btn-primary" data-action="saveProfile">Save profile</button>
                    {profile.panMasked ? (
                        <button type="button" className="btn btn-secondary" data-action="removePan" onClick={() => save({ pan: null }, 'PAN removed')}>Remove PAN</button>
                    ) : null}
                </div>
            </form>

            <h4 className="settings-subhead">Demat and broker accounts</h4>
            <ul id="demat-list" className="settings-list">
                {profile.dematAccounts.length === 0 ? <li>None saved</li> : profile.dematAccounts.map((account, index) => (
                    <li key={`${account.broker}-${index}`}>
                        <span><span className="what">{account.broker}</span> <span className="sub">{account.accountMasked}</span></span>
                        <button type="button" className="icon-btn danger" data-action="removeDemat" onClick={() => removeDemat(index)}><Trash2 aria-hidden="true" /> Remove</button>
                    </li>
                ))}
            </ul>
            <form className="add-row other-add-row" onSubmit={event => { event.preventDefault(); addDemat(); }}>
                <div className="field">
                    <label htmlFor="demat-broker">Broker</label>
                    <input type="text" id="demat-broker" maxLength={60} placeholder="Zerodha, Groww..." value={demat.broker} onChange={event => setDemat(value => ({ ...value, broker: event.target.value }))} />
                </div>
                <div className="field">
                    <label htmlFor="demat-id">Client or demat ID</label>
                    <input type="text" id="demat-id" maxLength={32} autoComplete="off" value={demat.accountId} onChange={event => setDemat(value => ({ ...value, accountId: event.target.value }))} />
                </div>
                <button type="submit" className="btn btn-secondary" data-action="addDemat"><Plus aria-hidden="true" /> Add</button>
            </form>

            <h4 className="settings-subhead">Dependants</h4>
            <ul id="dependants-list" className="settings-list">
                {dependants.length === 0 ? <li>None added</li> : dependants.map(item => (
                    <li key={item.id} data-dependant={item.id}>
                        <span><span className="what">{item.name}</span> <span className="sub">{RELATIONSHIPS[item.relationship]}{item.dateOfBirth ? `, born ${item.dateOfBirth}` : ''}</span></span>
                        <button type="button" className="icon-btn danger" data-action="removeDependant" onClick={() => removeDependant(item)}><Trash2 aria-hidden="true" /> Remove</button>
                    </li>
                ))}
            </ul>
            <form className="add-row other-add-row" onSubmit={event => { event.preventDefault(); addDependant(); }}>
                <div className="field">
                    <label htmlFor="dependant-relationship">Relationship</label>
                    <select id="dependant-relationship" value={dependant.relationship} onChange={event => setDependant(value => ({ ...value, relationship: event.target.value }))}>
                        {Object.entries(RELATIONSHIPS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                </div>
                <div className="field">
                    <label htmlFor="dependant-name">Name</label>
                    <input type="text" id="dependant-name" maxLength={80} value={dependant.name} onChange={event => setDependant(value => ({ ...value, name: event.target.value }))} />
                </div>
                <div className="field">
                    <label htmlFor="dependant-dob">Date of birth (optional)</label>
                    <input type="date" id="dependant-dob" value={dependant.dateOfBirth} onChange={event => setDependant(value => ({ ...value, dateOfBirth: event.target.value }))} />
                </div>
                <button type="submit" className="btn btn-secondary" data-action="addDependant"><Plus aria-hidden="true" /> Add</button>
            </form>
        </section>
    );
}
