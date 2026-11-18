import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { createRemoteJWKSet, jwtVerify } from 'jose';

// JWKS solo aplica a JWTs asimétricos (ES256/RS256) — los HS256 (secreto
// compartido) siguen verificándose con JWT_SECRET_KEY como siempre, sin
// tocar ese camino. Esto es necesario porque un secreto HS256 nunca se
// publica en un JWKS (por definición no es una clave pública), así que
// un proyecto de Supabase cuya "current signing key" sea HS256 requiere
// el secreto compartido de todas formas.
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
const getJwks = () => {
    if (!jwks) {
        const supabaseUrl = process.env.SUPABASE_URL as string;
        jwks = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));
    }
    return jwks;
};

const readAlg = (token: string): string | undefined => {
    const headerB64 = token.split('.')[0];
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    return header.alg;
};

export const AuthMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
        res.status(401).json({ error: 'No token provided' });
        return;
    }
    try {
        const alg = readAlg(token);
        let payload: Record<string, unknown>;
        if (alg === 'HS256') {
            payload = jwt.verify(token, process.env.JWT_SECRET_KEY as string) as jwt.JwtPayload;
        } else {
            payload = (await jwtVerify(token, getJwks())).payload;
        }
        (req as any).user = {
            id: payload.sub as string | undefined,
            isAnonymous: payload.is_anonymous === true,
            email: typeof payload.email === 'string' && payload.email ? payload.email : undefined,
        };
        next();
    } catch {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
};