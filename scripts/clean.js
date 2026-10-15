/**
 * Frees disk space after a test run: the Next.js build (rebuilt by every test run), test
 * results and traces, coverage, the API test servers' temporary folders, and npm's download
 * cache. Nothing here is needed between runs. Run with: npm run clean
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const sizeOf = target => {
    try {
        return Number(execSync(`du -sk "${target}"`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\t')[0]) * 1024;
    } catch {
        return 0;
    }
};

const targets = ['.next', 'test-results', 'playwright-report', 'coverage', 'tsconfig.tsbuildinfo'].map(name => path.join(root, name));
// The API test runner's server logs (scripts/run-api-tests.js), in the system's temporary folder
for (const name of fs.readdirSync(os.tmpdir())) if (name.startsWith('findb-api-')) targets.push(path.join(os.tmpdir(), name));

let freed = 0;
for (const target of targets.filter(item => fs.existsSync(item))) {
    freed += sizeOf(target);
    fs.rmSync(target, { recursive: true, force: true });
}
const npmCache = execSync('npm config get cache').toString().trim();
const before = sizeOf(npmCache);
execSync('npm cache clean --force', { stdio: 'ignore' });
freed += Math.max(0, before - sizeOf(npmCache));
console.log(`Freed ${(freed / 1024 / 1024).toFixed(0)} MB (build, test results, temporary files, npm cache)`);
