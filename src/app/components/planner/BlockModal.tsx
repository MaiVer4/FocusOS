import React, { useState } from 'react';
import { Block, BlockType, BlockPriority, BlockStatus, Task } from '../../lib/types';
import { durationBetween, formatTo12h, getBlockLabel } from '../../lib/helpers';

interface BlockModalProps {
  block?: Block | null;
  tasks: Task[];
  onSave: (blockData: {
    id?: string;
    label?: string;
    type: BlockType;
    priority: BlockPriority;
    taskId?: string;
    startTime: string;
    endTime: string;
    status?: BlockStatus;
  }) => void;
  onClose: () => void;
}

export function BlockModal({ block, tasks, onSave, onClose }: BlockModalProps) {
  const isEditing = !!block;
  const [label, setLabel] = useState(block?.label ?? '');
  const [type, setType] = useState<BlockType>(block?.type ?? 'deep');
  const [priority, setPriority] = useState<BlockPriority>(block?.priority ?? 'medium');
  const [taskId, setTaskId] = useState<string>(block?.taskId ?? '');
  const [startTime, setStartTime] = useState(block?.startTime ?? '19:00');
  const [endTime, setEndTime] = useState(block?.endTime ?? '20:00');
  const [status, setStatus] = useState<BlockStatus>(block?.status ?? 'pending');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const duration = durationBetween(startTime, endTime);
    if (duration <= 0) {
      alert('La hora de fin debe ser posterior a la hora de inicio.');
      return;
    }

    onSave({
      ...(isEditing ? { id: block.id } : {}),
      label: label.trim() || undefined,
      type,
      priority,
      taskId: taskId || undefined,
      startTime,
      endTime,
      ...(isEditing ? { status } : {}),
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center p-4 z-50">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-sm max-h-[90vh] overflow-y-auto">
        <h3 className="text-xl font-bold mb-1">
          {isEditing ? 'Editar Bloque' : 'Nuevo Bloque'}
        </h3>
        {isEditing && (
          <p className="text-zinc-500 text-xs mb-4">
            {block.label || getBlockLabel(block.type)} · {formatTo12h(block.startTime)}–{formatTo12h(block.endTime)}
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 mt-3">
          <div>
            <label className="block text-sm text-zinc-400 mb-1.5">Nombre (opcional)</label>
            <input
              type="text"
              value={label}
              onChange={e => setLabel(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              placeholder="Ej: Bloque profundo 1, Descanso..."
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-1.5">Tipo</label>
            <select
              value={type}
              onChange={e => setType(e.target.value as BlockType)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              <option value="deep">Profundo (Deep Work)</option>
              <option value="light">Ligero</option>
              <option value="exercise">Ejercicio</option>
              <option value="rest">Descanso / Rutina</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-1.5">Prioridad</label>
            <select
              value={priority}
              onChange={e => setPriority(e.target.value as BlockPriority)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              <option value="high">Alta</option>
              <option value="medium">Media</option>
              <option value="low">Baja</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-1.5">Tarea asociada (opcional)</label>
            <select
              value={taskId}
              onChange={e => setTaskId(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              <option value="">Sin tarea asociada</option>
              {tasks.map(t => (
                <option key={t.id} value={t.id}>{t.subject}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-zinc-400 mb-1.5">Hora Inicio *</label>
              <input
                type="time"
                required
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500 [color-scheme:dark]"
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-1.5">Hora Fin *</label>
              <input
                type="time"
                required
                value={endTime}
                onChange={e => setEndTime(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500 [color-scheme:dark]"
              />
            </div>
          </div>

          {isEditing && (
            <div>
              <label className="block text-sm text-zinc-400 mb-1.5">Estado</label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value as BlockStatus)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                <option value="pending">Pendiente</option>
                <option value="active">Activo</option>
                <option value="completed">Completado</option>
                <option value="failed">Fallado</option>
              </select>
            </div>
          )}

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
              className="flex-1 py-3 bg-red-600 hover:bg-red-700 rounded-xl font-semibold text-sm transition-colors"
            >
              {isEditing ? 'Guardar Cambios' : 'Agregar Bloque'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
