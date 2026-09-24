import "server-only";
import { cookies } from "next/headers";
import type { OpStore } from "./client";
import { DEMO_COOKIE, decodeOps, encodeOps } from "./state";

/** Keeps the visitor's demo changes in an HTTP-only cookie. */
export const cookieOpStore: OpStore = {
  async load() {
    return decodeOps((await cookies()).get(DEMO_COOKIE)?.value);
  },
  async save(ops) {
    const store = await cookies();
    try {
      store.set(DEMO_COOKIE, encodeOps(ops), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
    } catch {
      // Read-only during Server Component rendering; writes only happen in
      // Server Actions, where this succeeds.
    }
  },
};

export async function resetDemoState() {
  (await cookies()).delete(DEMO_COOKIE);
}
