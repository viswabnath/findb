/**
 * Photos shrunk in the browser before they are uploaded to the document vault (v2 plan, "Free for
 * everyone": a small allowance per user). A picture wider or taller than 1600 pixels is scaled
 * down and saved as JPEG, lowering the quality until it is under the target size; small pictures
 * and PDFs are left as they are.
 */

const MAX_SIDE = 1600;
const TARGET_BYTES = 900 * 1024;


function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
    return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
}

export async function compressImage(file: File): Promise<File> {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
    // Decoded straight from the file: a blob: address would need an exception in the page's CSP
    let image: ImageBitmap;
    try {
        image = await createImageBitmap(file);
    } catch {
        return file;
    }
    const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height));
    if (scale === 1 && file.size <= TARGET_BYTES) {
        image.close();
        return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const context = canvas.getContext('2d');
    if (!context) return file;
    // A white page under transparent PNGs, as on paper
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();
    let blob: Blob | null = null;
    for (const quality of [0.82, 0.7, 0.55, 0.4]) {
        blob = await toBlob(canvas, quality);
        if (blob && blob.size <= TARGET_BYTES) break;
    }
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg', { type: 'image/jpeg' });
}
