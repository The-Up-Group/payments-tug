import { Request, Response } from 'express';
import Stripe from 'stripe';
import { CreateCustomerRequest, CreateCustomereResponse, PaymentMethods } from '../types/customerTypes';

const getStripe = () => new Stripe(process.env.STRIPE_SECRET_KEY as string);

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
            res.status(200).json({ customerId: existing.data[0].id, isNew: false});
            return;
        }

        // si el usuario no existe lo creamos y devolvemos el id con el flag isNew = true
        const customer = await getStripe().customers.create({
            metadata: { externalUserId: userId, appId: appId},
        });
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
        const result = await getStripe().paymentMethods.list({
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

        res.status(201).json({ paymentMethods: paymentMethods});
        return;
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        res.status(500).json({
            error: 'Failed to retrieve customer Payment Methods',
            ...(process.env.NODE_ENV !== 'production' && { detail: message }),
        });
    }
}

export const deleteCustomerPaymentMethod = async (req: Request, res: Response): Promise<void> => {
    const pmId = req.params.pmId as string;

    if (!pmId) {
        res.status(400).json({ error: 'pmId is rquired.'});
        return;
    }
    try {
        await getStripe().paymentMethods.detach(pmId);
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