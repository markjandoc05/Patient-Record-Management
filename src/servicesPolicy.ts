import { hasAdministrativeAccess, RBAC } from './rbac';
export const canManageServices = (role: unknown) => hasAdministrativeAccess(role);
export const canViewServices = (role: unknown) => typeof role === 'string' && Object.hasOwn(RBAC, role);
export class ServiceError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function serviceName(value: unknown, limit = 120): string {
  if (typeof value !== 'string') throw new ServiceError(400, 'INVALID_NAME', 'Enter a name.');
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > limit) throw new ServiceError(400, 'INVALID_NAME', `Name must contain 1–${limit} characters.`);
  return name;
}
export type PriceInput = { mode: 'priced'; amount: string } | { mode: 'free' | 'unpriced' | 'inherit' };
export function parseServicePrice(value: unknown, branch = false): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServiceError(400, 'INVALID_PRICE', 'Choose a price state.');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(k => k !== 'mode' && k !== 'amount')) throw new ServiceError(400, 'INVALID_PRICE', 'Unknown price field.');
  if (input.mode === 'priced') {
    if (typeof input.amount !== 'string' || !/^\d{1,10}(\.\d{1,2})?$/.test(input.amount)) throw new ServiceError(400, 'INVALID_PRICE', 'Price must be a decimal string with at most two decimal places.');
    const [whole, fraction = ''] = input.amount.split('.');
    const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    if (minor <= 0n || minor > 999999999999n) throw new ServiceError(400, 'INVALID_PRICE', 'Enter a positive price, or choose Free.');
    return `${BigInt(whole)}.${fraction.padEnd(2, '0')}`;
  }
  if ('amount' in input) throw new ServiceError(400, 'INVALID_PRICE', 'Only a priced amount may include a value.');
  if (input.mode === 'free') return '0.00';
  if (input.mode === (branch ? 'inherit' : 'unpriced')) return null;
  throw new ServiceError(400, 'INVALID_PRICE', 'Choose a valid price state.');
}
export function priceInput(amount: string | null, branch = false): PriceInput {
  return amount === null ? { mode: branch ? 'inherit' : 'unpriced' } : /^0(?:\.0+)?$/.test(amount) ? { mode: 'free' } : { mode: 'priced', amount };
}
export function effectiveServicePrice(standard: string | null, override: string | null) {
  const amount = override ?? standard;
  return { amount, mode: amount === null ? 'unpriced' : /^0(?:\.0+)?$/.test(amount) ? 'free' : 'priced', source: override !== null ? 'branch' : standard !== null ? 'standard' : 'unconfigured' };
}
export function priceLabel(amount: string | null) {
  if (amount === null) return 'Not configured';
  if (/^0(?:\.0+)?$/.test(amount)) return 'Free';
  return `₱${Number(amount).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
