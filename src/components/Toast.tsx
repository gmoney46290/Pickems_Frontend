import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Toast = { id: number; msg: string; error?: boolean };
const Ctx = createContext<(msg: string, error?: boolean) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((msg: string, error = false) => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t.slice(-2), { id, msg, error }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), error ? 4500 : 2200);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toast-wrap">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.error ? 'error' : ''}`}>{t.msg}</div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
