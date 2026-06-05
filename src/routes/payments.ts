import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { createPayment, getPaymentStatus } from '../controllers/paymentControllers';
import { createOrGetCustomer, listCustomerPaymentMethods, deleteCustomerPaymentMethod } from '../controllers/customerControllers';
import { setupIntents } from '../controllers/setupIntentControllers';

const router = Router();

// Payments
router.post('/', authMiddleware, createPayment);
router.get('/:id', authMiddleware, getPaymentStatus);

// Customers
router.post('/customers', authMiddleware, createOrGetCustomer);
router.get('/customers/:customerId/payment-methods', authMiddleware, listCustomerPaymentMethods);
router.delete('/payment-methods/:pmId', authMiddleware, deleteCustomerPaymentMethod);

// Setup Intents
router.post('/setup-intents', authMiddleware, setupIntents);

export default router;
