import { Request, Response } from 'express';
import { StripeClient } from './chargeFinancials';

export interface OwnedCustomer {
    id: string;
    created: number;
    metadata: Record<string, string>;
}

export const getOwnedCustomer = async (
    stripe: StripeClient,
    customerId: string,
    userId: string | undefined,
): Promise<OwnedCustomer | null> => {
    if (!userId) return null;
    const customer = await stripe.customers.retrieve(customerId) as unknown as Partial<OwnedCustomer> & { deleted?: boolean };
    if (customer.deleted || !customer.id || customer.created === undefined) return null;
    return customer.metadata?.externalUserId === userId ? customer as OwnedCustomer : null;
};

export const requestUser = (req: Request): { id?: string; isAnonymous: boolean } => {
    const user = (req as any).user ?? {};
    return { id: user.id, isAnonymous: user.isAnonymous === true };
};

export const respondForbiddenCustomer = (res: Response): void => {
    res.status(403).json({ error: 'Customer does not belong to the authenticated user' });
};

export const respondGuestNotAllowed = (res: Response): void => {
    res.status(403).json({ error: 'Guest accounts cannot save payment methods' });
};
