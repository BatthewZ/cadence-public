import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const HOLD_TO_DELETE_MS = 1200;
const CIRCUMFERENCE = 2 * Math.PI * 9;

/**
 * A press-and-hold delete button with a circular progress ring.
 * Hold for 2 seconds to confirm deletion — release early to cancel.
 */
export function HoldToDeleteButton({
  onDelete,
  label,
  iconSize = 12,
}: {
  onDelete: () => void;
  label: string;
  iconSize?: number;
}) {
  const [holding, setHolding] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function startHold() {
    setHolding(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setHolding(false);
      onDelete();
    }, HOLD_TO_DELETE_MS);
  }

  function cancelHold() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setHolding(false);
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <button
      type="button"
      aria-label={label}
      className="relative size-5 p-0 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
      onMouseDown={startHold}
      onMouseUp={cancelHold}
      onMouseLeave={cancelHold}
      onTouchStart={startHold}
      onTouchEnd={cancelHold}
      onContextMenu={(e) => e.preventDefault()}
    >
      {holding && (
        <svg className="absolute inset-0 -rotate-90" viewBox="0 0 20 20">
          <circle
            cx="10"
            cy="10"
            r="9"
            fill="none"
            stroke="var(--C-STATUS-ERROR, #ef4444)"
            strokeWidth="2"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE}
            style={{
              animation: `hold-delete-ring ${HOLD_TO_DELETE_MS}ms linear forwards`,
            }}
          />
        </svg>
      )}
      <Trash2 size={iconSize} className={holding ? "text-status-error" : "text-fg-muted"} />
    </button>
  );
}
