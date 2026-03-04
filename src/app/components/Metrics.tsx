import { useState, useEffect } from 'react';
import { store } from '../lib/store';
import { DailyMetrics } from '../lib/types';
import { dateToStr, scoreColor, scoreBarColor, formatDateDisplay, todayStr } from '../lib/helpers';
import { TrendingUp, TrendingDown, Minus, Flame, Target, AlertTriangle } from 'lucide-react';

export function Metrics() {
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [metrics, setMetrics] = useState<DailyMetrics[]>([]);
  const [currentStreak, setCurrentStreak] = useState(0);

  useEffect(() => {
    const recalc = () => {
      const today = new Date();
      const start = new Date();
      start.setDate(today.getDate() - (period === 'week' ? 7 : 30));

      const startStr = dateToStr(start);
      const todayString = dateToStr(today);

      // Read already-computed metrics for the date range
      const generated = store.getMetrics(startStr, todayString);

      setMetrics(generated);

      // Calculate streak: consecutive days ending today with score >= 85
      let streak = 0;
      const sorted = [...generated].sort((a, b) => b.date.localeCompare(a.date));
      for (const m of sorted) {
        if (m.disciplineScore >= 85) {
          streak++;
        } else {
          break;
        }
      }
      setCurrentStreak(streak);
    };

    recalc();
    // Refrescar cuando cloud sync actualiza datos desde otro dispositivo
    const unsubStore = store.subscribe(recalc);
    return () => unsubStore();
  }, [period]);

  const totalBlocks     = metrics.reduce((s, m) => s + m.blocksPlanned, 0);
  const completedBlocks = metrics.reduce((s, m) => s + m.blocksCompleted, 0);
  const failedBlocks    = metrics.reduce((s, m) => s + m.blocksFailed, 0);
  const totalInterruptions = metrics.reduce((s, m) => s + m.interruptions, 0);
  const totalDeepHours  = metrics.reduce((s, m) => s + m.deepWorkHours, 0);
  const avgDiscipline   = metrics.length > 0
    ? Math.round(metrics.reduce((s, m) => s + m.disciplineScore, 0) / metrics.length)
    : 100;
  const completionRate  = totalBlocks > 0
    ? Math.round((completedBlocks / totalBlocks) * 100)
    : 0;

  // Trend: compare last 3 days vs first 3 days
  const recentAvg = metrics.length >= 3
    ? metrics.slice(-3).reduce((s, m) => s + m.disciplineScore, 0) / 3
    : avgDiscipline;
  const olderAvg  = metrics.length >= 6
    ? metrics.slice(0, 3).reduce((s, m) => s + m.disciplineScore, 0) / 3
    : avgDiscipline;
  const trend = recentAvg > olderAvg + 2 ? 'up' : recentAvg < olderAvg - 2 ? 'down' : 'stable';

  const maxScore = Math.max(...metrics.map(m => m.disciplineScore), 1);

  return (
    <div className="p-6 space-y-5 pb-24">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-3xl font-bold">Métricas</h1>
        <p className="text-zinc-400 text-sm">Análisis de tu disciplina</p>
      </div>

      {/* Period Selector */}
      <div className="flex gap-2 bg-zinc-900 border border-zinc-800 rounded-xl p-1">
        {(['week', 'month'] as const).map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
              period === p ? 'bg-red-600 text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            {p === 'week' ? 'Semana' : 'Mes'}
          </button>
        ))}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3">
        {/* Discipline */}
        <div className="bg-gradient-to-br from-red-900/20 to-orange-900/20 border border-red-800/30 rounded-2xl p-5">
          <div className="flex items-center gap-2 text-red-400 mb-2">
            <Flame className="size-4" />
            <span className="text-xs uppercase tracking-wider">Disciplina</span>
          </div>
          <div className={`text-4xl font-bold ${scoreColor(avgDiscipline)}`}>{avgDiscipline}%</div>
          <div className="flex items-center gap-1 mt-2 text-xs">
            {trend === 'up' && <><TrendingUp className="size-3 text-green-500" /><span className="text-green-500">Mejorando</span></>}
            {trend === 'down' && <><TrendingDown className="size-3 text-red-500" /><span className="text-red-500">Bajando</span></>}
            {trend === 'stable' && <><Minus className="size-3 text-zinc-400" /><span className="text-zinc-400">Estable</span></>}
          </div>
        </div>

        {/* Completion */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
          <div className="flex items-center gap-2 text-green-400 mb-2">
            <Target className="size-4" />
            <span className="text-xs uppercase tracking-wider">Cumplimiento</span>
          </div>
          <div className="text-4xl font-bold">{completionRate}%</div>
          <div className="text-xs text-zinc-400 mt-2">{completedBlocks}/{totalBlocks} bloques</div>
        </div>

        {/* Deep Hours */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
          <div className="flex items-center gap-2 text-blue-400 mb-2">
            <span className="text-xs uppercase tracking-wider">⏱ Horas Profundas</span>
          </div>
          <div className="text-4xl font-bold">{totalDeepHours.toFixed(1)}</div>
          <div className="text-xs text-zinc-400 mt-2">horas totales</div>
        </div>

        {/* Streak */}
        <div className="bg-gradient-to-br from-purple-900/20 to-pink-900/20 border border-purple-800/30 rounded-2xl p-5">
          <div className="flex items-center gap-2 text-purple-400 mb-2">
            <Flame className="size-4" />
            <span className="text-xs uppercase tracking-wider">Racha</span>
          </div>
          <div className="text-4xl font-bold">{currentStreak}</div>
          <div className="text-xs text-zinc-400 mt-2">días consecutivos ≥85%</div>
        </div>
      </div>

      {/* Detailed Stats */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-3">
        <h3 className="font-semibold">Resumen Detallado</h3>
        {[
          { label: 'Bloques completados', value: completedBlocks, color: 'text-green-500' },
          { label: 'Bloques fallados',    value: failedBlocks,    color: 'text-red-500'   },
          { label: 'Interrupciones',      value: totalInterruptions, color: 'text-orange-500' },
          { label: 'Días analizados',     value: metrics.length,  color: ''              },
        ].map(({ label, value, color }) => (
          <div key={label} className="flex items-center justify-between text-sm">
            <span className="text-zinc-400">{label}</span>
            <span className={`font-semibold ${color}`}>{value}</span>
          </div>
        ))}
      </div>

      {/* Bar Chart */}
      {metrics.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-3">
          <h3 className="font-semibold">Historial Visual</h3>
          <div className="flex items-end gap-1 h-20">
            {metrics.map((m) => (
              <div key={m.date} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className={`w-full rounded-t-sm transition-all ${scoreBarColor(m.disciplineScore)}`}
                  style={{ height: `${(m.disciplineScore / maxScore) * 100}%`, minHeight: '2px' }}
                  title={`${m.date}: ${m.disciplineScore}%`}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between text-xs text-zinc-500">
            <span>{formatDateDisplay(metrics[0]?.date)}</span>
            <span>{formatDateDisplay(metrics[metrics.length - 1]?.date)}</span>
          </div>
        </div>
      )}

      {/* Daily Breakdown */}
      <div className="space-y-3">
        <h3 className="font-semibold">Historial Diario</h3>
        <div className="space-y-2">
          {[...metrics].reverse().map((m) => {
            const isToday = m.date === todayStr();
            return (
              <div key={m.date} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="font-semibold text-sm">
                      {isToday ? 'Hoy' : formatDateDisplay(m.date, { weekday: 'short', month: 'short', day: 'numeric' })}
                    </div>
                    <div className="text-xs text-zinc-400 mt-0.5">
                      {m.blocksCompleted}/{m.blocksPlanned} bloques
                      {m.interruptions > 0 && ` · ${m.interruptions} interrupción${m.interruptions > 1 ? 'es' : ''}`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-2xl font-bold ${scoreColor(m.disciplineScore)}`}>
                      {m.disciplineScore}%
                    </div>
                    {m.deepWorkHours > 0 && (
                      <div className="text-xs text-zinc-400">{m.deepWorkHours.toFixed(1)}h prof.</div>
                    )}
                  </div>
                </div>
                <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${scoreBarColor(m.disciplineScore)}`}
                    style={{ width: `${m.disciplineScore}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Performance Alerts */}
      {avgDiscipline < 70 && (
        <div className="bg-orange-900/20 border border-orange-800/30 rounded-2xl p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="size-5 text-orange-500 mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-semibold text-orange-400">Rendimiento Bajo</div>
              <div className="text-sm text-zinc-400 mt-1">
                Disciplina promedio por debajo del 70%. Considera ajustar tus horarios o reducir la cantidad de bloques.
              </div>
            </div>
          </div>
        </div>
      )}

      {currentStreak >= 7 && (
        <div className="bg-gradient-to-br from-purple-900/20 to-pink-900/20 border border-purple-800/30 rounded-2xl p-5">
          <div className="flex items-start gap-3">
            <Flame className="size-5 text-purple-400 mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-semibold text-purple-400">¡Racha de {currentStreak} Días!</div>
              <div className="text-sm text-zinc-400 mt-1">
                Excelente disciplina sostenida. ¡Sigue así!
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

