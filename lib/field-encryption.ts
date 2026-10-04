import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * Encryption of sensitive values before they reach the database (v2 plan, Security and privacy):
 * AES-256-GCM in the application, with the key in an environment secret.
 *
 * FIELD_ENCRYPTION_KEYS lists the keys as `version:base64key`, comma-separated; the first is the
 * current one, used for new values. Each stored value starts with its key's version, so a new key
 * can be added in front and older values still read until they are re-encrypted (rotation without
 * downtime). Make a key with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *
 * A stored value is `v<version>.<iv>.<tag>.<ciphertext>` (base64url). Each value is bound to a
 * context, such as the column and the user's id, so a value copied to another row does not decrypt.
 */

interface Key { version: string; key: Buffer }

function keys(): Key[] {
    const setting = process.env.FIELD_ENCRYPTION_KEYS;
    if (!setting) throw new Error('FIELD_ENCRYPTION_KEYS is not set');
    return setting.split(',').map(entry => {
        const [version, encoded] = entry.trim().split(':');
        const key = Buffer.from(encoded ?? '', 'base64');
        if (!version || !/^\d+$/.test(version) || key.length !== 32) {
            throw new Error('FIELD_ENCRYPTION_KEYS must be version:base64 entries of 32-byte keys');
        }
        return { version, key };
    });
}

export function encryptField(plaintext: string, context: string): string {
    const { version, key } = keys()[0]!;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(context));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return ['v' + version, iv, cipher.getAuthTag(), ciphertext]
        .map(part => (typeof part === 'string' ? part : part.toString('base64url'))).join('.');
}

export function decryptField(stored: string, context: string): string {
    const [version, iv, tag, ciphertext] = stored.split('.');
    const match = keys().find(entry => `v${entry.version}` === version);
    if (!match || !iv || !tag || ciphertext === undefined) throw new Error('Cannot decrypt: unknown key version or bad value');
    const decipher = createDecipheriv('aes-256-gcm', match.key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}

/** Whether a stored value was made with an older key (re-encrypt it with the current one) */
export function needsReencryption(stored: string): boolean {
    return !stored.startsWith(`v${keys()[0]!.version}.`);
}
