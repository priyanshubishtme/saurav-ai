import { useCallback, useState } from "react";
import { CircleCheck, Info, X } from "lucide-react";
import { ToastContext } from "./ToastContext.js";

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback((message, tone = "info") => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => dismiss(id), 5000);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="toast-stack" role="region" aria-live="polite" aria-label="Notifications">
        {toasts.map((toast) => (
          <div className={`toast toast-${toast.tone}`} role="status" key={toast.id}>
            {toast.tone === "success" ? <CircleCheck size={17} /> : <Info size={17} />}
            <span>{toast.message}</span>
            <button type="button" className="toast-dismiss" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification">
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
