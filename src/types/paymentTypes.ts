export interface PaymentRequest {
    amount: number;
    currency: string;
    customerId: string;
    destinationAccountId: string;
    applicationFeeAmount: number;
    appId: string;
    eventId: string;
    userId: string;
    ticketTypeId: string;
    quantity: number;
    paymentMethodId?: string;
    /** Solo presente en compras de guest checkout — viaja en el metadata del
     * PaymentIntent para que el webhook pueda escribirlo en `event_bookings.guest_email`. */
    guestEmail?: string;
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

export interface CheckoutSessionRequest {
    amount: number;
    currency: string;
    customerId: string;
    destinationAccountId: string;
    applicationFeeAmount: number;
    appId: string;
    eventId: string;
    userId: string;
    ticketTypeId: string;
    quantity: number;
    returnUrl: string;
    /** Ver `PaymentRequest.guestEmail`. */
    guestEmail?: string;
}

export interface CheckoutSessionResponse {
    clientSecret: string | null;
    sessionId: string;
    paymentIntentId: string | null;
    platformFee: number;
}
