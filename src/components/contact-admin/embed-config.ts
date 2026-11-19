import "server-only";
import { embedAllowedOrigins } from "@/lib/embed-origins";

/** Public app origin used in hosted links and embed code (BETTER_AUTH_URL, no trailing slash). */
export function contactAppUrl(): string {
  return (process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/+$/, "");
}

export function contactEmbedConfig(): { appUrl: string; allowedOrigins: string[] } {
  return { appUrl: contactAppUrl(), allowedOrigins: embedAllowedOrigins() };
}
