import { useState, useEffect } from 'react';
import { Bell, X } from 'lucide-react';

interface NotificationBannerProps {
  message: string;
  type: 'info' | 'warning' | 'success' | 'error';
  onClose?: () => void;
}

export function NotificationBanner({ message, type, onClose }: NotificationBannerProps) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
      onClose?.();
    }, 5000);

    return () => clearTimeout(timer);
  }, [onClose]);

  if (!isVisible) return null;

  const colors = {
    info: 'from-blue-900/90 to-blue-800/90 border-blue-700',
    warning: 'from-orange-900/90 to-orange-800/90 border-orange-700',
    success: 'from-green-900/90 to-green-800/90 border-green-700',
    error: 'from-red-900/90 to-red-800/90 border-red-700',
  };

  return (
    <div className={`fixed top-4 left-4 right-4 z-50 max-w-md mx-auto bg-gradient-to-r ${colors[type]} border rounded-xl p-4 shadow-lg animate-in slide-in-from-top`}>
      <div className="flex items-start gap-3">
        <Bell className="size-5 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium whitespace-pre-line">{message}</p>
        </div>
        <button
          onClick={() => {
            setIsVisible(false);
            onClose?.();
          }}
          className="p-1 hover:bg-white/10 rounded-lg transition-colors"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
