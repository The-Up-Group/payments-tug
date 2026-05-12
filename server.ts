import express from 'express';
import dotenv from 'dotenv';
import paymentsRouter from './src/routes/payments';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use('/payments', paymentsRouter);

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
