import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { createPayment, getPaymentStatus } from '../controllers/paymentControllers';

const router = Router();

router.post('/', authMiddleware, createPayment);
router.get('/:id', authMiddleware, getPaymentStatus);

export default router;
