/**
 * Google OAuth2 — Google Identity Services (GIS)
 * Maneja autenticación con Google para acceder a APIs (Classroom, Calendar, etc.)
 * con soporte de sesión de 7 días mediante Refresh Token silencioso.
 */

// Client ID de Google Cloud Console
const CLIENT_ID = '470733236827-6d756k50hohamsq3hhur273f13f99167.apps.googleusercontent.com';

// Scopes necesarios para Google Classroom, Google Calendar e información de perfil
const SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.students.readonly',
  'https://www.googleapis.com/auth/classroom.student-submissions.me.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ');

// Claves de almacenamiento local
const TOKEN_KEY = 'focusos_google_token';
const TOKEN_EXPIRY_KEY = 'focusos_google_token_expiry';
const REFRESH_TOKEN_KEY = 'focusos_google_refresh_token';
const SESSION_EXPIRY_KEY = 'focusos_google_session_expiry';
const USER_EMAIL_KEY = 'focusos_google_user_email';
const CONNECTED_KEY = 'focusos_google_connected';

// Duración de la sesión: 7 días exactos
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initCodeClient(config: {
            client_id: string;
            scope: string;
            ux_mode?: 'popup' | 'redirect';
            select_account?: boolean;
            hint?: string;
            callback: (response: CodeResponse) => void;
            error_callback?: (error: { type: string; message: string }) => void;
          }): CodeClient;
          initTokenClient(config: {
            client_id: string;
            scope: string;
            hint?: string;
            callback: (response: TokenResponse) => void;
            error_callback?: (error: { type: string; message: string }) => void;
          }): TokenClient;
          revoke(token: string, callback?: () => void): void;
        };
      };
    };
  }
}

interface CodeResponse {
  code?: string;
  scope?: string;
  error?: string;
}

interface CodeClient {
  requestCode(): void;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  error?: string;
}

interface TokenClient {
  requestAccessToken(config?: { prompt?: string; hint?: string }): void;
}

class GoogleAuth {
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;
  private refreshToken: string | null = null;
  private sessionExpiry: number = 0;
  private userEmail: string | null = null;
  private renewInFlight: Promise<boolean> | null = null;

  constructor() {
    this.restoreSession();
  }

  /** Restaura tokens y metadatos desde localStorage */
  private restoreSession(): void {
    const savedSessionExpiry = localStorage.getItem(SESSION_EXPIRY_KEY);
    const sessionExp = savedSessionExpiry ? parseInt(savedSessionExpiry, 10) : 0;

    // Si la sesión de 7 días ya venció, limpiar todo
    if (sessionExp > 0 && Date.now() >= sessionExp) {
      this.clearStorage();
      return;
    }

    this.sessionExpiry = sessionExp;
    this.refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    this.userEmail = localStorage.getItem(USER_EMAIL_KEY);

    const savedToken = localStorage.getItem(TOKEN_KEY);
    const savedExpiry = localStorage.getItem(TOKEN_EXPIRY_KEY);

    if (savedToken && savedExpiry) {
      const exp = parseInt(savedExpiry, 10);
      if (Date.now() < exp) {
        this.accessToken = savedToken;
        this.tokenExpiry = exp;
      }
    }
  }

  /** Verifica si la librería GIS está cargada en window */
  isReady(): boolean {
    return !!window.google?.accounts?.oauth2;
  }

  /** Verifica si hay un access_token activo y vigente en este instante */
  isAuthenticated(): boolean {
    return !!this.accessToken && Date.now() < this.tokenExpiry;
  }

  /** Verifica si la sesión de 7 días con refresh token sigue vigente */
  isSessionActive(): boolean {
    if (!this.sessionExpiry) return false;
    return Date.now() < this.sessionExpiry && !!this.refreshToken;
  }

  /** Indica si el usuario está conectado a Google (dentro de los 7 días) */
  wasConnected(): boolean {
    return localStorage.getItem(CONNECTED_KEY) === 'true' && (this.isAuthenticated() || this.isSessionActive());
  }

  /** Obtiene el access_token actual o null si expiró */
  getAccessToken(): string | null {
    return this.isAuthenticated() ? this.accessToken : null;
  }

  /** Obtiene el email de la cuenta conectada */
  getUserEmail(): string | null {
    return this.userEmail;
  }

  /** Guarda la sesión de 7 días y los tokens */
  private saveSession(
    accessToken: string,
    expiresIn: number,
    refreshToken?: string,
    email?: string,
  ): void {
    this.accessToken = accessToken;
    this.tokenExpiry = Date.now() + expiresIn * 1000;

    localStorage.setItem(TOKEN_KEY, accessToken);
    localStorage.setItem(TOKEN_EXPIRY_KEY, String(this.tokenExpiry));
    localStorage.setItem(CONNECTED_KEY, 'true');

    if (refreshToken) {
      this.refreshToken = refreshToken;
      localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    }

    // Iniciar o preservar ventana de 7 días
    if (!this.sessionExpiry || Date.now() >= this.sessionExpiry) {
      this.sessionExpiry = Date.now() + SESSION_TTL_MS;
      localStorage.setItem(SESSION_EXPIRY_KEY, String(this.sessionExpiry));
    }

    if (email) {
      this.userEmail = email;
      localStorage.setItem(USER_EMAIL_KEY, email);
    }
  }

  /** Consulta el email del usuario para pasarlo como hint en futuras conexiones */
  private async fetchUserEmail(accessToken: string): Promise<string | null> {
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        return data.email ?? null;
      }
    } catch {
      // Ignorar fallo de userinfo
    }
    return null;
  }

  /**
   * Solicita acceso al usuario vía popup OAuth2.
   * Utiliza initCodeClient (Authorization Code) para obtener un refresh token de 7 días.
   * Incluye 'hint' con el email para evitar el selector de cuentas ("Elige una cuenta").
   */
  authenticate(forceConsent = false): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.isReady()) {
        reject(new Error('Google Identity Services no está cargado'));
        return;
      }

      if (this.isAuthenticated() && !forceConsent) {
        resolve(this.accessToken!);
        return;
      }

      const hintEmail = this.userEmail || localStorage.getItem(USER_EMAIL_KEY) || undefined;

      // 1. Intentar Authorization Code Flow (permite refresh_token de 7 días)
      try {
        const codeClient = window.google!.accounts.oauth2.initCodeClient({
          client_id: CLIENT_ID,
          scope: SCOPES,
          ux_mode: 'popup',
          select_account: !hintEmail,
          hint: hintEmail,
          callback: async (response) => {
            if (response.error) {
              reject(new Error(response.error));
              return;
            }

            if (!response.code) {
              reject(new Error('No se recibió código de autorización'));
              return;
            }

            try {
              // Canjear código en /api/google-auth
              const exchangeRes = await fetch('/api/google-auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  action: 'exchange',
                  code: response.code,
                }),
              });

              const tokenData = await exchangeRes.json();

              if (!exchangeRes.ok) {
                // Si falta GOOGLE_CLIENT_SECRET, informar con claridad
                if (tokenData.error === 'GOOGLE_CLIENT_SECRET_MISSING') {
                  throw new Error(
                    'Falta configurar GOOGLE_CLIENT_SECRET en las variables de entorno para habilitar la sesión de 7 días.'
                  );
                }
                throw new Error(tokenData.error_description || tokenData.error || 'Error al canjear código de Google');
              }

              const accessToken = tokenData.access_token;
              const expiresIn = tokenData.expires_in || 3600;
              const refreshToken = tokenData.refresh_token;

              // Obtener email del usuario para futuras preselecciones (hint)
              const email = await this.fetchUserEmail(accessToken);

              this.saveSession(accessToken, expiresIn, refreshToken, email ?? undefined);
              resolve(accessToken);
            } catch (err) {
              reject(err instanceof Error ? err : new Error(String(err)));
            }
          },
          error_callback: (error) => {
            reject(new Error(error.message || 'Error en la autorización de Google'));
          },
        });

        codeClient.requestCode();
      } catch (err) {
        reject(err instanceof Error ? err : new Error('No se pudo iniciar el cliente de autorización'));
      }
    });
  }

  /**
   * Renueva el token de forma 100% silenciosa en segundo plano por HTTP.
   * CERO popups: si no hay refresh_token o ya pasaron los 7 días, retorna false
   * de forma limpia sin abrir ninguna ventana emergente en el navegador.
   */
  async tryAutoRenew(): Promise<boolean> {
    if (this.isAuthenticated()) return true;

    // Verificar si la sesión de 7 días sigue activa y tenemos refresh_token
    if (!this.isSessionActive() || !this.refreshToken) {
      if (this.sessionExpiry && Date.now() >= this.sessionExpiry) {
        console.log('[GoogleAuth] La sesión de 7 días ha finalizado. Se requerirá login.');
        this.signOut();
      }
      return false;
    }

    // Si ya hay una renovación en curso, esperar la misma promesa
    if (this.renewInFlight) {
      return this.renewInFlight;
    }

    this.renewInFlight = (async () => {
      try {
        const res = await fetch('/api/google-auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'refresh',
            refresh_token: this.refreshToken,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          // Si el refresh token fue revocado o venció en Google Cloud
          if (res.status === 400 || errData.error === 'invalid_grant') {
            console.warn('[GoogleAuth] Refresh token no válido o revocado en Google. Limpiando sesión.');
            this.signOut();
            return false;
          }
          return false;
        }

        const data = await res.json();
        if (data.access_token) {
          this.accessToken = data.access_token;
          this.tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
          localStorage.setItem(TOKEN_KEY, data.access_token);
          localStorage.setItem(TOKEN_EXPIRY_KEY, String(this.tokenExpiry));
          console.log('[GoogleAuth] ✅ Token renovado silenciosamente por HTTP (sin popup).');
          return true;
        }

        return false;
      } catch (err) {
        console.warn('[GoogleAuth] Error renovando token silenciosamente:', err);
        return false;
      } finally {
        this.renewInFlight = null;
      }
    })();

    return this.renewInFlight;
  }

  /** Limpia el almacenamiento local */
  private clearStorage(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(SESSION_EXPIRY_KEY);
    localStorage.removeItem(CONNECTED_KEY);
    // Preservar USER_EMAIL_KEY para poder usarlo como hint en la próxima autenticación
  }

  /** Cierra sesión y revoca el token */
  signOut(): void {
    if (this.accessToken) {
      try {
        window.google?.accounts?.oauth2?.revoke(this.accessToken);
      } catch {
        // Ignorar error al revocar
      }
    }
    this.accessToken = null;
    this.tokenExpiry = 0;
    this.refreshToken = null;
    this.sessionExpiry = 0;
    this.clearStorage();
  }
}

export const googleAuth = new GoogleAuth();
