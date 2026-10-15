import { readReceiptText, type ReceiptReading } from '../src/core/receipt';
import { todayInIndiaClient } from './dates';

/**
 * Reads a receipt photo or a UPI screenshot in the browser (v2 Phase 2; "Free for everyone": no paid
 * OCR service, and the picture never leaves the device to be read). tesseract.js loads only when a
 * picture is chosen, from FinDB's own copy (public/ocr, scripts/copy-ocr-assets.js), and its text is
 * understood by src/core/receipt.ts. The English model is about 3 MB, fetched once and kept by the
 * browser.
 */

/** The tesseract.js version whose files are in public/ocr (tests/unit/receipt.test.ts checks it) */
export const OCR_VERSION = '7.0.0';
const BASE = `/ocr/${OCR_VERSION}`;
/** Big photos are read faster, and as well, at this size */
const MAX_SIDE = 2000;

/** Whether a picture is mostly dark (a dark-mode screenshot): OCR reads dark text on light best */
function isDark(context: CanvasRenderingContext2D, width: number, height: number): boolean {
    const { data } = context.getImageData(0, 0, width, height);
    let total = 0;
    let count = 0;
    // Every 16th pixel is plenty to tell
    for (let i = 0; i < data.length; i += 64) {
        total += 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
        count++;
    }
    return count > 0 && total / count < 110;
}

/**
 * The picture on a canvas tesseract.js can read: no larger than MAX_SIDE (times `scale`; a second
 * reading at half size catches large print, such as a UPI app's amount, that the first one skipped),
 * and turned light if it is a dark screenshot.
 */
async function prepare(file: File, scale = 1): Promise<HTMLCanvasElement | File> {
    let image: ImageBitmap;
    try {
        image = await createImageBitmap(file);
    } catch {
        return file;
    }
    const size = Math.min(1, MAX_SIDE / Math.max(image.width, image.height)) * scale;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.width * size);
    canvas.height = Math.round(image.height * size);
    const context = canvas.getContext('2d');
    if (!context) {
        image.close();
        return file;
    }
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();
    if (isDark(context, canvas.width, canvas.height)) {
        context.globalCompositeOperation = 'difference';
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.globalCompositeOperation = 'source-over';
    }
    return canvas;
}

/** The amount, date and merchant a picture shows, with progress from 0 to 1 */
export async function readReceipt(file: File, onProgress?: (progress: number) => void): Promise<ReceiptReading & { text: string }> {
    const { createWorker, OEM, PSM } = await import('tesseract.js');
    const worker = await createWorker('eng', OEM.LSTM_ONLY, {
        workerPath: `${BASE}/worker.min.js`,
        corePath: `${BASE}/`,
        langPath: `${BASE}/lang`,
        // A worker from this site's own file: the page's CSP allows worker-src 'self', not blob:
        workerBlobURL: false,
        gzip: true,
        logger: message => {
            if (message.status === 'recognizing text' && onProgress) onProgress(message.progress);
        },
    });
    try {
        const today = todayInIndiaClient();
        const { data } = await worker.recognize(await prepare(file));
        const first = readReceiptText(data.text, today);
        if (first.amount !== null) return { ...first, text: data.text };
        // No amount: large print (a UPI app's amount) is often skipped when the page is read as
        // blocks of text, so read it again as scattered text, at full and then half size
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
        let text = data.text;
        for (const scale of [1, 0.5]) {
            const again = await worker.recognize(await prepare(file, scale));
            text = `${text}\n${again.data.text}`;
            const next = readReceiptText(again.data.text, today);
            if (next.amount !== null) {
                return {
                    kind: first.kind === 'upi' || next.kind === 'upi' ? 'upi' : 'receipt',
                    amount: next.amount, readAs: next.readAs, date: first.date ?? next.date, merchant: first.merchant ?? next.merchant, text,
                };
            }
        }
        return { ...first, text };
    } finally {
        await worker.terminate();
    }
}
