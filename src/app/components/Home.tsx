import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { store } from '../lib/store';
import { Block } from '../lib/types';
import {
  getBlockSolidColor,
  getBlockLabel,
  formatTimeFull,
  scoreColor,
  todayStr,
} from '../lib/helpers';
import { Timer, AlertCircle, CheckCircle2, Flame, Calendar, BarChart3 } from 'lucide-react';

export function Home() {
  const navigate = useNavigate();
  const [currentBlock, setCurrentBlock] = useState<Block | null>(null);
  const [nextBlock, setNextBlock] = useState<Block | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [dailyScore, setDailyScore] = useState(100);
  const [todayBlocks, setTodayBlocks] = useState<Block[]>([]);
  const appName = store.getSettings().appName;

  useEffect(() => {
    const updateData = () => {
      setCurrentBlock(store.getCurrentBlock());
      setNextBlock(store.getNextBlock());
      setTodayBlocks(store.getTodayBlocks());
      setDailyScore(store.calculateDailyScore(todayStr()));
    };

    updateData();
    const timer = setInterval(() => {
      setCurrentTime(new Date());
      updateData();
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const completedBlocks = todayBlocks.filter(b => b.status === 'completed').length;
  const failedBlocks = todayBlocks.filter(b => b.status === 'failed').length;
  const totalBlocks = todayBlocks.length;
  const progressPct = totalBlocks > 0 ? Math.round((completedBlocks / totalBlocks) * 100) : 0;

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{appName}</h1>
          <p className="text-zinc-500 text-sm">
            {currentTime.toLocaleDateString('es-ES', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </p>
        </div>
        <div className={`text-2xl font-bold ${scoreColor(dailyScore)}`}>{dailyScore}%</div>
      </div>

      {/* Current Time */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 text-center">
        <div className="text-5xl font-mono font-bold tracking-tight tabular-nums">
          {formatTimeFull(currentTime)}
        </div>
      </div>

      {/* Daily Progress */}
      {totalBlocks > 0 && (
        <div className="bg-gradient-to-br from-red-900/20 to-orange-900/20 border border-red-800/30 rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-red-600/20 rounded-xl">
                <Flame className="size-5 text-red-500" />
              </div>
              <div>
                <div className="text-xs text-zinc-400 uppercase tracking-wider">Disciplina Hoy</div>
                <div className={`text-3xl font-bold ${scoreColor(dailyScore)}`}>{dailyScore}%</div>
              </div>
            </div>
            <div className="text-right text-sm space-y-0.5">
              {completedBlocks > 0 && <div className="text-green-400">{completedBlocks} completados</div>}
              {failedBlocks > 0 && <div className="text-red-400">{failedBlocks} fallados</div>}
              <div className="text-zinc-500">{totalBlocks} total</div>
            </div>
          </div>
          {/* Progress bar */}
          <div className="space-y-1">
            <div className="h-2 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="text-xs text-zinc-500 text-right">{progressPct}% completado</div>
          </div>
        </div>
      )}

      {/* Current Block */}
      {currentBlock ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="size-2 bg-red-500 rounded-full animate-pulse" />
            <h2 className="text-base font-semibold text-zinc-300">Bloque Activo</h2>
          </div>
          <button
            onClick={() => navigate('/focus')}
            className={`w-full ${getBlockSolidColor(currentBlock.type)} rounded-2xl p-5 text-left transition-transform active:scale-[0.98]`}
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="text-xs font-semibold opacity-80 uppercase tracking-wider">{getBlockLabel(currentBlock.type)}</div>
                <div className="text-2xl font-bold mt-1">
                  {currentBlock.task?.subject || 'Sin tarea asignada'}
                </div>
              </div>
              <Timer className="size-6 opacity-80" />
            </div>
            <div className="flex items-center justify-between text-sm opacity-90">
              <span>{currentBlock.startTime} – {currentBlock.endTime}</span>
              <span>{currentBlock.duration} min</span>
            </div>
          </button>
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
          <div className="flex items-center gap-3 text-zinc-400">
            <CheckCircle2 className="size-5 flex-shrink-0" />
            <span className="text-sm">No hay bloque activo en este momento</span>
          </div>
        </div>
      )}

      {/* Next Block */}
      {nextBlock && (
        <div className="space-y-2">
          <h2 className="text-base font-semibold text-zinc-300">Próximo Bloque</h2>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-zinc-500 uppercase tracking-wider">{getBlockLabel(nextBlock.type)}</div>
                <div className="text-lg font-semibold mt-0.5">
                  {nextBlock.task?.subject || 'Sin tarea asignada'}
                </div>
                <div className="text-sm text-zinc-500 mt-0.5">
                  {nextBlock.startTime} – {nextBlock.endTime}
                </div>
              </div>
              <div className={`size-10 ${getBlockSolidColor(nextBlock.type)} rounded-xl flex-shrink-0`} />
            </div>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="space-y-2">
        <h2 className="text-base font-semibold text-zinc-300">Acceso Rápido</h2>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => navigate('/planner')}
            className="bg-blue-700 hover:bg-blue-600 rounded-xl p-4 text-left transition-all active:scale-95"
          >
            <Calendar className="size-5 mb-2" />
            <div className="font-semibold text-sm">Planificar</div>
            <div className="text-xs opacity-70">Organizar bloques</div>
          </button>
          <button
            onClick={() => navigate('/metrics')}
            className="bg-purple-700 hover:bg-purple-600 rounded-xl p-4 text-left transition-all active:scale-95"
          >
            <BarChart3 className="size-5 mb-2" />
            <div className="font-semibold text-sm">Métricas</div>
            <div className="text-xs opacity-70">Ver progreso</div>
          </button>
        </div>
      </div>

      {/* Warning if no blocks today */}
      {todayBlocks.length === 0 && (
        <div className="bg-orange-900/20 border border-orange-800/30 rounded-2xl p-5">
          <div className="flex items-start gap-3">
            <AlertCircle className="size-5 text-orange-500 mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-semibold text-orange-400">Sin bloques programados</div>
              <div className="text-sm text-zinc-400 mt-1">
                Ve al planificador para configurar tu día.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

