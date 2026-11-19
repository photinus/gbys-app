import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { createAppleClientSecret } from "./apple-client-secret";
import { TRUSTED_CLIENT_IP_HEADER } from "./client-ip";
import { sendMagicLinkEmail } from "./email";

const baseURL = process.env.BETTER_AUTH_URL || undefined;

// Apple is enabled only when the Services ID, team, key id and .p8 are all set.
// The client secret is a short-lived JWT minted from the key at startup (see
// apple-client-secret.ts). A bad key logs an error and disables Apple instead
// of crashing the app; nothing here runs against missing env at build time.
function buildAppleProvider() {
  const clientId = process.env.APPLE_CLIENT_ID;
  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_KEY_ID;
  const privateKeyPem = process.env.APPLE_PRIVATE_KEY;
  if (!clientId || !teamId || !keyId || !privateKeyPem) return null;
  try {
    return {
      clientId,
      clientSecret: createAppleClientSecret({ teamId, keyId, clientId, privateKeyPem }),
      ...(process.env.APPLE_APP_BUNDLE_ID ? { appBundleIdentifier: process.env.APPLE_APP_BUNDLE_ID } : {}),
    };
  } catch (err) {
    console.error("[auth] Sign in with Apple disabled:", err instanceof Error ? err.message : err);
    return null;
  }
}

const appleProvider = buildAppleProvider();
/** True only when Apple is configured AND its client secret was generated. */
export const appleEnabled = appleProvider !== null;

export const auth = betterAuth({
  baseURL,
  trustedOrigins: [
    ...(baseURL ? [baseURL] : []),
    // Apple's response_mode=form_post POSTs the callback from appleid.apple.com.
    ...(appleProvider ? ["https://appleid.apple.com"] : []),
  ],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
  user: {
    additionalFields: {
      orgRole: {
        type: "string",
        required: false,
        defaultValue: "member",
        input: false, // Prevent users from self-assigning admin roles on signup
      },
      phone: {
        type: "string",
        required: false,
      },
      smsOptIn: {
        type: "boolean",
        required: false,
        defaultValue: false,
      },
    },
  },
  // Register providers only when configured so the app boots without OAuth creds.
  socialProviders: {
    ...(process.env.GOOGLE_CLIENT_ID
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
          },
        }
      : {}),
    ...(appleProvider ? { apple: appleProvider } : {}),
  },
  // Rate limiting keys on the client IP. Behind Railway's edge, X-Real-IP is the
  // trusted connecting address (see src/lib/client-ip.ts); without this all users
  // share one rate-limit bucket.
  advanced: {
    ipAddress: { ipAddressHeaders: [TRUSTED_CLIENT_IP_HEADER] },
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["google", "apple"],
    },
  },
  databaseHooks: {
    user: {
      create: {
        // Magic-link sign-ups arrive with an empty name. Default to the email's
        // local part so rosters, review queues, grant exports and emails never
        // show a blank; users can change it on their profile.
        before: async (user) => {
          if (user.name?.trim()) return;
          const local = (user.email ?? "").split("@")[0]?.trim();
          return { data: { ...user, name: local || "Volunteer" } };
        },
      },
    },
    session: {
      create: {
        // Soft-deleted users can never start a session.
        before: async (session) => {
          const [user] = await db
            .select({ deletedAt: schema.users.deletedAt })
            .from(schema.users)
            .where(eq(schema.users.id, session.userId))
            .limit(1);
          if (user?.deletedAt) return false;
        },
      },
    },
  },
  plugins: [
    magicLink({
      expiresIn: 600,
      sendMagicLink: async ({ email, url }) => {
        if (process.env.NODE_ENV === "development") {
          console.log(`[DEV MAGIC LINK] ${email}: ${url}`);
          return;
        }
        await sendMagicLinkEmail({ to: email, url });
      },
    }),
    nextCookies(), // must be the LAST plugin
  ],
});
