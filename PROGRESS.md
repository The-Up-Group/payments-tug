# payments-tug — Context Completo

## Qué es este proyecto
Microservicio de pagos en Node.js + TypeScript + Express + Stripe.
Sirve como backend de pagos para SPOT (y cualquier otra app).
El usuario está aprendiendo TypeScript mientras construye esto — explicar conceptos cuando sean nuevos.

## Stack
- Node.js + TypeScript
- Express 5
- Stripe SDK
- jsonwebtoken (JWT auth)
- dotenv

## Endpoints que tendrá el servicio
- `POST /payments` — crear un PaymentIntent en Stripe → devuelve `clientSecret` y `paymentIntentId`
- `GET /payments/:id` — consultar el estado de un pago por su ID

Ambos endpoints están protegidos con JWT (header `Authorization: Bearer <token>`).

---

## Estado actual de cada archivo

### package.json ✅
Scripts configurados:
```json
"scripts": {
  "dev": "ts-node server.ts",
  "build": "tsc",
  "start": "node dist/server.js"
}
```
Dependencias instaladas: `express`, `stripe`, `jsonwebtoken`, `dotenv`
DevDependencies: `typescript`, `ts-node`, `@types/express`, `@types/jsonwebtoken`, `@types/node`

### tsconfig.json ✅
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true
  },
  "include": ["src/**/*", "server.ts"]
}
```

### src/types/index.ts ✅
```ts
export interface PaymentRequest {
    amount: number;
    currency: string;
    metadata?: { [key: string]: string };
}

export interface PaymentResponse {
    clientSecret: string;
    paymentIntentId: string;
}

export interface PaymentStatusResponse {
    id: string;
    status: "succeeded" | "processing" | "requires_payment_method" | "requires_confirmation" | "canceled";
    amount: number;
    currency: string;
}
```

### src/middleware/auth.ts ✅
```ts
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
        const secret = process.env.JWT_SECRET as string;
        jwt.verify(token, secret);
        next();
    } catch (err){
        res.status(401).json({error: 'Invalid or expired token'});
    }
};
```

### src/controllers/paymentsController.ts ⏳ SIGUIENTE PASO
Aún no escrito. El usuario debe escribirlo con guía.

Dos funciones `async` que usan el Stripe SDK:

**`createPayment`** — maneja `POST /payments`:
1. Leer `amount`, `currency`, `metadata` del `req.body` tipado como `PaymentRequest`
2. Validar que `amount` y `currency` existen, y que `amount > 0` → si no, responder `400`
3. Llamar `await stripe.paymentIntents.create({ amount, currency, metadata })`
4. Responder `200` con `{ clientSecret: intent.client_secret, paymentIntentId: intent.id }`
5. `try/catch` — errores de Stripe responden `500`

**`getPaymentStatus`** — maneja `GET /payments/:id`:
1. Leer `id` de `req.params.id`
2. Llamar `await stripe.paymentIntents.retrieve(id)`
3. Responder `200` con `{ id: intent.id, status: intent.status, amount: intent.amount, currency: intent.currency }`
4. `try/catch` — si no existe responder `404`, otros errores `500`

Skeleton para darle al usuario:
```ts
import { Request, Response } from 'express';
import Stripe from 'stripe';
import { PaymentRequest } from '../types';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

export const createPayment = async (req: Request, res: Response): Promise<void> => {
  // TODO
};

export const getPaymentStatus = async (req: Request, res: Response): Promise<void> => {
  // TODO
};
```

Notas TypeScript importantes para este archivo:
- `intent.client_secret` puede ser `null` según el tipo de Stripe — usar `intent.client_secret!` o validar
- Las funciones son `async` y devuelven `Promise<void>`
- Usar `as string` para las variables de entorno

### src/routes/payments.ts ⏳ PENDIENTE
Se escribe después del controller. Conecta middleware + controllers en un router de Express:
```ts
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { createPayment, getPaymentStatus } from '../controllers/paymentsController';

const router = Router();

router.post('/', authMiddleware, createPayment);
router.get('/:id', authMiddleware, getPaymentStatus);

export default router;
```

### server.ts ⏳ PENDIENTE
Entry point de la app. Se escribe al final:
```ts
import express from 'express';
import dotenv from 'dotenv';
import paymentsRouter from './src/routes/payments';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use('/payments', paymentsRouter);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

### .env ⏳ PENDIENTE
Crear este archivo en la raíz (nunca hacer commit de este archivo):
```
PORT=3000
JWT_SECRET=cualquier_string_largo_y_secreto
STRIPE_SECRET_KEY=sk_test_...
```
La `STRIPE_SECRET_KEY` se obtiene en dashboard.stripe.com → Developers → API keys.

### .gitignore ⏳ PENDIENTE
Verificar que existe y que incluye al menos:
```
node_modules/
dist/
.env
```

---

## Orden de pasos restantes

1. **`src/controllers/paymentsController.ts`** — el usuario lo escribe con guía
2. **`src/routes/payments.ts`** — conectar middleware + controllers (código arriba)
3. **`server.ts`** — entry point (código arriba)
4. **`.env`** — variables de entorno reales
5. **`.gitignore`** — verificar que .env está ignorado
6. **Probar** con `npm run dev` y hacer requests con Postman o curl

## Cómo probar cuando esté listo
```bash
# Crear pago
curl -X POST http://localhost:3000/payments \
  -H "Authorization: Bearer <jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{"amount": 1099, "currency": "mxn"}'

# Consultar estado
curl http://localhost:3000/payments/<paymentIntentId> \
  -H "Authorization: Bearer <jwt_token>"
```

---

## Cómo retomar en otro equipo
> **ANTES DE CAMBIAR DE EQUIPO:** commit y push de todo:
> ```
> git add .
> git commit -m "WIP: types, middleware, progress"
> git push
> ```
> En el otro equipo: `git pull` y `npm install`.

1. Abre este proyecto
2. Corre `npm install`
3. Muéstrale este archivo a Claude
4. El siguiente paso es `src/controllers/paymentsController.ts`
