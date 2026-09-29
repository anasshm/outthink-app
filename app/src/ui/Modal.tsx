import { useEffect, useRef, useContext, useId, type ReactNode } from "react";
import { FeedbackContext } from "./FeedbackContext";
import { Icon } from "./Progress";
export default function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const feedback = useContext(FeedbackContext);
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const d = ref.current;
    d?.showModal();
    return () => {
      d?.close();
      document.body.style.overflow = overflow;
      previous?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`ot-modal ${wide ? "ot-wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="ot-modal-header">
        <h3 id={titleId}>{title}</h3>
        <button
          className="pp-icon-button"
          aria-label={`Close ${title}`}
          onClick={onClose}
        >
          <Icon kind="close" />
        </button>
      </div>
      {feedback.error && (
        <div className="ot-form-error" role="alert">
          <p>{feedback.error}</p>
          <div className="ot-actions">
            {feedback.retry && (
              <button
                className="ot-secondary"
                disabled={feedback.busy}
                onClick={feedback.retry}
              >
                Retry save
              </button>
            )}
            <button className="ot-text-button" onClick={feedback.clear}>
              Dismiss
            </button>
          </div>
        </div>
      )}
      {children}
    </dialog>
  );
}
