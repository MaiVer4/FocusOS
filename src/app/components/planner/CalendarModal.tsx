import { useState } from 'react';
import { CalendarDays, Loader2, Clock } from 'lucide-react';
import { CalendarEventItem, getCalendarEvents } from '../../lib/google-calendar';
import { googleAuth } from '../../lib/google-auth';
import { formatTo12h } from '../../lib/helpers';

interface CalendarModalProps {
  onImport: (events: CalendarEventItem[]) => void;
  onClose: () => void;
}

export function CalendarModal({ onImport, onClose }: CalendarModalProps) {
  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFetch = async () => {
    setLoading(true);
    setError(null);
    setEvents([]);
    try {
      if (!googleAuth.isAuthenticated()) {
        await googleAuth.authenticate(true);
      }
      const fetched = await getCalendarEvents();
      if (fetched.length === 0) {
        setError('No se encontraron eventos próximos en tu calendario.');
      }
      setEvents(fetched);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      if (msg.includes('403')) {
        setError(
          'Permiso denegado. Verifica en Google Cloud Console:\n' +
          '1. Que la API "Google Calendar API" esté habilitada\n' +
          '2. Que el scope calendar.events.readonly esté en la pantalla de consentimiento\n' +
          '3. Que aceptaste todos los permisos solicitados'
        );
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCreateItems = () => {
    const selected = events.filter(e => e.selected);
    if (selected.length === 0) return;
    onImport(selected);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center p-4 z-50">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-sm max-h-[92vh] overflow-y-auto">
        <div className="flex items-center gap-2 mb-4">
          <CalendarDays className="size-5 text-blue-400" />
          <h3 className="text-xl font-bold">Google Calendar</h3>
        </div>

        {/* Sin datos */}
        {events.length === 0 && !loading && !error && (
          <div className="space-y-4">
            <p className="text-xs text-zinc-400">
              Importa tus próximos eventos de Google Calendar para agregarlos como tareas a tu día.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-semibold text-sm transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleFetch}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2"
              >
                <CalendarDays className="size-4" /> Obtener eventos
              </button>
            </div>
          </div>
        )}

        {/* Cargando */}
        {loading && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="size-8 animate-spin text-blue-400" />
            <p className="text-xs text-zinc-400">Obteniendo eventos del calendario...</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="space-y-4">
            <div className="bg-red-900/20 border border-red-800/30 rounded-xl p-3.5">
              <p className="text-xs text-red-400 whitespace-pre-line leading-relaxed">{error}</p>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-semibold text-sm transition-colors"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={handleFetch}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 rounded-xl font-semibold text-sm transition-colors"
              >
                Reintentar
              </button>
            </div>
          </div>
        )}

        {/* Lista de eventos */}
        {events.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs text-zinc-400">
              {events.filter(e => e.selected).length} de {events.length} seleccionados
            </p>

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {events.map((ev, idx) => (
                <label
                  key={ev.id}
                  className={`flex gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                    ev.selected
                      ? 'bg-blue-600/10 border-blue-600/30'
                      : 'bg-zinc-900 border-zinc-800 opacity-40'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-blue-500"
                    checked={ev.selected}
                    onChange={e => {
                      const next = [...events];
                      next[idx] = { ...next[idx], selected: e.target.checked };
                      setEvents(next);
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{ev.title}</div>
                    {ev.description && (
                      <div className="text-xs text-zinc-400 mt-0.5 line-clamp-2">{ev.description}</div>
                    )}
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-blue-600/20 text-blue-400">
                        {ev.date}
                      </span>
                      {ev.isAllDay ? (
                        <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-600/20 text-amber-400">
                          Todo el día
                        </span>
                      ) : (
                        <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-cyan-600/20 text-cyan-400 flex items-center gap-0.5">
                          <Clock className="size-3" /> {formatTo12h(ev.startTime)} – {formatTo12h(ev.endTime)}
                        </span>
                      )}
                      {ev.location && (
                        <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-zinc-700 text-zinc-300 truncate max-w-[12rem]">
                          📍 {ev.location}
                        </span>
                      )}
                    </div>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-semibold text-sm transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCreateItems}
                disabled={events.every(e => !e.selected)}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-xl font-semibold text-sm transition-colors"
              >
                Importar {events.filter(e => e.selected).length} tarea{events.filter(e => e.selected).length !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
