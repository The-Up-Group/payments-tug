import request from 'supertest';
import express from 'express';
import {
    createOrGetCustomer,
    listCustomerPaymentMethods,
    createCustomerSession,
    deleteCustomerPaymentMethod,
} from '../src/controllers/customerControllers';

const mockCustomersSearch         = jest.fn();
const mockCustomersCreate         = jest.fn();
const mockPaymentMethodsList      = jest.fn();
const mockPaymentMethodsDetach    = jest.fn();
const mockCustomerSessionsCreate  = jest.fn();
const mockCustomersRetrieve       = jest.fn();
const mockPaymentMethodsRetrieve  = jest.fn();

jest.mock('stripe', () => {
    return jest.fn().mockImplementation(() => ({
        customers: {
            search: mockCustomersSearch,
            create: mockCustomersCreate,
            retrieve: mockCustomersRetrieve,
        },
        paymentMethods: {
            list:   mockPaymentMethodsList,
            detach: mockPaymentMethodsDetach,
            retrieve: mockPaymentMethodsRetrieve,
        },
        customerSessions: {
            create: mockCustomerSessionsCreate,
        },
    }));
});

let currentUser: Record<string, unknown> = {};

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
    (req as any).user = currentUser;
    next();
});

// createOrGetCustomer reads req.user.id which is normally set by AuthMiddleware.
// We simulate that here with a small inline middleware so we don't couple
// these tests to the auth middleware behaviour.
app.post('/customers', (req, _res, next) => {
    (req as any).user = { id: 'user-123' };
    next();
}, createOrGetCustomer);

app.get('/customers/:customerId/payment-methods', listCustomerPaymentMethods);
app.post('/customers/session', createCustomerSession);
app.delete('/payment-methods/:pmId', deleteCustomerPaymentMethod);

beforeAll(() => {
    process.env.STRIPE_SECRET_KEY = 'fake-stripe-key';
});

beforeEach(() => {
    jest.clearAllMocks();
    currentUser = { id: 'user-123', isAnonymous: false };
    mockCustomersRetrieve.mockResolvedValue({ id: 'cus_123', created: 1, metadata: { externalUserId: 'user-123' } });
    mockPaymentMethodsRetrieve.mockResolvedValue({ id: 'pm_123', customer: 'cus_123' });
});

// ─── createOrGetCustomer ──────────────────────────────────────────────────────

describe('createOrGetCustomer', () => {
    it('returns 400 when appId is missing', async () => {
        const res = await request(app).post('/customers').send({});

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('appId is required');
    });

    it('returns existing customer with isNew: false when already in Stripe', async () => {
        mockCustomersSearch.mockResolvedValueOnce({
            data: [{ id: 'cus_existing' }],
        });

        const res = await request(app)
            .post('/customers')
            .send({ appId: 'app_1' });

        expect(res.status).toBe(200);
        expect(res.body.customerId).toBe('cus_existing');
        expect(res.body.isNew).toBe(false);
    });

    it('creates and returns a new customer with isNew: true when none exists', async () => {
        mockCustomersSearch.mockResolvedValueOnce({ data: [] });
        mockCustomersCreate.mockResolvedValueOnce({ id: 'cus_new' });

        const res = await request(app)
            .post('/customers')
            .send({ appId: 'app_1' });

        expect(res.status).toBe(201);
        expect(res.body.customerId).toBe('cus_new');
        expect(res.body.isNew).toBe(true);
    });

    it('passes the correct metadata when creating a new customer', async () => {
        mockCustomersSearch.mockResolvedValueOnce({ data: [] });
        mockCustomersCreate.mockResolvedValueOnce({ id: 'cus_new' });

        await request(app).post('/customers').send({ appId: 'app_1' });

        const callArgs = mockCustomersCreate.mock.calls[0][0];
        expect(callArgs.metadata.externalUserId).toBe('user-123');
        expect(callArgs.metadata.appId).toBe('app_1');
    });

    it('creates the customer with a per-user idempotency key to avoid duplicates', async () => {
        mockCustomersSearch.mockResolvedValueOnce({ data: [] });
        mockCustomersCreate.mockResolvedValueOnce({ id: 'cus_new' });

        await request(app).post('/customers').send({ appId: 'app_1' });

        expect(mockCustomersCreate.mock.calls[0][1]).toEqual({ idempotencyKey: 'customer-app_1-user-123' });
    });

    it('returns the oldest customer when duplicates exist', async () => {
        mockCustomersSearch.mockResolvedValueOnce({
            data: [
                { id: 'cus_newer', created: 300 },
                { id: 'cus_oldest', created: 100 },
                { id: 'cus_middle', created: 200 },
            ],
        });

        const res = await request(app).post('/customers').send({ appId: 'app_1' });

        expect(res.body.customerId).toBe('cus_oldest');
    });

    it('returns 500 when Stripe throws an error', async () => {
        mockCustomersSearch.mockRejectedValueOnce(new Error('Stripe error'));

        const res = await request(app).post('/customers').send({ appId: 'app_1' });

        expect(res.status).toBe(500);
        expect(res.body.error).toBe('Failed to create or retrieve customer');
    });
});

// ─── listCustomerPaymentMethods ───────────────────────────────────────────────

describe('listCustomerPaymentMethods', () => {
    it('returns 200 with a mapped list of payment methods', async () => {
        mockPaymentMethodsList.mockResolvedValueOnce({
            data: [
                {
                    id: 'pm_123',
                    card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2027 },
                },
                {
                    id: 'pm_456',
                    card: { brand: 'mastercard', last4: '1234', exp_month: 6, exp_year: 2026 },
                },
            ],
        });

        const res = await request(app).get('/customers/cus_123/payment-methods');

        expect(res.status).toBe(200);
        expect(res.body.paymentMethods).toHaveLength(2);
        expect(res.body.paymentMethods[0]).toEqual({
            id: 'pm_123',
            cardBrand: 'visa',
            last4: '4242',
            expMonth: 12,
            expYear: 2027,
        });
    });

    it('returns an empty array when the customer has no payment methods', async () => {
        mockPaymentMethodsList.mockResolvedValueOnce({ data: [] });

        const res = await request(app).get('/customers/cus_123/payment-methods');

        expect(res.status).toBe(200);
        expect(res.body.paymentMethods).toEqual([]);
    });

    it('returns 403 when the customer belongs to another user', async () => {
        mockCustomersRetrieve.mockResolvedValueOnce({ id: 'cus_other', created: 1, metadata: { externalUserId: 'someone-else' } });

        const res = await request(app).get('/customers/cus_other/payment-methods');

        expect(res.status).toBe(403);
        expect(mockPaymentMethodsList).not.toHaveBeenCalled();
    });

    it('returns 403 when the customer was deleted', async () => {
        mockCustomersRetrieve.mockResolvedValueOnce({ id: 'cus_123', deleted: true });

        const res = await request(app).get('/customers/cus_123/payment-methods');

        expect(res.status).toBe(403);
    });

    it('returns 500 when Stripe throws an error', async () => {
        mockPaymentMethodsList.mockRejectedValueOnce(new Error('Stripe error'));

        const res = await request(app).get('/customers/cus_bad/payment-methods');

        expect(res.status).toBe(500);
        expect(res.body.error).toBe('Failed to retrieve customer Payment Methods');
    });
});

// ─── createCustomerSession ────────────────────────────────────────────────────

describe('createCustomerSession', () => {
    it('returns 400 when customerId is missing', async () => {
        const res = await request(app).post('/customers/session').send({});

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('customerId is required');
    });

    it('returns 201 with clientSecret on success', async () => {
        mockCustomerSessionsCreate.mockResolvedValueOnce({
            client_secret: 'cs_test_secret',
        });

        const res = await request(app)
            .post('/customers/session')
            .send({ customerId: 'cus_123' });

        expect(res.status).toBe(201);
        expect(res.body.clientSecret).toBe('cs_test_secret');
    });

    it('enables saved card redisplay for every allow_redisplay value', async () => {
        mockCustomerSessionsCreate.mockResolvedValueOnce({ client_secret: 'cs_test_secret' });

        await request(app).post('/customers/session').send({ customerId: 'cus_123' });

        const { components } = mockCustomerSessionsCreate.mock.calls[0][0];
        for (const element of [components.payment_element, components.mobile_payment_element]) {
            expect(element.features.payment_method_redisplay).toBe('enabled');
            expect(element.features.payment_method_allow_redisplay_filters).toEqual(['always', 'limited', 'unspecified']);
        }
    });

    it('returns 403 for guest accounts', async () => {
        currentUser = { id: 'user-123', isAnonymous: true };

        const res = await request(app).post('/customers/session').send({ customerId: 'cus_123' });

        expect(res.status).toBe(403);
        expect(mockCustomerSessionsCreate).not.toHaveBeenCalled();
    });

    it('returns 403 when the customer belongs to another user', async () => {
        mockCustomersRetrieve.mockResolvedValueOnce({ id: 'cus_other', created: 1, metadata: { externalUserId: 'someone-else' } });

        const res = await request(app).post('/customers/session').send({ customerId: 'cus_other' });

        expect(res.status).toBe(403);
        expect(mockCustomerSessionsCreate).not.toHaveBeenCalled();
    });

    it('returns 500 when Stripe throws an error', async () => {
        mockCustomerSessionsCreate.mockRejectedValueOnce(new Error('Stripe error'));

        const res = await request(app)
            .post('/customers/session')
            .send({ customerId: 'cus_123' });

        expect(res.status).toBe(500);
        expect(res.body.error).toBe('Failed to create customer session');
    });
});

// ─── deleteCustomerPaymentMethod ──────────────────────────────────────────────

describe('deleteCustomerPaymentMethod', () => {
    it('returns 200 on successful detach', async () => {
        mockPaymentMethodsDetach.mockResolvedValueOnce({});

        const res = await request(app).delete('/payment-methods/pm_123');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('returns 403 when the card belongs to another user', async () => {
        mockPaymentMethodsRetrieve.mockResolvedValueOnce({ id: 'pm_other', customer: 'cus_other' });
        mockCustomersRetrieve.mockResolvedValueOnce({ id: 'cus_other', created: 1, metadata: { externalUserId: 'someone-else' } });

        const res = await request(app).delete('/payment-methods/pm_other');

        expect(res.status).toBe(403);
        expect(mockPaymentMethodsDetach).not.toHaveBeenCalled();
    });

    it('returns 403 when the card is not attached to any customer', async () => {
        mockPaymentMethodsRetrieve.mockResolvedValueOnce({ id: 'pm_loose', customer: null });

        const res = await request(app).delete('/payment-methods/pm_loose');

        expect(res.status).toBe(403);
        expect(mockPaymentMethodsDetach).not.toHaveBeenCalled();
    });

    it('returns 500 when Stripe throws an error', async () => {
        mockPaymentMethodsDetach.mockRejectedValueOnce(new Error('Stripe error'));

        const res = await request(app).delete('/payment-methods/pm_bad');

        expect(res.status).toBe(500);
        expect(res.body.error).toBe('Failed to delete customer Payment Method');
    });
});
