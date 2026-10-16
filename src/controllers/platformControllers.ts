import { Request, Response } from 'express';
import Stripe from 'stripe';
import {
    CreatePlatformPayoutRequest,
    PlatformBalanceResponse,
    PlatformPayout,
    PlatformPayoutsResponse,
} from '../types/platformTypes';

// Endpoints de la cuenta principal de Stripe (la de SPOT, sin header
// stripeAccount). Solo para admins: van detrás de AuthMiddleware +
// AdminMiddleware. Ojo: el saldo y los retiros son de TODA la cuenta, no se
// pueden separar por appId.

const getStripe = () => new Stripe(process.env.STRIPE_SECRET_KEY as string);

const DEFAULT_CURRENCY = 'mxn';

const amountFor = (funds: { amount: number; currency: string }[], currency: string): number =>
    funds.find((f) => f.currency === currency)?.amount ?? 0;

const toPayout = (p: {
    id: string;
    amount: number;
    currency: string;
    arrival_date: number;
    created: number;
    status: string;
    description: string | null;
}): PlatformPayout => ({
    id: p.id,
    amount: p.amount,
    currency: p.currency,
    arrivalDate: p.arrival_date,
    created: p.created,
    status: p.status,
    description: p.description,
});

const errorResponse = (res: Response, status: number, error: string, err: unknown) => {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(status).json({
        error,
        ...(process.env.NODE_ENV !== 'production' && { detail: message }),
    });
};

export const getPlatformBalance = async (req: Request, res: Response): Promise<void> => {
    const currency = (req.query.currency as string | undefined)?.toLowerCase() ?? DEFAULT_CURRENCY;
    try {
        const balance = await getStripe().balance.retrieve();
        const response: PlatformBalanceResponse = {
            available: amountFor(balance.available, currency),
            pending: amountFor(balance.pending, currency),
            currency,
        };
        res.status(200).json(response);
    } catch (err) {
        errorResponse(res, 500, 'Failed to retrieve platform balance', err);
    }
};

export const getPlatformPayouts = async (req: Request, res: Response): Promise<void> => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100);
    try {
        const list = await getStripe().payouts.list({ limit });
        const response: PlatformPayoutsResponse = { payouts: list.data.map(toPayout) };
        res.status(200).json(response);
    } catch (err) {
        errorResponse(res, 500, 'Failed to retrieve platform payouts', err);
    }
};

// Retiro manual del saldo disponible a la cuenta bancaria registrada en
// Stripe. `requestId` lo genera el cliente una vez por confirmación y se usa
// como idempotency key: un doble toque o un reintento no crean dos retiros.
export const createPlatformPayout = async (req: Request, res: Response): Promise<void> => {
    const { amount, currency: rawCurrency, requestId } = req.body as CreatePlatformPayoutRequest;
    const currency = rawCurrency?.toLowerCase() ?? DEFAULT_CURRENCY;

    if (!Number.isInteger(amount) || amount <= 0 || !requestId || typeof requestId !== 'string') {
        res.status(400).json({ error: 'amount must be a positive integer (cents) and requestId is required' });
        return;
    }

    const stripe = getStripe();
    try {
        const balance = await stripe.balance.retrieve();
        const available = amountFor(balance.available, currency);
        if (amount > available) {
            res.status(400).json({ error: 'Amount exceeds available balance', available });
            return;
        }

        const payout = await stripe.payouts.create(
            {
                amount,
                currency,
                metadata: { triggeredBy: (req as any).user?.id ?? 'unknown' },
            },
            { idempotencyKey: `platform-payout-${requestId}` },
        );
        res.status(201).json(toPayout(payout));
    } catch (err) {
        const isStripeRequestError =
            typeof err === 'object' && err !== null && (err as { type?: string }).type === 'StripeInvalidRequestError';
        errorResponse(res, isStripeRequestError ? 400 : 500, 'Failed to create platform payout', err);
    }
};
