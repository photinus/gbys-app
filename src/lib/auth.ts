import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { sendMagicLinkEmail } from "./email";

export const auth = betterAuth({
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
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["google"],
    },
  },
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        if (process.env.NODE_ENV === "development") {
          console.log(`[DEV MAGIC LINK] ${email}: ${url}`);
          return;
        }
        await sendMagicLinkEmail({ to: email, url });
      },
    }),
  ],
});
