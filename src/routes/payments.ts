import { Router } from 'express';
import { AuthMiddleware } from '../middleware/auth';
import { AdminMiddleware } from '../middleware/admin';
import { getPlatformBalance, getPlatformPayouts, createPlatformPayout } from '../controllers/platformControllers';
import { createPayment, getPaymentStatus, createCheckoutSession, getCheckoutSessionStatus } from '../controllers/paymentControllers';
import { createOrGetCustomer, listCustomerPaymentMethods, deleteCustomerPaymentMethod, createCustomerSession } from '../controllers/customerControllers';
import { setupIntents } from '../controllers/setIntentControllers';
import { createOrganizerAccount, getOrganizerAccountStatus, deleteOrganizerAccount, createOrganizerAccountLink, getOrganizerBalance, getOrganizerPayouts, getOrganizerCharges } from '../controllers/organizerControllers';

const router = Router();

// Payments
router.post('/', AuthMiddleware, createPayment);
router.get('/:id', AuthMiddleware, getPaymentStatus);
router.post('/checkout-sessions', AuthMiddleware, createCheckoutSession);
router.get('/checkout-sessions/:sessionId', AuthMiddleware, getCheckoutSessionStatus);

// Customers
router.post('/customers', AuthMiddleware, createOrGetCustomer);
router.post('/customers/session', AuthMiddleware, createCustomerSession);
router.get('/customers/:customerId/payment-methods', AuthMiddleware, listCustomerPaymentMethods);
router.delete('/payment-methods/:pmId', AuthMiddleware, deleteCustomerPaymentMethod);

// Setup Intents
router.post('/setup-intents', AuthMiddleware, setupIntents);

// Organizer
router.post('/accounts/onboard', AuthMiddleware, createOrganizerAccount);
router.post('/accounts/:accountId/link', AuthMiddleware, createOrganizerAccountLink);
router.get('/accounts/:accountId/status', AuthMiddleware, getOrganizerAccountStatus);
router.get('/accounts/:accountId/balance', AuthMiddleware, getOrganizerBalance);
router.get('/accounts/:accountId/payouts', AuthMiddleware, getOrganizerPayouts);
router.get('/accounts/:accountId/charges', AuthMiddleware, getOrganizerCharges);
router.delete('/accounts/:accountId', AuthMiddleware, deleteOrganizerAccount);

// Platform (cuenta principal de SPOT) — solo admins
router.get('/platform/balance', AuthMiddleware, AdminMiddleware, getPlatformBalance);
router.get('/platform/payouts', AuthMiddleware, AdminMiddleware, getPlatformPayouts);
router.post('/platform/payouts', AuthMiddleware, AdminMiddleware, createPlatformPayout);

export default router;
