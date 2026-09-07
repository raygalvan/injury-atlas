import React, { useEffect, useState } from "react";
import { api } from "./api";

// Adapted from law-bot's firm/client entry pages. Server membership controls access.
export function Login({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const client = location.pathname.startsWith("/client");
  const entry = client ? "/client/sign-in" : "/sign-in";
  const [accessToken] = useState(() => {
    const token = new URLSearchParams(location.hash.slice(1)).get("token");
    if (token) history.replaceState(null, "", entry);
    return token;
  });
  const [email, setEmail] = useState("");
  const [remember, setRemember] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api("/auth/preferences")
      .then((data) => {
        if (!data.email) return;
        setEmail((current) => current || data.email);
        setRemember(true);
      })
      .catch(() => {});
  }, []);
  return (
    <main className={`portal-entry ${client ? "client-entry" : "firm-entry"}`}>
      <a className="entry-brand" href="/sign-in">
        injury<span>.bot</span>
      </a>
      <section className="entry-card">
        <div className="entry-intro">
          <p className="eyebrow">
            {client ? "Client access" : "Law-firm access"}
          </p>
          <h1>
            {client
              ? "Your evidence has a place to go."
              : "Your injury command center."}
          </h1>
          <p>
            {client
              ? "Share injury photos, medical records, and case documents with your legal team in one private place."
              : "Examine the human atlas, organize case evidence, and review documented injuries. Keep every decision under lawyer control."}
          </p>
        </div>
        <div className="entry-form-panel">
          {error && (
            <p className="entry-error" role="alert">
              {error}
            </p>
          )}
          {sent ? (
            <div className="entry-form" role="status">
              <h2>Check your email</h2>
              <p>
                If this address belongs to an invited{" "}
                {client ? "client" : "firm member"}, a secure link is on its
                way. It expires in 15 minutes.
              </p>
              <p className="entry-fine">
                Check your spam folder too. Use the same address your
                administrator registered.
              </p>
              <button
                onClick={() => {
                  setSent(false);
                  setError("");
                }}
              >
                Request another link
              </button>
            </div>
          ) : (
            <form
              className="entry-form"
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                setError("");
                try {
                  if (accessToken) {
                    await api("/auth/consume", { token: accessToken });
                    await onSuccess();
                  } else {
                    await api("/auth/request", {
                      email,
                      portal: client ? "client" : "firm",
                      remember,
                    });
                    setSent(true);
                  }
                } catch (error) {
                  setError((error as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <h2>
                {accessToken
                  ? "Continue securely"
                  : client
                    ? "Client sign in"
                    : "Firm member sign in"}
              </h2>
              {accessToken ? (
                <p>Your one-time link will be verified when you continue.</p>
              ) : (
                <label>
                  Email address
                  <input
                    autoComplete="email"
                    autoFocus
                    inputMode="email"
                    maxLength={254}
                    name="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={
                      client ? "you@example.com" : "you@yourfirm.com"
                    }
                    required
                    type="email"
                  />
                </label>
              )}
              {!accessToken && (
                <label className="entry-remember">
                  <input
                    checked={remember}
                    name="remember"
                    onChange={(e) => setRemember(e.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    Remember my email on this device
                    <small>
                      Prefills this form next time. It never signs you in.
                    </small>
                  </span>
                </label>
              )}
              <button className="primary wide" type="submit" disabled={busy}>
                {busy
                  ? "Please wait…"
                  : accessToken
                    ? client
                      ? "Enter the client portal"
                      : "Continue to the command center"
                    : "Email my secure link"}
              </button>
              <p className="entry-fine">
                No password required. Only invited members receive access. Links
                expire in 15 minutes and work once.
              </p>
              {accessToken && <a href={entry}>Request a new link</a>}
            </form>
          )}
        </div>
      </section>
      <p className="entry-switch">
        {client ? "Work at a law firm? " : "Looking for client access? "}
        <a href={client ? "/sign-in" : "/client/sign-in"}>
          {client ? "Use the law-firm portal" : "Open the client portal"}
        </a>
      </p>
    </main>
  );
}
