import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { store } from '../lib/store';
import { Block } from '../lib/types';
import {
  getBlockGradient,
  getBlockLabel,
  formatCountdown,
  formatTo12h,
} from '../lib/helpers';
import { X, CheckCircle2, XCircle, AlertTriangle, Timer } from 'lucide-react';

export function Focus() {
  const navigate = useNavigate();
  const [currentBlock, setCurrentBlock] = useState<Block | null>(() => store.getCurrentBlock());
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [showExitWarning, setShowExitWarning] = useState(false);
  const [blockFinished, setBlockFinished] = useState(false);

  // Sincronizar bloque activo con el store
  useEffect(() => {
    const syncBlock = () => {
      const active = store.getCurrentBlock();
      setCurrentBlock(active);
    };

    syncBlock();
    const unsub = store.subscribe(syncBlock);
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

  const totalSecs = currentBlock.duration * 60;
  const progress = Math.min(100, Math.max(0, ((totalSecs - timeRemaining) / totalSecs) * 100));

  // Circular gauge calculations
  const circleRadius = 120;
  const circleCircumference = 2 * Math.PI * circleRadius;
  const circleStrokeOffset = circleCircumference - (progress / 100) * circleCircumference;

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col justify-between p-6 relative overflow-hidden select-none">
      {/* Ambient background glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className={`absolute -top-32 left-1/2 -translate-x-1/2 w-96 h-96 rounded-full blur-[120px] opacity-30 ${
            currentBlock.type === 'deep'
              ? 'bg-red-600'
              : currentBlock.type === 'exercise'
              ? 'bg-emerald-500'
              : 'bg-teal-500'
          }`}
        />
      </div>

      {/* Top Bar Header */}
      <div className="relative z-10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`size-2.5 rounded-full ${currentBlock.type === 'deep' ? 'bg-red-500 animate-ping' : 'bg-emerald-400'}`} />
          <span className="text-xs font-black uppercase tracking-widest text-zinc-300">
            {currentBlock.label || getBlockLabel(currentBlock.type)}
          </span>
        </div>
        <button
          onClick={handleExit}
          className="size-10 rounded-full glass-card hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white transition-all active:scale-95"
          aria-label="Salir"
        >
          <X className="size-5" />
        </button>
      </div>

      {/* Center Circular Timer & Task Spotlight */}
      <div className="relative z-10 flex flex-col items-center justify-center my-auto space-y-6">
        {/* Giant SVG Circular Countdown Gauge */}
        <div className="relative flex items-center justify-center">
          <svg className="size-72 -rotate-90 transform drop-shadow-2xl">
            <circle
              cx="144"
              cy="144"
              r={circleRadius}
              className="text-zinc-900"
              strokeWidth="10"
              stroke="currentColor"
              fill="transparent"
            />
            <circle
              cx="144"
              cy="144"
              r={circleRadius}
              className="transition-all duration-1000 ease-linear"
              strokeWidth="10"
              strokeDasharray={circleCircumference}
              strokeDashoffset={circleStrokeOffset}
              strokeLinecap="round"
              stroke={currentBlock.type === 'deep' ? '#ef4444' : currentBlock.type === 'exercise' ? '#10b981' : '#14b8a6'}
              fill="transparent"
            />
          </svg>

          {/* Central Timer Text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <div className={`text-6xl font-mono font-black tracking-tight tabular-nums drop-shadow-lg ${blockFinished ? 'text-emerald-400 animate-pulse' : 'text-white'}`}>
              {formatCountdown(timeRemaining)}
            </div>
            <div className="text-xs font-mono text-zinc-400 mt-1">
              {formatTo12h(currentBlock.startTime)} – {formatTo12h(currentBlock.endTime)}
            </div>
            <div className="text-[11px] font-semibold text-zinc-400 mt-1 uppercase tracking-wider">
              {Math.round(progress)}% completado
            </div>
          </div>
        </div>

        {/* Task Info Card */}
        <div className="text-center space-y-2 max-w-sm px-4">
          <h2 className="text-2xl font-black text-white leading-tight">
            {currentBlock.task?.subject || 'Sin tarea específica asignada'}
          </h2>
          {currentBlock.task?.description && (
            <p className="text-zinc-400 text-xs line-clamp-2">{currentBlock.task.description}</p>
          )}

          <div className="flex items-center justify-center gap-2 flex-wrap pt-2">
            {currentBlock.priority && (
              <span className="px-3 py-1 glass-card rounded-full text-[11px] font-semibold text-zinc-300">
                Prioridad {getPriorityLabel()}
              </span>
            )}
            {currentBlock.interruptions > 0 && (
              <span className="px-3 py-1 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-full text-[11px] font-semibold">
                {currentBlock.interruptions} interrupción{currentBlock.interruptions > 1 ? 'es' : ''}
              </span>
            )}
          </div>
        </div>

        {/* Mode Banner */}
        {currentBlock.type === 'deep' && !blockFinished && (
          <div className="glass-card px-4 py-2.5 rounded-2xl border border-red-500/30 glow-red flex items-center gap-2.5 max-w-xs animate-breathing">
            <AlertTriangle className="size-4 text-red-400 flex-shrink-0" />
            <span className="text-xs text-red-200 font-medium">
              Modo Enfoque Máximo. Cero distracciones.
            </span>
          </div>
        )}
      </div>

      {/* Bottom Action Buttons */}
      <div className="relative z-10 space-y-3 pt-4">
        {currentBlock.type === 'rest' ? (
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
              Completado
            </button>
            <button
              onClick={handleFail}
              className="py-4 bg-zinc-900 hover:bg-zinc-800 active:scale-95 border border-white/10 text-zinc-300 rounded-2xl font-bold text-base flex items-center justify-center gap-2 transition-all"
            >
              <XCircle className="size-5 text-red-400" />
              No cumplí
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

