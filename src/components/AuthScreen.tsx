import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { logIn, signUp } from "../online/authApi.ts";

const MIN_PASSWORD = 6; // Supabase Auth's default minimum

type Mode = "login" | "signup";

// title: logo centred + "Press any key"; menu: logo up + Log in / Sign up
// buttons; form: logo up + the email/password form.
type Phase = "title" | "menu" | "form";

/** Log in / sign up screen (React shell), shown until there's a logged-in account. */
export function AuthScreen(): ReactElement {
  const [phase, setPhase] = useState<Phase>("title");
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const switchMode = (next: Mode): void => {
    setMode(next);
    setError(null);
    setNotice(null);
    setPassword("");
    setConfirm("");
  };

  // Any key or click on the title screen moves on to the Log in / Sign up menu.
  useEffect(() => {
    if (phase !== "title") return;
    const next = (): void => setPhase("menu");
    window.addEventListener("keydown", next);
    window.addEventListener("click", next);
    return () => {
      window.removeEventListener("keydown", next);
      window.removeEventListener("click", next);
    };
  }, [phase]);

  const openForm = (next: Mode): void => {
    switchMode(next);
    setPhase("form");
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setNotice(null);
    const trimmedEmail = email.trim();
    if (mode === "signup") {
      if (username.trim().length < 2) return setError("Pick a username of at least 2 characters.");
      if (password.length < MIN_PASSWORD) return setError(`The password needs at least ${MIN_PASSWORD} characters.`);
      if (password !== confirm) return setError("The passwords don't match.");
    }
    setBusy(true);
    try {
      if (mode === "login") {
        await logIn(trimmedEmail, password);
        // useAuth() picks up the new session and App leaves this screen.
      } else {
        const { needsConfirmation } = await signUp(trimmedEmail, password, username.trim());
        if (needsConfirmation) {
          switchMode("login");
          setNotice(`Account created! Click the link we sent to ${trimmedEmail}, then log in.`);
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`title-screen phase-${phase}`}>
      <div className="title-scene" aria-hidden="true">
        <div className="title-torch" style={{ left: "21.72%" }} />
        <div className="title-torch late" style={{ left: "78.28%" }} />
        <div className="title-fog" />
        <div className="title-fog slow" />
      </div>
      <div className="title-shade" aria-hidden="true" />
      <img className="title-logo" src="/ui/zenkake-title-logo.svg" alt="Zenkake: Strategy Card Battle" />
      <div className="title-press">Press any key to start</div>
      {phase === "menu" ? (
        <div className="title-menu">
          <button type="button" className="title-btn primary" autoFocus onClick={() => openForm("login")}>
            Log in
          </button>
          <button type="button" className="title-btn" onClick={() => openForm("signup")}>
            Sign up
          </button>
        </div>
      ) : null}
      {phase === "form" ? (
        <form className="auth-box title-form" onSubmit={(e) => void submit(e)}>
          <div className="gallery-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "login"}
              className={`gallery-tab${mode === "login" ? " selected" : ""}`}
              onClick={() => switchMode("login")}
            >
              Log in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "signup"}
              className={`gallery-tab${mode === "signup" ? " selected" : ""}`}
              onClick={() => switchMode("signup")}
            >
              Sign up
            </button>
          </div>
          <label className="auth-field">
            <span>Email</span>
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          {mode === "signup" ? (
            <label className="auth-field">
              <span>Username</span>
              <input
                type="text"
                autoComplete="nickname"
                maxLength={20}
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
          ) : null}
          <label className="auth-field">
            <span>Password</span>
            <input
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {mode === "signup" ? (
            <label className="auth-field">
              <span>Confirm password</span>
              <input
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
          ) : null}
          {error ? <p className="auth-error">{error}</p> : null}
          {notice ? <p className="auth-notice">{notice}</p> : null}
          <button type="submit" className="shell-button primary auth-submit" disabled={busy}>
            {busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
          </button>
          <button type="button" className="title-back" onClick={() => setPhase("menu")}>
            Back
          </button>
        </form>
      ) : null}
    </div>
  );
}
