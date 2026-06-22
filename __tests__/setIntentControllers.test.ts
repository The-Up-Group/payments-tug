import request from 'supertest';
import express from 'express';
import { setupIntents } from '../src/controllers/setIntentControllers';

const mockSetupIntentsCreate = jest.fn();

jest.mock('stripe', () => {
    return jest.fn().mockImplementation(() => ({
        setupIntents: {
            create: mockSetupIntentsCreate,
        },
    }));
});

const app = express();
app.use(express.json());
app.post('/setup-intents', setupIntents);

beforeAll(() => {
    process.env.STRIPE_SECRET_KEY = 'fake-stripe-key';
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
