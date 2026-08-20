export const STAGING_PHONE_AUTH_BRANCH = 'staging';

export function isStagingPhoneAuthBranch(environment) {
  return (
    environment.VERCEL_ENV === 'preview'
    && environment.VERCEL_GIT_COMMIT_REF === STAGING_PHONE_AUTH_BRANCH
  );
}

export function resolveStagingPhoneAuthActivation(environment) {
  const flag = environment.HUB_PHONE_AUTH_STAGING_ENABLED;
  if (flag === undefined || flag === 'false') return 'disabled';
  if (flag !== 'true') return 'unavailable';
  return isStagingPhoneAuthBranch(environment) ? 'enabled' : 'unavailable';
}
