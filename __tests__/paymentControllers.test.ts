import request from 'supertest';
import express from 'express';
import { createPayment, createCheckoutSession, getCheckoutSessionStatus, getPaymentStatus } from '../src/controllers/paymentControllers';

const mockPaymentIntentsCreate    = jest.fn();
const mockPaymentIntentsRetrieve  = jest.fn();
const mockCheckoutSessionsCreate  = jest.fn();
const mockCheckoutSessionsRetrieve = jest.fn();

jest.mock('stripe', () => {
    return jest.fn().mockImplementation(() => ({
        paymentIntents: {
            create:   mockPaymentIntentsCreate,
            retrieve: mockPaymentIntentsRetrieve,
        },
        checkout: {
            sessions: {
                create: mockCheckoutSessionsCreate,
                retrieve: mockCheckoutSessionsRetrieve,
            },
        },
    }));
});

const app = express();
app.use(express.json());
app.post('/payments', createPayment);
app.post('/payments/checkout-sessions', createCheckoutSession);
app.get('/payments/checkout-sessions/:sessionId', getCheckoutSessionStatus);
app.get('/payments/:id', getPaymentStatus);

beforeAll(() => {
    process.env.STRIPE_SECRET_KEY = 'fake-stripe-key';
});

// ─── createPayment ────────────────────────────────────────────────────────────

describe('createPayment', () => {
    const validBody = {
        amount: 1000,
        currency: 'usd',
        customerId: 'cus_123',
        destinationAccountId: 'acct_123',
        applicationFeeAmount: 100,
        appId: 'app_1',
        eventId: 'evt_1',
        userId: 'user_1',
        ticketTypeId: 'ticket_type_1',
        quantity: 1,
    };

    it('returns 400 when required fields are missing', async () => {
        const res = await request(app)
            .post('/payments')
            .send({ amount: 1000 });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Missing required fields');
    });

    it('returns 400 when amount is 0', async () => {
        const res = await request(app)
            .post('/payments')
            .send({ ...validBody, amount: 0 });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Missing required fields');
    });

    it('returns 400 when applicationFeeAmount is missing', async () => {
        const { applicationFeeAmount, ...rest } = validBody;

        const res = await request(app)
            .post('/payments')
            .send(rest);

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid applicationFeeAmount');
    });

    it('returns 400 when applicationFeeAmount is negative', async () => {
        const res = await request(app)
            .post('/payments')
            .send({ ...validBody, applicationFeeAmount: -1 });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid applicationFeeAmount');
    });

    it('returns 400 when applicationFeeAmount exceeds amount', async () => {
        const res = await request(app)
            .post('/payments')
            .send({ ...validBody, applicationFeeAmount: 1001 });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid applicationFeeAmount');
    });

    it('returns 201 with clientSecret, paymentIntentId and the client-provided platformFee', async () => {
        mockPaymentIntentsCreate.mockResolvedValueOnce({
            id: 'pi_123',
            client_secret: 'pi_123_secret',
        });

        const res = await request(app)
            .post('/payments')
            .send(validBody);

        expect(res.status).toBe(201);
        expect(res.body.paymentIntentId).toBe('pi_123');
        expect(res.body.clientSecret).toBe('pi_123_secret');
        expect(res.body.platformFee).toBe(100);

        const callArgs = mockPaymentIntentsCreate.mock.calls[0][0];
        expect(callArgs.application_fee_amount).toBe(100);
    });

    it('creates a Connect charge with the fee copied into metadata and no platformCharge flag', async () => {
        mockPaymentIntentsCreate.mockResolvedValueOnce({ id: 'pi_conn', client_secret: 'secret' });

        await request(app).post('/payments').send(validBody);

        const callArgs = mockPaymentIntentsCreate.mock.calls[0][0];
        expect(callArgs.transfer_data.destination).toBe('acct_123');
        expect(callArgs.application_fee_amount).toBe(100);
        expect(callArgs.metadata.applicationFeeAmount).toBe('100');
        expect(callArgs.metadata.platformCharge).toBeUndefined();
    });

    it('creates a platform charge without transfer_data or application_fee_amount when destinationAccountId is omitted', async () => {
        mockPaymentIntentsCreate.mockResolvedValueOnce({ id: 'pi_plat', client_secret: 'secret' });
        const { destinationAccountId, ...rest } = validBody;

        const res = await request(app).post('/payments').send(rest);

        expect(res.status).toBe(201);
        expect(res.body.platformFee).toBe(100);

        const callArgs = mockPaymentIntentsCreate.mock.calls[0][0];
        expect(callArgs.transfer_data).toBeUndefined();
        expect(callArgs.application_fee_amount).toBeUndefined();
        expect(callArgs.metadata.platformCharge).toBe('true');
        expect(callArgs.metadata.applicationFeeAmount).toBe('100');
    });

    it('still requires applicationFeeAmount on platform charges', async () => {
        const { destinationAccountId, applicationFeeAmount, ...rest } = validBody;

        const res = await request(app).post('/payments').send(rest);

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid applicationFeeAmount');
        expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
    });

    it('passes through a fractional-commission fee unchanged (rounded)', async () => {
        mockPaymentIntentsCreate.mockResolvedValueOnce({ id: 'pi_456', client_secret: 'secret' });

        const res = await request(app)
            .post('/payments')
            .send({ ...validBody, amount: 3333, applicationFeeAmount: 333.3 });

        expect(res.body.platformFee).toBe(333);
    });

    it('calls Stripe with confirm and off_session when paymentMethodId is provided', async () => {
        mockPaymentIntentsCreate.mockResolvedValueOnce({ id: 'pi_789', client_secret: 'secret' });

        await request(app)
            .post('/payments')
            .send({ ...validBody, paymentMethodId: 'pm_abc' });

        const callArgs = mockPaymentIntentsCreate.mock.calls[0][0];
        expect(callArgs.payment_method).toBe('pm_abc');
        expect(callArgs.confirm).toBe(true);
        expect(callArgs.off_session).toBe(true);
    });

    it('does NOT send confirm or off_session when paymentMethodId is omitted', async () => {
        mockPaymentIntentsCreate.mockResolvedValueOnce({ id: 'pi_000', client_secret: 'secret' });

        await request(app).post('/payments').send(validBody);

        const callArgs = mockPaymentIntentsCreate.mock.calls[0][0];
        expect(callArgs.confirm).toBeUndefined();
        expect(callArgs.off_session).toBeUndefined();
    });

    it('returns 500 when Stripe throws an error', async () => {
        mockPaymentIntentsCreate.mockRejectedValueOnce(new Error('Card declined'));

        const res = await request(app).post('/payments').send(validBody);

        expect(res.status).toBe(500);
        expect(res.body.error).toBe('Failed to create payment');
    });
});

// ─── createCheckoutSession ────────────────────────────────────────────────────

describe('createCheckoutSession', () => {
    const validBody = {
        amount: 1000,
        currency: 'usd',
        customerId: 'cus_123',
        destinationAccountId: 'acct_123',
        applicationFeeAmount: 100,
        appId: 'app_1',
        eventId: 'evt_1',
        userId: 'user_1',
        ticketTypeId: 'ticket_type_1',
        quantity: 1,
        returnUrl: 'https://example.com/checkout/return',
    };

    it('returns 400 when required fields are missing', async () => {
        const res = await request(app)
            .post('/payments/checkout-sessions')
            .send({ amount: 1000 });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Missing required fields');
    });

    it('returns 400 when returnUrl is missing', async () => {
        const { returnUrl, ...rest } = validBody;

        const res = await request(app)
            .post('/payments/checkout-sessions')
            .send(rest);

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Missing required fields');
    });

    it('returns 400 when applicationFeeAmount is missing', async () => {
        const { applicationFeeAmount, ...rest } = validBody;

        const res = await request(app)
            .post('/payments/checkout-sessions')
            .send(rest);

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid applicationFeeAmount');
    });

    it('returns 400 when applicationFeeAmount is negative', async () => {
        const res = await request(app)
            .post('/payments/checkout-sessions')
            .send({ ...validBody, applicationFeeAmount: -1 });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid applicationFeeAmount');
    });

    it('returns 400 when applicationFeeAmount exceeds amount', async () => {
        const res = await request(app)
            .post('/payments/checkout-sessions')
            .send({ ...validBody, applicationFeeAmount: 1001 });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid applicationFeeAmount');
    });

    it('returns 201 with clientSecret, sessionId and the client-provided platformFee', async () => {
        mockCheckoutSessionsCreate.mockResolvedValueOnce({
            id: 'cs_123',
            client_secret: 'cs_123_secret',
            payment_intent: 'pi_123',
        });

        const res = await request(app)
            .post('/payments/checkout-sessions')
            .send(validBody);

        expect(res.status).toBe(201);
        expect(res.body.sessionId).toBe('cs_123');
        expect(res.body.clientSecret).toBe('cs_123_secret');
        expect(res.body.paymentIntentId).toBe('pi_123');
        expect(res.body.platformFee).toBe(100);

        const callArgs = mockCheckoutSessionsCreate.mock.calls[0][0];
        expect(callArgs.ui_mode).toBe('embedded_page');
        expect(callArgs.mode).toBe('payment');
        expect(callArgs.return_url).toBe(validBody.returnUrl);
        expect(callArgs.payment_intent_data.application_fee_amount).toBe(100);
        expect(callArgs.payment_intent_data.transfer_data.destination).toBe('acct_123');
        expect(callArgs.line_items[0].price_data.unit_amount).toBe(1000);
        expect(callArgs.line_items[0].price_data.currency).toBe('usd');
    });

    it('creates a Connect session with the fee copied into both metadata objects', async () => {
        mockCheckoutSessionsCreate.mockResolvedValueOnce({ id: 'cs_conn', client_secret: 'secret' });

        await request(app).post('/payments/checkout-sessions').send(validBody);

        const callArgs = mockCheckoutSessionsCreate.mock.calls[0][0];
        expect(callArgs.payment_intent_data.transfer_data.destination).toBe('acct_123');
        expect(callArgs.payment_intent_data.metadata.applicationFeeAmount).toBe('100');
        expect(callArgs.payment_intent_data.metadata.platformCharge).toBeUndefined();
        expect(callArgs.metadata).toEqual(callArgs.payment_intent_data.metadata);
    });

    it('creates a platform session without transfer_data or application_fee_amount when destinationAccountId is omitted', async () => {
        mockCheckoutSessionsCreate.mockResolvedValueOnce({ id: 'cs_plat', client_secret: 'secret' });
        const { destinationAccountId, ...rest } = validBody;

        const res = await request(app).post('/payments/checkout-sessions').send(rest);

        expect(res.status).toBe(201);
        expect(res.body.platformFee).toBe(100);

        const callArgs = mockCheckoutSessionsCreate.mock.calls[0][0];
        expect(callArgs.payment_intent_data.transfer_data).toBeUndefined();
        expect(callArgs.payment_intent_data.application_fee_amount).toBeUndefined();
        expect(callArgs.payment_intent_data.metadata.platformCharge).toBe('true');
        expect(callArgs.payment_intent_data.metadata.applicationFeeAmount).toBe('100');
        expect(callArgs.metadata).toEqual(callArgs.payment_intent_data.metadata);
    });

    it('passes through a fractional-commission fee unchanged (rounded)', async () => {
        mockCheckoutSessionsCreate.mockResolvedValueOnce({ id: 'cs_456', client_secret: 'secret' });

        const res = await request(app)
            .post('/payments/checkout-sessions')
            .send({ ...validBody, amount: 3333, applicationFeeAmount: 333.3 });

        expect(res.body.platformFee).toBe(333);
    });

    it('unwraps paymentIntentId when Stripe returns an expanded payment_intent object', async () => {
        mockCheckoutSessionsCreate.mockResolvedValueOnce({
            id: 'cs_789',
            client_secret: 'secret',
            payment_intent: { id: 'pi_789' },
        });

        const res = await request(app).post('/payments/checkout-sessions').send(validBody);

        expect(res.body.paymentIntentId).toBe('pi_789');
    });

    it('returns paymentIntentId null when Stripe omits payment_intent', async () => {
        mockCheckoutSessionsCreate.mockResolvedValueOnce({ id: 'cs_000', client_secret: 'secret' });

        const res = await request(app).post('/payments/checkout-sessions').send(validBody);

        expect(res.body.paymentIntentId).toBeNull();
    });

    it('returns 500 when Stripe throws an error', async () => {
        mockCheckoutSessionsCreate.mockRejectedValueOnce(new Error('Invalid customer'));

        const res = await request(app).post('/payments/checkout-sessions').send(validBody);

        expect(res.status).toBe(500);
        expect(res.body.error).toBe('Failed to create checkout session');
    });
});

// ─── getCheckoutSessionStatus ─────────────────────────────────────────────────

describe('getCheckoutSessionStatus', () => {
    it('returns 200 with the resolved paymentIntentId once the session has one', async () => {
        mockCheckoutSessionsRetrieve.mockResolvedValueOnce({
            id: 'cs_123',
            status: 'complete',
            payment_intent: 'pi_123',
        });

        const res = await request(app).get('/payments/checkout-sessions/cs_123');

        expect(res.status).toBe(200);
        expect(res.body.sessionId).toBe('cs_123');
        expect(res.body.status).toBe('complete');
        expect(res.body.paymentIntentId).toBe('pi_123');
        expect(mockCheckoutSessionsRetrieve.mock.calls[0][0]).toBe('cs_123');
    });

    it('unwraps paymentIntentId when Stripe returns an expanded payment_intent object', async () => {
        mockCheckoutSessionsRetrieve.mockResolvedValueOnce({
            id: 'cs_789',
            status: 'complete',
            payment_intent: { id: 'pi_789' },
        });

        const res = await request(app).get('/payments/checkout-sessions/cs_789');

        expect(res.body.paymentIntentId).toBe('pi_789');
    });

    it('returns paymentIntentId null while the session is still open', async () => {
        mockCheckoutSessionsRetrieve.mockResolvedValueOnce({
            id: 'cs_000',
            status: 'open',
        });

        const res = await request(app).get('/payments/checkout-sessions/cs_000');

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('open');
        expect(res.body.paymentIntentId).toBeNull();
    });

    it('returns 500 when Stripe throws an error', async () => {
        mockCheckoutSessionsRetrieve.mockRejectedValueOnce(new Error('No such session'));

        const res = await request(app).get('/payments/checkout-sessions/cs_bad');

        expect(res.status).toBe(500);
        expect(res.body.error).toBe('Failed to retrieve checkout session');
    });
});

// ─── getPaymentStatus ─────────────────────────────────────────────────────────

describe('getPaymentStatus', () => {
    it('returns 200 with payment status fields', async () => {
        mockPaymentIntentsRetrieve.mockResolvedValueOnce({
            id: 'pi_123',
            status: 'succeeded',
            amount: 1000,
            currency: 'usd',
        });

        const res = await request(app).get('/payments/pi_123');

        expect(res.status).toBe(200);
        expect(res.body.id).toBe('pi_123');
        expect(res.body.status).toBe('succeeded');
        expect(res.body.amount).toBe(1000);
        expect(res.body.currency).toBe('usd');
    });

    it('returns 500 when Stripe throws an error', async () => {
        mockPaymentIntentsRetrieve.mockRejectedValueOnce(new Error('Not found'));

        const res = await request(app).get('/payments/pi_bad');

        expect(res.status).toBe(500);
        expect(res.body.error).toBe('Failed to retrieve payment');
    });
});
