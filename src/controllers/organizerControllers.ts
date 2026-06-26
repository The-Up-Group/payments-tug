import { Request, Response } from 'express';
import Stripe from 'stripe';
import { OnboardOrganizerRequest, OnboardOrganizerResponse, OrganizerAccountStatusResponse, CreateAccountLinkRequest, CreateAccountLinkResponse, OrganizerBalanceResponse, OrganizerPayoutsResponse, OrganizerChargesResponse } from '../types/organizerTypes';

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

export const getOrganizerBalance = async (req: Request, res: Response): Promise<void> => {
    const accountId = req.params.accountId as string;

    try {
        const balance = await getStripe().balance.retrieve({}, { stripeAccount: accountId });

        const available = balance.available[0];
        const response: OrganizerBalanceResponse = {
            available: available?.amount ?? 0,
            currency: available?.currency ?? 'mxn',
        };
        res.status(200).json(response);
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        res.status(500).json({
            error: 'Failed to retrieve organizer balance',
            ...(process.env.NODE_ENV !== 'production' && { detail: message }),
        });
    }
};

export const getOrganizerCharges = async (req: Request, res: Response): Promise<void> => {
    const accountId = req.params.accountId as string;

    try {
        const list = await getStripe().charges.list(
            { limit: 100 },
            { stripeAccount: accountId },
        );

        const now = new Date();
        const monthStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);

        const monthlyCharges = list.data.filter(
            (c) => c.paid && !c.refunded && c.created >= monthStart,
        );

        const monthlyTotal = monthlyCharges.reduce((sum, c) => sum + c.amount, 0);
        const ticketsSold = monthlyCharges.length;
        const spotCommission = Math.round(monthlyTotal * 0.1);

        const currency = monthlyCharges[0]?.currency ?? list.data[0]?.currency ?? 'mxn';

        const response: OrganizerChargesResponse = {
            monthlyTotal,
            currency,
            ticketsSold,
            spotCommission,
        };
        res.status(200).json(response);
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        res.status(500).json({
            error: 'Failed to retrieve organizer charges',
            ...(process.env.NODE_ENV !== 'production' && { detail: message }),
        });
    }
};

export const getOrganizerPayouts = async (req: Request, res: Response): Promise<void> => {
    const accountId = req.params.accountId as string;

    try {
        const list = await getStripe().payouts.list(
            { limit: 10 },
            { stripeAccount: accountId },
        );

        const response: OrganizerPayoutsResponse = {
            payouts: list.data.map((p) => ({
                id: p.id,
                amount: p.amount,
                currency: p.currency,
                arrivalDate: p.arrival_date,
                status: p.status,
                description: p.description,
            })),
        };
        res.status(200).json(response);
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        res.status(500).json({
            error: 'Failed to retrieve organizer payouts',
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

