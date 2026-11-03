interface DailySetupModalProps {
  onGenerate: () => void;
  onClose: () => void;
}

export function DailySetupModal({ onGenerate, onClose }: DailySetupModalProps) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-6 z-50">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 max-w-sm w-full space-y-5">
        <div>
          <h3 className="text-xl font-bold text-white">Generar Rutina Diaria Personalizada</h3>
          <p className="text-zinc-400 text-xs mt-2 leading-relaxed">
            Se armará tu día adaptado a tu diagnóstico clínico:
          </p>
          <ul className="text-xs text-zinc-300 space-y-1.5 mt-3 bg-zinc-950/60 p-3 rounded-xl border border-white/5">
            <li>🌅 <strong>07:00</strong> — 1 alarma · Luz solar + Vaso de agua</li>
            <li>🍳 <strong>07:30</strong> — Desayuno (Mín. 3 huevos)</li>
            <li>💪 <strong>09:00</strong> — Calistenia (50 min · Regla 2:1)</li>
            <li>🥤 <strong>10:30</strong> — Recarga Post-Entreno + Termo SENA</li>
            <li>🏫 <strong>12:00 – 18:00</strong> — SENA (Pausa almuerzo 14:00)</li>
            <li>🧠 <strong>18:45</strong> — Bloques Profundos de estudio</li>
            <li>🍽️ <strong>20:00</strong> — Cena (Corte de agua 20:30)</li>
            <li>🌙 <strong>22:00</strong> — Desconexión pantallas (Dormir 22:30)</li>
          </ul>
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
