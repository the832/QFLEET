import { motion } from "motion/react";
import { ArrowRight, Loader2, Lock, Mail, ShieldCheck, UserRound } from "lucide-react";
import { useState } from "react";
import { signInWithGoogle } from "../lib/auth";
import { useSupply } from "../supply/store";
import { LogoMark } from "./Logo";
import { QuantumField } from "./QuantumField";

/** Full-screen sign-in, shown only when the backend reports Neon Auth is configured. */
export function AuthGate() {
  const s = useSupply();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const google = async () => {
    setErr(null);
    setBusy(true);
    try {
      await signInWithGoogle(); // navigates away to Google; we come back signed in
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (mode === "up" && pw.length < 8) return setErr("Use at least 8 characters for the password.");
    setBusy(true);
    try {
      if (mode === "in") await s.signIn(email.trim(), pw);
      else await s.signUp(name.trim() || email.split("@")[0], email.trim(), pw);
      if (!useSupply.getState().user) setErr("Signed in, but no session came back. Check the Neon Auth trusted domains.");
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[58] bg-void overflow-hidden">
      <div className="absolute inset-0 grid-bg opacity-50" />
      <div className="absolute inset-0 opacity-70"><QuantumField density={0.6} /></div>
      <div className="absolute inset-0 overflow-y-auto grid place-items-center p-4 max-md:place-items-start max-md:py-6">
        <motion.form onSubmit={submit} initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.45 }}
          className="glass-strong hud rounded-2xl w-[400px] max-w-full p-7 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <LogoMark size={40} />
            <div>
              <div className="font-display font-black tracking-[0.16em] grad-text text-lg">QFLEET</div>
              <div className="text-[11px] text-dim">Supply Network · quantum-planned replenishment</div>
            </div>
          </div>
          <div>
            <h1 className="text-xl font-semibold">{mode === "in" ? "Sign in to your network" : "Create your account"}</h1>
            <p className="text-[12.5px] text-dim mt-1">{mode === "in" ? "Central store teams and branch staff use the same login." : "Free for the hackathon. You can create your own organisation after signing up."}</p>
          </div>
          <div className="flex p-1 rounded-xl border border-line bg-white/[0.02]">
            {(["in", "up"] as const).map((m) => (
              <button key={m} type="button" onClick={() => { setMode(m); setErr(null); }}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold ${mode === m ? "bg-cyan/15 text-cyan" : "text-dim"}`}>
                {m === "in" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>
          <button type="button" onClick={google} disabled={busy}
            className="w-full flex items-center justify-center gap-3 rounded-xl bg-white text-[#1f1f1f] font-semibold text-[14px] py-2.5 hover:bg-white/90 transition-colors disabled:opacity-60">
            <GoogleG /> Continue with Google
          </button>
          <div className="flex items-center gap-3 text-[11px] text-faint">
            <span className="h-px flex-1 bg-line" />or with email<span className="h-px flex-1 bg-line" />
          </div>
          {mode === "up" && (
            <Input icon={UserRound} type="text" placeholder="Your name" value={name} onChange={setName} autoComplete="name" />
          )}
          <Input icon={Mail} type="email" placeholder="Work email" value={email} onChange={setEmail} autoComplete="email" required />
          <Input icon={Lock} type="password" placeholder={mode === "up" ? "Password (8+ characters)" : "Password"} value={pw} onChange={setPw}
            autoComplete={mode === "in" ? "current-password" : "new-password"} required />
          {err && <div className="text-[12px] text-danger bg-danger/10 border border-danger/30 rounded-lg px-3 py-2" role="alert">{err}</div>}
          <button type="submit" className="btn-quantum inline-flex items-center justify-center gap-2 !py-3" disabled={busy || !email || !pw}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />}
            {mode === "in" ? "SIGN IN" : "CREATE ACCOUNT"}
          </button>
          <button type="button" onClick={() => s.continueAsGuest()} disabled={busy}
            className="w-full rounded-xl border border-line hover:border-cyan/50 text-dim hover:text-ink text-[13px] font-semibold py-2.5 transition-colors">
            Explore the demo without an account
          </button>
          <div className="flex items-center gap-2 text-[11px] text-faint justify-center text-center">
            <ShieldCheck size={13} className="text-lime shrink-0" /> Secured by Neon Auth (Better Auth) · sessions verified on our server
          </div>
        </motion.form>
      </div>
    </div>
  );
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function Input({ icon: Icon, value, onChange, ...rest }: {
  icon: typeof Mail; value: string; onChange: (v: string) => void; type: string; placeholder: string; autoComplete?: string; required?: boolean;
}) {
  return (
    <label className="relative block">
      <Icon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
      <input className="input w-full !pl-9 !py-2.5 !text-[14px]" value={value} onChange={(e) => onChange(e.target.value)} {...rest} />
    </label>
  );
}
