import { Request, Response } from 'express';
import Stripe from 'stripe';
import { OnboardOrganizerRequest, OnboardOrganizerResponse, OrganizerAccountStatusResponse, CreateAccountLinkRequest, CreateAccountLinkResponse } from '../types/organizerTypes';

const getStripe = () => new Stripe(process.env.STRIPE_SECRET_KEY as string);

export const createOrganizerAccount = async (req: Request, res: Response): Promise<void> => {
    const { appId, email, refreshUrl, returnUrl } = req.body as OnboardOrganizerRequest;

    if( !appId || !email ||  !refreshUrl || !returnUrl){
        res.status(400).json({ error: 'Missing required fields'}); 
        return;
    }

    try{
        const account: any = await getStripe().accounts.create({
            controller: {
                fees: {
                    payer: 'application',
                },
                losses: {
                    payments: 'application',
                },
                stripe_dashboard: {
                    type: 'express',
                },
            },
            email: email,
            metadata: { appId: appId},
        })
        const accountLink: any = await getStripe().accountLinks.create({
            account: account.id,
            refresh_url: refreshUrl,
            return_url: returnUrl,
            type: 'account_onboarding',
        })

        const response: OnboardOrganizerResponse = {
            accountId: account.id,
            onboardingUrl: accountLink.url,
        };
        res.status(201).json(response);
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown Error'; 
        res.status(500).json({ 
            error: 'Failed to create organizer account',
        ...(process.env.NODE_ENV !== 'production' && {detail: message})
        })
    }
}

export const getOrganizerAccountStatus = async (req: Request, res: Response): Promise<void> => {
    const accountId = req.params.accountId as string;

    try {
        const account: any = await getStripe().accounts.retrieve(accountId);

        const response: OrganizerAccountStatusResponse = {
            accountId: account.id,
            chargesEnabled: account.charges_enabled,
            detailsSubmitted: account.details_submitted,
        };
        res.status(200).json(response);
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown Error';
        res.status(500).json({
            error: 'Failed to retrieve organizer account status',
        ...(process.env.NODE_ENV !== 'production' && {detail: message})
        })
    }
}

export const createOrganizerAccountLink = async (req: Request, res: Response): Promise<void> => {
    const accountId = req.params.accountId as string;
    const { refreshUrl, returnUrl } = req.body as CreateAccountLinkRequest;

    if (!accountId || !refreshUrl || !returnUrl) {
        res.status(400).json({ error: 'Missing required fields' });
        return;
    }

    try {
        const accountLink: any = await getStripe().accountLinks.create({
            account: accountId,
            refresh_url: refreshUrl,
            return_url: returnUrl,
            type: 'account_onboarding',
        });
        const response: CreateAccountLinkResponse = { onboardingUrl: accountLink.url };
        res.status(200).json(response);
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown Error';
        res.status(500).json({
            error: 'Failed to create account link',
            ...(process.env.NODE_ENV !== 'production' && { detail: message }),
        });
    }
};

export const deleteOrganizerAccount = async (req: Request, res: Response): Promise<void> => {
    const accountId = req.params.accountId as string;

    if (!accountId) {
        res.status(400).json({ error: 'accountId is required' });
        return;
    }

    try {
        await getStripe().accounts.del(accountId);
        res.status(200).json({ success: true });
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        res.status(500).json({
            error: 'Failed to delete organizer account',
            ...(process.env.NODE_ENV !== 'production' && { detail: message }),
        });
    }
};

