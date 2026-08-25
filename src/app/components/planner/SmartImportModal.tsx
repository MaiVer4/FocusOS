import { useState } from 'react';
import { Sparkles, Loader2, Package } from 'lucide-react';
import { classifyTasksWithAI, ParsedItem } from '../../lib/ai-classifier';
import { formatDateDisplay } from '../../lib/helpers';

interface SmartImportModalProps {
  onImport: (items: ParsedItem[]) => void;
  onClose: () => void;
}

export function SmartImportModal({ onImport, onClose }: SmartImportModalProps) {
  const [text, setText] = useState('');
  const [items, setItems] = useState<ParsedItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<boolean[]>([]);

  const handleClassify = async () => {
    if (!text.trim()) return;
    setLoading(true);
    try {
      const parsed = await classifyTasksWithAI(text);
      setItems(parsed);
      setSelected(parsed.map(() => true));
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    if (!items) return;
    const toImport = items.filter((_, idx) => selected[idx]);
    if (toImport.length === 0) return;
    onImport(toImport);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center p-4 z-50">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-sm max-h-[92vh] overflow-y-auto">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="size-5 text-purple-400" />
          <h3 className="text-xl font-bold">Importar con IA</h3>
        </div>
        <p className="text-zinc-500 text-xs mb-4">
          Clasificación automática por palabras clave y fechas
        </p>

        {/* Step 1: Input */}
        {!items && (
          <div className="space-y-4">
            <textarea
              rows={7}
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={"Escribe o pega tus tareas, una por línea:\n\nEstudiar capítulo 4 de cálculo para el viernes\nRevisar emails 30 min\nSalir a correr 45 min\nTerminar informe de proyecto entregable"}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 font-sans"
            />
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
                onClick={handleClassify}
                disabled={loading || !text.trim()}
                className="flex-1 py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2"
              >
                {loading ? (
                  <><Loader2 className="size-4 animate-spin" /> Clasificando...</>
                ) : (
                  <><Sparkles className="size-4" /> Clasificar</>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Preview & Selection */}
        {items && (
          <div className="space-y-3">
            <p className="text-xs text-zinc-400">
              {selected.filter(Boolean).length} de {items.length} seleccionadas
            </p>

            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {items.map((item, idx) => (
                <label
                  key={idx}
                  className={`flex gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                    selected[idx]
                      ? item.blockType === 'deep' ? 'bg-red-600/10 border-red-600/30'
                      : item.blockType === 'exercise' ? 'bg-green-600/10 border-green-600/30'
                      : item.blockType === 'light' ? 'bg-blue-600/10 border-blue-600/30'
                      : 'bg-zinc-700/30 border-zinc-600/30'
                      : 'bg-zinc-900 border-zinc-800 opacity-40'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-purple-500"
                    checked={selected[idx]}
                    onChange={e => {
                      const next = [...selected];
                      next[idx] = e.target.checked;
                      setSelected(next);
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{item.subject}</div>
                    {item.description && (
                      <div className="text-xs text-zinc-400 mt-0.5 line-clamp-1">{item.description}</div>
                    )}
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium ${
                        item.blockType === 'deep' ? 'bg-red-600/20 text-red-400'
                        : item.blockType === 'exercise' ? 'bg-green-600/20 text-green-400'
                        : item.blockType === 'light' ? 'bg-blue-600/20 text-blue-400'
                        : 'bg-zinc-600/20 text-zinc-400'
                      }`}>
                        {item.blockType === 'deep' ? 'Profundo'
                        : item.blockType === 'exercise' ? 'Ejercicio'
                        : item.blockType === 'light' ? 'Ligero' : 'Descanso'}
                      </span>
                      <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${
                        item.difficulty === 'high' ? 'bg-red-600/20 text-red-400'
                        : item.difficulty === 'medium' ? 'bg-yellow-600/20 text-yellow-400'
                        : 'bg-green-600/20 text-green-400'
                      }`}>
                        {item.difficulty === 'high' ? 'Alta' : item.difficulty === 'medium' ? 'Media' : 'Baja'}
                      </span>
                      <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-zinc-700/50 text-zinc-400">
                        {item.estimatedMinutes} min
                      </span>
                      {item.isDeliverable && (
                        <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-purple-600/20 text-purple-400 flex items-center gap-0.5">
                          <Package className="size-3" /> Entregable
                        </span>
                      )}
                      {item.dueDate && (
                        <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-cyan-600/20 text-cyan-400">
                          {item.dueDate.includes('T')
                            ? formatDateDisplay(item.dueDate)
                            : formatDateDisplay(item.dueDate + 'T00:00')}
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
                onClick={() => setItems(null)}
                className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-semibold text-sm transition-colors"
              >
                ← Editar
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={selected.every(s => !s)}
                className="flex-1 py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 rounded-xl font-semibold text-sm transition-colors"
              >
                Crear {selected.filter(Boolean).length} tarea{selected.filter(Boolean).length !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
