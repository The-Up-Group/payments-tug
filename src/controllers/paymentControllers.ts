import { Request, Response } from 'express';
import Stripe from 'stripe';
import { PaymentRequest } from '../types/paymentTypes';

const getStripe = () => new Stripe(process.env.STRIPE_SECRET_KEY as string);

// create a payment
export const createPayment = async (req: Request, res: Response): Promise<void> => {
  const { amount, currency, customerId, destinationAccountId, appId, eventId, paymentMethodId } = req.body as PaymentRequest;

  if (!amount || amount <= 0 || !currency || !customerId || !destinationAccountId || !appId || !eventId) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  const platformFee = Math.round(amount * 0.10);

  try {
    const paymentIntent = await getStripe().paymentIntents.create({
        amount,
        currency,
        customer: customerId,
        application_fee_amount: platformFee,
        transfer_data: { destination: destinationAccountId },
        metadata: { appId, eventId },
        ...(paymentMethodId && {
            payment_method: paymentMethodId,
            confirm: true,
            off_session: true,
        }),
    });

    res.status(201).json({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        platformFee,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({
        error: 'Failed to create payment',
        ...(process.env.NODE_ENV !== 'production' && { detail: message }),
    });
  }
};

export const getPaymentStatus = async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;

  try {
    const intent = await getStripe().paymentIntents.retrieve(id);
    res.status(200).json({
        id: intent.id,
        status: intent.status,
        amount: intent.amount,
        currency: intent.currency,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve payment' });
  }
};
