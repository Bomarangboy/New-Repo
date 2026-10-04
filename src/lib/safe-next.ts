/** Only same-site relative paths ("/app/leads"); never "//evil.com", "/\\evil.com" or absolute URLs. */
export function safeNext(raw: unknown, fallback = "/app"): string {
  const s = typeof raw === "string" ? raw : "";
  return s.startsWith("/") && !s.startsWith("//") && !s.startsWith("/\\") && !/[\r\n]/.test(s) ? s : fallback;
}
