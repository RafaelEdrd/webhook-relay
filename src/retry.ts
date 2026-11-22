import { isIP } from 'node:net';
export const MAX_ATTEMPTS = 6;

export function nextDelaySeconds(attempt: number, random = Math.random()): number {
  if (attempt < 1 || !Number.isInteger(attempt) || random < 0 || random > 1) {
    throw new RangeError('Invalid retry parameters');
  }
  const capped = Math.min(30 * 2 ** (attempt - 1), 3600);
  return Math.round(capped * (0.8 + random * 0.4));
}

export function isDelivered(httpStatus: number): boolean {
  return httpStatus >= 200 && httpStatus < 300;
}

export function safeDestination(url: string, production: boolean): URL {
  const parsed = new URL(url);
  if (parsed.username || parsed.password || parsed.hash || parsed.search) {
    throw new Error('Destination URL must not include credentials, fragments or query parameters');
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(hostname);
  if (!production && parsed.protocol === 'http:' && isLoopback) return parsed;
  if (parsed.protocol !== 'https:') throw new Error('HTTPS destination required');
  // Fixed, operator-controlled public DNS destinations only. DNS-based attacks
  // also require an egress proxy / firewall policy in a live deployment.
  if (isIP(hostname) || !hostname.includes('.') ||
      ['.local', '.localhost', '.internal', '.test'].some(suffix => hostname.endsWith(suffix)) ||
      hostname === 'metadata.google.internal') {
    throw new Error('A public DNS hostname is required');
  }
  return parsed;
}
