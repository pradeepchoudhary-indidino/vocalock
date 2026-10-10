import { randomBytes } from 'crypto';

export const iso = (ms = Date.now()) => new Date(ms).toISOString();
export const newId = (prefix: string) => `${prefix}_${randomBytes(8).toString('hex')}`;
