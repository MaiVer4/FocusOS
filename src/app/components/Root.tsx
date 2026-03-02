import { useEffect, useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router';
import { Home, Target, Calendar, BarChart3, Settings, Cloud, CloudOff, LoaderCircle, RotateCw } from 'lucide-react';
import { googleAuth } from '../lib/google-auth';
import { cloudSync, type CloudSyncStatus } from '../lib/cloud-sync';
import { store } from '../lib/store';

const NAV_ITEMS = [
  { to: '/',        icon: Home,     label: 'Inicio'   },
  { to: '/focus',   icon: Target,   label: 'Enfoque'  },
  { to: '/planner', icon: Calendar, label: 'Plan'     },
  { to: '/metrics', icon: BarChart3,label: 'Métricas' },
  { to: '/settings',icon: Settings, label: 'Config'   },
] as const;

export function Root() {
  const location = useLocation();
  const [syncStatus, setSyncStatus] = useState<CloudSyncStatus>(cloudSync.getStatus());

  const syncUI: Record<CloudSyncStatus, { label: string; dot: string; icon: React.ComponentType<{ className?: string }> }> = {
    connected: { label: 'Sincronizado', dot: 'bg-emerald-400', icon: Cloud },
    syncing: { label: 'Sincronizando…', dot: 'bg-sky-400', icon: RotateCw },
    connecting: { label: 'Conectando…', dot: 'bg-amber-400', icon: LoaderCircle },
    retrying: { label: 'Reintentando…', dot: 'bg-orange-400', icon: LoaderCircle },
    disconnected: { label: 'Sin conexión', dot: 'bg-zinc-500', icon: CloudOff },
  };

  // ─── Cloud Sync a nivel de App (persiste en TODAS las páginas) ──────
  useEffect(() => {
    if (googleAuth.isAuthenticated() || googleAuth.wasConnected()) {
      cloudSync.connect();
    }

    // Cuando otro dispositivo escribe en Firestore, recargar datos
    const unsub = cloudSync.onRemoteChange(() => {
      store.reloadFromStorage();
    });

    const unsubStatus = cloudSync.onStatusChange((status) => {
      setSyncStatus(status);
    });

    return () => { unsub(); unsubStatus(); };
  }, []);

  const isActive = (to: string) =>
    to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);

  const statusInfo = syncUI[syncStatus];
  const StatusIcon = statusInfo.icon;
  const spin = syncStatus === 'syncing' || syncStatus === 'connecting' || syncStatus === 'retrying';

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col max-w-md mx-auto relative">
      <div className="sticky top-0 z-20 px-4 py-2 bg-zinc-900/90 backdrop-blur border-b border-zinc-800">
        <div className="flex items-center justify-center gap-2 text-xs text-zinc-200">
          <span className={`inline-block w-2 h-2 rounded-full ${statusInfo.dot}`} />
          <StatusIcon className={`size-3.5 ${spin ? 'animate-spin' : ''}`} />
          <span>{statusInfo.label}</span>
        </div>
      </div>

      <main className="flex-1 overflow-auto pb-20 min-h-0">
        <Outlet />
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-zinc-900/95 backdrop-blur-sm border-t border-zinc-800">
        <div className="flex items-center justify-around h-16">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <Link
              key={to}
              to={to}
              className={`flex flex-col items-center gap-1 px-3 py-2 transition-colors min-w-0 ${
                isActive(to) ? 'text-red-500' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <Icon className="size-5 flex-shrink-0" />
              <span className="text-xs truncate">{label}</span>
              {isActive(to) && (
                <span className="absolute bottom-0 w-6 h-0.5 bg-red-500 rounded-full" />
              )}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
