export interface CreateSetupIntentRequest {
    customerId: string;
    appId: string;
}

export interface CreateSetupIntentResponse {
    clientSecret: string;
}
