const REQUIRED = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'TURNSTILE_SECRET_KEY', 'IP_HASH_SALT'];

export function readConfig(env) {
  const missing = REQUIRED.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required binding(s)/var(s): ${missing.join(', ')}`);
  }
  return {
    ...env,
    WRITES_PER_IP_HOURLY: Number(env.WRITES_PER_IP_HOURLY || 30),
    GEN_GLOBAL_DAILY: Number(env.GEN_GLOBAL_DAILY || 18),
    GEN_PER_IP_DAILY: Number(env.GEN_PER_IP_DAILY || 5),
  };
}
