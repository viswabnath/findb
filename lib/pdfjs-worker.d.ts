/** pdf.js's worker module has no type declarations; FinDB only hands it to pdf.js (lib/statement-file.ts) */
declare module 'pdfjs-dist/build/pdf.worker.min.mjs' {
    export const WorkerMessageHandler: unknown;
}
