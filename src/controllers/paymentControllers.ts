import { Request, Response } from 'express';
import Stripe from 'stripe';
import { PaymentRequest, CheckoutSessionRequest } from '../types/paymentTypes';

const getStripe = () => new Stripe(process.env.STRIPE_SECRET_KEY as string);

// create a payment
export const createPayment = async (req: Request, res: Response): Promise<void> => {
  const { amount, currency, customerId, destinationAccountId, applicationFeeAmount, appId, eventId, userId, ticketTypeId, quantity, paymentMethodId, guestEmail } = req.body as PaymentRequest;

  if (!amount || amount <= 0 || !currency || !customerId || !destinationAccountId || !appId || !eventId || !userId || !ticketTypeId || !quantity || quantity <= 0) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  if (
    applicationFeeAmount === undefined ||
    applicationFeeAmount === null ||
    !Number.isFinite(applicationFeeAmount) ||
    applicationFeeAmount < 0 ||
    applicationFeeAmount > amount
  ) {
    res.status(400).json({ error: 'Invalid applicationFeeAmount' });
    return;
  }

  const platformFee = Math.round(applicationFeeAmount);

  try {
    const paymentIntent = await getStripe().paymentIntents.create({
        amount,
        currency,
        customer: customerId,
        application_fee_amount: platformFee,
        transfer_data: { destination: destinationAccountId },
        metadata: { appId, eventId, userId, ticketTypeId, quantity: String(quantity), ...(guestEmail && { guestEmail }) },
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

// Controller funcional solo para web ya que no existe flutter payment sheet en web.
export const createCheckoutSession = async (req: Request, res: Response): Promise<void> => {
  const { amount, currency, customerId, destinationAccountId, applicationFeeAmount, appId, eventId, userId, ticketTypeId, quantity, returnUrl, guestEmail } = req.body as CheckoutSessionRequest;

  if (!amount || amount <= 0 || !currency || !customerId || !destinationAccountId || !appId || !eventId || !userId || !ticketTypeId || !quantity || quantity <= 0 || !returnUrl) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  if (
    applicationFeeAmount === undefined ||
    applicationFeeAmount === null ||
    !Number.isFinite(applicationFeeAmount) ||
    applicationFeeAmount < 0 ||
    applicationFeeAmount > amount
  ) {
    res.status(400).json({ error: 'Invalid applicationFeeAmount' });
    return;
  }

  const platformFee = Math.round(applicationFeeAmount);

  try {
    const session = await getStripe().checkout.sessions.create({
        ui_mode: 'embedded_page',
        mode: 'payment',
        customer: customerId,
        return_url: returnUrl,
        redirect_on_completion: 'if_required',
        line_items: [{
            price_data: {
                currency,
                unit_amount: amount,
                product_data: { name: 'Event ticket' },
            },
            quantity: 1,
        }],
        payment_intent_data: {
            application_fee_amount: platformFee,
            transfer_data: { destination: destinationAccountId },
            // Este es el metadata que termina en el PaymentIntent y, por lo
            // tanto, el que lee el webhook (`payment_intent.succeeded`) para
            // armar el `event_bookings` — el `metadata` de la Checkout Session
            // de abajo es un objeto aparte que el webhook no consulta.
            metadata: { appId, eventId, userId, ticketTypeId, quantity: String(quantity), ...(guestEmail && { guestEmail }) },
        },
        metadata: { appId, eventId, userId, ticketTypeId, quantity: String(quantity), ...(guestEmail && { guestEmail }) },
    });

    const paymentIntentId = typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id ?? null;

    res.status(201).json({
        clientSecret: session.client_secret,
        sessionId: session.id,
        paymentIntentId,
        platformFee,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({
        error: 'Failed to create checkout session',
        ...(process.env.NODE_ENV !== 'production' && { detail: message }),
    });
  }
};

// Stripe no crea el PaymentIntent de una Checkout Session hasta que el
// comprador empieza a completar el pago — al crear la sesión (arriba)
// `payment_intent` siempre viene null. El cliente web llama este endpoint
// después de que el embedded Checkout reporta `onComplete`, para recién ahí
// obtener el id y poder insertar la fila de `payments`.
export const getCheckoutSessionStatus = async (req: Request, res: Response): Promise<void> => {
  const sessionId = req.params.sessionId as string;

  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);

    const paymentIntentId = typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id ?? null;

    res.status(200).json({
        sessionId: session.id,
        status: session.status,
        paymentIntentId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({
        error: 'Failed to retrieve checkout session',
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
