import { Request } from 'express';
import { OwnedCustomer } from './customerOwnership';

const NEW_CUSTOMER_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const METADATA_VALUE_MAX_LENGTH = 500;

const clip = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, METADATA_VALUE_MAX_LENGTH) : undefined;
};

export const buildBuyerEvidence = (req: Request, guestEmail?: string): Record<string, string> => {
    const user = (req as any).user ?? {};
    const body = req.body ?? {};
    const forwardedFor = req.headers['x-forwarded-for'];

    const evidence: Record<string, string | undefined> = {
        buyerName: clip(body.buyerName),
        buyerEmail: clip(user.email) ?? clip(guestEmail),
        buyerIsAnonymous: typeof user.isAnonymous === 'boolean' ? String(user.isAnonymous) : undefined,
        buyerIp: clip(Array.isArray(forwardedFor) ? forwardedFor.join(', ') : forwardedFor) ?? clip(req.socket?.remoteAddress),
        buyerUserAgent: clip(req.headers['user-agent']),
        buyerPlatform: clip(body.platform),
        buyerAppVersion: clip(body.appVersion),
    };

    return Object.fromEntries(
        Object.entries(evidence).filter(([, value]) => value !== undefined),
    ) as Record<string, string>;
};

export const shouldRequestThreeDSecure = (customer: OwnedCustomer, isAnonymous: boolean): boolean =>
    isAnonymous || Date.now() / 1000 - customer.created < NEW_CUSTOMER_MAX_AGE_SECONDS;
