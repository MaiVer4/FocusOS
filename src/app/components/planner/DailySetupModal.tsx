interface DailySetupModalProps {
  onGenerate: () => void;
  onClose: () => void;
}

export function DailySetupModal({ onGenerate, onClose }: DailySetupModalProps) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-6 z-50">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 max-w-sm w-full space-y-5">
        <div>
          <h3 className="text-xl font-bold">Generar Rutina Diaria</h3>
          <p className="text-zinc-400 text-sm mt-2 leading-relaxed">
            Se creará tu rutina completa del día: despertar, estudio, SENA/actividades formales, bloques profundos,
            ejercicio, revisión y descansos. Las tareas pendientes se asignarán automáticamente a los bloques de trabajo.
          </p>
        </div>
        <button
          type="button"
          onClick={onGenerate}
          className="w-full py-3.5 bg-red-600 hover:bg-red-700 rounded-xl font-bold text-base transition-all active:scale-95"
        >
          Generar Automáticamente
        </button>
        <button
          type="button"
          onClick={onClose}
          className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-semibold text-sm transition-colors text-zinc-300"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
