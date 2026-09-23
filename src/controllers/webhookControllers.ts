import { Request, Response } from 'express';
import Stripe from 'stripe';

const getStripe = () => new Stripe(process.env.STRIPE_SECRET_KEY as string);

const forwardEvent = async (payload: object): Promise<void> => {
    const url = process.env.WEBHOOK_FORWARD_URL;
    if (!url) return;
    // payment-webhook rechaza cualquier request sin este secreto (tiene
    // verify_jwt = false, así que es su única autenticación).
    const secret = process.env.PAYMENT_WEBHOOK_SECRET;
    if (!secret) throw new Error('PAYMENT_WEBHOOK_SECRET is not set');

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-webhook-secret': secret },
        body: JSON.stringify(payload),
    });
    // Sin este chequeo un 401/500 de payment-webhook se perdía en silencio y
    // se le respondía 200 a Stripe; así el handler responde 500 y Stripe reintenta.
    if (!response.ok) {
        throw new Error(`payment-webhook responded ${response.status}`);
    }
};

export const handleStripeWebhook = async (req: Request, res: Response): Promise<void> => {
    const sig = req.headers['stripe-signature'] as string;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET as string;

    let event: any;

    try {
        event = getStripe().webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        res.status(400).json({ error: `Webhook signature verification failed: ${message}` });
        return;
    }

    try {
        switch (event.type) {
            case 'payment_intent.succeeded': {
                const intent = event.data.object;
                await forwardEvent({
                    type: event.type,
                    paymentIntentId: intent.id,
                    amount: intent.amount,
                    currency: intent.currency,
                    applicationFeeAmount: intent.application_fee_amount ?? undefined,
                    metadata: intent.metadata,
                });
                break;
            }
            case 'payment_intent.payment_failed': {
                const intent = event.data.object;
                await forwardEvent({
                    type: event.type,
                    paymentIntentId: intent.id,
                    metadata: intent.metadata,
                });
                break;
            }
            default:
                break;
        }

        res.status(200).json({ received: true });
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        res.status(500).json({ error: 'Webhook handler error', detail: message });
    }
};
