"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { MessageSquare, Loader2 } from "lucide-react";

export default function SignupPage() {
  const router = useRouter();
  const supabase = createClient();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username },
      },
    });

    if (error) {
      setLoading(false);
      setError(error.message);
      return;
    }

    // With email confirmation turned off in Supabase, signUp() returns an
    // active session right away — log straight in.
    if (data.session) {
      router.push("/chat");
      router.refresh();
      return;
    }

    // Fallback: session is missing, which means "Confirm email" is still
    // enabled in the Supabase dashboard. Try signing in directly in case
    // the project allows unconfirmed sign-in, otherwise surface a clear message.
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (signInError) {
      setError(
        "Account created, but email confirmation is still required. Turn off \"Confirm email\" in your Supabase project's Authentication settings, then log in."
      );
      return;
    }

    router.push("/chat");
    router.refresh();
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-accent to-accent2 flex items-center justify-center mb-4 shadow-lg shadow-accent/20">
            <MessageSquare className="text-white" size={26} />
          </div>
          <h1 className="text-2xl font-bold text-text">Create an account</h1>
          <p className="text-muted text-sm mt-1">Join and start chatting</p>
        </div>

        <form
          onSubmit={handleSignup}
          className="glass rounded-2xl p-7 flex flex-col gap-4"
        >
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted uppercase tracking-wide">
              Username
            </label>
            <input
              type="text"
              required
              minLength={3}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="janedoe"
              className="bg-panel2 border border-border rounded-lg px-3.5 py-2.5 text-sm text-text outline-none focus:border-accent transition-colors"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted uppercase tracking-wide">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="bg-panel2 border border-border rounded-lg px-3.5 py-2.5 text-sm text-text outline-none focus:border-accent transition-colors"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted uppercase tracking-wide">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              className="bg-panel2 border border-border rounded-lg px-3.5 py-2.5 text-sm text-text outline-none focus:border-accent transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-2 bg-gradient-to-r from-accent to-accent2 text-white font-semibold rounded-lg py-2.5 text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-60"
          >
            {loading && <Loader2 className="animate-spin" size={16} />}
            Sign Up
          </button>
        </form>

        <p className="text-center text-muted text-sm mt-6">
          Already have an account?{" "}
          <Link href="/login" className="text-accent2 font-medium hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}
