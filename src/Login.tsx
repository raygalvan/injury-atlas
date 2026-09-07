import React, { useState } from "react";
import { ShieldCheck, ArrowUpRight } from "lucide-react";
import { api } from "./api";
import { Field } from "./ui";
export function Login({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const [accessToken] = useState(() => {
      const t = new URLSearchParams(location.hash.slice(1)).get("token");
      if (t) history.replaceState(null, "", "/sign-in");
      return t;
    }),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="login">
      <div className="login-brand">
        injury<span>atlas</span>
      </div>
      <div className="login-layout">
        <section>
          <p className="eyebrow">A CLEARER PICTURE OF THE INJURY</p>
          <h1>
            Evidence.
            <br />
            Anatomy.
            <br />
            <em>Understanding.</em>
          </h1>
          <p>
            One private workspace for injury evidence,
            <br />
            anatomical review, and the next generation
            <br />
            of incident reconstruction.
          </p>
          <span className="badge">INVITATION-ONLY PILOT</span>
        </section>
        <form
          className="login-card"
          onSubmit={async (e) => {
            e.preventDefault();
            const email = new FormData(e.currentTarget).get("email");
            setBusy(true);
            setError("");
            try {
              if (accessToken) {
                await api("/auth/consume", { token: accessToken });
                await onSuccess();
              } else {
                const d = await api("/auth/request", { email });
                setMessage(d.message);
              }
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <ShieldCheck size={30} />
          <h2>
            {accessToken ? "Open your workspace" : "Welcome to Injury Atlas"}
          </h2>
          <p>
            {accessToken
              ? "Continue to use your one-time access link."
              : "Sign in with the email address that received your invitation."}
          </p>
          {!accessToken && (
            <Field
              name="email"
              label="Email address"
              type="email"
              placeholder="you@yourfirm.com"
            />
          )}
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          {message && (
            <p className="notice" role="status">
              {message}
            </p>
          )}
          <button className="primary wide" disabled={busy}>
            {busy
              ? "Please wait…"
              : accessToken
                ? "Continue to workspace"
                : "Email my secure link"}
            <ArrowUpRight size={17} />
          </button>
          <p className="fine">
            No password. Links expire in 15 minutes and work once. Attorneys and
            invited clients use the same secure entry.
          </p>
          {accessToken && <a href="/sign-in">Request a new link</a>}
        </form>
      </div>
    </main>
  );
}
