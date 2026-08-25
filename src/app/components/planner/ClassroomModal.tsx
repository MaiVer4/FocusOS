import { useState } from 'react';
import { GraduationCap, Loader2, Package, Clock } from 'lucide-react';
import { ClassroomTask, getClassroomPendingTasks } from '../../lib/google-classroom';
import { googleAuth } from '../../lib/google-auth';
import { formatDateDisplay } from '../../lib/helpers';

interface ClassroomModalProps {
  connected: boolean;
  onConnectedChange: (connected: boolean) => void;
  onImport: (tasks: ClassroomTask[]) => void;
  onClose: () => void;
}

export function ClassroomModal({
  connected,
  onConnectedChange,
  onImport,
  onClose,
}: ClassroomModalProps) {
  const [tasks, setTasks] = useState<ClassroomTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFetch = async () => {
    setLoading(true);
    setError(null);
    setTasks([]);
    try {
      if (!googleAuth.isAuthenticated()) {
        await googleAuth.authenticate(true);
        onConnectedChange(true);
      }
      const fetched = await getClassroomPendingTasks();
      if (fetched.length === 0) {
        setError('No se encontraron tareas pendientes en tus cursos.');
      }
      setTasks(fetched);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      if (msg.includes('403')) {
        setError(
          'Permiso denegado. Verifica en Google Cloud Console:\n' +
          '1. Que la API "Google Classroom API" esté habilitada\n' +
          '2. Que los scopes estén en la pantalla de consentimiento OAuth\n' +
          '3. Que aceptaste todos los permisos solicitados'
        );
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = () => {
    googleAuth.signOut();
    onConnectedChange(false);
    setTasks([]);
    setError(null);
  };

  const handleCreateTasks = () => {
    const selected = tasks.filter(t => t.selected);
    if (selected.length === 0) return;
    onImport(selected);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center p-4 z-50">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-sm max-h-[92vh] overflow-y-auto">
        <div className="flex items-center gap-2 mb-1">
          <GraduationCap className="size-5 text-green-400" />
          <h3 className="text-xl font-bold">Google Classroom</h3>
        </div>

        {/* Estado de conexión */}
        <div className={`flex items-center justify-between rounded-xl px-3 py-2 my-3 ${
          connected ? 'bg-green-900/20 border border-green-800/30' : 'bg-zinc-800 border border-zinc-700'
        }`}>
          <div className="flex items-center gap-2">
            <span className={`size-2.5 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
            <span className={`text-xs font-medium ${connected ? 'text-green-400' : 'text-zinc-400'}`}>
              {connected ? 'Conectado a Google' : 'Desconectado'}
            </span>
          </div>
          {connected && (
            <button
              type="button"
              onClick={handleDisconnect}
              className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
            >
              Desconectar
            </button>
          )}
        </div>

        {/* Sin datos */}
        {tasks.length === 0 && !loading && !error && (
          <div className="space-y-4">
            <p className="text-xs text-zinc-400">
              {connected
                ? 'Obtén y selecciona tus tareas pendientes de Classroom.'
                : 'Conéctate con tu cuenta institucional para sincronizar tus entregables.'}
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
                className="flex-1 py-3 bg-green-600 hover:bg-green-700 rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2"
              >
                <GraduationCap className="size-4" /> {connected ? 'Obtener tareas' : 'Conectar'}
              </button>
            </div>
          </div>
        )}

        {/* Cargando */}
        {loading && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="size-8 animate-spin text-green-400" />
            <p className="text-xs text-zinc-400">Consultando Google Classroom...</p>
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
                className="flex-1 py-3 bg-green-600 hover:bg-green-700 rounded-xl font-semibold text-sm transition-colors"
              >
                Reintentar
              </button>
            </div>
          </div>
        )}

        {/* Lista de tareas */}
        {tasks.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs text-zinc-400">
              {tasks.filter(t => t.selected).length} de {tasks.length} seleccionadas
            </p>

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {tasks.map((ct, idx) => (
                <label
                  key={ct.courseworkId}
                  className={`flex gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                    ct.selected
                      ? 'bg-green-600/10 border-green-600/30'
                      : 'bg-zinc-900 border-zinc-800 opacity-40'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-green-500"
                    checked={ct.selected}
                    onChange={e => {
                      const next = [...tasks];
                      next[idx] = { ...next[idx], selected: e.target.checked };
                      setTasks(next);
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{ct.title}</div>
                    {ct.description && (
                      <div className="text-xs text-zinc-400 mt-0.5 line-clamp-2">{ct.description}</div>
                    )}
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-green-600/20 text-green-400">
                        {ct.courseName}
                      </span>
                      <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-purple-600/20 text-purple-400 flex items-center gap-0.5">
                        <Package className="size-3" /> Entregable
                      </span>
                      {ct.assignedDate && (
                        <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-zinc-700 text-zinc-300">
                          Asignada: {formatDateDisplay(ct.assignedDate)}
                        </span>
                      )}
                      <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-cyan-600/20 text-cyan-400 flex items-center gap-0.5">
                        <Clock className="size-3" /> Entrega: {ct.dueDate.includes('T')
                          ? formatDateDisplay(ct.dueDate)
                          : formatDateDisplay(ct.dueDate + 'T00:00')}
                      </span>
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
                onClick={handleCreateTasks}
                disabled={tasks.every(t => !t.selected)}
                className="flex-1 py-3 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-xl font-semibold text-sm transition-colors"
              >
                Importar {tasks.filter(t => t.selected).length} tarea{tasks.filter(t => t.selected).length !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
