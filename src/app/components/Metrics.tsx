import { useState, useEffect } from 'react';
import { store } from '../lib/store';
import { DailyMetrics, DailyHealthLog, DailyWorkoutLog } from '../lib/types';
import {
  dateToStr,
  scoreColor,
  scoreBarColor,
  formatDateDisplay,
  todayStr,
} from '../lib/helpers';
import { CLINICAL_PROFILE } from '../lib/personal-protocol';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Flame,
  Target,
  AlertTriangle,
  Scale,
  Zap,
  Dumbbell,
  Droplets,
  Utensils,
  ShieldCheck,
  ShieldAlert,
  HeartPulse,
} from 'lucide-react';

export function Metrics() {
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [metrics, setMetrics] = useState<DailyMetrics[]>([]);
  const [healthLogs, setHealthLogs] = useState<DailyHealthLog[]>([]);
  const [workoutLogs, setWorkoutLogs] = useState<DailyWorkoutLog[]>([]);
  const [currentStreak, setCurrentStreak] = useState(0);

  const settings = store.getSettings();

  useEffect(() => {
    const recalc = () => {
      const today = new Date();
      const start = new Date();
      start.setDate(today.getDate() - (period === 'week' ? 7 : 30));

      const startStr = dateToStr(start);
      const todayString = dateToStr(today);

      const generated = store.getMetrics(startStr, todayString);
      setMetrics(generated);

      const allH = store.getAllHealthLogs().filter((h) => h.date >= startStr && h.date <= todayString);
      setHealthLogs(allH);

      const allW = store.getAllWorkoutLogs().filter((w) => w.date >= startStr && w.date <= todayString);
      setWorkoutLogs(allW);

      let streak = 0;
      const scoreByDate = new Map(generated.map((m) => [m.date, m.disciplineScore]));
      const cursor = new Date(todayString + 'T12:00:00');
      while (true) {
        const dayStr = dateToStr(cursor);
        const score = scoreByDate.get(dayStr);
        if (score !== undefined && score >= 85) {
          streak++;
          cursor.setDate(cursor.getDate() - 1);
        } else {
          break;
        }
      }
      setCurrentStreak(streak);
    };

    recalc();
    const unsubStore = store.subscribe(recalc);
    return () => unsubStore();
  }, [period]);

  const totalBlocks = metrics.reduce((s, m) => s + m.blocksPlanned, 0);
  const completedBlocks = metrics.reduce((s, m) => s + m.blocksCompleted, 0);
  const failedBlocks = metrics.reduce((s, m) => s + m.blocksFailed, 0);
  const totalInterruptions = metrics.reduce((s, m) => s + m.interruptions, 0);
  const totalDeepHours = metrics.reduce((s, m) => s + m.deepWorkHours, 0);
  const avgDiscipline =
    metrics.length > 0
      ? Math.round(metrics.reduce((s, m) => s + m.disciplineScore, 0) / metrics.length)
      : 100;
  const completionRate =
    totalBlocks > 0 ? Math.round((completedBlocks / totalBlocks) * 100) : 0;
  const avgBio =
    metrics.length > 0
      ? Math.round(
          metrics.reduce((s, m) => s + (m.biologicalScore ?? m.disciplineScore), 0) /
            metrics.length
        )
      : 100;
  const avgFocus =
    metrics.length > 0
      ? Math.round(
          metrics.reduce((s, m) => s + (m.focusScore ?? m.disciplineScore), 0) /
            metrics.length
        )
      : 100;

  // Trend
  const recentAvg =
    metrics.length >= 3
      ? metrics.slice(-3).reduce((s, m) => s + m.disciplineScore, 0) / 3
      : avgDiscipline;
  const olderAvg =
    metrics.length >= 6
      ? metrics.slice(0, 3).reduce((s, m) => s + m.disciplineScore, 0) / 3
      : avgDiscipline;
  const trend = recentAvg > olderAvg + 2 ? 'up' : recentAvg < olderAvg - 2 ? 'down' : 'stable';

  // Métricas Clínicas, Posturales y Físicas
  const currentWeight = settings.currentWeightKg ?? CLINICAL_PROFILE.startingWeightKg;
  const targetWeight = settings.targetWeightKg ?? 54;
  const weightGained = (currentWeight - CLINICAL_PROFILE.startingWeightKg).toFixed(1);

  // Energía
  const energyLogs = healthLogs.filter((h) => typeof h.energyLevel === 'number' && h.energyLevel > 0);
  const avgEnergy =
    energyLogs.length > 0
      ? (energyLogs.reduce((s, h) => s + h.energyLevel!, 0) / energyLogs.length).toFixed(1)
      : '5.0';

  // Balance Biomecánico 2:1 (Tracción vs. Empuje)
  const completedWorkouts = workoutLogs.filter((w) => w.completed);
  const pullCount = completedWorkouts.filter((w) => w.splitType === 'pull').length;
  const pushCount = completedWorkouts.filter((w) => w.splitType === 'push').length;
  const legsCount = completedWorkouts.filter((w) => w.splitType === 'legs').length;
  const ratioMet = pullCount >= pushCount;

  // Adherencia Nutricional
  const totalWaterLitres = (
    healthLogs.reduce((s, h) => s + (h.waterMl || 0), 0) / 1000
  ).toFixed(1);
  const daysWithAllMeals = healthLogs.filter(
    (h) => Object.values(h.mealsCompleted ?? {}).filter(Boolean).length >= 4
  ).length;

  const maxScore = Math.max(...metrics.map((m) => m.disciplineScore), 1);

  return (
    <div className="p-6 space-y-5 pb-24">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-3xl font-bold">Métricas & Diagnóstico</h1>
        <p className="text-zinc-400 text-sm">Disciplina, progreso muscular y alineación postural</p>
      </div>

      {/* Period Selector */}
      <div className="flex gap-2 bg-zinc-900 border border-zinc-800 rounded-xl p-1">
        {(['week', 'month'] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
              period === p ? 'bg-red-600 text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            {p === 'week' ? 'Semana (7 días)' : 'Mes (30 días)'}
          </button>
        ))}
      </div>

      {/* ═══ RESUMEN CLÍNICO & FÍSICO (HIPERTROFIA, ENERGÍA Y ESCOLIOSIS) ═══ */}
      <div className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400 px-1">
          Evolución Física y Metabólica
        </h2>
        <div className="grid grid-cols-2 gap-3">
          {/* Peso y Volumen Limpio */}
          <div className="bg-gradient-to-br from-emerald-950/40 to-zinc-900 border border-emerald-500/30 rounded-2xl p-4 space-y-1">
            <div className="flex items-center justify-between text-xs text-emerald-400">
              <span className="flex items-center gap-1 font-bold">
                <Scale className="size-4" /> Peso Corporal
              </span>
              <span className="text-[10px] text-zinc-400">Meta {targetWeight} kg</span>
            </div>
            <div className="text-3xl font-black text-white tabular-nums pt-1">
              {currentWeight} <span className="text-xs font-normal text-zinc-400">kg</span>
            </div>
            <div className="text-[11px] text-emerald-300 font-semibold">
              {Number(weightGained) >= 0 ? `+${weightGained} kg` : `${weightGained} kg`} desde base (47 kg)
            </div>
          </div>

          {/* Nivel de Energía Diario */}
          <div className="bg-gradient-to-br from-amber-950/40 to-zinc-900 border border-amber-500/30 rounded-2xl p-4 space-y-1">
            <div className="flex items-center justify-between text-xs text-amber-400">
              <span className="flex items-center gap-1 font-bold">
                <Zap className="size-4" /> Energía Promedio
              </span>
              <span className="text-[10px] text-zinc-400">Meta 8–9 / 10</span>
            </div>
            <div className="text-3xl font-black text-white tabular-nums pt-1">
              {avgEnergy} <span className="text-xs font-normal text-zinc-400">/ 10</span>
            </div>
            <div className="text-[11px] text-amber-300 font-semibold">
              Base clínica: 4–5 / 10
            </div>
          </div>

          {/* Balance Biomecánico 2:1 (Escoliosis) */}
          <div className="col-span-2 bg-gradient-to-br from-teal-950/40 to-zinc-900 border border-teal-500/30 rounded-2xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-teal-300 flex items-center gap-1.5">
                <Dumbbell className="size-4" /> Regla Biomecánica 2:1 (Escoliosis)
              </span>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  ratioMet
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                }`}
              >
                {ratioMet ? '✓ Hombros Alineados' : '⚠️ Más Espalda Requerida'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-1 text-center">
              <div className="bg-zinc-900/80 rounded-xl p-2 border border-white/5">
                <div className="text-lg font-black text-teal-300">{pullCount}</div>
                <div className="text-[10px] text-zinc-400 font-semibold">Tracción / Espalda</div>
              </div>
              <div className="bg-zinc-900/80 rounded-xl p-2 border border-white/5">
                <div className="text-lg font-black text-orange-400">{pushCount}</div>
                <div className="text-[10px] text-zinc-400 font-semibold">Empuje / Pecho</div>
              </div>
              <div className="bg-zinc-900/80 rounded-xl p-2 border border-white/5">
                <div className="text-lg font-black text-sky-400">{legsCount}</div>
                <div className="text-[10px] text-zinc-400 font-semibold">Piernas / Core</div>
              </div>
            </div>
            <p className="text-[11px] text-zinc-300 leading-relaxed">
              {ratioMet
                ? '¡Excelente! Mantienes la tracción por encima o igual al empuje, protegiendo tu columna del acortamiento por las 6h de PC.'
                : 'Cuidado: Llevas más empuje que tracción. La próxima sesión debe ser Tracción y Corrección de Escoliosis.'}
            </p>
          </div>
        </div>
      </div>

      {/* ═══ RESUMEN DE DISCIPLINA Y BLOQUES ═══ */}
      <div className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400 px-1">
          Disciplina y Productividad
        </h2>
        <div className="grid grid-cols-2 gap-3">
          {/* Score Biológico Promedio */}
          <div className="bg-gradient-to-br from-emerald-950/30 to-zinc-900 border border-emerald-500/30 rounded-2xl p-4">
            <div className="flex items-center gap-2 text-emerald-400 mb-1">
              <HeartPulse className="size-4" />
              <span className="text-xs uppercase tracking-wider font-bold">Biológico</span>
            </div>
            <div className="text-3xl font-black text-emerald-400 tabular-nums">{avgBio}%</div>
            <div className="text-[11px] text-zinc-400 mt-1">
              Nutrición, agua, espalda y sueño
            </div>
          </div>

          {/* Score Enfoque Promedio */}
          <div className="bg-gradient-to-br from-blue-950/30 to-zinc-900 border border-blue-500/30 rounded-2xl p-4">
            <div className="flex items-center gap-2 text-blue-400 mb-1">
              <Zap className="size-4" />
              <span className="text-xs uppercase tracking-wider font-bold">Enfoque</span>
            </div>
            <div className="text-3xl font-black text-blue-400 tabular-nums">{avgFocus}%</div>
            <div className="text-[11px] text-zinc-400 mt-1">
              SENA y desarrollo de código
            </div>
          </div>

          {/* Discipline */}
          <div className="bg-gradient-to-br from-red-900/20 to-orange-900/20 border border-red-800/30 rounded-2xl p-4">
            <div className="flex items-center gap-2 text-red-400 mb-1">
              <Flame className="size-4" />
              <span className="text-xs uppercase tracking-wider">Disciplina</span>
            </div>
            <div className={`text-3xl font-bold ${scoreColor(avgDiscipline)}`}>{avgDiscipline}%</div>
            <div className="flex items-center gap-1 mt-1 text-xs">
              {trend === 'up' && (
                <>
                  <TrendingUp className="size-3 text-green-500" />
                  <span className="text-green-500">Mejorando</span>
                </>
              )}
              {trend === 'down' && (
                <>
                  <TrendingDown className="size-3 text-red-500" />
                  <span className="text-red-500">Bajando</span>
                </>
              )}
              {trend === 'stable' && (
                <>
                  <Minus className="size-3 text-zinc-400" />
                  <span className="text-zinc-400">Estable</span>
                </>
              )}
            </div>
          </div>

          {/* Completion */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <div className="flex items-center gap-2 text-green-400 mb-1">
              <Target className="size-4" />
              <span className="text-xs uppercase tracking-wider">Cumplimiento</span>
            </div>
            <div className="text-3xl font-bold">{completionRate}%</div>
            <div className="text-xs text-zinc-400 mt-1">
              {completedBlocks}/{totalBlocks} bloques
            </div>
          </div>

          {/* Deep Hours */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <div className="flex items-center gap-2 text-blue-400 mb-1">
              <span className="text-xs uppercase tracking-wider">⏱ Horas Deep</span>
            </div>
            <div className="text-3xl font-bold">{totalDeepHours.toFixed(1)}</div>
            <div className="text-xs text-zinc-400 mt-1">horas totales</div>
          </div>

          {/* Streak */}
          <div className="bg-gradient-to-br from-purple-900/20 to-pink-900/20 border border-purple-800/30 rounded-2xl p-4">
            <div className="flex items-center gap-2 text-purple-400 mb-1">
              <Flame className="size-4" />
              <span className="text-xs uppercase tracking-wider">Racha</span>
            </div>
            <div className="text-3xl font-bold">{currentStreak}</div>
            <div className="text-xs text-zinc-400 mt-1">días con score ≥85%</div>
          </div>
        </div>
      </div>

      {/* Detailed Stats */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-3">
        <h3 className="font-semibold text-sm">Resumen Detallado</h3>
        {[
          { label: 'Bloques completados', value: completedBlocks, color: 'text-green-500' },
          { label: 'Bloques fallados', value: failedBlocks, color: 'text-red-500' },
          { label: 'Interrupciones', value: totalInterruptions, color: 'text-orange-500' },
          { label: 'Días con 4 comidas completas', value: daysWithAllMeals, color: 'text-amber-400' },
          { label: 'Agua total consumida', value: `${totalWaterLitres} L`, color: 'text-sky-400' },
          { label: 'Sesiones de Calistenia', value: completedWorkouts.length, color: 'text-emerald-400' },
          { label: 'Días analizados', value: metrics.length, color: '' },
        ].map(({ label, value, color }) => (
          <div key={label} className="flex items-center justify-between text-xs">
            <span className="text-zinc-400">{label}</span>
            <span className={`font-semibold ${color}`}>{value}</span>
          </div>
        ))}
      </div>

      {/* Bar Chart */}
      {metrics.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-3">
          <h3 className="font-semibold text-sm">Historial Visual de Disciplina</h3>
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
        <h3 className="font-semibold text-sm">Historial Diario</h3>
        <div className="space-y-2">
          {[...metrics].reverse().map((m) => {
            const isToday = m.date === todayStr();
            const h = healthLogs.find((x) => x.date === m.date);
            return (
              <div key={m.date} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="font-semibold text-sm">
                      {isToday
                        ? 'Hoy'
                        : formatDateDisplay(m.date, {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                          })}
                    </div>
                    <div className="text-xs text-zinc-400 mt-0.5 flex items-center gap-2 flex-wrap">
                      <span>{m.blocksCompleted}/{m.blocksPlanned} bloques</span>
                      {h?.energyLevel && (
                        <span className="text-amber-400 font-semibold">
                          ⚡ {h.energyLevel}/10
                        </span>
                      )}
                      {h?.weightKg && (
                        <span className="text-emerald-400 font-semibold">
                          ⚖️ {h.weightKg}kg
                        </span>
                      )}
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
                Disciplina promedio por debajo del 70%. Recuerda que cumplir tus 4 comidas y dormir de 10:30 p.m. a 7:00 a.m. es lo que mantendrá tu energía en 8–9/10.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
