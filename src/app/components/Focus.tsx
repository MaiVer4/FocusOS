import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { store } from '../lib/store';
import { Block } from '../lib/types';
import {
  getBlockGradient,
  getBlockLabel,
  formatCountdown,
} from '../lib/helpers';
import { X, CheckCircle2, XCircle, AlertTriangle, Timer } from 'lucide-react';

export function Focus() {
  const navigate = useNavigate();
  const [currentBlock, setCurrentBlock] = useState<Block | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [showExitWarning, setShowExitWarning] = useState(false);
  const [blockFinished, setBlockFinished] = useState(false);

  useEffect(() => {
    const block = store.getCurrentBlock();
    setCurrentBlock(block);

    if (!block) return;

    const calcRemaining = () => {
      const now = new Date();
      const [endHour, endMinute] = block.endTime.split(':').map(Number);
      const endTime = new Date();
      endTime.setHours(endHour, endMinute, 0, 0);
      return Math.max(0, Math.floor((endTime.getTime() - now.getTime()) / 1000));
    };

    const rem = calcRemaining();
    setTimeRemaining(rem);
    if (rem === 0) setBlockFinished(true);

    const interval = setInterval(() => {
      const remaining = calcRemaining();
      setTimeRemaining(remaining);
      if (remaining === 0) {
        setBlockFinished(true);
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const handleComplete = () => {
    if (currentBlock) {
      store.updateBlock(currentBlock.id, { status: 'completed' });
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
      // Register the interruption but keep block pending
      store.updateBlock(currentBlock.id, {
        interruptions: (currentBlock.interruptions ?? 0) + 1,
      });
    }
    navigate('/');
  };

  if (!currentBlock) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center space-y-4">
          <div className="size-16 bg-zinc-800 rounded-full flex items-center justify-center mx-auto">
            <Timer className="size-8 text-zinc-500" />
          </div>
          <h2 className="text-xl font-semibold">Sin Bloque Activo</h2>
          <p className="text-zinc-400 text-sm">No hay ningún bloque en curso en este momento</p>
          <button
            onClick={() => navigate('/')}
            className="px-6 py-3 bg-red-600 hover:bg-red-700 rounded-xl font-semibold transition-colors active:scale-95"
          >
            Volver al Inicio
          </button>
        </div>
      </div>
    );
  }

  const getPriorityLabel = () => {
    switch (currentBlock.priority) {
      case 'high':   return 'Alta';
      case 'medium': return 'Media';
      case 'low':    return 'Baja';
    }
  };

  const progress = Math.min(
    100,
    ((currentBlock.duration * 60 - timeRemaining) / (currentBlock.duration * 60)) * 100
  );

  return (
    <div className={`min-h-screen bg-gradient-to-b ${getBlockGradient(currentBlock.type)} flex flex-col`}>
      {/* Header */}
      <div className="p-6 flex items-center justify-between">
        <div className="text-sm font-bold uppercase tracking-widest opacity-80">
          {getBlockLabel(currentBlock.type)}
        </div>
        <button
          onClick={handleExit}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          aria-label="Salir"
        >
          <X className="size-6" />
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 space-y-8">
        {/* Timer */}
        <div className="text-center space-y-2">
          <div className={`text-8xl font-mono font-bold tracking-tighter tabular-nums ${blockFinished ? 'text-green-400' : ''}`}>
            {formatCountdown(timeRemaining)}
          </div>
          <div className="text-sm text-zinc-400">
            {currentBlock.startTime} – {currentBlock.endTime}
          </div>
          {blockFinished && (
            <div className="text-green-400 font-semibold animate-pulse">¡Tiempo completado!</div>
          )}
        </div>

        {/* Progress Bar */}
        <div className="w-full max-w-xs space-y-1">
          <div className="h-2 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-white transition-all duration-1000"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="text-xs text-zinc-500 text-right">{Math.round(progress)}%</div>
        </div>

        {/* Task Info */}
        <div className="text-center space-y-2 max-w-xs">
          <h1 className="text-3xl font-bold leading-tight">
            {currentBlock.task?.subject || 'Sin tarea asignada'}
          </h1>
          {currentBlock.task?.description && (
            <p className="text-zinc-300 text-sm">{currentBlock.task.description}</p>
          )}
          <div className="flex items-center justify-center gap-2 flex-wrap">
            {currentBlock.priority && (
              <div className="px-3 py-1 bg-white/10 rounded-full text-xs">
                Prioridad: {getPriorityLabel()}
              </div>
            )}
            {currentBlock.interruptions > 0 && (
              <div className="px-3 py-1 bg-orange-500/20 rounded-full text-xs text-orange-300">
                {currentBlock.interruptions} interrupción{currentBlock.interruptions > 1 ? 'es' : ''}
              </div>
            )}
          </div>
        </div>

        {/* Deep Block Warning */}
        {currentBlock.type === 'deep' && !blockFinished && (
          <div className="bg-red-500/20 border border-red-500/30 rounded-xl p-4 max-w-xs w-full">
            <div className="flex items-start gap-3">
              <AlertTriangle className="size-5 text-red-400 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-red-200">
                <strong>Modo disciplina activo.</strong> Celular fuera. Sin interrupciones.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="p-6 space-y-3">
        <button
          onClick={handleComplete}
          className="w-full py-5 bg-green-600 hover:bg-green-700 rounded-xl font-semibold text-lg flex items-center justify-center gap-2 transition-all active:scale-95"
        >
          <CheckCircle2 className="size-6" />
          Cumplido
        </button>
        <button
          onClick={handleFail}
          className="w-full py-4 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-semibold text-base flex items-center justify-center gap-2 transition-all active:scale-95"
        >
          <XCircle className="size-5" />
          Fallé
        </button>
      </div>

      {/* Exit Warning Modal */}
      {showExitWarning && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-6 z-50">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 max-w-sm w-full space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-red-500/20 rounded-lg flex-shrink-0">
                <AlertTriangle className="size-6 text-red-500" />
              </div>
              <div>
                <h3 className="text-xl font-bold">Bloque Crítico Activo</h3>
                <p className="text-zinc-400 text-sm mt-1">
                  Estás en un bloque profundo. Salir registrará una interrupción y reducirá tu puntuación de disciplina.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowExitWarning(false)}
                className="flex-1 py-3 bg-red-600 hover:bg-red-700 rounded-xl font-semibold transition-colors active:scale-95"
              >
                Continuar
              </button>
              <button
                onClick={confirmExit}
                className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-semibold transition-colors active:scale-95"
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

