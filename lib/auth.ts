type AuthRuntimeEnv = {
  CLERK_SECRET_KEY?: string;
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?: string;
  NODE_ENV?: string;
  VERCEL_ENV?: string;
};

function hasEnvValue(value: string | undefined) {
  return Boolean(value?.trim());
}

export function hasRequiredClerkPublishableKey(
  env: AuthRuntimeEnv = process.env,
) {
  return hasEnvValue(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}

export function hasRequiredClerkServerKeys(env: AuthRuntimeEnv = process.env) {
  return (
    hasRequiredClerkPublishableKey(env) && hasEnvValue(env.CLERK_SECRET_KEY)
  );
}

export function isProductionRuntime(env: AuthRuntimeEnv = process.env) {
  const vercelEnv = env.VERCEL_ENV?.trim().toLowerCase();

  if (vercelEnv) {
    return vercelEnv === "production";
  }

  return env.NODE_ENV === "production";
}

export function shouldAllowMissingClerkAuthBypass(
  env: AuthRuntimeEnv = process.env,
) {
  return !isProductionRuntime(env);
}

export const hasClerkPublishableKey = hasRequiredClerkPublishableKey();

export const hasClerkServerKeys = hasRequiredClerkServerKeys();
