"use server";

import { revalidatePath } from "next/cache";
import { isDemoMode } from "@/lib/demo/mode";
import { resetDemoState } from "@/lib/demo/store";

/** Discards the visitor's demo changes and restores the sample data. */
export async function resetDemo() {
  if (!isDemoMode()) return;
  await resetDemoState();
  revalidatePath("/", "layout");
}
