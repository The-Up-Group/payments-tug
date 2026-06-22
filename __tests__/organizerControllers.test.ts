import request from 'supertest';
import express from 'express';
import { createOrganizerAccount, getOrganizerAccountStatus, deleteOrganizerAccount } from '../src/controllers/organizerControllers';

// These must be named mock* — Jest's hoisting rules allow mock-prefixed variables
// to be referenced inside jest.mock() factories. Any other prefix would throw.
const mockAccountsCreate   = jest.fn();
const mockAccountsRetrieve = jest.fn();
const mockAccountsDel      = jest.fn();
const mockAccountLinksCreate = jest.fn();

// Every call to new Stripe() returns the same object with the same jest.fn() instances.
// This means mockAccountsCreate.mockResolvedValueOnce(...) actually affects the
// function the controller calls.
jest.mock('stripe', () => {
    return jest.fn().mockImplementation(() => ({
        accounts: {
            create:   mockAccountsCreate,
            retrieve: mockAccountsRetrieve,
            del:      mockAccountsDel,
        },
        accountLinks: {
            create: mockAccountLinksCreate,
        },
    }));
});

const app = express();
app.use(express.json());
app.post('/accounts/onboard', createOrganizerAccount);
app.get('/accounts/:accountId/status', getOrganizerAccountStatus);
app.delete('/accounts/:accountId', deleteOrganizerAccount);

beforeAll(() => {
    process.env.STRIPE_SECRET_KEY = 'fake-stripe-key';
});

// ─── createOrganizerAccount ───────────────────────────────────────────────────

describe('createOrganizerAccount', () => {
    it('returns 400 when required fields are missing', async () => {
        const res = await request(app)
            .post('/accounts/onboard')
            .send({ email: 'org@test.com' });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Missing required fields');
    });

    it('returns 201 with accountId and onboardingUrl on success', async () => {
        mockAccountsCreate.mockResolvedValueOnce({ id: 'acct_123' });
        mockAccountLinksCreate.mockResolvedValueOnce({ url: 'https://onboarding.stripe.com/xyz' });

        const res = await request(app)
            .post('/accounts/onboard')
            .send({
                appId: 'app_1',
                email: 'org@test.com',
                refreshUrl: 'https://myapp.com/refresh',
                returnUrl: 'https://myapp.com/return',
            });

        expect(res.status).toBe(201);
        expect(res.body.accountId).toBe('acct_123');
        expect(res.body.onboardingUrl).toBe('https://onboarding.stripe.com/xyz');
    });

    it('returns 500 when Stripe throws an error', async () => {
        mockAccountsCreate.mockRejectedValueOnce(new Error('Stripe is down'));

        const res = await request(app)
            .post('/accounts/onboard')
            .send({
                appId: 'app_1',
                email: 'org@test.com',
                refreshUrl: 'https://myapp.com/refresh',
                returnUrl: 'https://myapp.com/return',
            });

        expect(res.status).toBe(500);
        expect(res.body.error).toBe('Failed to create organizer account');
    });
});

// ─── getOrganizerAccountStatus ────────────────────────────────────────────────

describe('getOrganizerAccountStatus', () => {
    it('returns 200 with account status fields', async () => {
        mockAccountsRetrieve.mockResolvedValueOnce({
            id: 'acct_123',
            charges_enabled: true,
            details_submitted: true,
        });

        const res = await request(app).get('/accounts/acct_123/status');

        expect(res.status).toBe(200);
        expect(res.body.accountId).toBe('acct_123');
        expect(res.body.chargesEnabled).toBe(true);
        expect(res.body.detailsSubmitted).toBe(true);
    });

    it('returns 500 when Stripe throws an error', async () => {
        mockAccountsRetrieve.mockRejectedValueOnce(new Error('Not found'));

        const res = await request(app).get('/accounts/acct_bad/status');

        expect(res.status).toBe(500);
        expect(res.body.error).toBe('Failed to retrieve organizer account status');
    });
});

// ─── deleteOrganizerAccount ───────────────────────────────────────────────────

describe('deleteOrganizerAccount', () => {
    it('returns 200 on successful deletion', async () => {
        mockAccountsDel.mockResolvedValueOnce({});

        const res = await request(app).delete('/accounts/acct_123');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('returns 500 when Stripe throws an error', async () => {
        mockAccountsDel.mockRejectedValueOnce(new Error('Cannot delete'));

        const res = await request(app).delete('/accounts/acct_123');

        expect(res.status).toBe(500);
        expect(res.body.error).toBe('Failed to delete organizer account');
    });
});
