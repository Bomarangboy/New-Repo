import { env } from "@/lib/env";
import type { AuthProvider } from "./types";
import { localProvider } from "./local";
import { supabaseProvider } from "./supabase";

export function authProvider(): AuthProvider {
  return env().AUTH_PROVIDER === "supabase" ? supabaseProvider : localProvider;
}

export type { Identity, AuthProvider } from "./types";
