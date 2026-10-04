import type { AdPlatform } from "../config";
import { googleClient } from "./google";
import { metaClient } from "./meta";
import { simulatedClient } from "./simulated";
import type { AdPlatformClient } from "./types";

/** The client for a connection's recorded mode. A simulated connection can never reach the real platform. */
export function clientFor(platform: AdPlatform, mode: string, seed?: string): AdPlatformClient {
  if (mode === "live") return platform === "meta" ? metaClient : googleClient;
  return simulatedClient(platform, seed);
}
