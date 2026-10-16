import { SupabaseClient } from '@supabase/supabase-js';
import { backfillStripeFees } from '../src/utils/backfillStripeFees';
import { StripeClient } from '../src/utils/chargeFinancials';

interface Row { id: string; stripe_payment_intent_id: string }

// Cliente de Supabase falso: el select regresa páginas de `rows` respetando
// gt('id') y limit(); los update se registran en `updates`.
const fakeSupabase = (rows: Row[], updateError: { message: string } | null = null) => {
    const updates: { id: string; fields: Record<string, unknown> }[] = [];
    const selectCalls: { gt?: string; limit?: number; status?: string[] }[] = [];

    const from = () => ({
        select: () => {
            const call: { gt?: string; limit?: number; status?: string[] } = {};
            selectCalls.push(call);
            const builder: any = {
                in: (_col: string, values: string[]) => { call.status = values; return builder; },
                not: () => builder,
                or: () => builder,
                order: () => builder,
                limit: (n: number) => { call.limit = n; return builder; },
                gt: (_col: string, value: string) => { call.gt = value; return builder; },
                then: (resolve: (r: unknown) => void) => {
                    const page = rows
                        .filter((r) => !call.gt || r.id > call.gt)
                        .slice(0, call.limit);
                    resolve({ data: page, error: null });
                },
            };
            return builder;
        },
        update: (fields: Record<string, unknown>) => ({
            eq: async (_col: string, id: string) => {
                if (!updateError) updates.push({ id, fields });
                return { error: updateError };
            },
        }),
    });

    return { client: { from } as unknown as SupabaseClient, updates, selectCalls };
};

const fakeStripe = (byIntent: Record<string, unknown>) => {
    const retrieve = jest.fn(async (id: string) => {
        const value = byIntent[id];
        if (value instanceof Error) throw value;
        return value;
    });
    return { stripe: { paymentIntents: { retrieve } } as unknown as StripeClient, retrieve };
};

const connectIntent = {
    transfer_data: { destination: 'acct_1' },
    latest_charge: {
        balance_transaction: { id: 'txn_1', fee: 410 },
        transfer: { id: 'tr_1', amount: 9150 },
    },
};

const platformIntent = {
    transfer_data: null,
    latest_charge: {
        balance_transaction: { id: 'txn_2', fee: 300 },
        transfer: null,
    },
};

const silent = () => {};

describe('backfillStripeFees', () => {
    it('updates Connect and platform payments with the Stripe fee and transfer', async () => {
        const { client, updates } = fakeSupabase([
            { id: 'a', stripe_payment_intent_id: 'pi_connect' },
            { id: 'b', stripe_payment_intent_id: 'pi_platform' },
        ]);
        const { stripe } = fakeStripe({ pi_connect: connectIntent, pi_platform: platformIntent });

        const result = await backfillStripeFees(client, stripe, { apply: true, log: silent });

        expect(result).toEqual({ scanned: 2, updated: 2, skipped: 0, failed: 0 });
        expect(updates).toEqual([
            { id: 'a', fields: { stripe_fee: 410, transfer_amount: 9150, stripe_balance_transaction_id: 'txn_1' } },
            { id: 'b', fields: { stripe_fee: 300, transfer_amount: 0, stripe_balance_transaction_id: 'txn_2' } },
        ]);
    });

    it('does not write anything in dry-run mode', async () => {
        const { client, updates } = fakeSupabase([{ id: 'a', stripe_payment_intent_id: 'pi_connect' }]);
        const { stripe } = fakeStripe({ pi_connect: connectIntent });

        const result = await backfillStripeFees(client, stripe, { apply: false, log: silent });

        expect(result.updated).toBe(1);
        expect(updates).toHaveLength(0);
    });

    it('includes needs_refund payments, since they were charged', async () => {
        const { client, selectCalls } = fakeSupabase([]);
        const { stripe } = fakeStripe({});

        await backfillStripeFees(client, stripe, { apply: true, log: silent });

        expect(selectCalls[0].status).toEqual(['succeeded', 'needs_refund']);
    });

    it('pages through all rows by id', async () => {
        const rows = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, stripe_payment_intent_id: 'pi_platform' }));
        const { client, selectCalls, updates } = fakeSupabase(rows);
        const { stripe } = fakeStripe({ pi_platform: platformIntent });

        const result = await backfillStripeFees(client, stripe, { apply: true, pageSize: 2, log: silent });

        expect(result.scanned).toBe(5);
        expect(updates.map((u) => u.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
        expect(selectCalls.map((c) => c.gt)).toEqual([undefined, 'b', 'd']);
    });

    it('skips payments whose data could not be read from Stripe', async () => {
        const { client, updates } = fakeSupabase([{ id: 'a', stripe_payment_intent_id: 'pi_missing' }]);
        const { stripe } = fakeStripe({ pi_missing: new Error('No such payment_intent') });
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        try {
            const result = await backfillStripeFees(client, stripe, { apply: true, log: silent });

            expect(result).toEqual({ scanned: 1, updated: 0, skipped: 1, failed: 0 });
            expect(updates).toHaveLength(0);
        } finally {
            errorSpy.mockRestore();
        }
    });

    it('counts update errors as failed', async () => {
        const { client } = fakeSupabase(
            [{ id: 'a', stripe_payment_intent_id: 'pi_connect' }],
            { message: 'permission denied' },
        );
        const { stripe } = fakeStripe({ pi_connect: connectIntent });

        const result = await backfillStripeFees(client, stripe, { apply: true, log: silent });

        expect(result).toEqual({ scanned: 1, updated: 0, skipped: 0, failed: 1 });
    });
});
