import { createHash, randomBytes } from 'crypto';

export const iso = (ms = Date.now()) => new Date(ms).toISOString();
export const newId = (prefix: string) => `${prefix}_${randomBytes(8).toString('hex')}`;
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
