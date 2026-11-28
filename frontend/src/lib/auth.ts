// Sign-in via Neon Auth (managed Better Auth). The auth URL comes from the backend (/api/inv/status),
// so nothing about the project is hard-coded in the frontend.
import { createAuthClient } from "@neon/auth";

export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any = null;
let cached: { token: string; exp: number } | null = null;

export function initAuth(url: string | null) {
  client = url ? createAuthClient(url) : null;
  cached = null;
}

export const authEnabled = () => !!client;

function expOf(token: string): number {
  try {
    const p = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return (p.exp ?? 0) * 1000;
  } catch {
    return 0;
  }
}

function errText(e: unknown, fallback: string): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const x = e as any;
  return x?.error?.message || x?.message || x?.statusText || fallback;
}

export async function currentUser(): Promise<AuthUser | null> {
  if (!client) return null;
  try {
    const r = await client.getSession();
    const u = r?.data?.user;
    const t = r?.data?.session?.token ?? r?.data?.session?.access_token;
    if (t) cached = { token: t, exp: expOf(t) };
    return u ? { id: u.id, email: u.email ?? null, name: u.name ?? null } : null;
  } catch {
    return null;
  }
}

/** Short-lived JWT (15 min) for our own API; refreshed through getSession near expiry. */
export async function getToken(): Promise<string | null> {
  if (!client) return null;
  if (cached && cached.exp - Date.now() > 60_000) return cached.token;
  await currentUser();
  return cached?.token ?? null;
}

export async function signIn(email: string, password: string) {
  try {
    const r = await client.signIn.email({ email, password });
    if (r?.error) throw new Error(errText(r, "Sign-in failed"));
  } catch (e) {
    throw new Error(errText(e, "Sign-in failed"));
  }
  cached = null;
  return currentUser();
}

export async function signUp(name: string, email: string, password: string) {
  try {
    const r = await client.signUp.email({ name, email, password });
    if (r?.error) throw new Error(errText(r, "Could not create the account"));
  } catch (e) {
    throw new Error(errText(e, "Could not create the account"));
  }
  cached = null;
  return currentUser();
}

/** Google OAuth via Neon Auth: redirects to Google, then back here with a one-time session verifier. */
export async function signInWithGoogle() {
  if (!client) throw new Error("Sign-in is not configured");
  try {
    const r = await client.signIn.social({ provider: "google", callbackURL: `${window.location.origin}/` });
    if (r?.error) throw new Error(errText(r, "Google sign-in failed"));
  } catch (e) {
    throw new Error(errText(e, "Google sign-in failed"));
  }
}

/** true right after returning from Google, before the SDK has exchanged the verifier */
export const returningFromOAuth = () => new URLSearchParams(window.location.search).has("neon_auth_session_verifier");

export async function signOut() {
  cached = null;
  try {
    await client?.signOut();
  } catch {
    /* already signed out */
  }
}
