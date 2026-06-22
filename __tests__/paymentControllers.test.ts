import request from 'supertest';
import express from 'express';
import { createPayment, getPaymentStatus } from '../src/controllers/paymentControllers';

const mockPaymentIntentsCreate   = jest.fn();
const mockPaymentIntentsRetrieve = jest.fn();

jest.mock('stripe', () => {
    return jest.fn().mockImplementation(() => ({
        paymentIntents: {
            create:   mockPaymentIntentsCreate,
            retrieve: mockPaymentIntentsRetrieve,
        },
    }));
});

const app = express();
app.use(express.json());
app.post('/payments', createPayment);
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
        appId: 'app_1',
        eventId: 'evt_1',
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

    it('returns 201 with clientSecret, paymentIntentId and platformFee', async () => {
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
        // 10% of 1000 = 100
        expect(res.body.platformFee).toBe(100);
    });

    it('calculates the platform fee correctly for a different amount', async () => {
        mockPaymentIntentsCreate.mockResolvedValueOnce({ id: 'pi_456', client_secret: 'secret' });

        const res = await request(app)
            .post('/payments')
            .send({ ...validBody, amount: 3333 });

        // Math.round(3333 * 0.10) = Math.round(333.3) = 333
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
