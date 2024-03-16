import { createHash } from 'crypto';

export function hashString(text: string): string {
    const hash = createHash('sha256');
    hash.update(text);
    return hash.digest('hex');
}
