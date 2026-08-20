export const STAGING_PHONE_AUTH_BRANCH: 'staging';

export type StagingPhoneAuthEnvironment = {
  readonly HUB_PHONE_AUTH_STAGING_ENABLED?: string;
  readonly VERCEL_ENV?: string;
  readonly VERCEL_GIT_COMMIT_REF?: string;
};

export function isStagingPhoneAuthBranch(
  environment: StagingPhoneAuthEnvironment,
): boolean;

export function resolveStagingPhoneAuthActivation(
  environment: StagingPhoneAuthEnvironment,
): 'disabled' | 'enabled' | 'unavailable';
