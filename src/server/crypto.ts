import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
export const randomToken = () => randomBytes(32).toString('base64url');
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, val]) => [key, stable(val)]),
    );
  return value;
}
export const bodyDigest = (value: unknown) => digest(JSON.stringify(stable(value)));
export const equalSecret = (a: string, b: string) =>
  timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));
function key() {
  const k = Buffer.from(process.env.CONTEXT_ENCRYPTION_KEY ?? '', 'base64');
  if (k.length !== 32) throw new Error('CONTEXT_ENCRYPTION_KEY must be a 32-byte base64 key.');
  return k;
}
export function encrypt(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64')).join('.');
}
export function decrypt<T>(value: string): T {
  const [iv, tag, data] = value.split('.').map((x) => Buffer.from(x, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')) as T;
}
