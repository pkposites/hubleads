import "server-only";

/**
 * Secret the app's server uses to call the lh_server_* functions (push
 * targets, Meta token). Set with `select lh_private.set_server_secret(...)`
 * in the database and LH_SERVER_SECRET in the host. Without it those
 * features stay off and everything else keeps working.
 */
export function serverSecret(): string | null {
  const secret = process.env.LH_SERVER_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}
