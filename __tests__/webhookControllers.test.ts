import request from 'supertest';
import express from 'express';
import { handleStripeWebhook } from '../src/controllers/webhookControllers';

const mockConstructEvent = jest.fn();

jest.mock('stripe', () => {
    return jest.fn().mockImplementation(() => ({
        webhooks: {
            constructEvent: mockConstructEvent,
        },
    }));
});

// Mock the global fetch used by forwardEvent so no real HTTP calls are made.
const mockFetch = jest.fn();
global.fetch = mockFetch;

const app = express();
// Webhooks require a raw Buffer body — same as in server.ts
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), handleStripeWebhook);

beforeAll(() => {
    process.env.STRIPE_SECRET_KEY = 'fake-stripe-key';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
});

beforeEach(() => {
    mockFetch.mockResolvedValue({ ok: true });
});

describe('handleStripeWebhook', () => {
    it('returns 400 when the Stripe signature is invalid', async () => {
        mockConstructEvent.mockImplementationOnce(() => {
            throw new Error('Signature mismatch');
        });

        const res = await request(app)
            .post('/webhooks/stripe')
            .set('stripe-signature', 'bad-sig')
            .send(Buffer.from('{}'));

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Webhook signature verification failed');
    });

    it('returns 200 and forwards a payment_intent.succeeded event', async () => {
        const fakeEvent = {
            type: 'payment_intent.succeeded',
            data: {
                object: {
                    id: 'pi_123',
                    amount: 1000,
                    currency: 'usd',
                    metadata: { appId: 'app_1', eventId: 'evt_1' },
                },
            },
        };
        mockConstructEvent.mockReturnValueOnce(fakeEvent);
        process.env.WEBHOOK_FORWARD_URL = 'https://myapp.com/webhooks';

        const res = await request(app)
            .post('/webhooks/stripe')
            .set('stripe-signature', 'valid-sig')
            .send(Buffer.from(JSON.stringify(fakeEvent)));

        expect(res.status).toBe(200);
        expect(res.body.received).toBe(true);

        // Verify the payload forwarded to our backend is correct
        const forwarded = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(forwarded.type).toBe('payment_intent.succeeded');
        expect(forwarded.paymentIntentId).toBe('pi_123');
        expect(forwarded.amount).toBe(1000);
        expect(forwarded.currency).toBe('usd');
    });

    it('returns 200 and forwards a payment_intent.payment_failed event', async () => {
        const fakeEvent = {
            type: 'payment_intent.payment_failed',
            data: {
                object: {
                    id: 'pi_456',
                    metadata: { appId: 'app_1', eventId: 'evt_1' },
                },
            },
        };
        mockConstructEvent.mockReturnValueOnce(fakeEvent);
        process.env.WEBHOOK_FORWARD_URL = 'https://myapp.com/webhooks';

        const res = await request(app)
            .post('/webhooks/stripe')
            .set('stripe-signature', 'valid-sig')
            .send(Buffer.from(JSON.stringify(fakeEvent)));

        expect(res.status).toBe(200);

        const forwarded = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(forwarded.type).toBe('payment_intent.payment_failed');
        expect(forwarded.paymentIntentId).toBe('pi_456');
    });

    it('returns 200 and does nothing for unrecognised event types', async () => {
        mockConstructEvent.mockReturnValueOnce({ type: 'customer.created', data: { object: {} } });

        const res = await request(app)
            .post('/webhooks/stripe')
            .set('stripe-signature', 'valid-sig')
            .send(Buffer.from('{}'));

        expect(res.status).toBe(200);
        expect(res.body.received).toBe(true);
        // fetch should not have been called — nothing to forward
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('does not call fetch when WEBHOOK_FORWARD_URL is not set', async () => {
        delete process.env.WEBHOOK_FORWARD_URL;
        mockConstructEvent.mockReturnValueOnce({
            type: 'payment_intent.succeeded',
            data: { object: { id: 'pi_789', amount: 500, currency: 'usd', metadata: {} } },
        });

        const res = await request(app)
            .post('/webhooks/stripe')
            .set('stripe-signature', 'valid-sig')
            .send(Buffer.from('{}'));

        expect(res.status).toBe(200);
        expect(mockFetch).not.toHaveBeenCalled();
    });
});
