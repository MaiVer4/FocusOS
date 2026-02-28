import { useState, useEffect } from 'react';
import { store } from '../lib/store';
import { notificationService } from '../lib/notifications';
import { Block, Task } from '../lib/types';
import { classifyTasksWithAI, ParsedItem } from '../lib/ai-classifier';
import {
  getBlockColor,
  getBlockLabel,
  getBlockStatusLabel,
  getDifficultyLabel,
  addMinutesToTime,
  addMinutesToDatetime,
  durationBetween,
  todayStr,
  formatDateDisplay,
} from '../lib/helpers';
import { Plus, Trash2, CalendarIcon, BookOpen, Clock, Pencil, Sparkles, Loader2 } from 'lucide-react';

export function Planner() {
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showAddBlock, setShowAddBlock] = useState(false);
  const [showAddTask, setShowAddTask] = useState(false);
  const [showDailySetup, setShowDailySetup] = useState(false);
  const [activeTab, setActiveTab] = useState<'blocks' | 'tasks'>('blocks');
  const [editingBlock, setEditingBlock] = useState<Block | null>(null);
  const [showSmartImport, setShowSmartImport] = useState(false);
  const [smartText, setSmartText] = useState('');
  const [smartItems, setSmartItems] = useState<ParsedItem[] | null>(null);
  const [smartLoading, setSmartLoading] = useState(false);
  const [smartSelected, setSmartSelected] = useState<boolean[]>([]);

  const refreshData = () => {
    setBlocks(store.getBlocks(selectedDate).sort((a, b) => a.startTime.localeCompare(b.startTime)));
    setTasks(store.getTasks());
  };

  useEffect(() => {
    refreshData();
    const today = todayStr();
    if (selectedDate === today && store.getBlocks(selectedDate).length === 0) {
      setShowDailySetup(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  // ─── Daily Setup ──────────────────────────────────────────────────────────────

  const handleDailySetup = (count: number) => {
    const settings = store.getSettings();
    const createdBlocks: Block[] = [];
    const [arrH, arrM] = settings.arrivalTime.split(':').map(Number);
    const arrivalMins = arrH * 60 + arrM;

    for (let i = 0; i < count; i++) {
      const blockStartMins = arrivalMins + i * (settings.deepBlockDuration + 10);
      const startH = Math.floor(blockStartMins / 60);
      const startM = blockStartMins % 60;
      const startTime = `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}`;
      const endTime = addMinutesToTime(startTime, settings.deepBlockDuration);

      const block: Block = {
        id: crypto.randomUUID(),
        type: 'deep',
        priority: 'high',
        duration: settings.deepBlockDuration,
        startTime,
        endTime,
        status: 'pending',
        date: selectedDate,
        interruptions: 0,
      };
      store.addBlock(block);
      createdBlocks.push(block);

      if (i === 0 && settings.exerciseMandatory) {
        const exStart = addMinutesToTime(endTime, 5);
        const exEnd = addMinutesToTime(exStart, settings.exerciseDuration);
        const exerciseBlock: Block = {
          id: crypto.randomUUID(),
          type: 'exercise',
          priority: 'high',
          duration: settings.exerciseDuration,
          startTime: exStart,
          endTime: exEnd,
          status: 'pending',
          date: selectedDate,
          interruptions: 0,
        };
        store.addBlock(exerciseBlock);
        createdBlocks.push(exerciseBlock);
      }
    }

    if (notificationService.hasPermission()) {
      createdBlocks.forEach(b => notificationService.scheduleBlockNotifications(b));
    }

    refreshData();
    setShowDailySetup(false);
  };

  // ─── Add Task ────────────────────────────────────────────────────────────────

  const addTask = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const task: Task = {
      id: crypto.randomUUID(),
      subject: fd.get('subject') as string,
      description: fd.get('description') as string,
      notes: fd.get('notes') as string,
      dueDate: fd.get('dueDate') as string,
      difficulty: fd.get('difficulty') as Task['difficulty'],
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    store.addTask(task);

    // Auto-crear bloque si el checkbox está marcado
    if (fd.get('autoBlock') === 'on') {
      const blockDate = task.dueDate.split('T')[0]; // YYYY-MM-DD
      const settings = store.getSettings();
      const existingBlocks = store.getBlocks(blockDate)
        .sort((a, b) => a.endTime.localeCompare(b.endTime));

      // Primer slot disponible: después del último bloque + 10 min, o a la hora de llegada
      const startTime = existingBlocks.length > 0
        ? addMinutesToTime(existingBlocks[existingBlocks.length - 1].endTime, 10)
        : settings.arrivalTime;

      const duration = task.difficulty === 'high' ? 90
        : task.difficulty === 'medium' ? 60 : 45;
      const endTime = addMinutesToTime(startTime, duration);
      const priority = task.difficulty === 'high' ? 'high'
        : task.difficulty === 'medium' ? 'medium' : 'low';

      const block: Block = {
        id: crypto.randomUUID(),
        type: 'deep',
        priority,
        taskId: task.id,
        task,
        duration,
        startTime,
        endTime,
        status: 'pending',
        date: blockDate,
        interruptions: 0,
      };

      if (notificationService.hasPermission()) {
        notificationService.scheduleBlockNotifications(block);
      }
      store.addBlock(block);

      // Cambiar a pestaña de bloques si el bloque es del día seleccionado
      if (blockDate === selectedDate) setActiveTab('blocks');
    }

    refreshData();
    setShowAddTask(false);
    form.reset();
  };

  const deleteTask = (id: string) => {
    if (confirm('¿Eliminar esta tarea? Los bloques asociados quedarán sin tarea.')) {
      store.deleteTask(id);
      refreshData();
    }
  };

  const postponeTask = (id: string, minutes: number) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    const newDueDate = addMinutesToDatetime(task.dueDate, minutes);
    store.updateTask(id, { dueDate: newDueDate });
    refreshData();
  };

  // ─── Add Block ───────────────────────────────────────────────────────────────

  const addBlock = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const startTime = fd.get('startTime') as string;
    const endTime = fd.get('endTime') as string;
    const duration = durationBetween(startTime, endTime);

    if (duration <= 0) {
      alert('La hora de fin debe ser posterior a la de inicio.');
      return;
    }

    const taskId = fd.get('taskId') as string || undefined;
    const task = taskId ? tasks.find(t => t.id === taskId) : undefined;

    const block: Block = {
      id: crypto.randomUUID(),
      type: fd.get('type') as Block['type'],
      priority: fd.get('priority') as Block['priority'],
      taskId,
      task,
      duration,
      startTime,
      endTime,
      status: 'pending',
      date: selectedDate,
      interruptions: 0,
    };

    if (notificationService.hasPermission()) {
      notificationService.scheduleBlockNotifications(block);
    }

    store.addBlock(block);
    refreshData();
    setShowAddBlock(false);
    form.reset();
  };

  const deleteBlock = (id: string) => {
    store.deleteBlock(id);
    refreshData();
  };

  const saveEditBlock = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingBlock) return;
    const fd = new FormData(e.currentTarget);
    const startTime = fd.get('startTime') as string;
    const endTime = fd.get('endTime') as string;
    const duration = durationBetween(startTime, endTime);

    if (duration <= 0) {
      alert('La hora de fin debe ser posterior a la de inicio.');
      return;
    }

    const taskId = fd.get('taskId') as string || undefined;
    const task = taskId ? tasks.find(t => t.id === taskId) : undefined;

    store.updateBlock(editingBlock.id, {
      type: fd.get('type') as Block['type'],
      priority: fd.get('priority') as Block['priority'],
      taskId,
      task,
      startTime,
      endTime,
      duration,
    });
    refreshData();
    setEditingBlock(null);
  };

  // ─── Render

  // ─── Smart Import ─────────────────────────────────────────────────────

  const handleSmartClassify = async () => {
    if (!smartText.trim()) return;
    setSmartLoading(true);
    try {
      const items = await classifyTasksWithAI(smartText);
      setSmartItems(items);
      setSmartSelected(items.map(() => true));
    } finally {
      setSmartLoading(false);
    }
  };

  const createSmartItems = () => {
    if (!smartItems) return;
    const settings = store.getSettings();
    const existingBlocks = store.getBlocks(selectedDate)
      .sort((a, b) => a.endTime.localeCompare(b.endTime));
    let lastEnd = existingBlocks.length > 0
      ? addMinutesToTime(existingBlocks[existingBlocks.length - 1].endTime, 10)
      : settings.arrivalTime;

    smartItems.forEach((item, idx) => {
      if (!smartSelected[idx]) return;
      const task: Task = {
        id: crypto.randomUUID(),
        subject: item.subject,
        description: item.description,
        notes: '',
        dueDate: item.dueDate ?? selectedDate,
        difficulty: item.difficulty,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      store.addTask(task);

      const startTime = lastEnd;
      const endTime = addMinutesToTime(startTime, item.estimatedMinutes);
      const block: Block = {
        id: crypto.randomUUID(),
        type: item.blockType,
        priority: item.difficulty === 'high' ? 'high' : item.difficulty === 'medium' ? 'medium' : 'low',
        taskId: task.id,
        task,
        duration: item.estimatedMinutes,
        startTime,
        endTime,
        status: 'pending',
        date: selectedDate,
        interruptions: 0,
      };
      if (notificationService.hasPermission()) {
        notificationService.scheduleBlockNotifications(block);
      }
      store.addBlock(block);
      lastEnd = addMinutesToTime(endTime, 10);
    });

    refreshData();
    setShowSmartImport(false);
    setSmartText('');
    setSmartItems(null);
    setSmartSelected([]);
    setActiveTab('blocks');
  }; ──────────────────────────────────────────────────────────────────

  const isToday = selectedDate === todayStr();

  return (
    <div className="p-6 space-y-5 pb-24">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-3xl font-bold">Planificador</h1>
        <p className="text-zinc-400 text-sm">
          {isToday ? 'Hoy — ' : ''}{formatDateDisplay(selectedDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* Date Selector */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
        <label className="block text-xs text-zinc-500 mb-2 uppercase tracking-wider">Fecha</label>
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500"
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 bg-zinc-900 border border-zinc-800 rounded-xl p-1">
        <button
          onClick={() => setActiveTab('blocks')}
          className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
            activeTab === 'blocks' ? 'bg-red-600 text-white' : 'text-zinc-400 hover:text-white'
          }`}
        >
          Bloques ({blocks.length})
        </button>
        <button
          onClick={() => setActiveTab('tasks')}
          className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
            activeTab === 'tasks' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
          }`}
        >
          Tareas ({tasks.length})
        </button>
      </div>

      {/* Daily Setup Modal */}
      {showDailySetup && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-6 z-50">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 max-w-sm w-full space-y-5">
            <div>
              <h3 className="text-xl font-bold">Configurar Día</h3>
              <p className="text-zinc-400 text-sm mt-1">¿Cuántos bloques profundos quieres hoy?</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[1, 2, 3].map((count) => (
                <button
                  key={count}
                  onClick={() => handleDailySetup(count)}
                  className="py-8 bg-red-600 hover:bg-red-700 rounded-xl font-bold text-3xl transition-all active:scale-95"
                >
                  {count}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowDailySetup(false)}
              className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-semibold text-sm transition-colors"
            >
              Configurar Manualmente
            </button>
          </div>
        </div>
      )}

      {/* ── Blocks Tab ── */}
      {activeTab === 'blocks' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Bloques del Día</h2>
            <div className="flex gap-2">
              <button
                onClick={() => setShowDailySetup(true)}
                className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-xs font-semibold transition-colors"
              >
                Auto
              </button>
              <button
                onClick={() => setShowAddBlock(true)}
                className="p-2 bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
              >
                <Plus className="size-5" />
              </button>
            </div>
          </div>

          {blocks.length === 0 ? (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center text-zinc-500 space-y-2">
              <CalendarIcon className="size-8 mx-auto opacity-40" />
              <p className="text-sm">Sin bloques para este día</p>
              <p className="text-xs">Toca "Auto" para configuración rápida o "+" para agregar manualmente</p>
            </div>
          ) : (
            <div className="space-y-2">
              {blocks.map((block) => (
                <div key={block.id} className={`border rounded-xl p-4 ${getBlockColor(block.type)}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{getBlockLabel(block.type)}</span>
                        {block.status !== 'pending' && (
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            block.status === 'completed' ? 'bg-green-600/30 text-green-300' :
                            block.status === 'failed' ? 'bg-red-600/30 text-red-300' :
                            'bg-blue-600/30 text-blue-300'
                          }`}>
                            {getBlockStatusLabel(block.status)}
                          </span>
                        )}
                        {block.interruptions > 0 && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-orange-600/30 text-orange-300">
                            {block.interruptions} interrupción{block.interruptions > 1 ? 'es' : ''}
                          </span>
                        )}
                      </div>
                      {block.task && (
                        <div className="text-sm mt-1 truncate opacity-90">{block.task.subject}</div>
                      )}
                      <div className="text-xs opacity-60 mt-1">
                        {block.startTime} – {block.endTime} · {block.duration} min
                      </div>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button
                        onClick={() => setEditingBlock(block)}
                        className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
                        aria-label="Editar bloque"
                      >
                        <Pencil className="size-4" />
                      </button>
                      {block.status === 'pending' && (
                        <button
                          onClick={() => deleteBlock(block.id)}
                          className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
                          aria-label="Eliminar bloque"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tasks Tab ── */}
      {activeTab === 'tasks' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Tareas</h2>
            <div className="flex gap-2">
              <button
                onClick={() => { setSmartItems(null); setSmartText(''); setShowSmartImport(true); }}
                className="flex items-center gap-1.5 px-3 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-xs font-semibold transition-colors"
              >
                <Sparkles className="size-3.5" />
                Importar con IA
              </button>
              <button
                onClick={() => setShowAddTask(true)}
                className="p-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                <Plus className="size-5" />
              </button>
            </div>
          </div>

          {tasks.length === 0 ? (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center text-zinc-500 space-y-2">
              <BookOpen className="size-8 mx-auto opacity-40" />
              <p className="text-sm">Sin tareas registradas</p>
            </div>
          ) : (
            <div className="space-y-2">
              {tasks.map((task) => (
                <div key={task.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">{task.subject}</div>
                      {task.description && (
                        <div className="text-sm text-zinc-400 mt-0.5 line-clamp-2">{task.description}</div>
                      )}
                    </div>
                    <button
                      onClick={() => deleteTask(task.id)}
                      className="p-1.5 hover:bg-white/10 rounded-lg transition-colors flex-shrink-0 text-zinc-500 hover:text-red-400"
                      aria-label="Eliminar tarea"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 text-xs flex-wrap">
                    <span className="flex items-center gap-1 text-zinc-400">
                      <Clock className="size-3" />
                      {formatDateDisplay(task.dueDate)}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full ${
                      task.difficulty === 'high' ? 'bg-red-600/20 text-red-400' :
                      task.difficulty === 'medium' ? 'bg-yellow-600/20 text-yellow-400' :
                      'bg-green-600/20 text-green-400'
                    }`}>
                      {getDifficultyLabel(task.difficulty)}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full ${
                      task.status === 'completed' ? 'bg-green-600/20 text-green-400' :
                      task.status === 'in-progress' ? 'bg-blue-600/20 text-blue-400' :
                      'bg-zinc-600/20 text-zinc-400'
                    }`}>
                      {task.status === 'completed' ? 'Completada' :
                       task.status === 'in-progress' ? 'En curso' : 'Pendiente'}
                    </span>
                  </div>
                  {task.status !== 'completed' && (
                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-xs text-zinc-600">Aplazar:</span>
                      <button
                        onClick={() => postponeTask(task.id, 30)}
                        className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors text-zinc-300"
                      >
                        +30 min
                      </button>
                      <button
                        onClick={() => postponeTask(task.id, 60)}
                        className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors text-zinc-300"
                      >
                        +1 hora
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Add Task Modal ── */}
      {showAddTask && (
        <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-sm max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-5">Nueva Tarea</h3>
            <form onSubmit={addTask} className="space-y-4">
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Materia / Título *</label>
                <input type="text" name="subject" required
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Ej: Matemáticas, Proyecto Final..." />
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Descripción</label>
                <textarea name="description" rows={2}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Qué hay que hacer..." />
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Notas adicionales</label>
                <textarea name="notes" rows={2}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Recursos, URLs, contexto extra..." />
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Fecha y hora de entrega *</label>
                <input type="datetime-local" name="dueDate" required
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 [color-scheme:dark]" />
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Dificultad</label>
                <select name="difficulty"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="low">Baja</option>
                  <option value="medium">Media</option>
                  <option value="high">Alta</option>
                </select>
              </div>
              {/* Auto-crear bloque */}
              <label className="flex items-start gap-3 bg-zinc-800/60 border border-zinc-700 rounded-xl p-3 cursor-pointer hover:bg-zinc-800 transition-colors">
                <input type="checkbox" name="autoBlock" defaultChecked
                  className="mt-0.5 size-4 rounded accent-blue-500 cursor-pointer" />
                <div>
                  <p className="text-sm font-medium text-white">Crear bloque automáticamente</p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Añade un bloque profundo en la fecha de entrega.<br/>
                    Baja: 45 min · Media: 60 min · Alta: 90 min
                  </p>
                </div>
              </label>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowAddTask(false)}
                  className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-semibold transition-colors">Cancelar</button>
                <button type="submit"
                  className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 rounded-xl font-semibold transition-colors">Agregar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Add Block Modal ── */}
      {showAddBlock && (
        <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-sm max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-5">Nuevo Bloque</h3>
            <form onSubmit={addBlock} className="space-y-4">
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Tipo</label>
                <select name="type"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500">
                  <option value="deep">Profundo</option>
                  <option value="light">Ligero</option>
                  <option value="exercise">Ejercicio</option>
                  <option value="rest">Descanso</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Prioridad</label>
                <select name="priority"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500">
                  <option value="high">Alta</option>
                  <option value="medium">Media</option>
                  <option value="low">Baja</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Tarea asociada (opcional)</label>
                <select name="taskId"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500">
                  <option value="">Sin tarea</option>
                  {tasks.map((task) => (
                    <option key={task.id} value={task.id}>{task.subject}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-zinc-400 mb-2">Hora Inicio *</label>
                  <input type="time" name="startTime" required
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500" />
                </div>
                <div>
                  <label className="block text-sm text-zinc-400 mb-2">Hora Fin *</label>
                  <input type="time" name="endTime" required
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500" />
                </div>
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowAddBlock(false)}
                  className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-semibold transition-colors">Cancelar</button>
                <button type="submit"
                  className="flex-1 py-3 bg-red-600 hover:bg-red-700 rounded-xl font-semibold transition-colors">Agregar</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* ── Smart Import Modal ── */}
      {showSmartImport && (
        <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-sm max-h-[92vh] overflow-y-auto">

            {/* Header */}
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="size-5 text-purple-400" />
              <h3 className="text-xl font-bold">Importar con IA</h3>
            </div>
            <p className="text-zinc-500 text-sm mb-4">
              {store.getSettings().deepseekApiKey
                ? <span className="text-green-500">Usando DeepSeek · deepseek-chat (V3)</span>
                : <span>Clasificación automática por keywords (añade tu clave en <span className="text-purple-400">Ajustes</span> para IA real)</span>
              }
            </p>

            {/* Step 1 — Input */}
            {!smartItems && (
              <div className="space-y-4">
                <textarea
                  rows={7}
                  value={smartText}
                  onChange={e => setSmartText(e.target.value)}
                  placeholder={"Escribe o pega tus tareas, una por línea:\n\nEstudiar capítulo 4 de cálculo\nRevisar emails\nSalir a correr 30 min\nTerminar informe de proyecto\nLlamar al banco"}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                <div className="flex gap-3">
                  <button type="button" onClick={() => setShowSmartImport(false)}
                    className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-semibold text-sm transition-colors">
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleSmartClassify}
                    disabled={smartLoading || !smartText.trim()}
                    className="flex-1 py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2"
                  >
                    {smartLoading
                      ? <><Loader2 className="size-4 animate-spin" /> Clasificando...</>
                      : <><Sparkles className="size-4" /> Clasificar</>
                    }
                  </button>
                </div>
              </div>
            )}

            {/* Step 2 — Preview */}
            {smartItems && (
              <div className="space-y-3">
                <p className="text-sm text-zinc-400">
                  {smartSelected.filter(Boolean).length} de {smartItems.length} seleccionadas · desactiva las que no quieras
                </p>

                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {smartItems.map((item, idx) => (
                    <label key={idx}
                      className={`flex gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                        smartSelected[idx]
                          ? item.blockType === 'deep' ? 'bg-red-600/10 border-red-600/30'
                          : item.blockType === 'exercise' ? 'bg-green-600/10 border-green-600/30'
                          : item.blockType === 'light' ? 'bg-blue-600/10 border-blue-600/30'
                          : 'bg-zinc-700/30 border-zinc-600/30'
                          : 'bg-zinc-900 border-zinc-800 opacity-40'
                      }`}
                    >
                      <input type="checkbox" className="mt-0.5 accent-purple-500"
                        checked={smartSelected[idx]}
                        onChange={e => {
                          const next = [...smartSelected];
                          next[idx] = e.target.checked;
                          setSmartSelected(next);
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{item.subject}</div>
                        {item.description && (
                          <div className="text-xs text-zinc-400 mt-0.5 line-clamp-1">{item.description}</div>
                        )}
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                            item.blockType === 'deep' ? 'bg-red-600/20 text-red-400'
                            : item.blockType === 'exercise' ? 'bg-green-600/20 text-green-400'
                            : item.blockType === 'light' ? 'bg-blue-600/20 text-blue-400'
                            : 'bg-zinc-600/20 text-zinc-400'
                          }`}>
                            {item.blockType === 'deep' ? 'Profundo'
                            : item.blockType === 'exercise' ? 'Ejercicio'
                            : item.blockType === 'light' ? 'Ligero' : 'Descanso'}
                          </span>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                            item.difficulty === 'high' ? 'bg-red-600/20 text-red-400'
                            : item.difficulty === 'medium' ? 'bg-yellow-600/20 text-yellow-400'
                            : 'bg-green-600/20 text-green-400'
                          }`}>
                            {item.difficulty === 'high' ? 'Alta' : item.difficulty === 'medium' ? 'Media' : 'Baja'}
                          </span>
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-zinc-700/50 text-zinc-400">
                            {item.estimatedMinutes} min
                          </span>
                          {item.dueDate && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-purple-600/20 text-purple-400">
                              {item.dueDate}
                            </span>
                          )}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>

                <div className="flex gap-3 pt-1">
                  <button type="button" onClick={() => setSmartItems(null)}
                    className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-semibold text-sm transition-colors">
                    ← Editar
                  </button>
                  <button
                    type="button"
                    onClick={createSmartItems}
                    disabled={smartSelected.every(s => !s)}
                    className="flex-1 py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 rounded-xl font-semibold text-sm transition-colors"
                  >
                    Crear {smartSelected.filter(Boolean).length} tarea{smartSelected.filter(Boolean).length !== 1 ? 's' : ''}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Edit Block Modal ── */}
      {editingBlock && (
        <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-sm max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-1">Editar Bloque</h3>
            <p className="text-zinc-500 text-sm mb-5">
              {getBlockLabel(editingBlock.type)} · {editingBlock.startTime}–{editingBlock.endTime}
            </p>
            <form onSubmit={saveEditBlock} className="space-y-4">
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Tipo</label>
                <select name="type" defaultValue={editingBlock.type}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500">
                  <option value="deep">Profundo</option>
                  <option value="light">Ligero</option>
                  <option value="exercise">Ejercicio</option>
                  <option value="rest">Descanso</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Prioridad</label>
                <select name="priority" defaultValue={editingBlock.priority}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500">
                  <option value="high">Alta</option>
                  <option value="medium">Media</option>
                  <option value="low">Baja</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Tarea asociada</label>
                <select name="taskId" defaultValue={editingBlock.taskId ?? ''}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500">
                  <option value="">Sin tarea</option>
                  {tasks.map((task) => (
                    <option key={task.id} value={task.id}>{task.subject}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-zinc-400 mb-2">Hora Inicio *</label>
                  <input type="time" name="startTime" required defaultValue={editingBlock.startTime}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500 [color-scheme:dark]" />
                </div>
                <div>
                  <label className="block text-sm text-zinc-400 mb-2">Hora Fin *</label>
                  <input type="time" name="endTime" required defaultValue={editingBlock.endTime}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500 [color-scheme:dark]" />
                </div>
              </div>
              {editingBlock.status !== 'pending' && (
                <div>
                  <label className="block text-sm text-zinc-400 mb-2">Estado</label>
                  <select name="status" defaultValue={editingBlock.status}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                    onChange={(ev) => {
                      store.updateBlock(editingBlock.id, { status: ev.target.value as Block['status'] });
                    }}
                  >
                    <option value="pending">Pendiente</option>
                    <option value="active">Activo</option>
                    <option value="completed">Completado</option>
                    <option value="failed">Fallado</option>
                  </select>
                </div>
              )}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setEditingBlock(null)}
                  className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-semibold transition-colors">
                  Cancelar
                </button>
                <button type="submit"
                  className="flex-1 py-3 bg-red-600 hover:bg-red-700 rounded-xl font-semibold transition-colors">
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
