import { Request, Response } from 'express';
import Stripe from 'stripe';
import { CreateSetupIntentRequest } from '../types/setupIntentTypes';
import { getOwnedCustomer, requestUser, respondForbiddenCustomer, respondGuestNotAllowed } from '../utils/customerOwnership';

const getStripe = () => new Stripe(process.env.STRIPE_SECRET_KEY as string);

export const setupIntents = async (req: Request, res: Response): Promise<void> => {
    const { customerId, appId } = req.body as CreateSetupIntentRequest;

    if(!customerId || !appId ){
        res.status(400).json({error: "Missing customerId or appId"});
        return;
    }

    try{
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

        const setupIntent = await stripe.setupIntents.create({
            customer: customerId,
            usage: 'off_session',
            metadata: { appId: appId }, 
        });
        res.status(201).json({ clientSecret: setupIntent.client_secret });
        return;
    } catch (err)  {
        const message = err instanceof Error ? err.message : 'Unknown error';
        res.status(500).json({
            error: 'Failed to create SetupIntent',
            ...(process.env.NODE_ENV !== 'production' && { detail: message }),
        });
    }
}