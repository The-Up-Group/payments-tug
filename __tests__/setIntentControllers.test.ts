import request from 'supertest';
import express from 'express';
import { setupIntents } from '../src/controllers/setIntentControllers';

const mockSetupIntentsCreate = jest.fn();
const mockCustomersRetrieve = jest.fn();

jest.mock('stripe', () => {
    return jest.fn().mockImplementation(() => ({
        setupIntents: {
            create: mockSetupIntentsCreate,
        },
        customers: {
            retrieve: mockCustomersRetrieve,
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
app.post('/setup-intents', setupIntents);

beforeAll(() => {
    process.env.STRIPE_SECRET_KEY = 'fake-stripe-key';
});

beforeEach(() => {
    jest.clearAllMocks();
    currentUser = { id: 'user_1', isAnonymous: false };
    mockCustomersRetrieve.mockResolvedValue({ id: 'cus_123', created: 1, metadata: { externalUserId: 'user_1' } });
});

describe('setupIntents ownership', () => {
    it('returns 403 for guest accounts', async () => {
        currentUser = { id: 'user_1', isAnonymous: true };

        const res = await request(app).post('/setup-intents').send({ customerId: 'cus_123', appId: 'app_1' });

        expect(res.status).toBe(403);
        expect(mockSetupIntentsCreate).not.toHaveBeenCalled();
    });

    it('returns 403 when the customer belongs to another user', async () => {
        mockCustomersRetrieve.mockResolvedValueOnce({ id: 'cus_other', created: 1, metadata: { externalUserId: 'someone-else' } });

        const res = await request(app).post('/setup-intents').send({ customerId: 'cus_other', appId: 'app_1' });

        expect(res.status).toBe(403);
        expect(mockSetupIntentsCreate).not.toHaveBeenCalled();
    });
});

describe('setupIntents', () => {
    it('returns 400 when customerId is missing', async () => {
        const res = await request(app)
            .post('/setup-intents')
            .send({ appId: 'app_1' });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Missing customerId or appId');
    });

    it('returns 400 when appId is missing', async () => {
        const res = await request(app)
            .post('/setup-intents')
            .send({ customerId: 'cus_123' });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Missing customerId or appId');
    });

    it('returns 400 when both fields are missing', async () => {
        const res = await request(app).post('/setup-intents').send({});

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Missing customerId or appId');
    });

    it('returns 201 with clientSecret on success', async () => {
        mockSetupIntentsCreate.mockResolvedValueOnce({
            client_secret: 'seti_test_secret',
        });

        const res = await request(app)
            .post('/setup-intents')
            .send({ customerId: 'cus_123', appId: 'app_1' });

        expect(res.status).toBe(201);
        expect(res.body.clientSecret).toBe('seti_test_secret');
    });

    it('calls Stripe with correct params', async () => {
        mockSetupIntentsCreate.mockResolvedValueOnce({ client_secret: 'secret' });

        await request(app)
            .post('/setup-intents')
            .send({ customerId: 'cus_123', appId: 'app_1' });

        const callArgs = mockSetupIntentsCreate.mock.calls[0][0];
        expect(callArgs.customer).toBe('cus_123');
        expect(callArgs.usage).toBe('off_session');
        expect(callArgs.metadata.appId).toBe('app_1');
    });

    it('returns 500 when Stripe throws an error', async () => {
        mockSetupIntentsCreate.mockRejectedValueOnce(new Error('Stripe error'));

        const res = await request(app)
            .post('/setup-intents')
            .send({ customerId: 'cus_123', appId: 'app_1' });

        expect(res.status).toBe(500);
        expect(res.body.error).toBe('Failed to create SetupIntent');
    });
});
