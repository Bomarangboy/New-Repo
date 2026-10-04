/** Loads .env.local for command-line scripts (Next.js does this itself for the web app). */
import { existsSync } from "node:fs";

if (existsSync(".env.local")) {
  try {
    // Never overrides variables already set in the shell.
    process.loadEnvFile(".env.local");
  } catch {
    /* ignore malformed lines; env() validation reports anything missing */
  }
}
