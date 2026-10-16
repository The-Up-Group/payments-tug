import { Request, Response, NextFunction } from 'express';

// Va después de AuthMiddleware. Pregunta a Supabase `is_admin()` con el mismo
// JWT del usuario (no con la service role key): la función lee
// profiles.role del usuario autenticado, así que solo un admin real pasa.
// Cualquier falla (Supabase caído, token rechazado) termina en 403/500,
// nunca deja pasar.
export const AdminMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
        res.status(500).json({ error: 'Admin check is not configured' });
        return;
    }

    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
        res.status(401).json({ error: 'No token provided' });
        return;
    }

    try {
        const response = await fetch(`${supabaseUrl}/rest/v1/rpc/is_admin`, {
            method: 'POST',
            headers: {
                apikey: anonKey,
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: '{}',
        });
        const isAdmin = response.ok ? await response.json() : false;
        if (isAdmin !== true) {
            res.status(403).json({ error: 'Admin access required' });
            return;
        }
        next();
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        res.status(500).json({
            error: 'Failed to verify admin access',
            ...(process.env.NODE_ENV !== 'production' && { detail: message }),
        });
    }
};
