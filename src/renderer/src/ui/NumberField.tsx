import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber, parseNumber } from '../format.ts';
import { useAppState } from '../state/store.ts';

interface NumberFieldProps {
  label: string;
  value: number;
  onChange(value: number): void;
  /** Allow zero and negative values (coordinates). */
  signed?: boolean;
  unit?: string;
  step?: number;
  testId?: string;
}

/**
 * Numeric input with live preview: every valid keystroke updates the model,
 * arrow keys step the value (Shift: ×10), both "," and "." are accepted.
 */
export function NumberField({ label, value, onChange, signed = false, unit = 'mm', step = 1, testId }: NumberFieldProps) {
  const { t } = useTranslation();
  const language = useAppState((state) => state.language);
  const id = useId();
  // Text typed by the user while the field has focus; otherwise the formatted value is shown.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? formatNumber(value, language);
  const parsed = parseNumber(text);
  const valid = parsed !== null && (signed || parsed > 0);

  const commit = (next: number) => {
    setDraft(formatNumber(next, language));
    onChange(next);
  };

  return (
    <div className={`field${valid ? '' : ' is-invalid'}`}>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <div className="field-control">
        <input
          id={id}
          className="field-input"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={text}
          data-testid={testId}
          aria-invalid={!valid}
          onFocus={(event) => {
            setDraft(formatNumber(value, language));
            event.currentTarget.select();
          }}
          onBlur={() => setDraft(null)}
          onChange={(event) => {
            setDraft(event.target.value);
            const next = parseNumber(event.target.value);
            if (next !== null && (signed || next > 0)) onChange(next);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
            event.preventDefault();
            const delta = (event.key === 'ArrowUp' ? 1 : -1) * step * (event.shiftKey ? 10 : 1);
            const next = Math.round(((parsed ?? value) + delta) * 1e6) / 1e6;
            if (signed || next > 0) commit(next);
          }}
        />
        <span className="field-unit">{unit}</span>
      </div>
      {valid ? null : <div className="field-error">{t('panel.invalidNumber')}</div>}
    </div>
  );
}
