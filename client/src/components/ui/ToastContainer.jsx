import React from 'react';
import { useNotification, TOAST_TYPES } from '../../context/NotificationContext.jsx';
import { CheckCircle2, AlertOctagon, AlertTriangle, Info, X } from 'lucide-react';

const TOAST_STYLES = {
  [TOAST_TYPES.SUCCESS]: {
    container: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    icon: <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />,
    progress: 'bg-emerald-500',
  },
  [TOAST_TYPES.ERROR]: {
    container: 'bg-rose-50 border-rose-200 text-rose-900',
    icon: <AlertOctagon className="w-5 h-5 text-rose-600 flex-shrink-0" />,
    progress: 'bg-rose-500',
  },
  [TOAST_TYPES.WARNING]: {
    container: 'bg-amber-50 border-amber-200 text-amber-900',
    icon: <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />,
    progress: 'bg-amber-500',
  },
  [TOAST_TYPES.INFO]: {
    container: 'bg-blue-50 border-blue-200 text-blue-900',
    icon: <Info className="w-5 h-5 text-blue-600 flex-shrink-0" />,
    progress: 'bg-blue-500',
  },
};

export function ToastContainer() {
  const { toasts, dismissToast } = useNotification();

  if (!toasts || toasts.length === 0) return null;

  return (
    <aside
      aria-label="Notifications"
      className="fixed top-4 right-4 z-50 flex flex-col space-y-2.5 max-w-sm w-full pointer-events-none"
    >
      {toasts.map((toast) => {
        const style = TOAST_STYLES[toast.type] || TOAST_STYLES[TOAST_TYPES.INFO];
        return (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto flex items-start space-x-3 p-3.5 rounded-lg border shadow-lg transition-all transform duration-200 ease-out translate-y-0 ${style.container}`}
          >
            {style.icon}
            <div className="flex-1 min-w-0 pt-0.5">
              {toast.title && (
                <div className="font-semibold text-xs tracking-wide uppercase mb-0.5">{toast.title}</div>
              )}
              <div className="text-xs leading-relaxed font-medium break-words">{toast.message}</div>
            </div>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              className="text-gray-400 hover:text-gray-700 p-0.5 rounded transition-colors focus:outline-none"
              title="Dismiss notification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </aside>
  );
}

export default ToastContainer;
