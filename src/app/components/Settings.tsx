import { useState, useEffect } from 'react';
import { store } from '../lib/store';
import { notificationService } from '../lib/notifications';
import { validateApiKey, sanitizeApiKey } from '../lib/ai-engine';
import type { AIProvider } from '../lib/ai-engine';
import { UserSettings } from '../lib/types';
import { Save, Moon, Sun, Zap, Dumbbell, Smartphone, Bell, RotateCcw, Brain, Eye, EyeOff, Loader2 } from 'lucide-react';

export function Settings() {
  const [settings, setSettings] = useState<UserSettings>(store.getSettings());
  const [saved, setSaved] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [validatingKey, setValidatingKey] = useState(false);
  const [keyStatus, setKeyStatus] = useState<'idle' | 'valid' | 'invalid'>('idle');

  useEffect(() => {
    setNotificationsEnabled(notificationService.hasPermission());
    // Refrescar settings cuando cloud sync actualiza desde otro dispositivo
    const unsubStore = store.subscribe(() => {
      setSettings(store.getSettings());
    });
    return () => unsubStore();
  }, []);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    // Validaciones de coherencia
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
    if (confirm('¿Restablecer todos los ajustes a los valores por defecto?')) {
      store.resetSettings();
      setSettings(store.getSettings());
    }
  };

  const handleEnableNotifications = async () => {
    const granted = await notificationService.requestPermission();
    setNotificationsEnabled(granted);
    if (granted) {
      store.getTodayBlocks().forEach(block => notificationService.scheduleBlockNotifications(block));
    }
  };

  const testNotification = () => {
    if (notificationsEnabled) {
      notificationService.sendNotification('🎯 Notificación de Prueba', {
        body: 'Las notificaciones están funcionando correctamente.',
      });
    }
  };

  const update = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="p-6 space-y-5 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Configuración</h1>
          <p className="text-zinc-400 text-sm">Personaliza tu FocusOS</p>
        </div>
        <button
          type="button"
          onClick={handleReset}
          className="p-2 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors"
          title="Restablecer valores por defecto"
        >
          <RotateCcw className="size-5" />
        </button>
      </div>

      <form onSubmit={handleSave} className="space-y-5">

        {/* Schedule Settings */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Sun className="size-4 text-yellow-500" /> Horario Base
          </h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Despertar</label>
              <input type="time" value={settings.wakeTime}
                onChange={(e) => update('wakeTime', e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500" />
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Dormir</label>
              <input type="time" value={settings.sleepTime}
                onChange={(e) => update('sleepTime', e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Horario Inicio</label>
              <input type="time" value={settings.scheduleStartTime}
                onChange={(e) => update('scheduleStartTime', e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500" />
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Horario Fin</label>
              <input type="time" value={settings.scheduleEndTime}
                onChange={(e) => update('scheduleEndTime', e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500" />
            </div>
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-2">Hora de llegada a casa / trabajo libre</label>
            <input type="time" value={settings.arrivalTime}
              onChange={(e) => update('arrivalTime', e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500" />
            <p className="text-xs text-zinc-500 mt-1">Se usará como hora de inicio al crear bloques automáticos</p>
          </div>
        </div>

        {/* Energy Settings */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Zap className="size-4 text-orange-500" /> Energía
          </h3>
          <div>
            <label className="block text-sm text-zinc-400 mb-2">Pico de energía</label>
            <select value={settings.peakEnergyTime}
              onChange={(e) => update('peakEnergyTime', e.target.value as UserSettings['peakEnergyTime'])}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500">
              <option value="morning">Mañana</option>
              <option value="afternoon">Tarde</option>
              <option value="night">Noche</option>
            </select>
          </div>
        </div>

        {/* Deep Work */}
        <div className="bg-gradient-to-br from-red-900/20 to-orange-900/20 border border-red-800/30 rounded-2xl p-5 space-y-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Moon className="size-4 text-red-500" /> Bloques Profundos
          </h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Mínimo diario</label>
              <select value={settings.dailyDeepBlocksMin}
                onChange={(e) => update('dailyDeepBlocksMin', parseInt(e.target.value))}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500">
                {[1, 2, 3].map(n => <option key={n} value={n}>{n} bloque{n > 1 ? 's' : ''}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Máximo diario</label>
              <select value={settings.dailyDeepBlocksMax}
                onChange={(e) => update('dailyDeepBlocksMax', parseInt(e.target.value))}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500">
                {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} bloque{n > 1 ? 's' : ''}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-2">
              Duración: <span className="text-white font-semibold">{settings.deepBlockDuration} min</span>
            </label>
            <input type="range" min="25" max="120" step="5"
              value={settings.deepBlockDuration}
              onChange={(e) => update('deepBlockDuration', parseInt(e.target.value))}
              className="w-full accent-red-500" />
            <div className="flex justify-between text-xs text-zinc-500 mt-1">
              <span>25 min</span><span>60 min</span><span>120 min</span>
            </div>
          </div>
        </div>

        {/* Exercise */}
        <div className="bg-gradient-to-br from-green-900/20 to-emerald-900/20 border border-green-800/30 rounded-2xl p-5 space-y-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Dumbbell className="size-4 text-green-500" /> Ejercicio
          </h3>

          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold text-sm">Ejercicio obligatorio</div>
              <div className="text-xs text-zinc-400">Se programa automáticamente con los bloques del día</div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" checked={settings.exerciseMandatory}
                onChange={(e) => update('exerciseMandatory', e.target.checked)} className="sr-only peer" />
              <div className="w-11 h-6 bg-zinc-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
            </label>
          </div>

          {settings.exerciseMandatory && (
            <div>
              <label className="block text-sm text-zinc-400 mb-2">
                Duración: <span className="text-white font-semibold">{settings.exerciseDuration} min</span>
              </label>
              <input type="range" min="10" max="90" step="5"
                value={settings.exerciseDuration}
                onChange={(e) => update('exerciseDuration', parseInt(e.target.value))}
                className="w-full accent-green-500" />
              <div className="flex justify-between text-xs text-zinc-500 mt-1">
                <span>10 min</span><span>45 min</span><span>90 min</span>
              </div>
            </div>
          )}
        </div>

        {/* Social Media */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Smartphone className="size-4 text-blue-500" /> Redes Sociales
          </h3>
          <div>
            <label className="block text-sm text-zinc-400 mb-2">
              Máximo diario: <span className="text-white font-semibold">{settings.socialMediaMaxMinutes} min</span>
            </label>
            <input type="range" min="0" max="180" step="15"
              value={settings.socialMediaMaxMinutes}
              onChange={(e) => update('socialMediaMaxMinutes', parseInt(e.target.value))}
              className="w-full accent-blue-500" />
            <div className="flex justify-between text-xs text-zinc-500 mt-1">
              <span>0 min</span><span>90 min</span><span>180 min</span>
            </div>
          </div>
        </div>

        {/* Notifications */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Bell className="size-4 text-blue-400" /> Notificaciones
          </h3>

          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold text-sm">Habilitar notificaciones</div>
              <div className="text-xs text-zinc-400">Recordatorios y alertas de bloques</div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" checked={notificationsEnabled}
                onChange={handleEnableNotifications} className="sr-only peer" />
              <div className="w-11 h-6 bg-zinc-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          {notificationsEnabled && (
            <button type="button" onClick={testNotification}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors active:scale-95">
              <Bell className="size-4" />
              Probar notificación
            </button>
          )}
        </div>

        {/* AI Configuration */}
        <div className="bg-gradient-to-br from-purple-900/20 to-indigo-900/20 border border-purple-800/30 rounded-2xl p-5 space-y-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Brain className="size-4 text-purple-400" /> Inteligencia Artificial
          </h3>
          <p className="text-xs text-zinc-400">
            Conecta un proveedor de IA para generar horarios inteligentes basados en tu historial de productividad.
          </p>

          {/* Provider Selector */}
          <div>
            <label className="block text-sm text-zinc-400 mb-2">Proveedor</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => { update('aiProvider', 'groq'); setKeyStatus('idle'); }}
                className={`p-3 rounded-xl border text-sm font-semibold transition-all ${
                  (settings.aiProvider ?? 'groq') === 'groq'
                    ? 'border-purple-500 bg-purple-900/30 text-purple-300'
                    : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600'
                }`}
              >
                ⚡ Groq
                <span className="block text-[10px] font-normal mt-0.5 text-green-400">100% Gratis</span>
              </button>
              <button
                type="button"
                onClick={() => { update('aiProvider', 'gemini'); setKeyStatus('idle'); }}
                className={`p-3 rounded-xl border text-sm font-semibold transition-all ${
                  settings.aiProvider === 'gemini'
                    ? 'border-purple-500 bg-purple-900/30 text-purple-300'
                    : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600'
                }`}
              >
                🔮 Gemini
                <span className="block text-[10px] font-normal mt-0.5 text-yellow-400">Free tier limitado</span>
              </button>
            </div>
          </div>

          {/* API Key */}
          <div>
            <label className="block text-sm text-zinc-400 mb-2">
              API Key {(settings.aiProvider ?? 'groq') === 'groq' ? 'de Groq' : 'de Gemini'}
            </label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={settings.aiApiKey ?? ''}
                onChange={(e) => {
                  update('aiApiKey', sanitizeApiKey(e.target.value));
                  setKeyStatus('idle');
                }}
                placeholder={(settings.aiProvider ?? 'groq') === 'groq' ? 'gsk_...' : 'AIza...'}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 pr-12 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono text-sm"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
              >
                {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <p className="text-xs text-zinc-500 mt-1">
              {(settings.aiProvider ?? 'groq') === 'groq' ? (
                <>Crea tu key gratis en{' '}
                  <a href="https://console.groq.com/keys" target="_blank" rel="noopener"
                    className="text-purple-400 underline hover:text-purple-300">console.groq.com</a>
                  {' '}(sin tarjeta de crédito)
                </>
              ) : (
                <>Obtén tu key en{' '}
                  <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener"
                    className="text-purple-400 underline hover:text-purple-300">Google AI Studio</a>
                </>
              )}
            </p>
          </div>

          {/* Validate Button */}
          {(settings.aiApiKey ?? '').trim().length > 5 && (
            <button
              type="button"
              disabled={validatingKey}
              onClick={async () => {
                setValidatingKey(true);
                setKeyStatus('idle');
                try {
                  const provider: AIProvider = settings.aiProvider ?? 'groq';
                  const key = settings.aiApiKey ?? '';
                  const valid = await validateApiKey(provider, key);
                  setKeyStatus(valid ? 'valid' : 'invalid');
                  if (valid) {
                    store.updateSettings(settings);
                  }
                } catch (err) {
                  console.error('Error validando:', err);
                  setKeyStatus('invalid');
                }
                setValidatingKey(false);
              }}
              className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-zinc-700 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors active:scale-95"
            >
              {validatingKey ? (
                <><Loader2 className="size-4 animate-spin" /> Validando...</>
              ) : keyStatus === 'valid' ? (
                <span className="text-green-400">✓ Conexión exitosa</span>
              ) : keyStatus === 'invalid' ? (
                <span className="text-red-400">✗ Key inválida o error de conexión</span>
              ) : (
                <><Brain className="size-4" /> Verificar conexión</>
              )}
            </button>
          )}

          {store.isAIEnabled() && (
            <div className="bg-purple-900/30 border border-purple-800/40 rounded-xl p-3">
              <p className="text-xs text-purple-300">
                🧠 IA activa con <strong>{(settings.aiProvider ?? 'groq') === 'groq' ? 'Groq (Llama 3.3)' : 'Google Gemini'}</strong>. En el Planner verás el botón <strong>"IA"</strong> para generar horarios inteligentes.
              </p>
            </div>
          )}
        </div>

        {/* Save */}
        <button type="submit"
          className={`w-full py-4 rounded-xl font-semibold text-base flex items-center justify-center gap-2 transition-all active:scale-95 ${
            saved ? 'bg-green-600' : 'bg-red-600 hover:bg-red-700'
          }`}>
          <Save className="size-5" />
          {saved ? '¡Guardado ✓' : 'Guardar Cambios'}
        </button>
      </form>

      {/* About */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
        <h3 className="font-semibold mb-2">Acerca de FocusOS</h3>
        <p className="text-sm text-zinc-400">
          Sistema de productividad basado en bloques de tiempo. Diseñado para estructurar el trabajo, eliminar distracciones y medir la disciplina real.
        </p>
        <div className="text-xs text-zinc-500 mt-3">Versión 2.0.0</div>
      </div>
    </div>
  );
}

