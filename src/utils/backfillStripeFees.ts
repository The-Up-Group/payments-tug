import { SupabaseClient } from '@supabase/supabase-js';
import { getChargeFinancials, StripeClient } from './chargeFinancials';

export interface BackfillOptions {
    apply: boolean;
    pageSize?: number;
    log?: (message: string) => void;
}

export interface BackfillResult {
    scanned: number;
    updated: number;
    skipped: number;
    failed: number;
}

interface PaymentRow {
    id: string;
    stripe_payment_intent_id: string;
}

// Llena stripe_fee, transfer_amount y stripe_balance_transaction_id en los
// pagos cobrados antes de que el webhook los guardara. Recorre por id
// (keyset) para que funcione igual en modo prueba (no actualiza) y real.
export const backfillStripeFees = async (
    supabase: SupabaseClient,
    stripe: StripeClient,
    { apply, pageSize = 100, log = console.log }: BackfillOptions,
): Promise<BackfillResult> => {
    const result: BackfillResult = { scanned: 0, updated: 0, skipped: 0, failed: 0 };
    let lastId: string | null = null;

    for (;;) {
        let query = supabase
            .from('payments')
            .select('id, stripe_payment_intent_id')
            .in('status', ['succeeded', 'needs_refund'])
            .not('stripe_payment_intent_id', 'is', null)
            .or('stripe_fee.is.null,transfer_amount.is.null')
            .order('id')
            .limit(pageSize);
        if (lastId) query = query.gt('id', lastId);

        const { data, error } = await query;
        if (error) throw new Error(`No se pudieron leer los pagos: ${error.message}`);

        const rows = (data ?? []) as PaymentRow[];
        if (rows.length === 0) break;

        for (const row of rows) {
            result.scanned++;
            const financials = await getChargeFinancials(stripe, row.stripe_payment_intent_id);
            const fields = {
                ...(financials.stripeFee != null && { stripe_fee: financials.stripeFee }),
                ...(financials.transferAmount != null && { transfer_amount: financials.transferAmount }),
                ...(financials.balanceTransactionId && { stripe_balance_transaction_id: financials.balanceTransactionId }),
            };

            if (Object.keys(fields).length === 0) {
                result.skipped++;
                log(`SIN DATOS  ${row.id} (${row.stripe_payment_intent_id})`);
                continue;
            }

            if (!apply) {
                result.updated++;
                log(`PRUEBA     ${row.id} → ${JSON.stringify(fields)}`);
                continue;
            }

            const { error: updateError } = await supabase
                .from('payments')
                .update(fields)
                .eq('id', row.id);
            if (updateError) {
                result.failed++;
                log(`ERROR      ${row.id}: ${updateError.message}`);
            } else {
                result.updated++;
                log(`OK         ${row.id} → ${JSON.stringify(fields)}`);
            }
        }

        lastId = rows[rows.length - 1].id;
        if (rows.length < pageSize) break;
    }

    return result;
};
