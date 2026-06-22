import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { AuthMiddleware } from '../src/middleware/auth';

const TEST_SECRET = 'test-secret';

// A minimal Express app that uses the middleware on a single route.
// We don't import the real app — we only want to test the middleware in isolation.
const app = express();
app.get('/test', AuthMiddleware, (_req, res) => {
    res.status(200).json({ success: true });
});

beforeAll(() => {
    process.env.JWT_SECRET_KEY = TEST_SECRET;
});

describe('AuthMiddleware', () => {
    it('returns 401 when no Authorization header is sent', async () => {
        const res = await request(app).get('/test');

        expect(res.status).toBe(401);
        expect(res.body.error).toBe('No token provided');
    });

    it('returns 401 when the token is invalid', async () => {
        const res = await request(app)
            .get('/test')
            .set('Authorization', 'Bearer this.is.not.valid');

        expect(res.status).toBe(401);
        expect(res.body.error).toBe('Invalid or expired token');
    });

    it('returns 401 when the token is signed with the wrong secret', async () => {
        const token = jwt.sign({ sub: 'user-123' }, 'wrong-secret');
        const res = await request(app)
            .get('/test')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(401);
        expect(res.body.error).toBe('Invalid or expired token');
    });

    it('passes through and reaches the route with a valid token', async () => {
        const token = jwt.sign({ sub: 'user-123' }, TEST_SECRET);
        const res = await request(app)
            .get('/test')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});
