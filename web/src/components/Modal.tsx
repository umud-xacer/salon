import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto max-h-[92dvh] w-[calc(100%-1rem)] sm:w-[calc(100%-2rem)] max-w-2xl rounded-2xl p-0 text-ink backdrop:bg-navy/60"
    >
      <div className="sticky top-0 z-[1000] flex items-center justify-between gap-3 border-b border-line bg-white px-4 py-3 sm:px-5">
        <h2 className="min-w-0 truncate font-semibold text-navy">{title}</h2>
        <button onClick={onClose} aria-label="Yopish" className="text-muted hover:text-ink">
          <X size={20} />
        </button>
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </dialog>
  );
}
