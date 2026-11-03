import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { store } from '../lib/store';
import { Block, DailyHealthLog, MealId } from '../lib/types';
import {
  getBlockSolidColor,
  getBlockLabel,
  formatTimeFull,
  formatTo12h,
  scoreColor,
  todayStr,
  cleanBlockLabel,
  getCircadianPhase,
} from '../lib/helpers';
import { triggerHaptic } from '../lib/notifications';
import {
  MEAL_PROTOCOL,
  HOME_INGREDIENTS,
  WORKOUT_SPLITS,
  CLINICAL_PROFILE,
} from '../lib/personal-protocol';
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
  Play,
  Utensils,
  Droplets,
  Dumbbell,
  ShieldAlert,
  Check,
  Loader2,
  Scale,
  RotateCcw,
  X,
  HeartPulse,
  Sun,
  Moon,
  Footprints,
  Clock,
  Compass,
  CheckSquare,
} from 'lucide-react';

const MEAL_ORDER: MealId[] = ['breakfast', 'post_workout', 'sena_lunch', 'dinner'];

export function Home() {
  const navigate = useNavigate();
  const [currentBlock, setCurrentBlock] = useState<Block | null>(null);
  const [nextBlock, setNextBlock] = useState<Block | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [dailyScore, setDailyScore] = useState(100);
  const [todayBlocks, setTodayBlocks] = useState<Block[]>([]);
  const [healthLog, setHealthLog] = useState<DailyHealthLog>(() => store.getHealthLog(todayStr()));
  const [activeMealTab, setActiveMealTab] = useState<MealId>('breakfast');

  // Estado del Adaptador de Comidas con IA
  const [adaptingMeal, setAdaptingMeal] = useState<MealId | null>(null);
  const [selectedIngredients, setSelectedIngredients] = useState<string[]>([]);
  const [customKitchenNote, setCustomKitchenNote] = useState('');
  const [isGeneratingMeal, setIsGeneratingMeal] = useState(false);

  // Estado de peso rápido
  const [editingWeight, setEditingWeight] = useState(false);
  const [weightInput, setWeightInput] = useState('');

  const settings = store.getSettings();
  const appName = settings.appName || 'FocusOS';
  const today = todayStr();

  // Auto-seleccionar la comida según la hora del día al cargar
  useEffect(() => {
    const h = new Date().getHours();
    if (h < 10) setActiveMealTab('breakfast');
    else if (h < 13) setActiveMealTab('post_workout');
    else if (h < 18) setActiveMealTab('sena_lunch');
    else setActiveMealTab('dinner');
  }, []);

  useEffect(() => {
    const updateData = () => {
      const d = todayStr();
      setCurrentBlock(store.getCurrentBlock());
      setNextBlock(store.getNextBlock());
      setTodayBlocks(store.getTodayBlocks());
      setDailyScore(store.calculateDailyScore(d));
      setHealthLog(store.getHealthLog(d));
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
  const totalBlocks = todayBlocks.length;
  const progressPct = totalBlocks > 0 ? Math.round((completedBlocks / totalBlocks) * 100) : 0;

  // SVG Circular progress radius
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progressPct / 100) * circumference;

  // Datos nutricionales e hidratación
  const waterGoal = settings.waterGoalMl ?? CLINICAL_PROFILE.waterGoalMl;
  const waterPct = Math.min(100, Math.round(((healthLog.waterMl || 0) / waterGoal) * 100));
  const mealsDoneCount = MEAL_ORDER.filter((m) => healthLog.mealsCompleted[m]).length;
  const isPastWaterCutoff =
    currentTime.getHours() > 20 ||
    (currentTime.getHours() === 20 && currentTime.getMinutes() >= 30);

  // Datos de entrenamiento y Guardia 2:1
  const guard = store.getBiomechanicalGuard(today);
  const workoutLog = store.getWorkoutLog(today);
  const activeSplit = WORKOUT_SPLITS[workoutLog.splitType];

  const activeMealDef = MEAL_PROTOCOL[activeMealTab];
  const activeMealOverride = healthLog.mealCustomOverride?.[activeMealTab];
  const activeMealTime =
    activeMealTab === 'breakfast'
      ? settings.mealTimes?.breakfast ?? activeMealDef.defaultTime
      : activeMealTab === 'post_workout'
        ? settings.mealTimes?.postWorkout ?? activeMealDef.defaultTime
        : activeMealTab === 'sena_lunch'
          ? settings.mealTimes?.senaLunch ?? activeMealDef.defaultTime
          : settings.mealTimes?.dinner ?? activeMealDef.defaultTime;

  const toggleIngredientChip = (ing: string) => {
    setSelectedIngredients((prev) =>
      prev.includes(ing) ? prev.filter((x) => x !== ing) : [...prev, ing]
    );
  };

  const handleGenerateMealReplacement = async () => {
    if (!adaptingMeal) return;
    if (selectedIngredients.length === 0 && !customKitchenNote.trim()) {
      alert('Selecciona al menos un ingrediente o escribe qué tienes en casa.');
      return;
    }
    setIsGeneratingMeal(true);
    try {
      await store.adaptMealWithAI(
        today,
        adaptingMeal,
        selectedIngredients,
        customKitchenNote
      );
      setAdaptingMeal(null);
      setSelectedIngredients([]);
      setCustomKitchenNote('');
    } finally {
      setIsGeneratingMeal(false);
    }
  };

  const currentWeight = healthLog.weightKg ?? settings.currentWeightKg ?? CLINICAL_PROFILE.startingWeightKg;
  const targetWeight = settings.targetWeightKg ?? 54;

  const phase = getCircadianPhase(currentTime);
  const bioScore = store.calculateBiologicalScore(today);
  const focusScore = store.calculateFocusScore(today);
  const isOutOfRoutine = !!healthLog.outOfRoutine;
  const isWeekend = currentTime.getDay() === 0 || currentTime.getDay() === 6;

  // Tiempo restante del bloque activo
  const getRemainingMinutes = () => {
    if (!currentBlock) return 0;
    const [eh, em] = currentBlock.endTime.split(':').map(Number);
    const endMinutes = eh * 60 + em;
    const nowMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
    return Math.max(0, endMinutes - nowMinutes);
  };
  const remainingMins = getRemainingMinutes();

  return (
    <div className="p-4 sm:p-5 space-y-4 sm:space-y-5 pb-24">
      {/* ═══ 1. FASE CIRCADIANA EN VIVO ("¿QUÉ HAGO AHORA?") ═══ */}
      <div
        className={`rounded-3xl p-4 border transition-all duration-300 shadow-lg ${phase.borderColor} bg-gradient-to-r ${phase.bgGradient}`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`size-2.5 rounded-full ${phase.dotColor} motion-safe:animate-ping`} />
            <span className={`text-xs font-black uppercase tracking-wider ${phase.color}`}>
              {phase.label}
            </span>
          </div>
          <span
            className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border tracking-wide uppercase ${phase.badgeBg}`}
          >
            Fase Activa
          </span>
        </div>
        <p className="text-xs text-zinc-300 mt-1.5 leading-relaxed font-medium">
          {phase.sublabel}
        </p>
      </div>

      {/* ═══ 2. TOP HEADER CON APP NAME & RELOJ ═══ */}
      <div className="flex items-center justify-between pt-0.5 px-1">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-black tracking-tight text-white">{appName}</h1>
            {isOutOfRoutine && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                Modo Libre
              </span>
            )}
          </div>
          <p className="text-zinc-400 text-xs capitalize mt-0.5">
            {currentTime.toLocaleDateString('es-ES', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </p>
        </div>

        {/* Toggle Rápido: Modo Fuera de Rutina / Salí de Casa */}
        <button
          type="button"
          onClick={() => {
            triggerHaptic(isOutOfRoutine ? 'light' : 'warning');
            store.toggleOutOfRoutine(today);
          }}
          className={`px-3 py-1.5 rounded-full text-xs font-bold border flex items-center gap-1.5 transition-all active:scale-95 ${
            isOutOfRoutine
              ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 shadow-sm'
              : 'glass-card border-white/10 text-zinc-400 hover:text-white'
          }`}
          title="Congela bloques de estudio si sales de casa o tienes imprevistos"
        >
          <Footprints className="size-3.5" />
          <span>{isOutOfRoutine ? 'Fuera de Casa' : 'Modo Salida'}</span>
        </button>
      </div>

      {/* ═══ 3. FIN DE SEMANA: SELECTOR MATUTINO O RECORDATORIO DE MODO ═══ */}
      {isWeekend && !healthLog.weekendMode && (
        <div className="glass-card rounded-3xl p-5 border border-indigo-500/30 bg-gradient-to-br from-indigo-950/40 via-zinc-900 to-zinc-900 space-y-3 shadow-xl">
          <div className="flex items-center gap-2 text-indigo-400 font-bold text-sm">
            <Sparkles className="size-4" />
            <span>Fin de Semana: ¿Cuál es tu plan para hoy?</span>
          </div>
          <p className="text-xs text-zinc-300 leading-relaxed">
            No hay SENA. Elige cómo quieres enfocar tu {currentTime.toLocaleDateString('es-ES', { weekday: 'long' })}:
          </p>
          <div className="grid grid-cols-2 gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => {
                triggerHaptic('success');
                store.setWeekendPlanMode(today, 'projects');
              }}
              className="p-3 rounded-2xl bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-left active:scale-[0.97] transition-all"
            >
              <div className="text-xs font-black text-white">🏡 Proyectos en Casa</div>
              <div className="text-[10px] text-zinc-400 mt-0.5">Bloques de código y calistenia</div>
            </button>
            <button
              type="button"
              onClick={() => {
                triggerHaptic('success');
                store.setWeekendPlanMode(today, 'free');
              }}
              className="p-3 rounded-2xl bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-left active:scale-[0.97] transition-all"
            >
              <div className="text-xs font-black text-white">🚶 Modo Libre / Salida</div>
              <div className="text-[10px] text-zinc-400 mt-0.5">Checklist biológico sin estrés</div>
            </button>
          </div>
        </div>
      )}

      {isWeekend && healthLog.weekendMode && (
        <div className="flex items-center justify-between text-xs px-2 py-1 bg-zinc-900/60 rounded-xl border border-white/5">
          <span className="text-zinc-400">
            Fin de semana en: <strong className="text-white capitalize">{healthLog.weekendMode === 'free' ? 'Modo Libre / Salida' : 'Proyectos en Casa'}</strong>
          </span>
          <button
            type="button"
            onClick={() => {
              triggerHaptic('light');
              store.setWeekendPlanMode(today, healthLog.weekendMode === 'free' ? 'projects' : 'free');
            }}
            className="text-[11px] text-indigo-400 hover:text-indigo-300 font-bold underline"
          >
            Cambiar a {healthLog.weekendMode === 'free' ? 'Proyectos' : 'Modo Libre'}
          </button>
        </div>
      )}

      {/* ═══ 4. CHECKLIST BIOLÓGICO FLOTANTE (CUANDO SE ESTÁ FUERA DE RUTINA) ═══ */}
      {isOutOfRoutine && (
        <div className="glass-card rounded-3xl p-5 border border-emerald-500/30 bg-gradient-to-br from-emerald-950/30 via-zinc-900 to-zinc-900 space-y-3.5 shadow-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HeartPulse className="size-4 text-emerald-400" />
              <h2 className="text-sm font-black text-white uppercase tracking-wider">
                Checklist Biológico Flotante
              </h2>
            </div>
            <span className="text-xs font-black text-emerald-400 tabular-nums">
              {bioScore}% Salud
            </span>
          </div>
          <p className="text-xs text-zinc-300 leading-relaxed">
            Cero estrés con horarios hoy. Cumple tus 3 no negociables para cuidar tu hipertrofia (54 kg) y tu escoliosis:
          </p>

          <div className="grid grid-cols-2 gap-2.5">
            <div className="bg-zinc-900/90 border border-white/5 rounded-2xl p-3 flex flex-col justify-between">
              <span className="text-[10px] font-bold text-orange-400 uppercase">Nutrición (40%)</span>
              <div className="text-base font-black text-white mt-0.5">{mealsDoneCount} de 4 comidas</div>
              <span className="text-[10px] text-zinc-400">Meta ~2,400 kcal</span>
            </div>

            <div className="bg-zinc-900/90 border border-white/5 rounded-2xl p-3 flex flex-col justify-between">
              <span className="text-[10px] font-bold text-emerald-400 uppercase">Espalda 2:1 (30%)</span>
              <div className="text-base font-black text-white mt-0.5">
                {workoutLog.completed ? 'Completado ✓' : 'Piernas / Movilidad'}
              </div>
              <span className="text-[10px] text-zinc-400">Escoliosis & Morral</span>
            </div>

            <div className="bg-zinc-900/90 border border-white/5 rounded-2xl p-3 flex flex-col justify-between">
              <span className="text-[10px] font-bold text-sky-400 uppercase">Hidratación (20%)</span>
              <div className="text-base font-black text-white mt-0.5">
                {((healthLog.waterMl || 0) / 1000).toFixed(1)} / 2.5 L
              </div>
              <span className="text-[10px] text-zinc-400">Corte 8:30 p.m.</span>
            </div>

            <div className="bg-zinc-900/90 border border-white/5 rounded-2xl p-3 flex flex-col justify-between">
              <span className="text-[10px] font-bold text-purple-400 uppercase">Sueño (10%)</span>
              <div className="text-base font-black text-white mt-0.5">22:30 Estricto</div>
              <span className="text-[10px] text-zinc-400">Almohada entre piernas</span>
            </div>
          </div>
        </div>
      )}

      {/* ═══ 5. RELOJ PRINCIPAL + DUAL SCORE (BIOLÓGICO vs ENFOQUE) ═══ */}
      <div className="glass-card rounded-3xl p-5 relative overflow-hidden space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
              <span className="inline-block size-1.5 bg-emerald-400 rounded-full" />
              Hora Actual
            </div>
            <div className="text-4xl sm:text-5xl font-mono font-bold tracking-tight text-white tabular-nums drop-shadow-md">
              {formatTimeFull(currentTime)}
            </div>
            <div className="text-[11px] text-zinc-400">
              {totalBlocks > 0
                ? `${completedBlocks} de ${totalBlocks} bloques completados`
                : 'Sin bloques generados hoy'}
            </div>
          </div>

          {/* Medidor Circular del Score Global Híbrido */}
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
                  <stop offset="0%" stopColor="#10b981" />
                  <stop offset="100%" stopColor="#3b82f6" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-lg font-black text-white tabular-nums">{dailyScore}%</span>
              <span className="text-[9px] uppercase tracking-wider text-zinc-400 font-semibold">
                Global
              </span>
            </div>
          </div>
        </div>

        {/* Barras de Desglose Dual: Biológico vs Enfoque */}
        <div className="grid grid-cols-2 gap-2.5 pt-1 border-t border-white/[0.06]">
          {/* Score Biológico */}
          <div className="bg-zinc-900/70 border border-white/5 rounded-2xl p-2.5 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400 font-semibold flex items-center gap-1">
                <HeartPulse className="size-3.5 text-emerald-400" /> Biológico (70%)
              </span>
              <span className="font-bold text-emerald-400 tabular-nums">{bioScore}%</span>
            </div>
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-300"
                style={{ width: `${bioScore}%` }}
              />
            </div>
          </div>

          {/* Score Enfoque */}
          <div className="bg-zinc-900/70 border border-white/5 rounded-2xl p-2.5 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400 font-semibold flex items-center gap-1">
                <Zap className="size-3.5 text-blue-400" /> Enfoque (30%)
              </span>
              <span className="font-bold text-blue-400 tabular-nums">{focusScore}%</span>
            </div>
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-indigo-400 transition-all duration-300"
                style={{ width: `${focusScore}%` }}
              />
            </div>
          </div>
        </div>

        {/* Botón de Auto-Reajuste Dinámico Sin Penalización */}
        {totalBlocks > 0 && (
          <button
            type="button"
            onClick={() => {
              triggerHaptic('light');
              const moved = store.reorganizeFromNow(todayStr());
              if (moved > 0) {
                alert(`¡Día recalculado! Se ajustaron ${moved} bloques respetando cena (20:00) y sueño (22:30).`);
              } else {
                alert('Tus bloques ya están al día con la hora actual.');
              }
            }}
            className="w-full py-2.5 px-4 bg-amber-500/10 hover:bg-amber-500/20 active:scale-[0.98] border border-amber-500/25 text-amber-300 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-2 shadow-sm"
          >
            <Zap className="size-3.5 fill-current text-amber-400" />
            <span>Reajustar Tarde desde Ahora (Sin Penalización)</span>
          </button>
        )}
      </div>

      {/* ═══ 6. SPOTLIGHT HERO: BLOQUE ACTUAL + ACCIONES ERGONÓMICAS DE PULGAR ═══ */}
      {currentBlock ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
              </span>
              <h2 className="text-xs font-bold uppercase tracking-wider text-red-400">
                En Curso Ahora
              </h2>
            </div>
            <span className="text-xs text-amber-400 font-mono font-bold">
              ⏱️ {remainingMins > 0 ? `${remainingMins} min restantes` : 'Terminando...'}
            </span>
          </div>

          <div
            className={`relative overflow-hidden rounded-3xl p-5 border transition-all duration-200 shadow-xl space-y-4 ${
              currentBlock.type === 'deep'
                ? 'bg-gradient-to-br from-red-950/80 via-zinc-900 to-zinc-900 border-red-500/40 glow-red'
                : currentBlock.type === 'exercise'
                  ? 'bg-gradient-to-br from-emerald-950/80 via-zinc-900 to-zinc-900 border-emerald-500/40 glow-emerald'
                  : 'glass-card border-white/10'
            }`}
          >
            <div
              onClick={() => navigate('/focus')}
              className="cursor-pointer flex items-start justify-between gap-3"
            >
              <div className="space-y-1 min-w-0">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide bg-white/10 text-white/90">
                  {cleanBlockLabel(currentBlock.label) || getBlockLabel(currentBlock.type)}
                </span>
                <h3 className="text-xl font-black text-white truncate pt-1">
                  {currentBlock.type === 'exercise'
                    ? activeSplit.title
                    : currentBlock.task?.subject || cleanBlockLabel(currentBlock.label) || 'Bloque activo'}
                </h3>
                <p className="text-xs text-zinc-400">
                  Horario:{' '}
                  <span className="font-semibold text-white font-mono">
                    {formatTo12h(currentBlock.startTime)} – {formatTo12h(currentBlock.endTime)}
                  </span>{' '}
                  ({currentBlock.duration} min)
                </p>
              </div>

              <div className="size-12 rounded-2xl bg-white/10 group-hover:bg-red-500 group-hover:text-white flex items-center justify-center flex-shrink-0 transition-colors shadow-lg">
                <Play className="size-5 fill-current ml-0.5 text-white" />
              </div>
            </div>

            {/* BOTONES DE ACCIÓN RÁPIDA (ZONA DEL PULGAR EN ANDROID) */}
            <div className="pt-2 border-t border-white/[0.08] grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('success');
                  store.updateBlock(currentBlock.id, { status: 'completed' });
                }}
                className="py-2.5 px-3 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-md"
              >
                <CheckCircle2 className="size-4" />
                <span>Cumplir Bloque</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  triggerHaptic('light');
                  store.postponeBlock(currentBlock.id, 15);
                }}
                className="py-2.5 px-3 bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-zinc-200 border border-white/10 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm"
              >
                <Clock className="size-4 text-amber-400" />
                <span>+15 min</span>
              </button>
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
            <div className="text-xs text-zinc-500">
              Revisa tu próxima comida o hidratación a continuación
            </div>
          </div>
        </div>
      )}

      {/* ═══ 7. BARRA RÁPIDA DE LOGGING PARA EL PULGAR (1 TOQUE EN ANDROID) ═══ */}
      <div className="glass-card rounded-2xl p-2.5 border border-white/10 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => {
            triggerHaptic('light');
            store.addWater(today, 250);
          }}
          className="py-2 px-2 bg-sky-500/15 hover:bg-sky-500/25 active:scale-95 border border-sky-500/30 text-sky-300 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1"
        >
          <Droplets className="size-3.5" />
          <span>+250ml</span>
        </button>

        <button
          type="button"
          onClick={() => {
            triggerHaptic('success');
            store.toggleMeal(today, activeMealTab);
          }}
          className={`py-2 px-2 rounded-xl text-xs font-bold border transition-all active:scale-95 flex items-center justify-center gap-1 ${
            healthLog.mealsCompleted[activeMealTab]
              ? 'bg-emerald-600 border-emerald-500 text-white'
              : 'bg-orange-500/15 border-orange-500/30 text-orange-300'
          }`}
        >
          <Utensils className="size-3.5" />
          <span>Comida {mealsDoneCount}/4</span>
        </button>

        <button
          type="button"
          onClick={() => {
            triggerHaptic('light');
            navigate('/focus?mode=workout');
          }}
          className="py-2 px-2 bg-emerald-500/15 hover:bg-emerald-500/25 active:scale-95 border border-emerald-500/30 text-emerald-300 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1"
        >
          <Dumbbell className="size-3.5" />
          <span>{workoutLog.completed ? 'Rutina ✓' : 'Calistenia'}</span>
        </button>
      </div>

      {/* Next Upcoming Block */}
      {nextBlock && (
        <div className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400 px-1">
            A Continuación
          </h2>
          <div className="glass-card rounded-2xl p-4 border border-white/5 flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wide">
                {cleanBlockLabel(nextBlock.label) || getBlockLabel(nextBlock.type)}
              </span>
              <div className="text-sm font-bold text-white">
                {nextBlock.task?.subject || cleanBlockLabel(nextBlock.label) || 'Actividad de rutina'}
              </div>
              <div className="text-xs text-zinc-400 font-mono">
                {formatTo12h(nextBlock.startTime)} – {formatTo12h(nextBlock.endTime)} ·{' '}
                {nextBlock.duration} min
              </div>
            </div>
            <div className={`size-3 rounded-full ${getBlockSolidColor(nextBlock.type)} shadow-sm`} />
          </div>
        </div>
      )}

      {/* ═══ PANEL DE NUTRICIÓN DE VOLUMEN LIMPIO (4 COMIDAS + IA) ═══ */}
      <div className="glass-card rounded-3xl p-5 border border-orange-500/20 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-xl bg-orange-500/20 text-orange-400 flex items-center justify-center">
              <Utensils className="size-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Plan Volumen Limpio (~2,400 kcal)</h2>
              <p className="text-[11px] text-zinc-400">
                Meta: 90–100g proteína · {mealsDoneCount}/4 comidas hoy
              </p>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-orange-500/15 text-orange-300 border border-orange-500/30">
            {mealsDoneCount * 25}%
          </span>
        </div>

        {/* Selector de las 4 Comidas */}
        <div className="grid grid-cols-4 gap-1.5">
          {MEAL_ORDER.map((mId) => {
            const def = MEAL_PROTOCOL[mId];
            const done = healthLog.mealsCompleted[mId];
            const selected = activeMealTab === mId;
            const timeStr =
              mId === 'breakfast'
                ? settings.mealTimes?.breakfast ?? def.defaultTime
                : mId === 'post_workout'
                  ? settings.mealTimes?.postWorkout ?? def.defaultTime
                  : mId === 'sena_lunch'
                    ? settings.mealTimes?.senaLunch ?? def.defaultTime
                    : settings.mealTimes?.dinner ?? def.defaultTime;

            return (
              <button
                key={mId}
                type="button"
                onClick={() => setActiveMealTab(mId)}
                className={`p-2 rounded-xl border text-left transition-all relative ${
                  selected
                    ? 'bg-orange-500/20 border-orange-500/50 text-white'
                    : done
                      ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
                      : 'bg-zinc-900/70 border-white/5 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <div className="flex items-center justify-between text-[10px] font-mono opacity-80">
                  <span>{formatTo12h(timeStr).replace(' ', '')}</span>
                  {done && <Check className="size-3 text-emerald-400 stroke-[3]" />}
                </div>
                <div className="text-[11px] font-bold truncate mt-0.5">
                  {mId === 'breakfast'
                    ? 'Desayuno'
                    : mId === 'post_workout'
                      ? 'Post-Entr.'
                      : mId === 'sena_lunch'
                        ? 'Almuerzo'
                        : 'Cena'}
                </div>
              </button>
            );
          })}
        </div>

        {/* Detalle de la Comida Activa */}
        <div className="bg-zinc-900/90 border border-white/10 rounded-2xl p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs font-bold text-orange-400 uppercase tracking-wide">
                {activeMealDef.number}. {activeMealDef.name} ({formatTo12h(activeMealTime)})
              </div>
              <div className="text-[11px] text-zinc-400 mt-0.5">
                {activeMealDef.targetProtein} · {activeMealDef.targetCalories}
              </div>
            </div>
            <button
              type="button"
              onClick={() => store.toggleMeal(today, activeMealTab)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-[background-color,border-color,transform] duration-150 enabled:active:scale-[0.96] ${
                healthLog.mealsCompleted[activeMealTab]
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-white/10'
              }`}
            >
              <CheckCircle2 className="size-3.5" />
              {healthLog.mealsCompleted[activeMealTab] ? 'Comida lista' : 'Marcar comida'}
            </button>
          </div>

          {/* Si el usuario adaptó la comida con IA hoy, mostrar el plato personalizado */}
          {activeMealOverride ? (
            <div className="bg-purple-950/35 border border-purple-500/40 rounded-xl p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-purple-300 flex items-center gap-1">
                  <Sparkles className="size-3" /> Plato Adaptado a tu Cocina Hoy
                </span>
                <button
                  type="button"
                  onClick={() => store.setMealCustomOverride(today, activeMealTab, null)}
                  className="text-[11px] text-zinc-400 hover:text-white flex items-center gap-1"
                  title="Volver a las opciones estándar"
                >
                  <RotateCcw className="size-3" /> Restaurar
                </button>
              </div>
              <div className="text-sm font-bold text-white">{activeMealOverride.title}</div>
              <p className="text-xs text-zinc-300 leading-relaxed">
                {activeMealOverride.description}
              </p>
              <div className="text-[11px] font-semibold text-emerald-400">
                {activeMealOverride.macros}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {activeMealDef.options.map((opt) => {
                const isSelected =
                  (healthLog.mealSelectedOption?.[activeMealTab] ??
                    activeMealDef.options[0].id) === opt.id;
                return (
                  <div
                    key={opt.id}
                    onClick={() => store.selectMealOption(today, activeMealTab, opt.id)}
                    className={`cursor-pointer p-3 rounded-xl border transition-all ${
                      isSelected
                        ? 'bg-orange-500/10 border-orange-500/40 text-white'
                        : 'bg-zinc-950/60 border-white/5 text-zinc-400 hover:border-white/15'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span className={isSelected ? 'text-orange-300' : 'text-zinc-300'}>
                        {opt.label}
                      </span>
                      <span className="text-[11px] text-emerald-400 font-mono">
                        ~{opt.proteinGrams}g prot · {opt.calories} kcal
                      </span>
                    </div>
                    <p className="text-xs mt-1 leading-relaxed text-zinc-200">{opt.details}</p>
                  </div>
                );
              })}
            </div>
          )}

          {/* Regla de oro + Botón para suplementar/adaptar con IA */}
          <div className="pt-1 flex flex-col gap-2">
            <div className="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1.5">
              💡 {activeMealDef.goldenRule}
            </div>
            <button
              type="button"
              onClick={() => {
                setAdaptingMeal(activeMealTab);
                setSelectedIngredients([]);
                setCustomKitchenNote('');
              }}
              className="w-full py-2.5 px-3 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/35 text-purple-200 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-[background-color,border-color,transform] duration-150 enabled:active:scale-[0.96]"
            >
              <Sparkles className="size-3.5 text-purple-400" />
              <span>¿No tienes algo? Dime qué hay en casa para suplementarlo</span>
            </button>
          </div>
        </div>
      </div>

      {/* ═══ HIDRATACIÓN ESTRATÉGICA (2.2 - 2.5 L + CORTE 8:30 P.M.) ═══ */}
      <div className="glass-card rounded-3xl p-5 border border-sky-500/20 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center">
              <Droplets className="size-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Hidratación Estratégica</h2>
              <p className="text-[11px] text-zinc-400">
                Meta: {(waterGoal / 1000).toFixed(1)} L (7:00 a.m. – 8:30 p.m.)
              </p>
            </div>
          </div>
          <div className="text-right">
            <span className="text-base font-black text-sky-400 tabular-nums">
              {((healthLog.waterMl || 0) / 1000).toFixed(2)} L
            </span>
            <span className="text-xs text-zinc-500"> / {(waterGoal / 1000).toFixed(1)} L</span>
          </div>
        </div>

        <div className="h-2.5 bg-zinc-900 rounded-full overflow-hidden border border-white/5">
          <div
            className="h-full bg-gradient-to-r from-sky-500 to-cyan-400 transition-[width] duration-300 ease-out"
            style={{ width: `${waterPct}%` }}
          />
        </div>

        {isPastWaterCutoff && (
          <div className="bg-amber-950/40 border border-amber-500/30 rounded-xl p-2.5 text-[11px] text-amber-200 flex items-center gap-2">
            <AlertCircle className="size-4 text-amber-400 flex-shrink-0" />
            <span>
              <strong>Corte de agua (8:30 p.m.):</strong> Evita líquidos abundantes ahora para no despertarte a orinar ni fragmentar tu sueño REM.
            </span>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => store.addWater(today, 250)}
            className="py-2 px-3 bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 text-sky-300 rounded-xl text-xs font-bold transition-[background-color,transform] duration-150 enabled:active:scale-[0.96]"
          >
            +250 ml (Vaso)
          </button>
          <button
            type="button"
            onClick={() => store.addWater(today, 500)}
            className="py-2 px-3 bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 rounded-xl text-xs font-bold transition-[background-color,transform] duration-150 enabled:active:scale-[0.96]"
          >
            +500 ml (Termo)
          </button>
          <button
            type="button"
            onClick={() => store.addWater(today, -250)}
            className="py-2 px-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded-xl text-xs font-semibold transition-[background-color,transform] duration-150 enabled:active:scale-[0.96]"
          >
            -250 ml
          </button>
        </div>
      </div>

      {/* ═══ ENTRENAMIENTO DE HOY + PULSO BIOMÉTRICO (ENERGÍA Y PESO) ═══ */}
      <div className="glass-card rounded-3xl p-5 border border-emerald-500/20 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <Dumbbell className="size-4" />
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                {activeSplit.daysLabel}
              </span>
              <h2 className="text-sm font-bold text-white">{activeSplit.title}</h2>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate('/focus?mode=workout')}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-[background-color,transform] duration-150 enabled:active:scale-[0.96] flex-shrink-0"
          >
            {workoutLog.completed ? 'Ver Rutina ✓' : 'Entrenar'}
          </button>
        </div>

        {guard.guardTriggered && guard.reason && (
          <div className="bg-amber-950/40 border border-amber-500/40 rounded-xl p-3 text-xs text-amber-200 flex items-start gap-2">
            <ShieldAlert className="size-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <span>{guard.reason}</span>
          </div>
        )}

        {/* Energía del día (1-10) y Peso Actual (47 -> 54 kg) */}
        <div className="pt-2 border-t border-white/10 grid grid-cols-2 gap-3">
          <div className="bg-zinc-900/80 rounded-2xl p-3 border border-white/5">
            <div className="flex items-center justify-between text-xs text-zinc-400 mb-1.5">
              <span>⚡ Energía Hoy</span>
              <span className="font-bold text-amber-400">
                {healthLog.energyLevel ? `${healthLog.energyLevel}/10` : 'Base 4-5 → Meta 8-9'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-1">
              {[4, 5, 6, 7, 8, 9, 10].map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => store.updateHealthLog(today, { energyLevel: lvl })}
                  className={`flex-1 py-1 rounded-lg text-[11px] font-bold transition-all ${
                    healthLog.energyLevel === lvl
                      ? 'bg-amber-500 text-black'
                      : 'bg-zinc-800 text-zinc-400 hover:text-white'
                  }`}
                >
                  {lvl}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-zinc-900/80 rounded-2xl p-3 border border-white/5 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span className="flex items-center gap-1">
                <Scale className="size-3.5 text-emerald-400" /> Peso
              </span>
              <span className="text-[10px] text-emerald-400 font-semibold">
                Meta {targetWeight} kg
              </span>
            </div>
            {editingWeight ? (
              <div className="flex items-center gap-1.5 mt-1">
                <input
                  type="number"
                  step="0.1"
                  min="35"
                  max="90"
                  value={weightInput}
                  onChange={(e) => setWeightInput(e.target.value)}
                  placeholder={String(currentWeight)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-white"
                />
                <button
                  type="button"
                  onClick={() => {
                    const parsed = parseFloat(weightInput);
                    if (!isNaN(parsed) && parsed > 35 && parsed < 100) {
                      store.updateHealthLog(today, { weightKg: parsed });
                    }
                    setEditingWeight(false);
                  }}
                  className="px-2 py-1 bg-emerald-600 text-white rounded-lg text-xs font-bold"
                >
                  OK
                </button>
              </div>
            ) : (
              <div className="flex items-baseline justify-between mt-1">
                <span className="text-xl font-black text-white tabular-nums">
                  {currentWeight} <span className="text-xs font-normal text-zinc-400">kg</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setWeightInput(String(currentWeight));
                    setEditingWeight(true);
                  }}
                  className="text-[11px] text-emerald-400 underline hover:text-emerald-300"
                >
                  Actualizar
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick Action Navigation Grid */}
      <div className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400 px-1">
          Acceso Rápido
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => navigate('/planner')}
            className="glass-card glass-card-hover rounded-2xl p-4 text-left group enabled:active:scale-[0.96]"
          >
            <div className="size-9 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center mb-2.5 group-hover:scale-110 transition-transform">
              <Calendar className="size-5" />
            </div>
            <div className="font-bold text-sm text-white">Planificador</div>
            <div className="text-[11px] text-zinc-400">Horario SENA y bloques</div>
          </button>

          <button
            onClick={() => navigate('/metrics')}
            className="glass-card glass-card-hover rounded-2xl p-4 text-left group enabled:active:scale-[0.96]"
          >
            <div className="size-9 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center mb-2.5 group-hover:scale-110 transition-transform">
              <BarChart3 className="size-5" />
            </div>
            <div className="font-bold text-sm text-white">Métricas y Cuerpo</div>
            <div className="text-[11px] text-zinc-400">Peso, energía y balance 2:1</div>
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
              Ve al Planificador y presiona <strong>"Planificar Día" ✨</strong> para armar tu rutina de 7:00 a.m. a 10:30 p.m.
            </p>
          </div>
        </div>
      )}

      {/* ═══ MODAL DE SUSTITUCIÓN DE COMIDAS CON IA ("CON LO QUE TENGO EN CASA") ═══ */}
      {adaptingMeal && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-purple-500/40 rounded-3xl p-5 max-w-md w-full space-y-4 max-h-[88vh] overflow-y-auto overscroll-contain">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-purple-400 flex items-center gap-1">
                  <Sparkles className="size-3" /> Nutricionista IA · Volumen Limpio
                </span>
                <h3 className="text-lg font-black text-white mt-0.5">
                  Suplementar {MEAL_PROTOCOL[adaptingMeal].name}
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Marca o escribe qué tienes en la cocina ahora mismo y te armo el reemplazo exacto ({MEAL_PROTOCOL[adaptingMeal].targetProtein}).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAdaptingMeal(null)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-zinc-300">
                1. Toca lo que sí tienes disponible hoy:
              </label>
              <div className="flex flex-wrap gap-1.5">
                {HOME_INGREDIENTS.map((ing) => {
                  const active = selectedIngredients.includes(ing);
                  return (
                    <button
                      key={ing}
                      type="button"
                      onClick={() => toggleIngredientChip(ing)}
                      className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition-[background-color,border-color,color] duration-150 ${
                        active
                          ? 'bg-purple-600 text-white border-purple-400 shadow-sm'
                          : 'bg-zinc-800/90 text-zinc-300 border-zinc-700 hover:border-zinc-500'
                      }`}
                    >
                      {active ? `✓ ${ing}` : ing}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-zinc-300">
                2. O cuéntale a la IA qué hay o qué te falta (opcional):
              </label>
              <textarea
                rows={2}
                value={customKitchenNote}
                onChange={(e) => setCustomKitchenNote(e.target.value)}
                placeholder="Ej: Solo me quedan 2 huevos, no tengo arepa pero quedó arroz y lentejas de mi mamá..."
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                disabled={isGeneratingMeal}
                onClick={handleGenerateMealReplacement}
                className="flex-1 py-3 bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-700 rounded-xl font-bold text-xs text-white flex items-center justify-center gap-2 transition-[background-color,transform] duration-150 enabled:active:scale-[0.96]"
              >
                {isGeneratingMeal ? (
                  <>
                    <Loader2 className="size-4 motion-safe:animate-spin" /> Calculando porciones...
                  </>
                ) : (
                  <>
                    <Sparkles className="size-4" /> Armar mi plato sustituto
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setAdaptingMeal(null)}
                className="px-4 py-3 bg-zinc-800 hover:bg-zinc-700 enabled:active:scale-[0.96] rounded-xl font-semibold text-xs text-zinc-300 transition-[background-color,transform] duration-150"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
