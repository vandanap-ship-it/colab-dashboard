"use client";

import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";
import { Loader2, Lock, User as UserIcon } from "lucide-react";
import BrandMark from "@/components/BrandMark";

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const callbackUrl = search.get("callbackUrl") ?? "/";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await signIn("credentials", {
      username,
      password,
      redirect: false,
    });
    setPending(false);
    if (res?.error) {
      setError("Invalid username or password.");
      return;
    }
    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-ivory relative overflow-hidden">
      {/* Subtle background ornament */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 0%, rgba(251, 191, 36, 0.08), transparent 35%), radial-gradient(circle at 80% 100%, rgba(28, 25, 23, 0.04), transparent 35%)",
        }}
      />

      <div className="w-full max-w-sm relative">
        <div className="flex justify-center mb-8">
          <BrandMark size="lg" />
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl p-7 space-y-5 shadow-card border border-stone-200"
        >
          <div>
            <h1 className="text-xl font-semibold text-stone-900 tracking-tight">
              Sign in
            </h1>
            <p className="text-sm text-stone-500 mt-1">
              Welcome back. Enter your credentials to continue.
            </p>
          </div>

          <div className="space-y-3">
            <Field
              icon={<UserIcon className="w-4 h-4" />}
              label="Username"
              autoComplete="username"
              type="text"
              value={username}
              onChange={setUsername}
            />
            <Field
              icon={<Lock className="w-4 h-4" />}
              label="Password"
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={setPassword}
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-stone-900 text-white py-2.5 text-sm font-medium hover:bg-stone-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {pending && <Loader2 className="w-4 h-4 animate-spin" />}
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <details className="mt-4 group">
          <summary className="text-xs text-stone-500 text-center cursor-pointer hover:text-stone-700 list-none flex items-center justify-center gap-1">
            <span className="group-open:hidden">Show demo accounts</span>
            <span className="hidden group-open:inline">Hide demo accounts</span>
          </summary>
          <div className="mt-3 rounded-lg bg-white/60 border border-stone-200 p-3 text-[11px] text-stone-600">
            <p className="text-stone-400 mb-2">All passwords: <code className="text-stone-700">password</code></p>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono">
              <li><code>admin</code> <span className="text-stone-400">— Admin</span></li>
              <li><code>planner</code> <span className="text-stone-400">— Planner</span></li>
              <li><code>product</code> <span className="text-stone-400">— Product</span></li>
              <li><code>manager</code> <span className="text-stone-400">— Manager</span></li>
              <li><code>engineer</code> <span className="text-stone-400">— Engineer</span></li>
            </ul>
          </div>
        </details>
      </div>
    </div>
  );
}

function Field({
  icon,
  label,
  type,
  value,
  onChange,
  autoComplete,
}: {
  icon: React.ReactNode;
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-stone-700">{label}</span>
      <div className="mt-1.5 relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400">
          {icon}
        </span>
        <input
          type={type}
          autoComplete={autoComplete}
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-stone-300 bg-white pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-stone-900 focus:ring-2 focus:ring-stone-900/10 placeholder:text-stone-400"
        />
      </div>
    </label>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
