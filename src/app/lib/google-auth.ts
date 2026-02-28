/**
 * Google OAuth2 — Google Identity Services (GIS)
 * Maneja autenticación con Google para acceder a APIs (Classroom, Calendar, etc.)
 */

// Client ID de Google Cloud Console
const CLIENT_ID = '816126025512-l7b49blf2bjdj3e0ij2t8lah2k34d68h.apps.googleusercontent.com';

// Scopes necesarios
const SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
  'https://www.googleapis.com/auth/classroom.student-submissions.me.readonly',
].join(' ');

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

  /** Verifica si la librería GIS está cargada */
  isReady(): boolean {
    return !!window.google?.accounts?.oauth2;
  }

  /** Verifica si hay un token de acceso válido */
  isAuthenticated(): boolean {
    return !!this.accessToken && Date.now() < this.tokenExpiry;
  }

  /** Obtiene el token actual */
  getAccessToken(): string | null {
    return this.isAuthenticated() ? this.accessToken : null;
  }

  /** Solicita acceso al usuario vía popup OAuth2 */
  authenticate(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.isReady()) {
        reject(new Error('Google Identity Services no está cargado'));
        return;
      }

      if (this.isAuthenticated()) {
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
          this.accessToken = response.access_token;
          this.tokenExpiry = Date.now() + response.expires_in * 1000;
          resolve(response.access_token);
        },
        error_callback: (error) => {
          reject(new Error(error.message || 'Error en la autenticación'));
        },
      });

      this.tokenClient.requestAccessToken({ prompt: '' });
    });
  }

  /** Cierra sesión y revoca el token */
  signOut(): void {
    if (this.accessToken) {
      window.google?.accounts.oauth2.revoke(this.accessToken);
      this.accessToken = null;
      this.tokenExpiry = 0;
    }
  }
}

export const googleAuth = new GoogleAuth();
