/**
 * Vercel Serverless Function: /api/google-auth
 * Maneja el intercambio de Authorization Code por Tokens y la renovación silenciosa
 * con Refresh Token para Google Classroom y Google Calendar.
 */

export default async function handler(req: any, res: any) {
  // Configuración de CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const { action, code, refresh_token } = body;

  const clientId =
    process.env.GOOGLE_CLIENT_ID ||
    '470733236827-6d756k50hohamsq3hhur273f13f99167.apps.googleusercontent.com';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientSecret) {
    return res.status(500).json({
      error: 'GOOGLE_CLIENT_SECRET_MISSING',
      message:
        'Falta configurar la variable de entorno GOOGLE_CLIENT_SECRET en el panel de Vercel (o en .env.local).',
    });
  }

  try {
    if (action === 'exchange') {
      if (!code) {
        return res.status(400).json({ error: 'Missing code parameter' });
      }

      // Intercambio de código de autorización por Access Token + Refresh Token
      const params = new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: 'postmessage',
        grant_type: 'authorization_code',
      });

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      const data = await tokenRes.json();
      if (!tokenRes.ok) {
        console.error('[GoogleAuth API] Error canjeando código:', data);
        return res.status(tokenRes.status).json(data);
      }

      return res.status(200).json(data);
    }

    if (action === 'refresh') {
      if (!refresh_token) {
        return res.status(400).json({ error: 'Missing refresh_token parameter' });
      }

      // Renovación silenciosa con Refresh Token (CERO popups en navegador)
      const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token,
        grant_type: 'refresh_token',
      });

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      const data = await tokenRes.json();
      if (!tokenRes.ok) {
        console.error('[GoogleAuth API] Error renovando con refresh token:', data);
        return res.status(tokenRes.status).json(data);
      }

      return res.status(200).json(data);
    }

    return res.status(400).json({ error: 'Invalid action. Use "exchange" or "refresh".' });
  } catch (error: any) {
    console.error('[GoogleAuth API] Excepción no controlada:', error);
    return res.status(500).json({ error: error?.message || 'Internal server error' });
  }
}
