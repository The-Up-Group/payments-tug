import express from 'express';
import dotenv from 'dotenv';
import paymentsRouter from './src/routes/payments';
import { handleStripeWebhook } from './src/controllers/webhookControllers';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Raw body required for Stripe webhook signature verification — must be before express.json()
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), handleStripeWebhook);

app.use(express.json());
app.use('/payments', paymentsRouter);

app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
