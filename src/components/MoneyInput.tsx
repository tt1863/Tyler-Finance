import { useEffect, useRef, useState } from 'react';
import { fmt, parseMoney, toInput } from '../lib/money';
import type { Cents } from '../lib/types';

/**
 * Shows a formatted amount; becomes an editable field on focus. Accepts simple
 * math ("50+25"). Commits on Enter or blur, Escape cancels.
 */
export default function MoneyInput({
  value,
  onCommit,
  className = '',
  ariaLabel,
}: {
  value: Cents;
  onCommit: (v: Cents) => void;
  className?: string;
  ariaLabel?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    if (editing) ref.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const v = parseMoney(text);
    if (v !== null && v !== value) onCommit(v);
  };

  return (
    <input
      ref={ref}
      className={`money-input ${className}`}
      aria-label={ariaLabel}
      inputMode="decimal"
      value={editing ? text : fmt(value)}
      onFocus={() => {
        setText(toInput(value));
        setEditing(true);
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') ref.current?.blur();
        if (e.key === 'Escape') {
          cancelled.current = true;
          ref.current?.blur();
        }
      }}
    />
  );
}
