import { defineConfig, loadEnv } from 'vite'
import path from 'path'
import fs from 'fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

function pwaVersionPlugin() {
  return {
    name: 'pwa-version-updater',
    closeBundle() {
      const swPath = path.resolve(__dirname, 'dist/sw.js');
      if (fs.existsSync(swPath)) {
        let content = fs.readFileSync(swPath, 'utf-8');
        const buildId = Date.now().toString(36);
        content = content.replace(
          /const CACHE_NAME = ['"][^'"]+['"];/,
          `const CACHE_NAME = 'focusos-pwa-${buildId}';\n// Build ID: ${buildId} - ${new Date().toISOString()}`
        );
        fs.writeFileSync(swPath, content, 'utf-8');
        console.log(`[PWA] dist/sw.js actualizado con CACHE_NAME = focusos-pwa-${buildId}`);
      }
    },
  };
}

function googleAuthDevPlugin(env: Record<string, string>) {
  return {
    name: 'google-auth-dev-api',
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        if (req.url === '/api/google-auth' && req.method === 'POST') {
          let bodyStr = '';
          req.on('data', (chunk: any) => { bodyStr += chunk; });
          req.on('end', async () => {
            try {
              const body = bodyStr ? JSON.parse(bodyStr) : {};
              const { action, code, refresh_token } = body;
              const clientId =
                env.GOOGLE_CLIENT_ID ||
                process.env.GOOGLE_CLIENT_ID ||
                '470733236827-6d756k50hohamsq3hhur273f13f99167.apps.googleusercontent.com';
              const clientSecret = env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;

              res.setHeader('Content-Type', 'application/json');

              if (!clientSecret) {
                res.statusCode = 500;
                res.end(
                  JSON.stringify({
                    error: 'GOOGLE_CLIENT_SECRET_MISSING',
                    message:
                      'Falta configurar GOOGLE_CLIENT_SECRET en .env o .env.local para desarrollo local.',
                  })
                );
                return;
              }

              if (action === 'exchange') {
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
                res.statusCode = tokenRes.status;
                res.end(JSON.stringify(data));
                return;
              }

              if (action === 'refresh') {
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
                res.statusCode = tokenRes.status;
                res.end(JSON.stringify(data));
                return;
              }

              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Invalid action' }));
            } catch (err: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err?.message || 'Dev middleware error' }));
            }
          });
        } else {
          next();
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      react(),
      tailwindcss(),
      googleAuthDevPlugin(env),
      pwaVersionPlugin(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    assetsInclude: ['**/*.svg', '**/*.csv'],
  };
})
