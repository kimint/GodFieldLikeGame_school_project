import { useState, type FormEvent, type ReactElement } from "react";
import { changePassword, type Account } from "../online/authApi.ts";

const MIN_PASSWORD = 6; // Supabase Auth's default minimum (same as AuthScreen)

export interface AccountSettingsProps {
  account: Account;
  onBack: () => void;
}

/** Account settings screen (React shell): player icon, name and a change-password form. */
export function AccountSettings({ account, onBack }: AccountSettingsProps): ReactElement {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setNotice(null);
    if (!current) return setError("Enter your current password.");
    if (next.length < MIN_PASSWORD) return setError(`The new password needs at least ${MIN_PASSWORD} characters.`);
    if (next !== confirm) return setError("The new passwords don't match.");
    if (next === current) return setError("The new password must be different from the current one.");
    setBusy(true);
    try {
      await changePassword(account.email, current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setNotice("Password changed.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="shell-screen">
      <div className="shell-topbar">
        <span className="shell-title">Account settings</span>
        <button type="button" className="shell-button" onClick={onBack}>
          Back to menu
        </button>
      </div>

      <div className="account-profile">
        <div className="account-avatar" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="8.5" r="4.5" />
            <path d="M3.5 22c0-4.7 3.8-8 8.5-8s8.5 3.3 8.5 8z" />
          </svg>
        </div>
        <div className="account-profile-name">{account.username}</div>
        <div className="account-profile-email">{account.email}</div>
      </div>

      <form className="auth-box account-password" onSubmit={(e) => void submit(e)}>
        <h2 className="account-section-title">Change password</h2>
        <label className="auth-field">
          <span>Current password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <label className="auth-field">
          <span>New password</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </label>
        <label className="auth-field">
          <span>Confirm new password</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        {error ? <p className="auth-error">{error}</p> : null}
        {notice ? <p className="auth-notice">{notice}</p> : null}
        <button type="submit" className="shell-button primary auth-submit" disabled={busy}>
          {busy ? "Please wait…" : "Change password"}
        </button>
      </form>
    </div>
  );
}
