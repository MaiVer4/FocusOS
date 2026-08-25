import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { store } from '../lib/store';
import { Block } from '../lib/types';
import {
  getBlockSolidColor,
  getBlockLabel,
  formatTimeFull,
  formatTo12h,
  scoreColor,
  todayStr,
} from '../lib/helpers';
import {
  Timer,
  AlertCircle,
  CheckCircle2,
  Flame,
  Calendar,
  BarChart3,
  Zap,
  ArrowRight,
  Sparkles,
  Plus,
  Play,
} from 'lucide-react';

export function Home() {
  const navigate = useNavigate();
  const [currentBlock, setCurrentBlock] = useState<Block | null>(null);
  const [nextBlock, setNextBlock] = useState<Block | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [dailyScore, setDailyScore] = useState(100);
  const [todayBlocks, setTodayBlocks] = useState<Block[]>([]);
  const appName = store.getSettings().appName || 'FocusOS';

  useEffect(() => {
    const updateData = () => {
      setCurrentBlock(store.getCurrentBlock());
      setNextBlock(store.getNextBlock());
      setTodayBlocks(store.getTodayBlocks());
      setDailyScore(store.calculateDailyScore(todayStr()));
    };

    updateData();
    const unsubStore = store.subscribe(updateData);
    const timer = setInterval(() => {
      setCurrentTime(new Date());
      updateData();
    }, 1000);

    return () => {
      clearInterval(timer);
      unsubStore();
    };
  }, []);

  const completedBlocks = todayBlocks.filter((b) => b.status === 'completed').length;
  const failedBlocks = todayBlocks.filter((b) => b.status === 'failed').length;
  const totalBlocks = todayBlocks.length;
  const progressPct = totalBlocks > 0 ? Math.round((completedBlocks / totalBlocks) * 100) : 0;

  // SVG Circular progress radius
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progressPct / 100) * circumference;

  return (
    <div className="p-5 space-y-5">
      {/* Top Header */}
      <div className="flex items-center justify-between pt-1">
        <div>
          <div className="flex items-center gap-2">
            <span className="size-2 bg-red-500 rounded-full animate-ping" />
            <h1 className="text-2xl font-black tracking-tight text-white">{appName}</h1>
          </div>
          <p className="text-zinc-400 text-xs capitalize mt-0.5">
            {currentTime.toLocaleDateString('es-ES', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </p>
        </div>

        {/* Live Discipline Badge */}
        <div className="glass-card px-3.5 py-1.5 rounded-full flex items-center gap-2 border border-white/10 shadow-sm">
          <Flame className="size-4 text-orange-500 fill-orange-500 animate-pulse" />
          <span className={`text-sm font-bold tabular-nums ${scoreColor(dailyScore)}`}>
            {dailyScore}%
          </span>
        </div>
      </div>

      {/* Main HUD Clock & Score Widget */}
      <div className="glass-card rounded-3xl p-5 relative overflow-hidden">
        <div className="flex items-center justify-between gap-4">
          {/* Digital Clock */}
          <div className="space-y-1">
            <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
              <span className="inline-block size-1.5 bg-emerald-400 rounded-full" />
              Hora Actual
            </div>
            <div className="text-4xl sm:text-5xl font-mono font-bold tracking-tight text-white tabular-nums drop-shadow-md">
              {formatTimeFull(currentTime)}
            </div>
            <div className="text-[11px] text-zinc-400">
              {totalBlocks > 0 ? `${completedBlocks} de ${totalBlocks} bloques listos` : 'Día libre'}
            </div>
          </div>

          {/* Circular Progress Meter */}
          <div className="relative flex items-center justify-center flex-shrink-0">
            <svg className="size-24 -rotate-90 transform">
              <circle
                cx="48"
                cy="48"
                r={radius}
                className="text-zinc-800"
                strokeWidth="7"
                stroke="currentColor"
                fill="transparent"
              />
              <circle
                cx="48"
                cy="48"
                r={radius}
                className="transition-all duration-700 ease-out"
                strokeWidth="7"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                stroke="url(#progressGradient)"
                fill="transparent"
              />
              <defs>
                <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#ef4444" />
                  <stop offset="100%" stopColor="#f97316" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-lg font-black text-white tabular-nums">{progressPct}%</span>
              <span className="text-[9px] uppercase tracking-wider text-zinc-400 font-semibold">Progreso</span>
            </div>
          </div>
        </div>

        {/* Quick Reschedule Button */}
        {totalBlocks > 0 && (
          <div className="mt-4 pt-3.5 border-t border-white/[0.06]">
            <button
              onClick={() => {
                const moved = store.reorganizeFromNow(todayStr());
                if (moved > 0) {
                  alert(`¡Día recalculado! Se ajustaron ${moved} bloques desde la hora actual.`);
                } else {
                  alert('Tus bloques ya están al día con la hora actual.');
                }
              }}
              className="w-full py-2.5 px-4 bg-amber-500/10 hover:bg-amber-500/20 active:scale-[0.98] border border-amber-500/25 text-amber-300 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-2 shadow-sm"
            >
              <Zap className="size-3.5 fill-current text-amber-400" />
              <span>Recalcular mi día desde ahora</span>
            </button>
          </div>
        )}
      </div>

      {/* Active Block Spotlight Card */}
      {currentBlock ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
              </span>
              <h2 className="text-xs font-bold uppercase tracking-wider text-red-400">En Curso Ahora</h2>
            </div>
            <span className="text-xs text-zinc-400 font-mono">
              {formatTo12h(currentBlock.startTime)} – {formatTo12h(currentBlock.endTime)}
            </span>
          </div>

          <div
            onClick={() => navigate('/focus')}
            className={`cursor-pointer group relative overflow-hidden rounded-3xl p-5 border transition-all duration-300 active:scale-[0.98] ${
              currentBlock.type === 'deep'
                ? 'bg-gradient-to-br from-red-950/80 via-zinc-900 to-zinc-900 border-red-500/40 glow-red'
                : currentBlock.type === 'exercise'
                ? 'bg-gradient-to-br from-emerald-950/80 via-zinc-900 to-zinc-900 border-emerald-500/40 glow-emerald'
                : 'glass-card border-white/10'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide bg-white/10 text-white/90">
                  {currentBlock.label || getBlockLabel(currentBlock.type)}
                </span>
                <h3 className="text-xl font-black text-white truncate pt-1">
                  {currentBlock.task?.subject || 'Sin tarea específica asignada'}
                </h3>
                <p className="text-xs text-zinc-400">
                  Duración: <span className="font-semibold text-white">{currentBlock.duration} min</span>
                </p>
              </div>

              <div className="size-12 rounded-2xl bg-white/10 group-hover:bg-red-500 group-hover:text-white flex items-center justify-center flex-shrink-0 transition-colors shadow-lg">
                <Play className="size-5 fill-current ml-0.5" />
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-white/[0.08] flex items-center justify-between text-xs text-zinc-400 group-hover:text-white transition-colors">
              <span className="flex items-center gap-1 font-medium">
                <Timer className="size-3.5" /> Toca para abrir Modo Enfoque
              </span>
              <ArrowRight className="size-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>
        </div>
      ) : (
        <div className="glass-card rounded-2xl p-4 flex items-center gap-3.5 border border-white/5">
          <div className="size-10 rounded-xl bg-zinc-800 flex items-center justify-center text-zinc-400">
            <CheckCircle2 className="size-5 text-emerald-400" />
          </div>
          <div>
            <div className="text-sm font-semibold text-zinc-200">Sin bloque en este instante</div>
            <div className="text-xs text-zinc-500">Tómate un momento o revisa tus próximos compromisos</div>
          </div>
        </div>
      )}

      {/* Next Upcoming Block */}
      {nextBlock && (
        <div className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400 px-1">A Continuación</h2>
          <div className="glass-card rounded-2xl p-4 border border-white/5 flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wide">
                {nextBlock.label || getBlockLabel(nextBlock.type)}
              </span>
              <div className="text-sm font-bold text-white">
                {nextBlock.task?.subject || 'Sin tarea asignada'}
              </div>
              <div className="text-xs text-zinc-400 font-mono">
                {formatTo12h(nextBlock.startTime)} – {formatTo12h(nextBlock.endTime)} · {nextBlock.duration} min
              </div>
            </div>
            <div className={`size-3 rounded-full ${getBlockSolidColor(nextBlock.type)} shadow-sm`} />
          </div>
        </div>
      )}

      {/* Quick Action Navigation Grid */}
      <div className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400 px-1">Acceso Rápido</h2>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => navigate('/planner')}
            className="glass-card glass-card-hover rounded-2xl p-4 text-left group active:scale-95"
          >
            <div className="size-9 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center mb-2.5 group-hover:scale-110 transition-transform">
              <Calendar className="size-5" />
            </div>
            <div className="font-bold text-sm text-white">Planificador</div>
            <div className="text-[11px] text-zinc-400">Organizar bloques y tareas</div>
          </button>

          <button
            onClick={() => navigate('/metrics')}
            className="glass-card glass-card-hover rounded-2xl p-4 text-left group active:scale-95"
          >
            <div className="size-9 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center mb-2.5 group-hover:scale-110 transition-transform">
              <BarChart3 className="size-5" />
            </div>
            <div className="font-bold text-sm text-white">Métricas</div>
            <div className="text-[11px] text-zinc-400">Rendimiento y disciplina</div>
          </button>
        </div>
      </div>

      {/* Empty Blocks Warning */}
      {todayBlocks.length === 0 && (
        <div className="bg-amber-950/20 border border-amber-500/30 rounded-2xl p-4 flex items-start gap-3">
          <AlertCircle className="size-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-bold text-sm text-amber-300">Sin bloques hoy</div>
            <p className="text-xs text-zinc-400">
              Ve al Planificador y presiona <strong>"Auto"</strong> o <strong>"IA"</strong> para armar tu rutina.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

