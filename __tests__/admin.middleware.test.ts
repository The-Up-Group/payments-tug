import request from 'supertest';
import express from 'express';
import { AdminMiddleware } from '../src/middleware/admin';

const mockFetch = jest.fn();
global.fetch = mockFetch;

const app = express();
app.get('/admin-only', AdminMiddleware, (_req, res) => {
    res.status(200).json({ ok: true });
});

const send = (token?: string) => {
    const req = request(app).get('/admin-only');
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
};

beforeEach(() => {
    process.env.SUPABASE_URL = 'https://proj.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon-key';
});

describe('AdminMiddleware', () => {
    it('lets an admin through, asking is_admin() with the user token', async () => {
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => true });

        const res = await send('user-jwt');

        expect(res.status).toBe(200);
        const [url, init] = mockFetch.mock.calls[0];
        expect(url).toBe('https://proj.supabase.co/rest/v1/rpc/is_admin');
        expect(init.headers.Authorization).toBe('Bearer user-jwt');
        expect(init.headers.apikey).toBe('anon-key');
    });

    it('returns 403 when is_admin() is false', async () => {
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => false });

        const res = await send('user-jwt');

        expect(res.status).toBe(403);
        expect(res.body.error).toBe('Admin access required');
    });

    it('returns 403 when Supabase rejects the token', async () => {
        mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

        const res = await send('bad-jwt');

        expect(res.status).toBe(403);
    });

    it('returns 401 without a token', async () => {
        const res = await send();

        expect(res.status).toBe(401);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns 500 when SUPABASE_ANON_KEY is missing', async () => {
        delete process.env.SUPABASE_ANON_KEY;

        const res = await send('user-jwt');

        expect(res.status).toBe(500);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns 500 when Supabase is unreachable', async () => {
        mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

        const res = await send('user-jwt');

        expect(res.status).toBe(500);
    });
});
