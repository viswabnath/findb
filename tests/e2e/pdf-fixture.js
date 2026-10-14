// @ts-check
/**
 * Writes small PDF statements for the import tests: text placed at positions on pages, as banks'
 * PDFs are, and optionally protected by a password (the PDF standard security handler, revision 2:
 * RC4 with a 40-bit key, which every PDF reader opens). Test code only.
 */
const crypto = require('crypto');

const PAD = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');

function rc4(key, data) {
    const s = Array.from({ length: 256 }, (_, i) => i);
    let j = 0;
    for (let i = 0; i < 256; i++) {
        j = (j + s[i] + key[i % key.length]) & 255;
        [s[i], s[j]] = [s[j], s[i]];
    }
    const out = Buffer.alloc(data.length);
    let i = 0;
    j = 0;
    for (let n = 0; n < data.length; n++) {
        i = (i + 1) & 255;
        j = (j + s[i]) & 255;
        [s[i], s[j]] = [s[j], s[i]];
        out[n] = data[n] ^ s[(s[i] + s[j]) & 255];
    }
    return out;
}

const md5 = (...parts) => crypto.createHash('md5').update(Buffer.concat(parts)).digest();
const padded = password => Buffer.concat([Buffer.from(password, 'latin1'), PAD]).subarray(0, 32);
const escape = text => text.replace(/[\\()]/g, match => `\\${match}`);

/**
 * @param {Array<Array<[number, number, string]>>} pages each page's pieces: [x, y, text], y up from the bottom
 * @param {{ password?: string }} [options]
 * @returns {Buffer}
 */
function statementPdf(pages, options = {}) {
    const id = crypto.randomBytes(16);
    /** @type {Array<{ dict: string, stream?: Buffer }>} objects by number - 1 */
    const objects = [];
    const add = (dict, stream) => { objects.push({ dict, stream }); return objects.length; };

    const catalog = add('');
    const pagesObject = add('');
    const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const kids = pages.map(pieces => {
        const content = pieces.map(([x, y, text]) => `BT /F1 9 Tf 1 0 0 1 ${x} ${y} Tm (${escape(text)}) Tj ET`).join('\n');
        const contents = add('', Buffer.from(content, 'latin1'));
        return add(`<< /Type /Page /Parent ${pagesObject} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contents} 0 R >>`);
    });
    objects[catalog - 1].dict = `<< /Type /Catalog /Pages ${pagesObject} 0 R >>`;
    objects[pagesObject - 1].dict = `<< /Type /Pages /Kids [${kids.map(kid => `${kid} 0 R`).join(' ')}] /Count ${kids.length} >>`;

    let encrypt = null;
    let key = null;
    if (options.password !== undefined) {
        const owner = rc4(md5(padded(`${options.password}-owner`)).subarray(0, 5), padded(options.password));
        const permissions = Buffer.alloc(4);
        permissions.writeInt32LE(-4);
        key = md5(padded(options.password), owner, permissions, id).subarray(0, 5);
        const user = rc4(key, PAD);
        encrypt = add(`<< /Filter /Standard /V 1 /R 2 /O <${owner.toString('hex')}> /U <${user.toString('hex')}> /P -4 >>`);
    }

    const chunks = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    let length = chunks[0].length;
    const offsets = [];
    objects.forEach((object, index) => {
        const number = index + 1;
        offsets.push(length);
        let stream = object.stream;
        if (stream && key && number !== encrypt) {
            const objectKey = md5(key, Buffer.from([number & 255, (number >> 8) & 255, (number >> 16) & 255, 0, 0])).subarray(0, 10);
            stream = rc4(objectKey, stream);
        }
        const body = stream
            ? Buffer.concat([Buffer.from(`${number} 0 obj\n<< /Length ${stream.length} >>\nstream\n`, 'latin1'), stream, Buffer.from('\nendstream\nendobj\n', 'latin1')])
            : Buffer.from(`${number} 0 obj\n${object.dict}\nendobj\n`, 'latin1');
        chunks.push(body);
        length += body.length;
    });
    const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`)].join('');
    const trailer = `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${encrypt ? ` /Encrypt ${encrypt} 0 R` : ''} /ID [<${id.toString('hex')}> <${id.toString('hex')}>] >>\nstartxref\n${length}\n%%EOF\n`;
    chunks.push(Buffer.from(xref + trailer, 'latin1'));
    return Buffer.concat(chunks);
}

module.exports = { statementPdf };
