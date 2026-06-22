import express from 'express';
import paymentsRouter from './routes/payments';
import { handleStripeWebhook } from './controllers/webhookControllers';
import { setupDocs } from './docs/swagger';

const app = express();

app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), handleStripeWebhook);
app.use(express.json());
app.use('/payments', paymentsRouter);
app.get('/health', (_req, res) => { res.status(200).json({ status: 'ok' }); });
setupDocs(app);

export default app;
