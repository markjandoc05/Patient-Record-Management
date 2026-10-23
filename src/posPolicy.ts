import { ledgerFail, ledgerObject, ledgerRecordId, ledgerText, ledgerUuid, ledgerVersion } from './treatmentLedgerPolicy';
import { parseAppointmentSpecialPrice } from './utils/appointmentSpecialPrice';
export function moneyCents(value: unknown): number {
    let normalized: string | null = null;
    try {
        normalized = parseAppointmentSpecialPrice(value);
    }
    catch { /* return a bounded public validation error */ }
    if (normalized === null)
        ledgerFail(400, 'INVALID_AMOUNT', 'Enter a nonnegative amount with at most two decimal places.');
    const [whole, fraction = ''] = normalized!.split('.');
    const result = Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')));
    if (!Number.isSafeInteger(result) || result > 999999999999)
        ledgerFail(400, 'INVALID_AMOUNT', 'Amount is too large.');
    return result;
}
export const centsText = (cents: number | string) => { const n = BigInt(cents); return `${n / 100n}.${String(n % 100n).padStart(2, '0')}`; };
export function invoiceTotal(items: {
    amount: number;
}[]) {
    const total = items.reduce((sum, line) => sum + line.amount, 0);
    if (!Number.isSafeInteger(total) || total > 999999999999)
        ledgerFail(400, 'INVALID_TOTAL', 'Invoice total is too large.');
    return total;
}
export type PosLineInput = {
    kind: 'service' | 'package' | 'visit' | 'appointment';
    id: string;
    expectedVersion: number;
    amount?: string;
    reason?: string;
};
export function parsePosDraft(value: unknown) {
    const p = ledgerObject(value, ['commandId', 'expectedVersion', 'patientId', 'branchId', 'notes', 'items']);
    if (!Array.isArray(p.items) || !p.items.length || p.items.length > 20)
        ledgerFail(400, 'INVALID_LINES', 'Choose 1–20 invoice items.');
    const seen = new Set<string>();
    const items: PosLineInput[] = p.items.map((value: unknown) => {
        const l = ledgerObject(value, ['kind', 'id', 'expectedVersion', 'amount', 'reason']);
        if (!['service', 'package', 'visit', 'appointment'].includes(l.kind))
            ledgerFail(400, 'INVALID_KIND', 'Choose a Service, package or saved quote.');
        const key = `${l.kind}:${l.id}`;
        if (seen.has(key))
            ledgerFail(400, 'DUPLICATE_ITEM', 'An item may appear only once per invoice.');
        seen.add(key);
        return { kind: l.kind, id: ['service', 'package'].includes(l.kind) ? ledgerUuid(l.id) : ledgerRecordId(l.id), expectedVersion: ledgerVersion(l.expectedVersion, true),
            ...(Object.hasOwn(l, 'amount') ? { amount: centsText(moneyCents(l.amount)) } : {}), ...(l.reason !== undefined ? { reason: ledgerText(l.reason, 1000, 'Price reason') } : {}) };
    });
    return { commandId: ledgerUuid(p.commandId), expectedVersion: ledgerVersion(p.expectedVersion, true), patientId: ledgerRecordId(p.patientId), branchId: ledgerRecordId(p.branchId), notes: ledgerText(p.notes ?? '', 3000, 'Invoice notes'), items };
}
export function parsePosPayment(value: unknown) {
    const p = ledgerObject(value, ['commandId', 'expectedVersion', 'method', 'amount', 'tender', 'reference']);
    if (!['cash', 'card', 'gcash', 'bank'].includes(p.method))
        ledgerFail(400, 'INVALID_METHOD', 'Choose a payment method.');
    const amount = moneyCents(p.amount), tender = p.method === 'cash' ? moneyCents(p.tender) : amount;
    const reference = ledgerText(p.reference ?? '', 120, 'Payment reference');
    if (amount <= 0 || tender < amount || p.method !== 'cash' && !reference)
        ledgerFail(400, 'INVALID_PAYMENT', 'Enter a positive payment, sufficient cash tender or a non-cash reference.');
    return { commandId: ledgerUuid(p.commandId), expectedVersion: ledgerVersion(p.expectedVersion), method: p.method as string, amount, tender, reference };
}
