import { useEffect, useState, useRef } from 'react';
import { Outlet, Link, useLocation } from 'react-router';
import { Home, Target, Calendar, BarChart3, Settings, Cloud, CloudOff, Loader2, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { cloudSync, type CloudSyncStatus } from '../lib/cloud-sync';
import { onFirebaseAuth } from '../lib/firebase';
import { store } from '../lib/store';

const NAV_ITEMS = [
  { to: '/',        icon: Home,     label: 'Inicio'   },
  { to: '/focus',   icon: Target,   label: 'Enfoque'  },
  { to: '/planner', icon: Calendar, label: 'Plan'     },
  { to: '/metrics', icon: BarChart3,label: 'Métricas' },
  { to: '/settings',icon: Settings, label: 'Config'   },
] as const;

const SYNC_CONFIG: Record<CloudSyncStatus, {
  label: string;
  colors: string;
  bgGlow: string;
  icon: React.ComponentType<{ className?: string }>;
  pulse: boolean;
}> = {
  connected:    { label: 'Sincronizado',   colors: 'text-emerald-400', bgGlow: 'from-emerald-500/10 to-transparent', icon: Cloud,    pulse: false },
  syncing:      { label: 'Sincronizando',  colors: 'text-sky-400',     bgGlow: 'from-sky-500/10 to-transparent',     icon: RefreshCw, pulse: true  },
  connecting:   { label: 'Conectando',     colors: 'text-amber-400',   bgGlow: 'from-amber-500/10 to-transparent',   icon: Wifi,     pulse: true  },
  retrying:     { label: 'Reintentando',   colors: 'text-orange-400',  bgGlow: 'from-orange-500/10 to-transparent',  icon: Loader2,  pulse: true  },
  disconnected: { label: 'Sin conexión',   colors: 'text-zinc-500',    bgGlow: 'from-zinc-500/5 to-transparent',     icon: WifiOff,  pulse: false },
};

export function Root() {
  const location = useLocation();
  const [syncStatus, setSyncStatus] = useState<CloudSyncStatus>(cloudSync.getStatus());
  const [showBar, setShowBar] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(null);

  // ─── Cloud Sync a nivel de App (persiste en TODAS las páginas) ──────
  useEffect(() => {
    const unsubAuth = onFirebaseAuth((user) => {
      if (user) cloudSync.connect();
    });

    const unsub = cloudSync.onRemoteChange(() => {
      store.reloadFromStorage();
    });

    const unsubStatus = cloudSync.onStatusChange((status) => {
      setSyncStatus(status);
      // Mostrar la barra en cada cambio de estado
      setShowBar(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      // Auto-ocultar después de 2.5s si está conectado
      if (status === 'connected') {
        hideTimer.current = setTimeout(() => setShowBar(false), 2500);
      }
    });

    return () => { unsubAuth(); unsub(); unsubStatus(); if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, []);

  const isActive = (to: string) =>
    to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);

  const cfg = SYNC_CONFIG[syncStatus];
  const StatusIcon = cfg.icon;

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col max-w-md mx-auto relative">
      {/* Sync indicator — slides down/up */}
      <div
        className={`sticky top-0 z-20 transition-all duration-500 ease-out overflow-hidden ${
          showBar ? 'max-h-10 opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className={`relative px-4 py-1.5 bg-gradient-to-b ${cfg.bgGlow} backdrop-blur-md border-b border-white/[0.06]`}>
          <div className="flex items-center justify-center gap-2">
            {/* Animated dot */}
            <span className="relative flex h-2 w-2">
              {cfg.pulse && (
                <span className={`absolute inset-0 rounded-full ${cfg.colors.replace('text-', 'bg-')} opacity-75 animate-ping`} />
              )}
              <span className={`relative inline-flex h-2 w-2 rounded-full ${cfg.colors.replace('text-', 'bg-')}`} />
            </span>

            {/* Icon */}
            <StatusIcon className={`size-3.5 ${cfg.colors} ${cfg.pulse ? 'animate-spin' : ''}`} />

            {/* Label */}
            <span className={`text-[11px] font-medium tracking-wide uppercase ${cfg.colors}`}>
              {cfg.label}
            </span>
          </div>
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
