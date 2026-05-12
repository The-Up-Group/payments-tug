import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export const authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
        res.status(401).json({error: 'No token provided'});
        return;
    }
    const token = authHeader.split(' ')[1];
    if (!token){
        res.status(401).json({error: 'No token provided'});
        return;
    }
    try {
        const secret = process.env.JWT_SECRET_KEY as string;
        jwt.verify(token, secret);
        next();
    } catch (err){
        res.status(401).json({error: 'Invalid or expired token'});
    }
};