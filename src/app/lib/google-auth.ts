/**
 * Google OAuth2 — Google Identity Services (GIS)
 * Maneja autenticación con Google para acceder a APIs (Classroom, Calendar, etc.)
 */

// Client ID de Google Cloud Console
const CLIENT_ID = '470733236827-6d756k50hohamsq3hhur273f13f99167.apps.googleusercontent.com';

// Scopes necesarios (solo los que están disponibles en la consola)
const SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.student-submissions.me.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
].join(' ');

const TOKEN_KEY = 'focusos_google_token';
const TOKEN_EXPIRY_KEY = 'focusos_google_token_expiry';
const CONNECTED_KEY = 'focusos_google_connected';

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            callback: (response: TokenResponse) => void;
            error_callback?: (error: { type: string; message: string }) => void;
          }): TokenClient;
          revoke(token: string, callback?: () => void): void;
        };
      };
    };
  }
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  error?: string;
}

interface TokenClient {
  requestAccessToken(config?: { prompt?: string }): void;
}

class GoogleAuth {
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;
  private tokenClient: TokenClient | null = null;

  constructor() {
    // Restaurar token de localStorage
    const savedToken = localStorage.getItem(TOKEN_KEY);
    const savedExpiry = localStorage.getItem(TOKEN_EXPIRY_KEY);
    if (savedToken && savedExpiry) {
      const expiry = parseInt(savedExpiry, 10);
      if (Date.now() < expiry) {
        this.accessToken = savedToken;
        this.tokenExpiry = expiry;
      } else {
        // Token expirado, limpiar pero mantener flag de "conectado"
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(TOKEN_EXPIRY_KEY);
      }
    }
  }

  /** Verifica si la librería GIS está cargada */
  isReady(): boolean {
    return !!window.google?.accounts?.oauth2;
  }

  /** Verifica si hay un token de acceso válido */
  isAuthenticated(): boolean {
    return !!this.accessToken && Date.now() < this.tokenExpiry;
  }

  /** Verifica si el usuario se conectó alguna vez (aunque el token haya expirado) */
  wasConnected(): boolean {
    return localStorage.getItem(CONNECTED_KEY) === 'true';
  }

  /** Obtiene el token actual */
  getAccessToken(): string | null {
    return this.isAuthenticated() ? this.accessToken : null;
  }

  /** Guarda el token en memoria y localStorage */
  private saveToken(token: string, expiresIn: number): void {
    this.accessToken = token;
    this.tokenExpiry = Date.now() + expiresIn * 1000;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(TOKEN_EXPIRY_KEY, String(this.tokenExpiry));
    localStorage.setItem(CONNECTED_KEY, 'true');
  }

  /** Solicita acceso al usuario vía popup OAuth2 */
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

      this.tokenClient = window.google!.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (response) => {
          if (response.error) {
            reject(new Error(response.error));
            return;
          }
          this.saveToken(response.access_token, response.expires_in);
          resolve(response.access_token);
        },
        error_callback: (error) => {
          reject(new Error(error.message || 'Error en la autenticación'));
        },
      });

      this.tokenClient.requestAccessToken({
        prompt: forceConsent ? 'consent' : '',
      });
    });
  }

  /**
   * Intenta renovar el token de forma silenciosa (sin popup).
   * Solo funciona si el usuario ya dio consentimiento antes.
   * Devuelve true si se renovó exitosamente.
   */
  async tryAutoRenew(): Promise<boolean> {
    if (this.isAuthenticated()) return true;
    if (!this.wasConnected() || !this.isReady()) return false;

    try {
      await this.authenticate(false); // prompt: '' = sin popup si ya hay consent
      return this.isAuthenticated();
    } catch {
      return false;
    }
  }

  /** Cierra sesión y revoca el token */
  signOut(): void {
    if (this.accessToken) {
      window.google?.accounts.oauth2.revoke(this.accessToken);
    }
    this.accessToken = null;
    this.tokenExpiry = 0;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
    localStorage.removeItem(CONNECTED_KEY);
  }
}

export const googleAuth = new GoogleAuth();
