export interface PaymentRequest {
    amount: number;
    currency: string;
    customerId: string;
    destinationAccountId: string;
    applicationFeeAmount: number;
    appId: string;
    eventId: string;
    paymentMethodId?: string;
}

export interface PaymentResponse {
    clientSecret: string | null;
    paymentIntentId: string;
    platformFee: number;
}

export interface PaymentStatusResponse {
    id: string;
    status: "succeeded" | "processing" | "requires_payment_method" | "requires_confirmation" | "canceled";
    amount: number;
    currency: string; 
}
