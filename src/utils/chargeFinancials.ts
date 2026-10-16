import Stripe from 'stripe';

export type StripeClient = InstanceType<typeof Stripe>;

export interface ChargeFinancials {
    stripeFee?: number;
    transferAmount?: number;
    balanceTransactionId?: string;
}

// Comisión de Stripe y monto transferido al organizador de un PaymentIntent,
// para guardarlos en `payments` (stripe_fee, transfer_amount,
// stripe_balance_transaction_id). Lo usan el webhook y el script de backfill.
// Best-effort: si Stripe falla regresa {} y el llamador sigue sin esos datos.
export const getChargeFinancials = async (
    stripe: StripeClient,
    paymentIntentId: string,
): Promise<ChargeFinancials> => {
    try {
        const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
            expand: ['latest_charge.balance_transaction', 'latest_charge.transfer'],
        });
        const charge = intent.latest_charge;
        if (!charge || typeof charge === 'string') return {};

        const financials: ChargeFinancials = {};

        const balanceTx = charge.balance_transaction;
        if (balanceTx && typeof balanceTx !== 'string') {
            financials.stripeFee = balanceTx.fee;
            financials.balanceTransactionId = balanceTx.id;
        }

        const transfer = charge.transfer;
        if (transfer && typeof transfer !== 'string') {
            financials.transferAmount = transfer.amount;
        } else if (!intent.transfer_data) {
            financials.transferAmount = 0;
        }

        return financials;
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error(`chargeFinancials: no se pudo leer la comisión de ${paymentIntentId}: ${message}`);
        return {};
    }
};
