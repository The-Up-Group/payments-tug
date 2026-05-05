export interface PaymentRequest {
    amount: number;
    currency: string;
    metadata?: { [key: string]: string}; 
}

export interface PaymentResponse {
    clientSecret: string;
    paymentIntentId: string;
}

export interface PaymentStatusResponse {
    id: string;
    status: "succeeded" | "processing" | "requires_payment_method" | "requires_confirmation" | "canceled";
    amount: number;
    currency: string; 
}