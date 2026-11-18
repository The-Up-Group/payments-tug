import request from 'supertest';
import express from 'express';
import { createPayment, createCheckoutSession } from '../src/controllers/paymentControllers';
import { getCardEvidence } from '../src/utils/cardEvidence';

const mockPaymentIntentsCreate = jest.fn();
const mockCheckoutSessionsCreate = jest.fn();
const mockCustomersRetrieve = jest.fn();
const mockChargesRetrieve = jest.fn();

jest.mock('stripe', () => {
    return jest.fn().mockImplementation(() => ({
        paymentIntents: { create: mockPaymentIntentsCreate },
        checkout: { sessions: { create: mockCheckoutSessionsCreate } },
        customers: { retrieve: mockCustomersRetrieve },
        charges: { retrieve: mockChargesRetrieve },
    }));
});

const DAY = 24 * 60 * 60;
const nowSeconds = () => Math.floor(Date.now() / 1000);
const ownedCustomer = (ageDays: number) => ({
    id: 'cus_123',
    created: nowSeconds() - ageDays * DAY,
    metadata: { externalUserId: 'user_1' },
});

let currentUser: Record<string, unknown> = {};

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
    (req as any).user = currentUser;
    next();
});
app.post('/payments', createPayment);
app.post('/payments/checkout-sessions', createCheckoutSession);

const body = {
    amount: 1000,
    currency: 'mxn',
    customerId: 'cus_123',
    applicationFeeAmount: 100,
    appId: 'app_1',
    eventId: 'evt_1',
    userId: 'user_1',
    ticketTypeId: 'tt_1',
    quantity: 1,
    buyerName: 'Ana López',
    platform: 'android',
    appVersion: '2.3.0+41',
};

beforeAll(() => {
    process.env.STRIPE_SECRET_KEY = 'fake-stripe-key';
});

beforeEach(() => {
    jest.clearAllMocks();
    currentUser = { id: 'user_1', isAnonymous: false, email: 'ana@example.com' };
    mockCustomersRetrieve.mockResolvedValue(ownedCustomer(90));
    mockPaymentIntentsCreate.mockResolvedValue({ id: 'pi_1', client_secret: 'secret' });
    mockCheckoutSessionsCreate.mockResolvedValue({ id: 'cs_1', client_secret: 'secret', payment_intent: null });
});

describe('createPayment 3DS', () => {
    it('requests 3DS for anonymous buyers even with an old customer', async () => {
        currentUser = { id: 'user_1', isAnonymous: true };

        await request(app).post('/payments').send({ ...body, guestEmail: 'guest@example.com' });

        const params = mockPaymentIntentsCreate.mock.calls[0][0];
        expect(params.payment_method_options).toEqual({ card: { request_three_d_secure: 'any' } });
        expect(params.metadata.threeDSecureRequested).toBe('true');
        expect(params.metadata.buyerIsAnonymous).toBe('true');
        expect(params.metadata.buyerEmail).toBe('guest@example.com');
    });

    it('requests 3DS for customers created less than 30 days ago', async () => {
        mockCustomersRetrieve.mockResolvedValueOnce(ownedCustomer(2));

        await request(app).post('/payments').send(body);

        expect(mockPaymentIntentsCreate.mock.calls[0][0].payment_method_options)
            .toEqual({ card: { request_three_d_secure: 'any' } });
    });

    it('does not request 3DS for established customers', async () => {
        mockCustomersRetrieve.mockResolvedValueOnce(ownedCustomer(90));

        await request(app).post('/payments').send(body);

        const params = mockPaymentIntentsCreate.mock.calls[0][0];
        expect(params.payment_method_options).toBeUndefined();
        expect(params.metadata.threeDSecureRequested).toBeUndefined();
    });

    it('fails without charging when the customer lookup fails', async () => {
        mockCustomersRetrieve.mockRejectedValueOnce(new Error('stripe down'));

        const res = await request(app).post('/payments').send(body);

        expect(res.status).toBe(500);
        expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
    });

    it('returns 403 when charging a customer that belongs to another user', async () => {
        mockCustomersRetrieve.mockResolvedValueOnce({ ...ownedCustomer(90), metadata: { externalUserId: 'someone-else' } });

        const res = await request(app).post('/payments').send({ ...body, paymentMethodId: 'pm_victim' });

        expect(res.status).toBe(403);
        expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
    });

    it('does not request 3DS for off-session saved card charges', async () => {
        currentUser = { id: 'user_1', isAnonymous: true };

        await request(app).post('/payments').send({ ...body, paymentMethodId: 'pm_1' });

        const params = mockPaymentIntentsCreate.mock.calls[0][0];
        expect(params.payment_method_options).toBeUndefined();
        expect(params.off_session).toBe(true);
    });

    it('stores buyer evidence in the PaymentIntent metadata', async () => {
        mockCustomersRetrieve.mockResolvedValueOnce(ownedCustomer(90));

        await request(app)
            .post('/payments')
            .set('User-Agent', 'Dart/3.5 (dart:io)')
            .set('X-Forwarded-For', '201.141.10.20, 10.0.0.1')
            .send(body);

        expect(mockPaymentIntentsCreate.mock.calls[0][0].metadata).toEqual(expect.objectContaining({
            buyerName: 'Ana López',
            buyerEmail: 'ana@example.com',
            buyerIsAnonymous: 'false',
            buyerIp: '201.141.10.20, 10.0.0.1',
            buyerUserAgent: 'Dart/3.5 (dart:io)',
            buyerPlatform: 'android',
            buyerAppVersion: '2.3.0+41',
        }));
    });

    it('truncates evidence values to the Stripe metadata limit', async () => {
        mockCustomersRetrieve.mockResolvedValueOnce(ownedCustomer(90));

        await request(app).post('/payments').send({ ...body, buyerName: 'a'.repeat(800) });

        expect(mockPaymentIntentsCreate.mock.calls[0][0].metadata.buyerName).toHaveLength(500);
    });
});

describe('createCheckoutSession 3DS', () => {
    const checkoutBody = { ...body, returnUrl: 'https://example.com/return', platform: 'web' };

    it('requests 3DS and stores evidence in the PaymentIntent metadata for new customers', async () => {
        mockCustomersRetrieve.mockResolvedValueOnce(ownedCustomer(1));

        await request(app).post('/payments/checkout-sessions').send(checkoutBody);

        const params = mockCheckoutSessionsCreate.mock.calls[0][0];
        expect(params.payment_method_options).toEqual({ card: { request_three_d_secure: 'any' } });
        expect(params.payment_intent_data.metadata).toEqual(expect.objectContaining({
            threeDSecureRequested: 'true',
            buyerName: 'Ana López',
            buyerPlatform: 'web',
        }));
    });

    it('does not request 3DS for established customers', async () => {
        mockCustomersRetrieve.mockResolvedValueOnce(ownedCustomer(90));

        await request(app).post('/payments/checkout-sessions').send(checkoutBody);

        const params = mockCheckoutSessionsCreate.mock.calls[0][0];
        expect(params.payment_method_options).toBeUndefined();
        expect(params.payment_intent_data.metadata.threeDSecureRequested).toBeUndefined();
    });

    it('offers saved cards and the save checkbox to registered users', async () => {
        await request(app).post('/payments/checkout-sessions').send(checkoutBody);

        expect(mockCheckoutSessionsCreate.mock.calls[0][0].saved_payment_method_options).toEqual({
            payment_method_save: 'enabled',
            allow_redisplay_filters: ['always', 'limited', 'unspecified'],
        });
    });

    it('does not offer saved cards to guests', async () => {
        currentUser = { id: 'user_1', isAnonymous: true };

        await request(app).post('/payments/checkout-sessions').send(checkoutBody);

        expect(mockCheckoutSessionsCreate.mock.calls[0][0].saved_payment_method_options).toBeUndefined();
    });

    it('returns 403 when the customer belongs to another user', async () => {
        mockCustomersRetrieve.mockResolvedValueOnce({ ...ownedCustomer(90), metadata: { externalUserId: 'someone-else' } });

        const res = await request(app).post('/payments/checkout-sessions').send(checkoutBody);

        expect(res.status).toBe(403);
        expect(mockCheckoutSessionsCreate).not.toHaveBeenCalled();
    });
});

describe('getCardEvidence', () => {
    const stripe = new (require('stripe'))('fake') as any;

    it('extracts cardholder name, card and 3DS data from the charge', async () => {
        mockChargesRetrieve.mockResolvedValueOnce({
            billing_details: { name: 'ANA LOPEZ' },
            payment_method_details: {
                card: { brand: 'visa', last4: '4242', fingerprint: 'fp_1', three_d_secure: { result: 'authenticated' } },
            },
            outcome: { risk_level: 'normal' },
        });

        await expect(getCardEvidence(stripe, 'ch_1')).resolves.toEqual({
            cardholderName: 'ANA LOPEZ',
            cardBrand: 'visa',
            cardLast4: '4242',
            cardFingerprint: 'fp_1',
            threeDSecureResult: 'authenticated',
            riskLevel: 'normal',
        });
    });

    it('returns undefined without a charge id or when Stripe fails', async () => {
        await expect(getCardEvidence(stripe, null)).resolves.toBeUndefined();
        mockChargesRetrieve.mockRejectedValueOnce(new Error('boom'));
        await expect(getCardEvidence(stripe, 'ch_1')).resolves.toBeUndefined();
    });
});
