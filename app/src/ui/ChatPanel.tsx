import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { FeedbackContext } from "./FeedbackContext";
import { Icon } from "./Progress";

// A full-page conversation. The native dialog keeps focus in chat and makes
// the dashboard inert until the user returns or logging hands off to Pending.
export default function ChatPanel({
  children,
  onClose,
  saved,
  handingOff = false,
  restoreFocus = true,
}: {
  children: ReactNode;
  onClose: () => void;
  saved: boolean;
  handingOff?: boolean;
  restoreFocus?: boolean;
}) {
  const panel = useRef<HTMLDialogElement>(null);
  const feedback = useContext(FeedbackContext);
  const keepLatestVisible = useRef(false);
  const shouldRestoreFocus = useRef(restoreFocus);
  useEffect(() => {
    shouldRestoreFocus.current = restoreFocus;
  }, [restoreFocus]);
  const [viewport, setViewport] = useState({
    height: window.innerHeight,
    top: 0,
  });

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = panel.current;
    dialog?.showModal();
    dialog?.focus({ preventScroll: true });
    const visual = window.visualViewport;
    const resize = () => {
      const log = dialog?.querySelector<HTMLElement>(".ot-chat-log");
      keepLatestVisible.current =
        !!log && log.scrollHeight - log.scrollTop - log.clientHeight < 32;
      setViewport({
        height: visual?.height ?? window.innerHeight,
        top: visual?.offsetTop ?? 0,
      });
    };
    resize();
    visual?.addEventListener("resize", resize);
    visual?.addEventListener("scroll", resize);
    window.addEventListener("resize", resize);
    return () => {
      dialog?.close();
      document.body.style.overflow = overflow;
      visual?.removeEventListener("resize", resize);
      visual?.removeEventListener("scroll", resize);
      window.removeEventListener("resize", resize);
      if (!shouldRestoreFocus.current) return;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
      else
        document
          .querySelector<HTMLButtonElement>(".ot-chat-fab")
          ?.focus({ preventScroll: true });
    };
  }, []);
  useLayoutEffect(() => {
    const log = panel.current?.querySelector<HTMLElement>(".ot-chat-log");
    if (log && keepLatestVisible.current) log.scrollTop = log.scrollHeight;
  }, [viewport]);

  return (
    <dialog
      ref={panel}
      id="outthink-chat"
      role="dialog"
      aria-modal="true"
      aria-labelledby="outthink-chat-title"
      tabIndex={-1}
      className={`ot-chat-panel${handingOff ? " is-handing-off" : ""}`}
      style={
        {
          "--ot-chat-visible-height": `${viewport.height}px`,
          "--ot-chat-top": `${viewport.top}px`,
        } as CSSProperties
      }
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="ot-chat-panel-header">
        <div className="ot-chat-heading">
          <span className="ot-chat-mark">
            <Icon kind="spark" size={18} />
          </span>
          <h3 id="outthink-chat-title">OutThink</h3>
        </div>
        <span
          className={`ot-chat-saved${saved || handingOff ? " is-visible" : ""}`}
          role="status"
        >
          {(saved || handingOff) && (
            <>
              <Icon kind="check" size={14} />
              {handingOff ? "Ready to check off" : "Saved"}
            </>
          )}
        </span>
        <button
          className="ot-chat-back"
          onClick={onClose}
          aria-label="Back to dashboard"
        >
          <Icon kind="arrow" size={19} />
          <span>Dashboard</span>
        </button>
      </header>
      {feedback.error && (
        <div className="ot-chat-error" role="alert">
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
