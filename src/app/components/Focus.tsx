import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { store } from '../lib/store';
import {
  Block,
  DailyHealthLog,
  DailyWorkoutLog,
  SleepChecklistState,
  WorkoutSplitType,
} from '../lib/types';
import {
  getBlockLabel,
  formatCountdown,
  formatTo12h,
  todayStr,
  cleanBlockLabel,
} from '../lib/helpers';
import { WORKOUT_SPLITS } from '../lib/personal-protocol';
import {
  X,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Timer,
  Dumbbell,
  ShieldAlert,
  Backpack,
  Moon,
  Sparkles,
  Check,
  RefreshCw,
} from 'lucide-react';

export function Focus() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const forceWorkoutMode = searchParams.get('mode') === 'workout';

  const today = todayStr();
  const [currentBlock, setCurrentBlock] = useState<Block | null>(() => store.getCurrentBlock());
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [showExitWarning, setShowExitWarning] = useState(false);
  const [blockFinished, setBlockFinished] = useState(false);

  // Estado de Calistenia y Salud
  const [workoutLog, setWorkoutLog] = useState<DailyWorkoutLog>(() => store.getWorkoutLog(today));
  const [healthLog, setHealthLog] = useState<DailyHealthLog>(() => store.getHealthLog(today));
  const [manualView, setManualView] = useState<'auto' | 'workout' | 'sleep'>(
    forceWorkoutMode ? 'workout' : 'auto'
  );

  // Temporizador de Escudo Postural (cada 45 min sentado en PC)
  const postureIntervalSecs = (store.getSettings().postureReminderMinutes ?? 45) * 60;
  const [postureSecsLeft, setPostureSecsLeft] = useState<number>(postureIntervalSecs);
  const [postureDue, setPostureDue] = useState(false);

  // Sincronizar con el store
  useEffect(() => {
    const syncState = () => {
      const d = todayStr();
      setCurrentBlock(store.getCurrentBlock());
      setWorkoutLog(store.getWorkoutLog(d));
      setHealthLog(store.getHealthLog(d));
    };

    syncState();
    const unsub = store.subscribe(syncState);
    return () => unsub();
  }, []);

  // Manejar temporizador cuando hay un bloque activo
  useEffect(() => {
    if (!currentBlock) {
      setTimeRemaining(0);
      setBlockFinished(false);
      return;
    }

    const calcRemaining = () => {
      const now = new Date();
      const [endHour, endMinute] = currentBlock.endTime.split(':').map(Number);
      const endTime = new Date();
      endTime.setHours(endHour, endMinute, 0, 0);
      return Math.max(0, Math.floor((endTime.getTime() - now.getTime()) / 1000));
    };

    const initialRem = calcRemaining();
    setTimeRemaining(initialRem);
    if (initialRem === 0) {
      setBlockFinished(true);
      if (currentBlock.type === 'rest' && currentBlock.status !== 'completed') {
        store.updateBlock(currentBlock.id, { status: 'completed' });
      }
    } else {
      setBlockFinished(false);
    }

    const interval = setInterval(() => {
      const remaining = calcRemaining();
      setTimeRemaining(remaining);
      if (remaining === 0) {
        setBlockFinished(true);
        clearInterval(interval);
        if (currentBlock.type === 'rest' && currentBlock.status !== 'completed') {
          store.updateBlock(currentBlock.id, { status: 'completed' });
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [currentBlock?.id, currentBlock?.endTime, currentBlock?.type, currentBlock?.status]);

  // Temporizador de micro-pausa postural para bloques de PC (deep / light)
  useEffect(() => {
    if (!currentBlock || (currentBlock.type !== 'deep' && currentBlock.type !== 'light')) {
      return;
    }
    const timer = setInterval(() => {
      setPostureSecsLeft((prev) => {
        if (prev <= 1) {
          setPostureDue(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [currentBlock?.id, currentBlock?.type]);

  const handleComplete = () => {
    if (currentBlock) {
      store.updateBlock(currentBlock.id, { status: 'completed' });
      navigate('/');
    } else if (manualView === 'workout') {
      store.saveWorkoutLog(today, { ...workoutLog, completed: true });
      navigate('/');
    }
  };

  const handleFail = () => {
    if (currentBlock) {
      store.updateBlock(currentBlock.id, { status: 'failed' });
      navigate('/');
    }
  };

  const handleExit = () => {
    if (currentBlock?.type === 'deep' && !blockFinished) {
      setShowExitWarning(true);
    } else {
      navigate('/');
    }
  };

  const confirmExit = () => {
    if (currentBlock) {
      store.updateBlock(currentBlock.id, {
        interruptions: (currentBlock.interruptions ?? 0) + 1,
      });
    }
    navigate('/');
  };

  // Helpers para actualizar entrenamiento de Calistenia
  const changeSplit = (newSplit: WorkoutSplitType) => {
    const splitDef = WORKOUT_SPLITS[newSplit];
    const nextExercises = { ...workoutLog.exercises };
    for (const ex of splitDef.exercises) {
      if (!nextExercises[ex.id]) {
        nextExercises[ex.id] = {
          setsDone: 0,
          repsAchieved: ex.reps,
          backpackWeightNote: ex.usesBackpack ? `${workoutLog.backpackWeightKg} kg en morral` : '',
        };
      }
    }
    store.saveWorkoutLog(today, {
      ...workoutLog,
      splitType: newSplit,
      exercises: nextExercises,
    });
  };

  const toggleExerciseSet = (exId: string, setNumber: number, totalSets: number) => {
    const currentEx = workoutLog.exercises[exId] ?? {
      setsDone: 0,
      repsAchieved: '',
      backpackWeightNote: '',
    };
    const nextSetsDone = currentEx.setsDone === setNumber ? setNumber - 1 : setNumber;
    const nextExercises = {
      ...workoutLog.exercises,
      [exId]: {
        ...currentEx,
        setsDone: Math.max(0, Math.min(totalSets, nextSetsDone)),
      },
    };
    const splitDef = WORKOUT_SPLITS[workoutLog.splitType];
    const allDone = splitDef.exercises.every(
      (e) => (nextExercises[e.id]?.setsDone ?? 0) >= e.sets
    );
    store.saveWorkoutLog(today, {
      ...workoutLog,
      completed: allDone ? true : workoutLog.completed,
      exercises: nextExercises,
    });
  };

  const updateExerciseReps = (exId: string, repsAchieved: string) => {
    const currentEx = workoutLog.exercises[exId] ?? {
      setsDone: 0,
      repsAchieved: '',
      backpackWeightNote: '',
    };
    store.saveWorkoutLog(today, {
      ...workoutLog,
      exercises: {
        ...workoutLog.exercises,
        [exId]: { ...currentEx, repsAchieved },
      },
    });
  };

  const adjustBackpackWeight = (deltaKg: number) => {
    const nextKg = Math.max(0, Math.min(30, Number((workoutLog.backpackWeightKg + deltaKg).toFixed(1))));
    store.saveWorkoutLog(today, {
      ...workoutLog,
      backpackWeightKg: nextKg,
    });
  };

  const guard = store.getBiomechanicalGuard(today);
  const splitDef = WORKOUT_SPLITS[workoutLog.splitType];
  const isSleepBlock =
    manualView === 'sleep' ||
    (currentBlock?.label ?? '').toLowerCase().includes('protocolo de sueño') ||
    (currentBlock?.label ?? '').toLowerCase().includes('desconexión');
  const isWorkoutView =
    manualView === 'workout' || currentBlock?.type === 'exercise';

  // Si no hay bloque activo y no se abrió el entrenador ni protocolo de sueño
  if (!currentBlock && manualView === 'auto') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center space-y-5 max-w-sm w-full">
          <div className="size-16 bg-zinc-800 rounded-full flex items-center justify-center mx-auto">
            <Timer className="size-8 text-zinc-400" />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-bold">Sin Bloque Activo en Curso</h2>
            <p className="text-zinc-400 text-xs">
              Puedes abrir tu entrenador de Calistenia y Escoliosis de hoy o tu checklist nocturno en cualquier momento:
            </p>
          </div>

          <div className="space-y-2.5">
            <button
              onClick={() => setManualView('workout')}
              className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-500 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-95"
            >
              <Dumbbell className="size-4" />
              Abrir Calistenia de Hoy ({splitDef.shortTitle})
            </button>
            <button
              onClick={() => setManualView('sleep')}
              className="w-full py-3 px-4 bg-indigo-600/30 hover:bg-indigo-600/40 border border-indigo-500/40 text-indigo-200 rounded-2xl font-semibold text-xs flex items-center justify-center gap-2 transition-all active:scale-95"
            >
              <Moon className="size-4" />
              Checklist de Sueño y Postura (10:00 p.m.)
            </button>
            <button
              onClick={() => navigate('/')}
              className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 rounded-2xl font-semibold text-xs text-zinc-300 transition-colors"
            >
              Volver al Inicio
            </button>
          </div>
        </div>
      </div>
    );
  }

  const totalSecs = (currentBlock?.duration ?? 50) * 60;
  const progress = currentBlock
    ? Math.min(100, Math.max(0, ((totalSecs - timeRemaining) / totalSecs) * 100))
    : 0;

  const circleRadius = 92;
  const circleCircumference = 2 * Math.PI * circleRadius;
  const circleStrokeOffset = circleCircumference - (progress / 100) * circleCircumference;

  const SLEEP_ITEMS: Array<{ key: keyof SleepChecklistState; title: string; detail: string }> = [
    {
      key: 'waterCut830',
      title: 'Corte de líquidos abundantes (8:30 p.m.)',
      detail: 'Evita despertarte en la madrugada a orinar y protege tu fase REM.',
    },
    {
      key: 'blueLightOff',
      title: 'Luz cálida (9:00 p.m.) y cero pantallas (10:00 p.m.)',
      detail: 'Permite que tu cerebro libere melatonina y te duermas en menos de 15 minutos.',
    },
    {
      key: 'nasalWash',
      title: 'Lavado nasal con solución salina (si hay congestión)',
      detail: 'Evita respirar por la boca, roncar y amanecer con la boca seca.',
    },
    {
      key: 'singleAlarmFar',
      title: '1 sola alarma a las 7:00 a.m. con celular lejos',
      detail: 'Prohibido poner múltiples alarmas que fragmenten tu última fase de sueño.',
    },
    {
      key: 'sideOrBackPosture',
      title: 'Postura de escoliosis: De lado (almohada en rodillas) o boca arriba',
      detail: 'PROHIBIDO dormir boca abajo (gira tu cuello 90° y arquea la zona lumbar).',
    },
  ];

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col justify-between p-5 pb-28 relative overflow-x-hidden select-none">
      {/* Ambient background glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className={`absolute -top-32 left-1/2 -translate-x-1/2 w-96 h-96 rounded-full blur-[120px] opacity-25 ${
            isWorkoutView
              ? 'bg-emerald-500'
              : isSleepBlock
                ? 'bg-indigo-500'
                : currentBlock?.type === 'deep'
                  ? 'bg-red-600'
                  : 'bg-teal-500'
          }`}
        />
      </div>

      {/* Top Bar Header */}
      <div className="relative z-10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`size-2.5 rounded-full ${
              isWorkoutView
                ? 'bg-emerald-400 animate-ping'
                : currentBlock?.type === 'deep'
                  ? 'bg-red-500 animate-ping'
                  : 'bg-sky-400'
            }`}
          />
          <span className="text-xs font-black uppercase tracking-widest text-zinc-300">
            {isWorkoutView
              ? `Calistenia · ${splitDef.shortTitle}`
              : isSleepBlock
                ? 'Protocolo de Sueño y Escoliosis'
                : cleanBlockLabel(currentBlock?.label) || getBlockLabel(currentBlock?.type ?? 'deep')}
          </span>
        </div>
        <button
          onClick={handleExit}
          className="size-9 rounded-full glass-card hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white transition-all active:scale-95"
          aria-label="Salir"
        >
          <X className="size-5" />
        </button>
      </div>

      {/* ═══ VISTA 1: ENTRENADOR INTERACTIVO DE CALISTENIA, HIPERTROFIA Y POSTURA ═══ */}
      {isWorkoutView ? (
        <div className="relative z-10 my-4 space-y-4">
          {/* Timer compacto si hay bloque activo */}
          {currentBlock && (
            <div className="glass-card rounded-2xl p-3.5 border border-emerald-500/30 flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-emerald-400 font-bold">
                  Sesión Única Efectiva (45–60 min)
                </div>
                <div className="text-2xl font-mono font-black text-white tabular-nums">
                  {formatCountdown(timeRemaining)}
                </div>
              </div>
              <div className="text-right text-xs text-zinc-400 font-mono">
                {formatTo12h(currentBlock.startTime)} – {formatTo12h(currentBlock.endTime)}
              </div>
            </div>
          )}

          {/* Selector de Split + Guardia Biomecánica 2:1 */}
          <div className="glass-card rounded-2xl p-4 border border-white/10 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                  {splitDef.daysLabel}
                </span>
                <h2 className="text-base font-black text-white">{splitDef.title}</h2>
                <p className="text-xs text-zinc-400">{splitDef.subtitle}</p>
              </div>
            </div>

            {/* Selector rápido para cambiar el día de entrenamiento */}
            <div className="grid grid-cols-4 gap-1.5 pt-1">
              {(['push', 'pull', 'legs', 'rest'] as WorkoutSplitType[]).map((sp) => (
                <button
                  key={sp}
                  type="button"
                  onClick={() => changeSplit(sp)}
                  className={`py-1.5 px-2 rounded-xl text-[11px] font-bold border transition-all ${
                    workoutLog.splitType === sp
                      ? 'bg-emerald-600 text-white border-emerald-400'
                      : 'bg-zinc-900 text-zinc-400 border-white/5 hover:text-white'
                  }`}
                >
                  {sp === 'push'
                    ? 'Empuje'
                    : sp === 'pull'
                      ? 'Tracción 2:1'
                      : sp === 'legs'
                        ? 'Piernas/Core'
                        : 'Movilidad'}
                </button>
              ))}
            </div>

            {guard.guardTriggered && guard.reason && (
              <div className="bg-amber-950/50 border border-amber-500/40 rounded-xl p-2.5 text-xs text-amber-200 flex items-start gap-2">
                <ShieldAlert className="size-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <span>{guard.reason}</span>
                  {workoutLog.splitType !== 'pull' && (
                    <button
                      type="button"
                      onClick={() => changeSplit('pull')}
                      className="block mt-1 text-amber-300 underline font-bold"
                    >
                      Cambiar hoy a Tracción y Escoliosis →
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Control de Carga Progresiva (Morral con libros/botellas) */}
            <div className="bg-zinc-900/90 border border-white/10 rounded-xl p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Backpack className="size-4 text-emerald-400" />
                <div>
                  <div className="text-xs font-bold text-white">Lastre en Morral (Progresión)</div>
                  <div className="text-[10px] text-zinc-400">
                    Libros o botellas de agua para hipertrofia
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => adjustBackpackWeight(-0.5)}
                  className="size-7 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white font-bold text-sm"
                >
                  -
                </button>
                <span className="text-sm font-black font-mono text-emerald-400 min-w-[3.5rem] text-center">
                  {workoutLog.backpackWeightKg} kg
                </span>
                <button
                  type="button"
                  onClick={() => adjustBackpackWeight(0.5)}
                  className="size-7 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm"
                >
                  +
                </button>
              </div>
            </div>

            <div className="text-[11px] text-emerald-200/90 bg-emerald-950/40 border border-emerald-500/25 rounded-xl p-2.5">
              🩺 {splitDef.medicalWarning}
            </div>
          </div>

          {/* Lista Interactiva de Ejercicios Serie por Serie */}
          <div className="space-y-2.5">
            {splitDef.exercises.map((ex, idx) => {
              const exLog = workoutLog.exercises[ex.id] ?? {
                setsDone: 0,
                repsAchieved: ex.reps,
                backpackWeightNote: '',
              };
              const isExCompleted = exLog.setsDone >= ex.sets;

              return (
                <div
                  key={ex.id}
                  className={`rounded-2xl p-4 border transition-all space-y-2.5 ${
                    isExCompleted
                      ? 'bg-emerald-950/30 border-emerald-500/40'
                      : 'bg-zinc-900/90 border-white/10'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                        Ejercicio {idx + 1} · Descanso {ex.restSeconds}s
                      </span>
                      <h3 className="text-sm font-bold text-white">{ex.name}</h3>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex-shrink-0">
                      {ex.sets} × {ex.reps}
                    </span>
                  </div>

                  {ex.tempo && (
                    <div className="text-[11px] text-amber-300 font-semibold">
                      ⏱ Tempo: {ex.tempo} · 🎒 {ex.equipment}
                    </div>
                  )}

                  <p className="text-xs text-zinc-300 leading-relaxed">{ex.clinicalNote}</p>

                  {/* Botones de Series (S1, S2, S3, S4) */}
                  <div className="flex items-center gap-2 pt-1">
                    {Array.from({ length: ex.sets }, (_, i) => i + 1).map((setNum) => {
                      const done = exLog.setsDone >= setNum;
                      return (
                        <button
                          key={setNum}
                          type="button"
                          onClick={() => toggleExerciseSet(ex.id, setNum, ex.sets)}
                          className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all active:scale-95 flex items-center justify-center gap-1 ${
                            done
                              ? 'bg-emerald-600 text-white border-emerald-400 shadow-sm'
                              : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-white'
                          }`}
                        >
                          {done && <Check className="size-3 stroke-[3]" />}
                          Serie {setNum}
                        </button>
                      );
                    })}
                  </div>

                  {/* Nota de repeticiones logradas */}
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-[11px] text-zinc-400 whitespace-nowrap">
                      Reps / Nota:
                    </span>
                    <input
                      type="text"
                      value={exLog.repsAchieved}
                      onChange={(e) => updateExerciseReps(ex.id, e.target.value)}
                      placeholder={ex.reps}
                      className="w-full bg-zinc-950/70 border border-white/10 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : isSleepBlock ? (
        /* ═══ VISTA 2: CHECKLIST DE CRONOBIOLOGÍA Y POSTURA DE SUEÑO (10:00 P.M.) ═══ */
        <div className="relative z-10 my-auto space-y-4 py-4">
          <div className="glass-card rounded-3xl p-5 border border-indigo-500/30 space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="size-10 rounded-2xl bg-indigo-500/20 text-indigo-300 flex items-center justify-center">
                <Moon className="size-5" />
              </div>
              <div>
                <h2 className="text-lg font-black text-white">
                  Protocolo Nocturno (10:00 p.m. → 7:00 a.m.)
                </h2>
                <p className="text-xs text-zinc-400">
                  Hormona de crecimiento al máximo + Alineación de escoliosis
                </p>
              </div>
            </div>

            <div className="space-y-2.5 pt-2">
              {SLEEP_ITEMS.map((item) => {
                const checked = !!healthLog.sleepChecklist?.[item.key];
                return (
                  <div
                    key={item.key}
                    onClick={() => store.toggleSleepCheckItem(today, item.key)}
                    className={`cursor-pointer p-3.5 rounded-2xl border transition-all flex items-start gap-3 ${
                      checked
                        ? 'bg-indigo-950/40 border-indigo-500/50 text-white'
                        : 'bg-zinc-900/80 border-white/10 text-zinc-300'
                    }`}
                  >
                    <div
                      className={`size-5 rounded-lg border flex items-center justify-center flex-shrink-0 mt-0.5 ${
                        checked
                          ? 'bg-indigo-500 border-indigo-400 text-white'
                          : 'border-zinc-600 bg-zinc-800'
                      }`}
                    >
                      {checked && <Check className="size-3.5 stroke-[3]" />}
                    </div>
                    <div>
                      <div className="text-xs font-bold">{item.title}</div>
                      <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">
                        {item.detail}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        /* ═══ VISTA 3: MODO ENFOQUE DE ESTUDIO CON ESCUDO POSTURAL ANTI-ESCOLIOSIS ═══ */
        <div className="relative z-10 flex flex-col items-center justify-center my-auto space-y-5 py-4">
          {/* Circular Countdown Gauge */}
          <div className="relative flex items-center justify-center">
            <svg className="size-60 -rotate-90 transform drop-shadow-2xl">
              <circle
                cx="120"
                cy="120"
                r={circleRadius}
                className="text-zinc-900"
                strokeWidth="9"
                stroke="currentColor"
                fill="transparent"
              />
              <circle
                cx="120"
                cy="120"
                r={circleRadius}
                className="transition-all duration-1000 ease-linear"
                strokeWidth="9"
                strokeDasharray={circleCircumference}
                strokeDashoffset={circleStrokeOffset}
                strokeLinecap="round"
                stroke={currentBlock?.type === 'deep' ? '#ef4444' : '#14b8a6'}
                fill="transparent"
              />
            </svg>

            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <div
                className={`text-5xl font-mono font-black tracking-tight tabular-nums drop-shadow-lg ${
                  blockFinished ? 'text-emerald-400 animate-pulse' : 'text-white'
                }`}
              >
                {formatCountdown(timeRemaining)}
              </div>
              {currentBlock && (
                <div className="text-xs font-mono text-zinc-400 mt-1">
                  {formatTo12h(currentBlock.startTime)} – {formatTo12h(currentBlock.endTime)}
                </div>
              )}
              <div className="text-[11px] font-semibold text-zinc-400 mt-1 uppercase tracking-wider">
                {Math.round(progress)}% completado
              </div>
            </div>
          </div>

          {/* Task Info Card */}
          <div className="text-center space-y-1.5 max-w-sm px-4">
            <h2 className="text-xl font-black text-white leading-tight">
              {currentBlock?.task?.subject || cleanBlockLabel(currentBlock?.label) || 'Bloque de enfoque'}
            </h2>
            {currentBlock?.task?.description && (
              <p className="text-zinc-400 text-xs line-clamp-2">
                {currentBlock.task.description}
              </p>
            )}
          </div>

          {/* Escudo Postural Anti-Escoliosis (para las 6 horas de PC) */}
          {(currentBlock?.type === 'deep' || currentBlock?.type === 'light') && (
            <div
              className={`w-full max-w-sm rounded-2xl p-4 border transition-all space-y-2 ${
                postureDue
                  ? 'bg-amber-950/60 border-amber-500/60 animate-pulse'
                  : 'glass-card border-teal-500/30'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-teal-300 flex items-center gap-1.5">
                  <Sparkles className="size-3.5" /> Escudo Postural (Escoliosis · PC)
                </span>
                <span className="text-xs font-mono text-zinc-300">
                  {postureDue
                    ? '¡PAUSA AHORA!'
                    : `Próxima pausa: ${formatCountdown(postureSecsLeft)}`}
                </span>
              </div>
              <p className="text-[11px] text-zinc-300 leading-relaxed">
                {postureDue
                  ? '⚠️ Llevas 45 min sentado: Ponte de pie 60 seg, abre el pecho y junta las escápulas atrás (Y-T-W) para descomprimir tu escoliosis.'
                  : 'Mantén los hombros atrás y abajo, pantalla a la altura de los ojos y ambos pies apoyados en el suelo.'}
              </p>
              <div className="flex items-center justify-between pt-1">
                <span className="text-[10px] text-zinc-400">
                  Pausas posturales hoy: <strong>{healthLog.postureBreaksCount ?? 0}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    store.incrementPostureBreak(today);
                    setPostureDue(false);
                    setPostureSecsLeft(postureIntervalSecs);
                  }}
                  className="px-3 py-1.5 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-xs font-bold flex items-center gap-1 transition-all active:scale-95"
                >
                  <RefreshCw className="size-3" /> Hice retracción escapular (60s)
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bottom Action Buttons */}
      <div className="relative z-10 space-y-3 pt-3">
        {currentBlock?.type === 'rest' && !isSleepBlock ? (
          <button
            onClick={() => navigate('/')}
            className="w-full py-4 bg-zinc-800 hover:bg-zinc-700 active:scale-98 rounded-2xl font-bold text-base transition-all shadow-lg"
          >
            Volver al Inicio
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={handleComplete}
              className="py-4 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white rounded-2xl font-bold text-base flex items-center justify-center gap-2 transition-all shadow-lg glow-emerald"
            >
              <CheckCircle2 className="size-5" />
              {isWorkoutView ? 'Finalizar Entreno' : 'Completado'}
            </button>
            <button
              onClick={() => (currentBlock ? handleFail() : navigate('/'))}
              className="py-4 bg-zinc-900 hover:bg-zinc-800 active:scale-95 border border-white/10 text-zinc-300 rounded-2xl font-bold text-base flex items-center justify-center gap-2 transition-all"
            >
              <XCircle className="size-5 text-red-400" />
              {currentBlock ? 'No cumplí' : 'Cerrar'}
            </button>
          </div>
        )}
      </div>

      {/* Exit Warning Modal */}
      {showExitWarning && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center p-6 z-50 animate-in fade-in">
          <div className="glass-card rounded-3xl p-6 max-w-sm w-full space-y-4 border border-red-500/30 glow-red">
            <div className="flex items-start gap-3.5">
              <div className="p-2.5 bg-red-500/20 rounded-2xl flex-shrink-0">
                <AlertTriangle className="size-6 text-red-400" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-black text-white">¿Interrumpir Bloque?</h3>
                <p className="text-zinc-400 text-xs leading-relaxed">
                  Estás en un bloque profundo. Salir registrará una interrupción y afectará tu disciplina diaria.
                </p>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowExitWarning(false)}
                className="flex-1 py-3 bg-red-600 hover:bg-red-500 rounded-xl font-bold text-sm transition-all active:scale-95 shadow-md glow-red"
              >
                Continuar
              </button>
              <button
                onClick={confirmExit}
                className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-semibold text-sm transition-all active:scale-95"
              >
                Salir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
