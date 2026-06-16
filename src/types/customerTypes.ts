export interface CreateCustomerRequest {
    appId: string; 
}

export interface CreateCustomereResponse {
    customerId: string;
    isNew: boolean;
}

export interface PaymentMethods {
    id: string;
    cardBrand?: string;
    last4?: string;
    expMonth?: number;
    expYear?: number;
}

export interface ListPaymentMethodsResponse {
    paymentMethods: PaymentMethods[];
}

export interface CreateCustomerSessionRequest {
    customerId: string;
}

export interface CreateCustomerSessionResponse {
    clientSecret: string;
}