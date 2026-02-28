import { Outlet, Link, useLocation } from 'react-router';
import { Home, Target, Calendar, BarChart3, Settings } from 'lucide-react';

const NAV_ITEMS = [
  { to: '/',        icon: Home,     label: 'Inicio'   },
  { to: '/focus',   icon: Target,   label: 'Enfoque'  },
  { to: '/planner', icon: Calendar, label: 'Plan'     },
  { to: '/metrics', icon: BarChart3,label: 'Métricas' },
  { to: '/settings',icon: Settings, label: 'Config'   },
] as const;

export function Root() {
  const location = useLocation();

  const isActive = (to: string) =>
    to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col max-w-md mx-auto relative">
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
