import { Request, Response } from 'express';
import Stripe from 'stripe';

const getStripe = () => new Stripe(process.env.STRIPE_SECRET_KEY as string);

const forwardEvent = async (payload: object): Promise<void> => {
    const url = process.env.WEBHOOK_FORWARD_URL;
    if (!url) return;
    await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
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
