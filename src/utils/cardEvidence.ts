import { StripeClient } from './chargeFinancials';

export interface CardEvidence {
    cardholderName?: string;
    cardBrand?: string;
    cardLast4?: string;
    cardFingerprint?: string;
    threeDSecureResult?: string;
    riskLevel?: string;
}

export const getCardEvidence = async (
    stripe: StripeClient,
    chargeId: string | null | undefined,
): Promise<CardEvidence | undefined> => {
    if (!chargeId) return undefined;
    try {
        const charge = await stripe.charges.retrieve(chargeId);
        const card = charge.payment_method_details?.card;
        const evidence: CardEvidence = {
            cardholderName: charge.billing_details?.name ?? undefined,
            cardBrand: card?.brand ?? undefined,
            cardLast4: card?.last4 ?? undefined,
            cardFingerprint: card?.fingerprint ?? undefined,
            threeDSecureResult: card?.three_d_secure?.result ?? undefined,
            riskLevel: charge.outcome?.risk_level ?? undefined,
        };
        const present = Object.entries(evidence).filter(([, value]) => value !== undefined);
        return present.length ? Object.fromEntries(present) as CardEvidence : undefined;
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error(`cardEvidence: no se pudo leer el cargo ${chargeId}: ${message}`);
        return undefined;
    }
};
