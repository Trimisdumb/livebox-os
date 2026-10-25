import { useEffect, useState } from "react";
import {
  ChevronRight,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { api, type AuthState } from "./api";

export default function AuthGate({
  state,
  complete,
  retry,
}: {
  state: AuthState | null;
  complete: (state: AuthState) => void;
  retry: () => void;
}) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const setup = state?.configured === false;
  useEffect(() => {
    if (!setup || state?.setup_allowed) return;
    const timer = setInterval(retry, 5000);
    return () => clearInterval(timer);
  }, [setup, state?.setup_allowed]);
  return (
    <div className="modal-backdrop auth-backdrop">
      <section
        className="login-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
      >
        <img
          className="auth-logo"
          src="/livebox-logo.svg"
          alt="Logo Livebox OS 3.0"
        />
        <span className="eyebrow">LIVEBOX OS 3.0</span>
        <h2 id="auth-title">
          {setup ? "Votre espace, protégé." : "Bienvenue chez vous."}
        </h2>
        <p>
          {setup
            ? "Créez votre compte administrateur Livebox OS. Il est indépendant du compte de votre Livebox."
            : "Identifiez-vous pour accéder à votre espace Livebox OS."}
        </p>
        {state === null ? (
          <>
            <div className="error-message">
              Le backend ne répond pas encore. Vérifiez son démarrage et votre
              connexion au serveur.
            </div>
            <button className="secondary wide" onClick={retry}>
              <RefreshCw size={15} /> Réessayer
            </button>
          </>
        ) : setup && !state.setup_allowed ? (
          <div className="info-note">
            <ShieldCheck size={18} />
            <div><p>Autorisation de cet appareil nécessaire avant la première configuration. Un administrateur doit valider cette référence via SSH.</p><strong className="pairing-id">{state.pairing_id || 'En attente…'}</strong><p>La vérification est automatique. Le compte créé ensuite restera protégé par votre mot de passe.</p></div>
          </div>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (setup && password !== again) {
                setError("Les mots de passe ne correspondent pas.");
                return;
              }
              setBusy(true);
              setError("");
              try {
                complete(
                  await api<AuthState>(setup ? "/auth/setup" : "/auth/login", {
                    username,
                    password,
                  }),
                );
                setPassword("");
                setAgain("");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Identifiant Livebox OS
              <input
                autoFocus
                autoComplete="username"
                required
                pattern="[A-Za-z0-9_.-]+"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
            <label>
              Mot de passe Livebox OS
              <input
                type="password"
                autoComplete={setup ? "new-password" : "current-password"}
                required
                minLength={setup ? 12 : 1}
                maxLength={256}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {setup && (
              <label>
                Confirmer le mot de passe
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  value={again}
                  onChange={(e) => setAgain(e.target.value)}
                />
              </label>
            )}
            {error && (
              <div className="error-message" role="alert">
                {error}
              </div>
            )}
            <button disabled={busy} className="primary wide">
              {busy
                ? "Vérification…"
                : setup
                  ? "Créer mon espace sécurisé"
                  : "Ouvrir Livebox OS"}
              <ChevronRight size={17} />
            </button>
          </form>
        )}
        <div className="login-security">
          <LockKeyhole size={15} />
          <span>
            {setup
              ? "12 caractères minimum. Le mot de passe est stocké sous forme d’empreinte Argon2id."
              : "Votre session est protégée côté serveur. Aucun identifiant Livebox n’est enregistré dans le navigateur."}
          </span>
        </div>
      </section>
    </div>
  );
}
