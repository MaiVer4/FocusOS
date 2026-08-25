import React, { useState } from 'react';
import { Package, BookOpen } from 'lucide-react';
import { Task, Difficulty, Subtask } from '../../lib/types';
import { generateUUID } from '../../lib/helpers';

interface TaskModalProps {
  task?: Task | null;
  onSave: (taskData: Omit<Task, 'id' | 'createdAt'> & { id?: string }) => void;
  onClose: () => void;
}

export function TaskModal({ task, onSave, onClose }: TaskModalProps) {
  const isEditing = !!task;
  const [isDeliverable, setIsDeliverable] = useState<boolean>(task?.isDeliverable ?? false);
  const [subject, setSubject] = useState(task?.subject ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [notes, setNotes] = useState(task?.notes ?? '');
  const [category, setCategory] = useState(task?.category ?? '');
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '');
  const [difficulty, setDifficulty] = useState<Difficulty>(task?.difficulty ?? 'medium');
  const [subtasksText, setSubtasksText] = useState(
    task?.subtasks?.map(s => s.title).join('\n') ?? ''
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim()) return;
    if (isDeliverable && !dueDate.trim()) {
      alert('Las tareas entregables requieren fecha y hora de entrega.');
      return;
    }

    // Procesar sub-pasos
    const existingSubtasks = task?.subtasks ?? [];
    let subtasks: Subtask[] | undefined;
    if (subtasksText.trim()) {
      const titles = subtasksText.split('\n').map(s => s.trim()).filter(Boolean);
      subtasks = titles.map(title => {
        const found = existingSubtasks.find(s => s.title === title);
        return found ?? { id: generateUUID(), title, done: false };
      });
    }

    onSave({
      ...(isEditing ? { id: task.id } : {}),
      subject: subject.trim(),
      description: description.trim(),
      notes: notes.trim(),
      category: category.trim() || undefined,
      subtasks,
      dueDate: dueDate.trim(),
      difficulty,
      status: task?.status ?? 'sin-iniciar',
      isDeliverable,
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center p-4 z-50">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-sm max-h-[90vh] overflow-y-auto">
        <h3 className="text-xl font-bold mb-1">
          {isEditing ? 'Editar Tarea' : 'Nueva Tarea'}
        </h3>
        {isEditing && (
          <p className="text-zinc-500 text-xs mb-4">
            {task.subject} · {task.isDeliverable ? 'Entregable' : 'Personal'}
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 mt-3">
          {/* Selector de tipo: Entregable vs Personal */}
          <div>
            <label className="block text-sm text-zinc-400 mb-2">¿Qué tipo de tarea es?</label>
            <div className="flex rounded-xl overflow-hidden border border-zinc-700">
              <button
                type="button"
                onClick={() => setIsDeliverable(true)}
                className={`flex-1 py-2.5 text-sm font-semibold transition-colors flex items-center justify-center gap-1.5 ${
                  isDeliverable
                    ? 'bg-purple-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                }`}
              >
                <Package className="size-4" /> Entregable
              </button>
              <button
                type="button"
                onClick={() => setIsDeliverable(false)}
                className={`flex-1 py-2.5 text-sm font-semibold transition-colors flex items-center justify-center gap-1.5 ${
                  !isDeliverable
                    ? 'bg-teal-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                }`}
              >
                <BookOpen className="size-4" /> Personal / Repaso
              </button>
            </div>
            <p className="text-xs text-zinc-500 mt-1.5">
              {isDeliverable
                ? '📦 Debes entregar una evidencia. Tendrá prioridad con alertas automáticas.'
                : '📖 Para estudiar o repasar. Sin fecha límite obligatoria.'}
            </p>
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-1.5">Materia / Título *</label>
            <input
              type="text"
              required
              value={subject}
              onChange={e => setSubject(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Ej: Matemáticas, Proyecto Final..."
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-1.5">Descripción</label>
            <textarea
              rows={2}
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Qué hay que hacer..."
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-1.5">Notas adicionales</label>
            <textarea
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Recursos, URLs, contexto..."
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-1.5">Categoría</label>
            <input
              type="text"
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Ej: Java, JavaScript, SQL, React..."
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-1.5">Sub-pasos (uno por línea)</label>
            <textarea
              rows={3}
              value={subtasksText}
              onChange={e => setSubtasksText(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 font-sans"
              placeholder={"Investigar tema\nEstructurar solución\nProgramar\nProbar"}
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-1.5">
              {isDeliverable ? 'Fecha y hora de entrega *' : 'Fecha límite (opcional)'}
            </label>
            <input
              type="datetime-local"
              required={isDeliverable}
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 [color-scheme:dark]"
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-1.5">Dificultad</label>
            <select
              value={difficulty}
              onChange={e => setDifficulty(e.target.value as Difficulty)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="low">Baja</option>
              <option value="medium">Media</option>
              <option value="high">Alta</option>
            </select>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-semibold text-sm transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 rounded-xl font-semibold text-sm transition-colors"
            >
              {isEditing ? 'Guardar Cambios' : 'Crear Tarea'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
