/**
 * Copies the receipt reader's files (tesseract.js, v2 Phase 2) from node_modules into
 * public/ocr/<version>/, so FinDB serves them itself: no CDN, and the browser caches them for good
 * under a versioned path. Runs after npm install (package.json "postinstall"); public/ocr is not in git.
 *
 *   worker.min.js                          the OCR worker (tesseract.js)
 *   tesseract-core-*-lstm.wasm.js          the engine; the worker picks the one the browser supports
 *   lang/eng.traineddata.gz                English, the compact "best_int" model
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const from = (...parts) => path.join(root, 'node_modules', ...parts);
const version = require(from('tesseract.js', 'package.json')).version;
const target = path.join(root, 'public', 'ocr', version);

const files = [
    [from('tesseract.js', 'dist', 'worker.min.js'), 'worker.min.js'],
    [from('tesseract.js-core', 'tesseract-core-lstm.wasm.js'), 'tesseract-core-lstm.wasm.js'],
    [from('tesseract.js-core', 'tesseract-core-simd-lstm.wasm.js'), 'tesseract-core-simd-lstm.wasm.js'],
    [from('tesseract.js-core', 'tesseract-core-relaxedsimd-lstm.wasm.js'), 'tesseract-core-relaxedsimd-lstm.wasm.js'],
    [from('@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz'), path.join('lang', 'eng.traineddata.gz')],
];

if (!files.every(([source]) => fs.existsSync(source))) {
    // A production install without the OCR packages (they are dependencies, so this should not happen)
    console.log('Receipt reader files not found in node_modules; skipped');
    process.exit(0);
}

// Older versions are removed, so only the one in use is served
fs.rmSync(path.join(root, 'public', 'ocr'), { recursive: true, force: true });
fs.mkdirSync(path.join(target, 'lang'), { recursive: true });
for (const [source, name] of files) fs.copyFileSync(source, path.join(target, name));
console.log(`Receipt reader files copied to public/ocr/${version}`);
