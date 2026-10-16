import request from 'supertest';
import express from 'express';
import { getPlatformBalance, getPlatformPayouts, createPlatformPayout } from '../src/controllers/platformControllers';

const mockBalanceRetrieve = jest.fn();
const mockPayoutsList = jest.fn();
const mockPayoutsCreate = jest.fn();

jest.mock('stripe', () => {
    return jest.fn().mockImplementation(() => ({
        balance: { retrieve: mockBalanceRetrieve },
        payouts: { list: mockPayoutsList, create: mockPayoutsCreate },
    }));
});

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
    (req as any).user = { id: 'admin-user' };
    next();
});
app.get('/platform/balance', getPlatformBalance);
app.get('/platform/payouts', getPlatformPayouts);
app.post('/platform/payouts', createPlatformPayout);

const balance = {
    available: [{ amount: 50000, currency: 'mxn' }, { amount: 999, currency: 'usd' }],
    pending: [{ amount: 12000, currency: 'mxn' }],
};

const stripePayout = {
    id: 'po_1',
    amount: 30000,
    currency: 'mxn',
    arrival_date: 1760000000,
    created: 1759900000,
    status: 'pending',
    description: null,
};

beforeAll(() => {
    process.env.STRIPE_SECRET_KEY = 'fake-stripe-key';
});

describe('getPlatformBalance', () => {
    it('returns available and pending for MXN by default', async () => {
        mockBalanceRetrieve.mockResolvedValueOnce(balance);

        const res = await request(app).get('/platform/balance');

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ available: 50000, pending: 12000, currency: 'mxn' });
        expect(mockBalanceRetrieve).toHaveBeenCalledWith();
    });

    it('returns 0 for a currency with no funds', async () => {
        mockBalanceRetrieve.mockResolvedValueOnce(balance);

        const res = await request(app).get('/platform/balance?currency=USD');

        expect(res.body).toEqual({ available: 999, pending: 0, currency: 'usd' });
    });

    it('returns 500 when Stripe fails', async () => {
        mockBalanceRetrieve.mockRejectedValueOnce(new Error('Stripe down'));

        const res = await request(app).get('/platform/balance');

        expect(res.status).toBe(500);
        expect(res.body.error).toBe('Failed to retrieve platform balance');
    });
});

describe('getPlatformPayouts', () => {
    it('maps Stripe payouts and defaults to 10', async () => {
        mockPayoutsList.mockResolvedValueOnce({ data: [stripePayout] });

        const res = await request(app).get('/platform/payouts');

        expect(res.status).toBe(200);
        expect(mockPayoutsList).toHaveBeenCalledWith({ limit: 10 });
        expect(res.body.payouts).toEqual([{
            id: 'po_1',
            amount: 30000,
            currency: 'mxn',
            arrivalDate: 1760000000,
            created: 1759900000,
            status: 'pending',
            description: null,
        }]);
    });

    it('caps the limit at 100', async () => {
        mockPayoutsList.mockResolvedValueOnce({ data: [] });

        await request(app).get('/platform/payouts?limit=500');

        expect(mockPayoutsList).toHaveBeenCalledWith({ limit: 100 });
    });
});

describe('createPlatformPayout', () => {
    it('returns 400 when amount is not a positive integer', async () => {
        const res = await request(app).post('/platform/payouts').send({ amount: 10.5, requestId: 'r1' });

        expect(res.status).toBe(400);
        expect(mockPayoutsCreate).not.toHaveBeenCalled();
    });

    it('returns 400 when requestId is missing', async () => {
        const res = await request(app).post('/platform/payouts').send({ amount: 1000 });

        expect(res.status).toBe(400);
        expect(mockPayoutsCreate).not.toHaveBeenCalled();
    });

    it('returns 400 when the amount exceeds the available balance', async () => {
        mockBalanceRetrieve.mockResolvedValueOnce(balance);

        const res = await request(app).post('/platform/payouts').send({ amount: 50001, requestId: 'r1' });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Amount exceeds available balance');
        expect(res.body.available).toBe(50000);
        expect(mockPayoutsCreate).not.toHaveBeenCalled();
    });

    it('creates the payout with an idempotency key and the admin id', async () => {
        mockBalanceRetrieve.mockResolvedValueOnce(balance);
        mockPayoutsCreate.mockResolvedValueOnce(stripePayout);

        const res = await request(app).post('/platform/payouts').send({ amount: 30000, requestId: 'req-123' });

        expect(res.status).toBe(201);
        expect(res.body.id).toBe('po_1');
        expect(mockPayoutsCreate).toHaveBeenCalledWith(
            { amount: 30000, currency: 'mxn', metadata: { triggeredBy: 'admin-user' } },
            { idempotencyKey: 'platform-payout-req-123' },
        );
    });

    it('returns 400 when Stripe rejects the payout request', async () => {
        mockBalanceRetrieve.mockResolvedValueOnce(balance);
        mockPayoutsCreate.mockRejectedValueOnce(
            Object.assign(new Error('No bank account'), { type: 'StripeInvalidRequestError' }),
        );

        const res = await request(app).post('/platform/payouts').send({ amount: 1000, requestId: 'r2' });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Failed to create platform payout');
    });
});
