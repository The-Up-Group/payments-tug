export interface OnboardOrganizerRequest {
    appId: string;
    email: string;
    refreshUrl: string;
    returnUrl: string;
}

export interface OnboardOrganizerResponse {
    accountId: string;
    onboardingUrl: string;
}

export interface OrganizerAccountStatusResponse {
    accountId: string;
    chargesEnabled: boolean;
    detailsSubmitted: boolean;
}

export interface CreateAccountLinkRequest {
    refreshUrl: string;
    returnUrl: string;
}

export interface CreateAccountLinkResponse {
    onboardingUrl: string;
}

export interface OrganizerBalanceResponse {
    available: number;
    pending: number;
    currency: string;
}

export interface OrganizerPayout {
    id: string;
    amount: number;
    currency: string;
    arrivalDate: number;
    status: string;
    description: string | null;
}

export interface OrganizerPayoutsResponse {
    payouts: OrganizerPayout[];
}

export interface OrganizerChargesResponse {
    monthlyTotal: number;
    currency: string;
    ticketsSold: number;
    spotCommission: number;
}
