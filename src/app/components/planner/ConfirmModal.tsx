interface ConfirmModalProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
}

export function ConfirmModal({
  message,
  onConfirm,
  onCancel,
  confirmLabel = 'Eliminar',
  cancelLabel = 'Cancelar',
}: ConfirmModalProps) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-6 z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 max-w-sm w-full space-y-4">
        <p className="text-sm text-zinc-200 text-center">{message}</p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-semibold text-sm transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 rounded-xl font-semibold text-sm transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
