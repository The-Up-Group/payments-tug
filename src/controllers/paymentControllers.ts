import { Request, Response } from 'express';
import Stripe from 'stripe';
import { PaymentRequest } from '../types/paymentTypes';

const getStripe = () => new Stripe(process.env.STRIPE_SECRET_KEY as string);

export const createPayment = async (req: Request, res: Response): Promise<void> => {
  const { amount, currency, metadata } = req.body as PaymentRequest;

  if (!amount || !currency || amount <= 0) {
    res.status(400).json({ error: 'Invalid amount or currency' });
    return;
  }

  try {
    const paymentIntent = await getStripe().paymentIntents.create({
        amount,
        currency,
        metadata,
        automatic_payment_methods: { enabled: true },
    });
    res.status(200).json({
        clientSecret: paymentIntent.client_secret!,
        paymentIntentId: paymentIntent.id,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create payment' });
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
