import type { ReactNode } from 'react';

export function CandleIcon({ lit }: { readonly lit: boolean }): ReactNode {
  return (
    <svg className="costume-candle" viewBox="0 0 14 18" aria-hidden="true" focusable="false">
      <path d="M4 9h6v7H4zm3-3v3M2 17h10" fill="none" stroke="currentColor" />
      {lit ? <path className="costume-candle__flame" data-lit="true" d="M7 1c1 2 3 3 3 5a3 3 0 0 1-6 0c0-1.6 1.2-3 3-5Z" /> : null}
    </svg>
  );
}

export function ParchmentTag({ children, className }: { readonly children: ReactNode; readonly className?: string }): ReactNode {
  return (
    <span className={className === undefined ? 'costume-tag' : `costume-tag ${className}`}>
      <svg className="costume-tag__string" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
        <circle cx="7" cy="5" r="2" fill="none" stroke="currentColor" />
        <path d="M7 5C3 8 4 1 0 3" fill="none" stroke="currentColor" />
      </svg>
      {children}
    </span>
  );
}
