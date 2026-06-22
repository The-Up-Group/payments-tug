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

jest.mock('stripe', () => {
    return jest.fn().mockImplementation(() => ({
        customers: {
            search: mockCustomersSearch,
            create: mockCustomersCreate,
        },
        paymentMethods: {
            list:   mockPaymentMethodsList,
            detach: mockPaymentMethodsDetach,
        },
        customerSessions: {
            create: mockCustomerSessionsCreate,
        },
    }));
});

const app = express();
app.use(express.json());

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

        expect(res.status).toBe(201); // controller uses 201 here
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

        expect(res.status).toBe(201);
        expect(res.body.paymentMethods).toEqual([]);
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

    it('returns 500 when Stripe throws an error', async () => {
        mockPaymentMethodsDetach.mockRejectedValueOnce(new Error('Stripe error'));

        const res = await request(app).delete('/payment-methods/pm_bad');

        expect(res.status).toBe(500);
        expect(res.body.error).toBe('Failed to delete customer Payment Method');
    });
});
