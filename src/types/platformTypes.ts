export interface PlatformBalanceResponse {
    available: number;
    pending: number;
    currency: string;
}

export interface PlatformPayout {
    id: string;
    amount: number;
    currency: string;
    arrivalDate: number;
    created: number;
    status: string;
    description: string | null;
}

export interface PlatformPayoutsResponse {
    payouts: PlatformPayout[];
}

export interface PlatformSalesSummaryResponse {
    currency: string;
    grossSales: number;
    paidToOrganizers: number;
    spotGross: number;
    stripeFees: number;
    spotNet: number;
    paymentsCount: number;
    pendingFeeCharges: number;
}

export interface CreatePlatformPayoutRequest {
    amount: number;
    currency?: string;
    requestId: string;
}
