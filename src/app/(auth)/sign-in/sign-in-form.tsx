"use client";

import { Mail } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { signIn } from "@/lib/auth-client";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_token: "That sign-in link is invalid or has already been used. Request a new one below.",
  expired_token: "That sign-in link has expired. Request a new one below.",
  access_denied: "Sign-in was cancelled. Please try again.",
  unable_to_create_user: "We couldn't create your account. Please try again.",
  unable_to_create_session: "We couldn't start your session. Please try again.",
  "account not linked": "That email is already registered with a different sign-in method.",
};

function errorMessage(code: string | null): string | null {
  if (!code) return null;
  return ERROR_MESSAGES[code.toLowerCase()] ?? "We couldn't sign you in. Please try again.";
}

export function SignInForm({
  next,
  initialError,
  googleEnabled,
}: {
  next: string;
  initialError: string | null;
  googleEnabled: boolean;
}) {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(errorMessage(initialError));
  const [busy, setBusy] = useState<"google" | "magic" | null>(null);

  async function onGoogle() {
    setError(null);
    setBusy("google");
    try {
      const res = await signIn.social({
        provider: "google",
        callbackURL: next,
        errorCallbackURL: "/sign-in",
      });
      if (res?.error) {
        setError("Google sign-in is unavailable right now. Try email instead.");
        setBusy(null);
      }
      // On success the browser is redirected to Google; keep the busy state.
    } catch {
      setError("Google sign-in is unavailable right now. Try email instead.");
      setBusy(null);
    }
  }

  async function onMagicLink(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setError(null);
    setBusy("magic");
    try {
      const res = await signIn.magicLink({
        email: trimmed,
        callbackURL: next,
        errorCallbackURL: "/sign-in",
      });
      if (res?.error) {
        setError(res.error.message || "We couldn't send the sign-in link. Please try again.");
      } else {
        setSentTo(trimmed);
      }
    } catch {
      setError("We couldn't send the sign-in link. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  if (sentTo) {
    return (
      <div className="text-center" role="status">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-periwinkle/30 text-indigo-700">
          <Mail className="h-5 w-5" aria-hidden />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Check your email</h1>
        <p className="mt-2 text-sm text-stone-500">
          We sent a sign-in link to <span className="font-semibold text-charcoal">{sentTo}</span>. It expires in 10
          minutes.
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="mt-6"
          onClick={() => {
            setSentTo(null);
            setError(null);
          }}
        >
          Use a different email
        </Button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
      <p className="mt-1 text-sm text-stone-500">Welcome back. Choose how you&apos;d like to sign in.</p>

      {error ? (
        <div
          role="alert"
          className="mt-5 rounded-xl border border-coral/50 bg-coral/20 px-3.5 py-2.5 text-sm font-medium text-rose-900"
        >
          {error}
        </div>
      ) : null}

      {googleEnabled ? (
        <>
          <Button
            variant="secondary"
            className="mt-6 w-full"
            onClick={onGoogle}
            disabled={busy !== null}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
              <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z" />
            </svg>
            {busy === "google" ? "Redirecting..." : "Continue with Google"}
          </Button>
          <div className="my-5 flex items-center gap-3 text-xs text-stone-400">
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>
        </>
      ) : (
        <div className="h-6" />
      )}

      <form onSubmit={onMagicLink} className="space-y-4">
        <Field label="Email address" hint="We'll email you a one-time sign-in link. No password needed.">
          <Input
            type="email"
            name="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Button type="submit" className="w-full" disabled={busy !== null}>
          {busy === "magic" ? "Sending..." : "Email me a sign-in link"}
        </Button>
      </form>
    </div>
  );
}
