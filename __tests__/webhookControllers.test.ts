import request from 'supertest';
import express from 'express';
import { handleStripeWebhook } from '../src/controllers/webhookControllers';

const mockConstructEvent = jest.fn();
const mockRetrieveIntent = jest.fn();

jest.mock('stripe', () => {
    return jest.fn().mockImplementation(() => ({
        webhooks: {
            constructEvent: mockConstructEvent,
        },
        paymentIntents: {
            retrieve: mockRetrieveIntent,
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
    process.env.PAYMENT_WEBHOOK_SECRET = 'forward-secret-test';
});

beforeEach(() => {
    mockFetch.mockResolvedValue({ ok: true });
    mockRetrieveIntent.mockResolvedValue({ latest_charge: null, transfer_data: null });
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

        // payment-webhook authenticates the forward with this shared secret
        expect(mockFetch.mock.calls[0][1].headers['x-webhook-secret']).toBe('forward-secret-test');
    });

    it('returns 500 without forwarding when PAYMENT_WEBHOOK_SECRET is not set', async () => {
        const saved = process.env.PAYMENT_WEBHOOK_SECRET;
        delete process.env.PAYMENT_WEBHOOK_SECRET;
        process.env.WEBHOOK_FORWARD_URL = 'https://myapp.com/webhooks';
        mockConstructEvent.mockReturnValueOnce({
            type: 'payment_intent.succeeded',
            data: { object: { id: 'pi_nosecret', amount: 500, currency: 'usd', metadata: {} } },
        });

        try {
            const res = await request(app)
                .post('/webhooks/stripe')
                .set('stripe-signature', 'valid-sig')
                .send(Buffer.from('{}'));

            expect(res.status).toBe(500);
            expect(mockFetch).not.toHaveBeenCalled();
        } finally {
            process.env.PAYMENT_WEBHOOK_SECRET = saved;
        }
    });

    it('returns 500 so Stripe retries when payment-webhook rejects the forward', async () => {
        mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
        process.env.WEBHOOK_FORWARD_URL = 'https://myapp.com/webhooks';
        mockConstructEvent.mockReturnValueOnce({
            type: 'payment_intent.succeeded',
            data: { object: { id: 'pi_rejected', amount: 500, currency: 'usd', metadata: {} } },
        });

        const res = await request(app)
            .post('/webhooks/stripe')
            .set('stripe-signature', 'valid-sig')
            .send(Buffer.from('{}'));

        expect(res.status).toBe(500);
        expect(res.body.error).toBe('Webhook handler error');
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
        expect(forwarded).not.toHaveProperty('stripeFee');
        expect(mockRetrieveIntent).not.toHaveBeenCalled();
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

describe('handleStripeWebhook — applicationFeeAmount forwarding', () => {
    const succeededEvent = (applicationFee: number | null, metadata: Record<string, string>) => ({
        type: 'payment_intent.succeeded',
        data: {
            object: {
                id: 'pi_fee',
                amount: 10000,
                currency: 'mxn',
                application_fee_amount: applicationFee,
                metadata,
            },
        },
    });

    const sendWebhook = () =>
        request(app)
            .post('/webhooks/stripe')
            .set('stripe-signature', 'valid-sig')
            .send(Buffer.from('{}'));

    beforeEach(() => {
        process.env.WEBHOOK_FORWARD_URL = 'https://myapp.com/webhooks';
    });

    it('forwards the fee Stripe retained on Connect charges, ignoring metadata', async () => {
        mockConstructEvent.mockReturnValueOnce(
            succeededEvent(850, { appId: 'app_1', eventId: 'evt_1', applicationFeeAmount: '999' }),
        );

        const res = await sendWebhook();

        expect(res.status).toBe(200);
        const forwarded = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(forwarded.applicationFeeAmount).toBe(850);
    });

    it('falls back to metadata.applicationFeeAmount on platform charges', async () => {
        mockConstructEvent.mockReturnValueOnce(
            succeededEvent(null, { appId: 'app_1', eventId: 'evt_1', applicationFeeAmount: '850', platformCharge: 'true' }),
        );

        const res = await sendWebhook();

        expect(res.status).toBe(200);
        const forwarded = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(forwarded.applicationFeeAmount).toBe(850);
    });

    it('omits applicationFeeAmount when neither Stripe nor metadata has a fee', async () => {
        mockConstructEvent.mockReturnValueOnce(
            succeededEvent(null, { appId: 'app_1', eventId: 'evt_1' }),
        );

        const res = await sendWebhook();

        expect(res.status).toBe(200);
        const forwarded = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(forwarded).not.toHaveProperty('applicationFeeAmount');
    });
});

describe('handleStripeWebhook — Stripe fee and transfer forwarding', () => {
    const succeededEvent = {
        type: 'payment_intent.succeeded',
        data: {
            object: {
                id: 'pi_fin',
                amount: 10000,
                currency: 'mxn',
                metadata: { appId: 'app_1', eventId: 'evt_1' },
            },
        },
    };

    const sendWebhook = () =>
        request(app)
            .post('/webhooks/stripe')
            .set('stripe-signature', 'valid-sig')
            .send(Buffer.from('{}'));

    beforeEach(() => {
        process.env.WEBHOOK_FORWARD_URL = 'https://myapp.com/webhooks';
        mockConstructEvent.mockReturnValueOnce(succeededEvent);
    });

    it('forwards the Stripe fee and the amount transferred on Connect charges', async () => {
        mockRetrieveIntent.mockResolvedValueOnce({
            transfer_data: { destination: 'acct_1' },
            latest_charge: {
                balance_transaction: { id: 'txn_1', fee: 410 },
                transfer: { id: 'tr_1', amount: 9150 },
            },
        });

        const res = await sendWebhook();

        expect(res.status).toBe(200);
        expect(mockRetrieveIntent).toHaveBeenCalledWith('pi_fin', {
            expand: ['latest_charge.balance_transaction', 'latest_charge.transfer'],
        });
        const forwarded = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(forwarded.stripeFee).toBe(410);
        expect(forwarded.balanceTransactionId).toBe('txn_1');
        expect(forwarded.transferAmount).toBe(9150);
    });

    it('forwards transferAmount 0 on platform charges', async () => {
        mockRetrieveIntent.mockResolvedValueOnce({
            transfer_data: null,
            latest_charge: {
                balance_transaction: { id: 'txn_2', fee: 410 },
                transfer: null,
            },
        });

        const res = await sendWebhook();

        expect(res.status).toBe(200);
        const forwarded = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(forwarded.stripeFee).toBe(410);
        expect(forwarded.transferAmount).toBe(0);
    });

    it('omits transferAmount when a Connect transfer is not available yet', async () => {
        mockRetrieveIntent.mockResolvedValueOnce({
            transfer_data: { destination: 'acct_1' },
            latest_charge: {
                balance_transaction: { id: 'txn_3', fee: 410 },
                transfer: null,
            },
        });

        const res = await sendWebhook();

        expect(res.status).toBe(200);
        const forwarded = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(forwarded.stripeFee).toBe(410);
        expect(forwarded).not.toHaveProperty('transferAmount');
    });

    it('still forwards the payment when reading the fee from Stripe fails', async () => {
        mockRetrieveIntent.mockRejectedValueOnce(new Error('Stripe down'));
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        try {
            const res = await sendWebhook();

            expect(res.status).toBe(200);
            const forwarded = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(forwarded.paymentIntentId).toBe('pi_fin');
            expect(forwarded).not.toHaveProperty('stripeFee');
            expect(forwarded).not.toHaveProperty('transferAmount');
        } finally {
            errorSpy.mockRestore();
        }
    });
});
