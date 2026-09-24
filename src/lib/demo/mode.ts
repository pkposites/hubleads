/**
 * Demo mode serves the app from built-in sample data: no database, no login.
 * Each visitor's changes live in a cookie. Enable with LEADHUB_DEMO=1.
 */
export function isDemoMode() {
  return process.env.LEADHUB_DEMO === "1";
}
