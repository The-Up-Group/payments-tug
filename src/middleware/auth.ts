import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
export const AuthMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
        res.status(401).json({ error: 'No token provided' }); 
        return;
    }
    try {
        const payload = jwt.verify(token,process.env.JWT_SECRET_KEY as string) as jwt.JwtPayload;
        (req as any).user = {id: payload.sub};
        next();
    } catch {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
};