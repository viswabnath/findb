import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * Error messages the API returns come from messages/en.ts (the errors section), like every word
 * on a screen, so a translation needs no code changes. This scans lib/ and app/api/ for a
 * RequestError, jsonError or route errorMessage given as a plain string or template literal.
 */

const ROOT = join(__dirname, '..', '..');

function walk(folder: string): string[] {
    return readdirSync(folder).flatMap(name => {
        const path = join(folder, name);
        if (statSync(path).isDirectory()) return walk(path);
        return path.endsWith('.ts') ? [path] : [];
    });
}

const WRITTEN_IN = /(RequestError\(\s*\d+\s*,|jsonError\(\s*\d+\s*,|errorMessage:)\s*(?:[^'"`,)]*\?\s*)?['"`]/g;

function problems(source: string): string[] {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    return [...code.matchAll(WRITTEN_IN)].map(match => match[0]);
}

test('the check itself finds messages written into the code', () => {
    expect(problems("throw new RequestError(400, 'Bank not found');")).toHaveLength(1);
    expect(problems('throw new RequestError(400, `${label} not found`);')).toHaveLength(1);
    expect(problems("return jsonError(404, 'Not found');")).toHaveLength(1);
    expect(problems("{ errorMessage: 'Logout failed' }")).toHaveLength(1);
    expect(problems("throw new RequestError(400, kind ? 'One' : 'Other');")).toHaveLength(1);
    expect(problems("throw new RequestError(400, t('errors.bankNotFound'));")).toHaveLength(0);
});

test('no API error message is written into lib/ or app/api/', () => {
    const found = [...walk(join(ROOT, 'lib')), ...walk(join(ROOT, 'app', 'api'))]
        .flatMap(path => problems(readFileSync(path, 'utf8')).map(problem => `${relative(ROOT, path)}: ${problem}`));
    expect(found).toEqual([]);
});
