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
