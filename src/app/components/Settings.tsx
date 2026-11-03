import { useState, useEffect, useRef } from 'react';
import { store } from '../lib/store';
import { notificationService } from '../lib/notifications';
import { validateApiKey, sanitizeApiKey } from '../lib/ai-engine';
import type { AIProvider } from '../lib/ai-engine';
import { UserSettings, WorkoutSlot } from '../lib/types';
import {
  Save,
  Moon,
  Sun,
  Zap,
  Dumbbell,
  Smartphone,
  Bell,
  RotateCcw,
  Brain,
  Eye,
  EyeOff,
  Loader2,
  Utensils,
  Droplets,
  Scale,
  Clock,
  Sparkles,
  ExternalLink,
  AlertTriangle,
} from 'lucide-react';

export function Settings() {
  const [settings, setSettings] = useState<UserSettings>(store.getSettings());
  const [saved, setSaved] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [validatingKey, setValidatingKey] = useState(false);
  const [keyStatus, setKeyStatus] = useState<'idle' | 'valid' | 'invalid'>('idle');
  const [keyError, setKeyError] = useState<string | null>(null);
  const isEditingRef = useRef(false);

  useEffect(() => {
    setNotificationsEnabled(notificationService.hasPermission());
    const unsubStore = store.subscribe(() => {
      if (!isEditingRef.current) {
        setSettings(store.getSettings());
      }
    });
    return () => unsubStore();
  }, []);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    isEditingRef.current = false;
    if (settings.wakeTime >= settings.sleepTime) {
      alert('La hora de despertar debe ser anterior a la hora de dormir.');
      return;
    }
    if (settings.dailyDeepBlocksMin > settings.dailyDeepBlocksMax) {
      alert('El mínimo de bloques profundos no puede ser mayor que el máximo.');
      return;
    }
    store.updateSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleReset = () => {
    if (confirm('¿Restablecer todos los ajustes a los valores por defecto del protocolo clínico?')) {
      store.resetSettings();
      setSettings(store.getSettings());
      isEditingRef.current = false;
    }
  };

  const handleEnableNotifications = async () => {
    const granted = await notificationService.requestPermission();
    setNotificationsEnabled(granted);
    if (granted) {
      store.getTodayBlocks().forEach((block) => notificationService.scheduleBlockNotifications(block));
    }
  };

  const testNotification = () => {
    if (notificationsEnabled) {
      notificationService.sendNotification('🎯 Notificación de Prueba · FocusOS', {
        body: 'Notificaciones activas para bloques, comidas y postura.',
      });
    }
  };

  const update = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    isEditingRef.current = true;
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const updateMealTime = (mealKey: 'breakfast' | 'postWorkout' | 'senaLunch' | 'dinner', value: string) => {
    isEditingRef.current = true;
    setSettings((prev) => ({
      ...prev,
      mealTimes: {
        breakfast: prev.mealTimes?.breakfast ?? '07:30',
        postWorkout: prev.mealTimes?.postWorkout ?? '10:30',
        senaLunch: prev.mealTimes?.senaLunch ?? '14:00',
        dinner: prev.mealTimes?.dinner ?? '20:00',
        [mealKey]: value,
      },
    }));
  };

  return (
    <div className="p-6 space-y-5 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Configuración</h1>
          <p className="text-zinc-400 text-sm">Personalizado a tu diagnóstico y rutina</p>
        </div>
        <button
          type="button"
          onClick={handleReset}
          className="p-2 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors"
          title="Restablecer valores del protocolo"
        >
          <RotateCcw className="size-5" />
        </button>
      </div>

      <form onSubmit={handleSave} className="space-y-5">
        {/* ═══ ENTRENAMIENTO & REGLA BIOMECÁNICA 2:1 ═══ */}
        <div className="bg-gradient-to-br from-green-900/25 to-emerald-950/30 border border-green-700/40 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2 text-emerald-300">
              <Dumbbell className="size-4 text-emerald-400" /> Calistenia, Hipertrofia y Postura
            </h3>
            <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/30">
              Regla 2:1 Activa
            </span>
          </div>
          <p className="text-xs text-zinc-300 leading-relaxed">
            Una sola sesión intensa de 50 min al día (prohibido hacer doble jornada para no quemar calorías con IMC 17.47).
          </p>

          {/* Turno de Entrenamiento (Configurable a futuro como pediste en Q1) */}
          <div>
            <label className="block text-sm text-zinc-300 mb-2 font-medium">
              Turno diario de entrenamiento:
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => update('workoutSlot', 'morning')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  (settings.workoutSlot ?? 'morning') === 'morning'
                    ? 'bg-emerald-600/30 border-emerald-400 text-white shadow-sm'
                    : 'bg-zinc-800/80 border-zinc-700 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <div className="font-bold text-xs flex items-center gap-1.5">
                  <Sun className="size-3.5 text-amber-400" /> Mañana (09:00 – 09:50)
                </div>
                <div className="text-[10px] text-zinc-400 mt-1">
                  1.5h tras desayuno. Bloques profundos van en la noche.
                </div>
              </button>

              <button
                type="button"
                onClick={() => update('workoutSlot', 'evening')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  settings.workoutSlot === 'evening'
                    ? 'bg-emerald-600/30 border-emerald-400 text-white shadow-sm'
                    : 'bg-zinc-800/80 border-zinc-700 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <div className="font-bold text-xs flex items-center gap-1.5">
                  <Moon className="size-3.5 text-indigo-400" /> Tarde (18:45 – 19:35)
                </div>
                <div className="text-[10px] text-zinc-400 mt-1">
                  Al volver del SENA. Bloques profundos van en la mañana.
                </div>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-1">
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">Duración sesión (min)</label>
              <input
                type="number"
                min="35"
                max="65"
                step="5"
                value={settings.exerciseDuration ?? 50}
                onChange={(e) => update('exerciseDuration', parseInt(e.target.value))}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-white text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">Pausa postura PC (min)</label>
              <input
                type="number"
                min="30"
                max="60"
                step="5"
                value={settings.postureReminderMinutes ?? 45}
                onChange={(e) => update('postureReminderMinutes', parseInt(e.target.value))}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-white text-sm"
              />
            </div>
          </div>
        </div>

        {/* ═══ NUTRICIÓN: LAS 4 COMIDAS CASERAS & HIDRATACIÓN ═══ */}
        <div className="bg-gradient-to-br from-orange-950/30 to-amber-950/20 border border-orange-800/35 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2 text-orange-300">
              <Utensils className="size-4 text-orange-400" /> Plan Nutricional (~2,400 kcal)
            </h3>
            <span className="text-[10px] font-bold text-orange-400 font-mono">
              90–100g proteína
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">1. Desayuno (Mín. 3 huevos)</label>
              <input
                type="time"
                value={settings.mealTimes?.breakfast ?? '07:30'}
                onChange={(e) => updateMealTime('breakfast', e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-white text-xs"
              />
            </div>

            <div>
              <label className="block text-xs text-zinc-400 mb-1">2. Post-Entreno (Pre-SENA)</label>
              <input
                type="time"
                value={settings.mealTimes?.postWorkout ?? '10:30'}
                onChange={(e) => updateMealTime('postWorkout', e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-white text-xs"
              />
            </div>

            <div>
              <label className="block text-xs text-zinc-400 mb-1">3. Almuerzo Pausa SENA</label>
              <input
                type="time"
                value={settings.mealTimes?.senaLunch ?? '14:00'}
                onChange={(e) => updateMealTime('senaLunch', e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-white text-xs"
              />
            </div>

            <div>
              <label className="block text-xs text-zinc-400 mb-1">4. Cena (Corte agua 8:30)</label>
              <input
                type="time"
                value={settings.mealTimes?.dinner ?? '20:00'}
                onChange={(e) => updateMealTime('dinner', e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-white text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 pt-1 border-t border-white/5">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Peso actual (kg)</label>
              <input
                type="number"
                step="0.1"
                min="35"
                max="90"
                value={settings.currentWeightKg ?? 47}
                onChange={(e) => update('currentWeightKg', parseFloat(e.target.value))}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-white text-xs"
              />
            </div>

            <div>
              <label className="block text-xs text-zinc-400 mb-1">Peso meta (kg)</label>
              <input
                type="number"
                step="0.5"
                min="45"
                max="80"
                value={settings.targetWeightKg ?? 54}
                onChange={(e) => update('targetWeightKg', parseFloat(e.target.value))}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-white text-xs"
              />
            </div>

            <div>
              <label className="block text-xs text-zinc-400 mb-1">Agua diaria (ml)</label>
              <input
                type="number"
                step="100"
                min="1500"
                max="4000"
                value={settings.waterGoalMl ?? 2500}
                onChange={(e) => update('waterGoalMl', parseInt(e.target.value))}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-white text-xs"
              />
            </div>
          </div>
        </div>

        {/* ═══ CRONOBIOLOGÍA Y HORARIO SENA ═══ */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Sun className="size-4 text-yellow-500" /> Cronobiología & Horario SENA
          </h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Despertar (1 alarma)</label>
              <input
                type="time"
                value={settings.wakeTime}
                onChange={(e) => update('wakeTime', e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Dormir (Fase REM)</label>
              <input
                type="time"
                value={settings.sleepTime}
                onChange={(e) => update('sleepTime', e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Entrada SENA</label>
              <input
                type="time"
                value={settings.scheduleStartTime}
                onChange={(e) => update('scheduleStartTime', e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Salida SENA</label>
              <input
                type="time"
                value={settings.scheduleEndTime}
                onChange={(e) => update('scheduleEndTime', e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Llegada a casa</label>
              <input
                type="time"
                value={settings.arrivalTime}
                onChange={(e) => update('arrivalTime', e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Transporte al SENA (min)</label>
              <input
                type="number"
                min="10"
                max="60"
                step="5"
                value={settings.transportToSenaMinutes ?? 25}
                onChange={(e) => update('transportToSenaMinutes', parseInt(e.target.value))}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500 text-sm"
              />
            </div>
          </div>
        </div>

        {/* ═══ BLOQUES PROFUNDOS ═══ */}
        <div className="bg-gradient-to-br from-red-900/20 to-orange-900/20 border border-red-800/30 rounded-2xl p-5 space-y-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Moon className="size-4 text-red-500" /> Bloques Profundos de Estudio
          </h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Mínimo diario</label>
              <select
                value={settings.dailyDeepBlocksMin}
                onChange={(e) => update('dailyDeepBlocksMin', parseInt(e.target.value))}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                {[1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n} bloque{n > 1 ? 's' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Máximo diario</label>
              <select
                value={settings.dailyDeepBlocksMax}
                onChange={(e) => update('dailyDeepBlocksMax', parseInt(e.target.value))}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n} bloque{n > 1 ? 's' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-2">
              Duración de bloque: <span className="text-white font-semibold">{settings.deepBlockDuration} min</span>
            </label>
            <input
              type="range"
              min="30"
              max="90"
              step="5"
              value={settings.deepBlockDuration}
              onChange={(e) => update('deepBlockDuration', parseInt(e.target.value))}
              className="w-full accent-red-500"
            />
          </div>
        </div>

        {/* ═══ NOTIFICACIONES Y ALERTAS ═══ */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Bell className="size-4 text-blue-400" /> Notificaciones Clínicas
          </h3>

          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold text-sm">Alertas de Comidas, Postura y Bloques</div>
              <div className="text-xs text-zinc-400">
                Avisos para las 4 comidas, corte de agua a las 8:30 y bloques de estudio
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={notificationsEnabled}
                onChange={handleEnableNotifications}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-zinc-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          {notificationsEnabled && (
            <button
              type="button"
              onClick={testNotification}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors active:scale-95"
            >
              <Bell className="size-4" />
              Probar notificación
            </button>
          )}
        </div>

        {/* ═══ CONFIGURACIÓN IA ═══ */}
        <div className="bg-gradient-to-br from-purple-900/20 to-indigo-900/20 border border-purple-800/30 rounded-2xl p-5 space-y-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Brain className="size-4 text-purple-400" /> Inteligencia Artificial (Nutrición & Horarios)
          </h3>
          <p className="text-xs text-zinc-400">
            Alimenta al Asistente IA para sugerir tus comidas caseras, sustituir ingredientes disponibles y armar tu rutina.
          </p>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                update('aiProvider', 'groq');
                const groqKey = settings.groqApiKey || (settings.aiApiKey?.startsWith('gsk_') ? settings.aiApiKey : '');
                if (groqKey) update('aiApiKey', groqKey);
                setKeyStatus('idle');
                setKeyError(null);
              }}
              className={`p-3 rounded-xl border text-sm font-semibold transition-all ${
                (settings.aiProvider ?? 'groq') === 'groq'
                  ? 'border-purple-500 bg-purple-900/30 text-purple-300 ring-1 ring-purple-500/40'
                  : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600'
              }`}
            >
              ⚡ Groq (Recomendado)
              <span className="block text-[10px] font-normal mt-0.5 text-green-400">100% Gratis · Sin límites</span>
            </button>
            <button
              type="button"
              onClick={() => {
                update('aiProvider', 'gemini');
                const geminiKey = settings.geminiApiKey || (settings.aiApiKey?.startsWith('AIza') ? settings.aiApiKey : '');
                if (geminiKey) update('aiApiKey', geminiKey);
                setKeyStatus('idle');
                setKeyError(null);
              }}
              className={`p-3 rounded-xl border text-sm font-semibold transition-all ${
                settings.aiProvider === 'gemini'
                  ? 'border-purple-500 bg-purple-900/30 text-purple-300 ring-1 ring-purple-500/40'
                  : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600'
              }`}
            >
              🔮 Google Gemini
              <span className="block text-[10px] font-normal mt-0.5 text-yellow-400">Free tier limitado</span>
            </button>
          </div>

          {(() => {
            const currentProvider = settings.aiProvider ?? 'groq';
            const activeKey =
              currentProvider === 'groq'
                ? (settings.groqApiKey ?? (settings.aiProvider === 'groq' ? settings.aiApiKey : '') ?? '')
                : (settings.geminiApiKey ?? (settings.aiProvider === 'gemini' ? settings.aiApiKey : '') ?? '');
            const isGroqKeyInGemini = currentProvider === 'gemini' && activeKey.startsWith('gsk_');
            const isGeminiKeyInGroq = currentProvider === 'groq' && activeKey.startsWith('AIza');

            return (
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm text-zinc-300 font-medium">
                      API Key {currentProvider === 'groq' ? 'de Groq' : 'de Google Gemini'}
                    </label>
                    {currentProvider === 'groq' ? (
                      <a
                        href="https://console.groq.com/keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-purple-400 hover:text-purple-300 underline flex items-center gap-1"
                      >
                        Crear clave gratis en Groq <ExternalLink className="size-3" />
                      </a>
                    ) : (
                      <a
                        href="https://aistudio.google.com/app/apikey"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-purple-400 hover:text-purple-300 underline flex items-center gap-1"
                      >
                        Crear clave gratis en Google AI Studio <ExternalLink className="size-3" />
                      </a>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={activeKey}
                      onChange={(e) => {
                        const clean = sanitizeApiKey(e.target.value);
                        if (currentProvider === 'groq') {
                          update('groqApiKey', clean);
                          update('aiApiKey', clean);
                        } else {
                          update('geminiApiKey', clean);
                          update('aiApiKey', clean);
                        }
                        setKeyStatus('idle');
                        setKeyError(null);
                      }}
                      placeholder={currentProvider === 'groq' ? 'gsk_...' : 'AIzaSy...'}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 pr-12 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
                    >
                      {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-1.5">
                    {currentProvider === 'groq'
                      ? 'Formato esperado: comienza con gsk_ · 100% gratis, sin tarjeta de crédito'
                      : 'Formato esperado: comienza con AIzaSy... · Se genera gratis en Google AI Studio'}
                  </p>
                </div>

                {isGroqKeyInGemini && (
                  <div className="p-3 bg-amber-950/40 border border-amber-500/40 rounded-xl flex items-start justify-between gap-3 text-xs text-amber-200">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="size-4 text-amber-400 shrink-0 mt-0.5" />
                      <span>
                        Esta clave comienza con <strong>gsk_</strong> (pertenece a <strong>Groq</strong>), pero tienes seleccionado Gemini.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        update('aiProvider', 'groq');
                        update('groqApiKey', activeKey);
                        update('aiApiKey', activeKey);
                        setKeyStatus('idle');
                        setKeyError(null);
                      }}
                      className="shrink-0 px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white font-medium rounded-lg transition-colors"
                    >
                      Cambiar a Groq
                    </button>
                  </div>
                )}

                {isGeminiKeyInGroq && (
                  <div className="p-3 bg-amber-950/40 border border-amber-500/40 rounded-xl flex items-start justify-between gap-3 text-xs text-amber-200">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="size-4 text-amber-400 shrink-0 mt-0.5" />
                      <span>
                        Esta clave comienza con <strong>AIza</strong> (pertenece a <strong>Google Gemini</strong>), pero tienes seleccionado Groq.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        update('aiProvider', 'gemini');
                        update('geminiApiKey', activeKey);
                        update('aiApiKey', activeKey);
                        setKeyStatus('idle');
                        setKeyError(null);
                      }}
                      className="shrink-0 px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white font-medium rounded-lg transition-colors"
                    >
                      Cambiar a Gemini
                    </button>
                  </div>
                )}

                {activeKey.trim().length > 5 && (
                  <div className="space-y-2">
                    <button
                      type="button"
                      disabled={validatingKey}
                      onClick={async () => {
                        setValidatingKey(true);
                        setKeyStatus('idle');
                        setKeyError(null);
                        try {
                          const res = await validateApiKey(currentProvider, activeKey);
                          if (res.valid) {
                            setKeyStatus('valid');
                            store.updateSettings({
                              ...settings,
                              aiProvider: currentProvider,
                              aiApiKey: activeKey,
                              ...(currentProvider === 'groq'
                                ? { groqApiKey: activeKey }
                                : { geminiApiKey: activeKey }),
                            });
                          } else {
                            setKeyStatus('invalid');
                            setKeyError(res.error || 'La clave proporcionada no es válida');
                          }
                        } catch (err: unknown) {
                          setKeyStatus('invalid');
                          setKeyError(err instanceof Error ? err.message : 'Error al conectar');
                        }
                        setValidatingKey(false);
                      }}
                      className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-zinc-700 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors active:scale-95 text-white"
                    >
                      {validatingKey ? (
                        <>
                          <Loader2 className="size-4 animate-spin" /> Verificando clave...
                        </>
                      ) : keyStatus === 'valid' ? (
                        <span className="text-green-300 font-semibold">✓ Conexión exitosa y verificada</span>
                      ) : keyStatus === 'invalid' ? (
                        <span className="text-red-300 font-semibold">✗ Clave no válida</span>
                      ) : (
                        <>
                          <Brain className="size-4" /> Probar y verificar conexión
                        </>
                      )}
                    </button>

                    {keyError && (
                      <div className="p-3 bg-red-950/40 border border-red-500/30 rounded-xl text-xs text-red-300 space-y-1">
                        <p>{keyError}</p>
                        {currentProvider === 'gemini' && (
                          <p className="text-zinc-400 text-[11px] pt-1 border-t border-red-500/20">
                            💡 Tip: Puedes generar una nueva clave gratuita en{' '}
                            <a
                              href="https://aistudio.google.com/app/apikey"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-purple-400 underline font-medium"
                            >
                              Google AI Studio
                            </a>{' '}
                            o cambiarte a <strong>Groq</strong> (botón arriba), que es 100% gratuito y sin restricciones de proyecto.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* Save */}
        <button
          type="submit"
          className={`w-full py-4 rounded-xl font-semibold text-base flex items-center justify-center gap-2 transition-all active:scale-95 ${
            saved ? 'bg-green-600' : 'bg-red-600 hover:bg-red-700'
          }`}
        >
          <Save className="size-5" />
          {saved ? '¡Guardado ✓' : 'Guardar Cambios'}
        </button>
      </form>
    </div>
  );
}
