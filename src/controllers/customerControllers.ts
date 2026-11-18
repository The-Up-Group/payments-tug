import { Request, Response } from 'express';
import Stripe from 'stripe';
import { CreateCustomerRequest, CreateCustomereResponse, PaymentMethods, CreateCustomerSessionRequest, CreateCustomerSessionResponse } from '../types/customerTypes';
import { getOwnedCustomer, requestUser, respondForbiddenCustomer, respondGuestNotAllowed } from '../utils/customerOwnership';

const getStripe = () => new Stripe(process.env.STRIPE_SECRET_KEY as string);

const ALLOW_REDISPLAY_FILTERS: Array<'always' | 'limited' | 'unspecified'> = ['always', 'limited', 'unspecified'];

export const createOrGetCustomer = async (req: Request, res: Response): Promise<void> => {
    const { appId } = req.body as CreateCustomerRequest; 
    const userId = (req as any).user.id;

    if(!appId){
        res.status(400).json({ error: 'appId is required'});
        return; 
    }
    try {
        const existing = await getStripe().customers.search({
            query: `metadata['externalUserId']: '${userId}' AND 
            metadata['appId']: '${appId}'`,
        });

        // Si el usuario ya teien customerId ligado con la app lo devolvemos con el flag isNew = flase
        if (existing.data.length > 0 ){
            const oldest = existing.data.reduce((a, b) => (b.created < a.created ? b : a));
            res.status(200).json({ customerId: oldest.id, isNew: false});
            return;
        }

        // si el usuario no existe lo creamos y devolvemos el id con el flag isNew = true
        const customer = await getStripe().customers.create(
            { metadata: { externalUserId: userId, appId: appId} },
            { idempotencyKey: `customer-${appId}-${userId}` },
        );
        res.status(201).json({ customerId: customer.id, isNew: true });
        return;
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        res.status(500).json({
            error: 'Failed to create or retrieve customer',
            ...(process.env.NODE_ENV !== 'production' && { detail: message }),
        });
    }
};

export const listCustomerPaymentMethods = async (req: Request, res: Response): Promise<void> => {
    const customerId = req.params.customerId as string;

    if (!customerId) {
        res.status(400).json({ error: 'customerId is rquired.'});
        return;
    }
    try {
        const stripe = getStripe();
        if (!(await getOwnedCustomer(stripe, customerId, requestUser(req).id))) {
            respondForbiddenCustomer(res);
            return;
        }

        const result = await stripe.paymentMethods.list({
            customer: customerId,
            type: 'card'
        })

        const paymentMethods: PaymentMethods[] = result.data.map( pm => ({
            id: pm.id,
            cardBrand: pm.card?.brand,
            last4: pm.card?.last4,
            expMonth: pm.card?.exp_month,
            expYear: pm.card?.exp_year,
        }));

        res.status(200).json({ paymentMethods: paymentMethods});
        return;
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        res.status(500).json({
            error: 'Failed to retrieve customer Payment Methods',
            ...(process.env.NODE_ENV !== 'production' && { detail: message }),
        });
    }
}

export const createCustomerSession = async (req: Request, res: Response): Promise<void> => {
    const { customerId } = req.body as CreateCustomerSessionRequest;

    if (!customerId) {
        res.status(400).json({ error: 'customerId is required' });
        return;
    }
    try {
        const user = requestUser(req);
        if (user.isAnonymous) {
            respondGuestNotAllowed(res);
            return;
        }
        const stripe = getStripe();
        if (!(await getOwnedCustomer(stripe, customerId, user.id))) {
            respondForbiddenCustomer(res);
            return;
        }

        const session = await stripe.customerSessions.create({
            customer: customerId,
            components: {
                payment_element: {
                    enabled: true,
                    features: {
                        payment_method_save: 'enabled',
                        payment_method_remove: 'enabled',
                        payment_method_redisplay: 'enabled',
                        payment_method_allow_redisplay_filters: ALLOW_REDISPLAY_FILTERS,
                    },
                },
                mobile_payment_element: {
                    enabled: true,
                    features: {
                        payment_method_save: 'enabled',
                        payment_method_remove: 'enabled',
                        payment_method_redisplay: 'enabled',
                        payment_method_allow_redisplay_filters: ALLOW_REDISPLAY_FILTERS,
                    },
                },
            },
        });
        res.status(201).json({ clientSecret: session.client_secret } as CreateCustomerSessionResponse);
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        res.status(500).json({
            error: 'Failed to create customer session',
            ...(process.env.NODE_ENV !== 'production' && { detail: message }),
        });
    }
};

export const deleteCustomerPaymentMethod = async (req: Request, res: Response): Promise<void> => {
    const pmId = req.params.pmId as string;

    if (!pmId) {
        res.status(400).json({ error: 'pmId is rquired.'});
        return;
    }
    try {
        const stripe = getStripe();
        const paymentMethod = await stripe.paymentMethods.retrieve(pmId);
        const ownerCustomerId = typeof paymentMethod.customer === 'string'
            ? paymentMethod.customer
            : paymentMethod.customer?.id;
        if (!ownerCustomerId || !(await getOwnedCustomer(stripe, ownerCustomerId, requestUser(req).id))) {
            respondForbiddenCustomer(res);
            return;
        }

        await stripe.paymentMethods.detach(pmId);
        res.status(200).json({ success: true });
        return
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        res.status(500).json({
            error: 'Failed to delete customer Payment Method',
            ...(process.env.NODE_ENV !== 'production' && { detail: message }),
        });
    }
}