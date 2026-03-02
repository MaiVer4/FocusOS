import { useEffect, useState } from 'react';
import { RouterProvider } from 'react-router';
import { Lock, Mail, KeyRound } from 'lucide-react';
import { router } from '../routes';
import {
  onFirebaseAuth,
  getFirebaseUser,
  registerWithEmail,
  loginWithEmail,
  loginWithGooglePopup,
} from '../lib/firebase';

type AuthMode = 'login' | 'register';

export function AuthGate() {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(!!getFirebaseUser());
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onFirebaseAuth((user) => {
      setAuthenticated(!!user);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'register') {
        await registerWithEmail(email.trim(), password);
      } else {
        await loginWithEmail(email.trim(), password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo autenticar.');
    } finally {
      setBusy(false);
    }
  };

  const loginGoogle = async () => {
    setError(null);
    setBusy(true);
    try {
      await loginWithGooglePopup();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar con Google.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center">
        <p className="text-zinc-300">Verificando sesión…</p>
      </div>
    );
  }

  if (authenticated) {
    return <RouterProvider router={router} />;
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-5">
        <div>
          <h1 className="text-2xl font-bold">FocusOS</h1>
          <p className="text-zinc-400 text-sm">Inicia sesión para sincronizar toda tu información.</p>
        </div>

        <div className="flex gap-2 bg-zinc-800 rounded-lg p-1">
          <button
            type="button"
            onClick={() => setMode('login')}
            className={`flex-1 py-2 text-sm rounded-md ${mode === 'login' ? 'bg-zinc-700 text-white' : 'text-zinc-300'}`}
          >
            Iniciar sesión
          </button>
          <button
            type="button"
            onClick={() => setMode('register')}
            className={`flex-1 py-2 text-sm rounded-md ${mode === 'register' ? 'bg-zinc-700 text-white' : 'text-zinc-300'}`}
          >
            Registrarse
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="text-sm text-zinc-300">Correo</span>
            <div className="mt-1 flex items-center gap-2 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2">
              <Mail className="size-4 text-zinc-400" />
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                required
                className="bg-transparent outline-none w-full text-sm"
                placeholder="tu@correo.com"
              />
            </div>
          </label>

          <label className="block">
            <span className="text-sm text-zinc-300">Contraseña</span>
            <div className="mt-1 flex items-center gap-2 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2">
              <KeyRound className="size-4 text-zinc-400" />
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                required
                minLength={6}
                className="bg-transparent outline-none w-full text-sm"
                placeholder="Mínimo 6 caracteres"
              />
            </div>
          </label>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-2.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-60 text-sm font-medium"
          >
            {busy ? 'Procesando…' : mode === 'register' ? 'Crear cuenta' : 'Entrar'}
          </button>
        </form>

        <div className="relative">
          <div className="h-px bg-zinc-800" />
          <span className="absolute inset-0 -top-2 mx-auto w-fit bg-zinc-900 px-2 text-xs text-zinc-500">o</span>
        </div>

        <button
          type="button"
          onClick={loginGoogle}
          disabled={busy}
          className="w-full py-2.5 rounded-lg border border-zinc-700 hover:bg-zinc-800 disabled:opacity-60 text-sm font-medium flex items-center justify-center gap-2"
        >
          <Lock className="size-4" />
          Iniciar sesión con Google
        </button>
      </div>
    </div>
  );
}
