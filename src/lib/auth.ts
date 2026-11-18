import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { sendMagicLinkEmail } from "./email";

const baseURL = process.env.BETTER_AUTH_URL || undefined;

export const auth = betterAuth({
  baseURL,
  trustedOrigins: baseURL ? [baseURL] : [],
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
  // Register Google only when configured so the app boots without OAuth creds.
  socialProviders: process.env.GOOGLE_CLIENT_ID
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
        },
      }
    : {},
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["google"],
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
