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
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col max-w-md mx-auto relative overflow-x-hidden">
      {/* Sync indicator — Modern Pill */}
      <div
        className={`sticky top-2 z-50 px-4 transition-all duration-500 ease-out ${
          showBar ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none'
        }`}
      >
        <div className="mx-auto max-w-fit px-3 py-1 glass-card rounded-full shadow-lg border border-white/10 flex items-center gap-2">
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
          <span className={`text-[11px] font-semibold tracking-wider uppercase ${cfg.colors}`}>
            {cfg.label}
          </span>
        </div>
      </div>

      <main className="flex-1 overflow-auto pb-28 min-h-0">
        <Outlet />
      </main>

      {/* Floating Glassmorphism Bottom Dock */}
      <nav className="fixed bottom-3 left-3 right-3 max-w-md mx-auto z-40">
        <div className="glass-dock rounded-2xl p-1.5 flex items-center justify-between border border-white/[0.08] shadow-2xl">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => {
            const active = isActive(to);
            return (
              <Link
                key={to}
                to={to}
                className={`relative flex flex-col items-center justify-center gap-0.5 py-2 px-3 rounded-xl transition-all duration-200 min-w-0 flex-1 ${
                  active
                    ? 'bg-red-500/15 text-red-400 font-semibold border border-red-500/25 shadow-inner glow-red'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03] active:scale-95'
                }`}
              >
                <Icon className={`size-5 transition-transform duration-200 ${active ? 'scale-110 text-red-400' : ''}`} />
                <span className="text-[10px] tracking-tight truncate">{label}</span>
                {active && (
                  <span className="absolute -bottom-1 w-1 h-1 bg-red-400 rounded-full animate-pulse" />
                )}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
