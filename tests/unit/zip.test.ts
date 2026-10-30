/**
 * Unit tests for lib/zip.ts: a stored ZIP that unzips back to its files, and safe CSV rows
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { csvRow, zipFiles } from '../../lib/zip';

test('the files come back out exactly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'findb-zip-'));
    try {
        const zip = zipFiles([{ name: 'a.csv', content: 'id,name\n1,Café ₹\n' }, { name: 'b.json', content: '{"x":1}' }], new Date('2026-10-30T10:00:00Z'));
        writeFileSync(join(dir, 'export.zip'), zip);
        execFileSync('unzip', ['-q', 'export.zip'], { cwd: dir });
        expect(readFileSync(join(dir, 'a.csv'), 'utf8')).toBe('id,name\n1,Café ₹\n');
        expect(readFileSync(join(dir, 'b.json'), 'utf8')).toBe('{"x":1}');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('CSV fields are quoted when needed, and formulas are neutralised', () => {
    expect(csvRow([1, 'plain', null, 'a,b', 'say "hi"', 'two\nlines'])).toBe('1,plain,,"a,b","say ""hi""","two\nlines"');
    expect(csvRow(['=SUM(A1)', '-250.00', '+91 98', '@cmd'])).toBe("'=SUM(A1),-250.00,'+91 98,'@cmd");
    expect(csvRow([new Date('2026-10-30T00:00:00Z'), { a: 1 }])).toBe('2026-10-30T00:00:00.000Z,"{""a"":1}"');
});
