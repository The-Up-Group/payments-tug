import { Router } from 'express';
import { AuthMiddleware } from '../middleware/auth';
import { createPayment, getPaymentStatus } from '../controllers/paymentControllers';
import { createOrGetCustomer, listCustomerPaymentMethods, deleteCustomerPaymentMethod, createCustomerSession } from '../controllers/customerControllers';
import { setupIntents } from '../controllers/setIntentControllers';
import { createOrganizerAccount, getOrganizerAccountStatus, deleteOrganizerAccount } from '../controllers/organizerControllers';

const router = Router();

// Payments
router.post('/', AuthMiddleware, createPayment);
router.get('/:id', AuthMiddleware, getPaymentStatus);

// Customers
router.post('/customers', AuthMiddleware, createOrGetCustomer);
router.post('/customers/session', AuthMiddleware, createCustomerSession);
router.get('/customers/:customerId/payment-methods', AuthMiddleware, listCustomerPaymentMethods);
router.delete('/payment-methods/:pmId', AuthMiddleware, deleteCustomerPaymentMethod);

// Setup Intents
router.post('/setup-intents', AuthMiddleware, setupIntents);

// Organizer
router.post('/accounts/onboard', AuthMiddleware, createOrganizerAccount);
router.get('/accounts/:accountId/status', AuthMiddleware, getOrganizerAccountStatus);
router.delete('/accounts/:accountId', AuthMiddleware, deleteOrganizerAccount);

export default router;
