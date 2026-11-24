import './test-parent.css';

export interface TestParentProps {
  /** Width in CSS pixels. 360 stands for a phone, 720 and 1024 for wider hosts. */
  readonly width: number;
  readonly children: React.ReactNode;
}

/**
 * A minimal host for layout tests: a fixed-width parchment parent with a
 * decorative atmosphere overlay set to `pointer-events: none`. The e2e layout
 * test renders `IngestFlow` inside it.
 */
export function TestParent({ width, children }: TestParentProps): React.JSX.Element {
  return (
    <div className="test-parent" style={{ width: `${width}px` }} data-testid="test-parent">
      {children}
      <div className="test-parent-overlay" aria-hidden="true" />
    </div>
  );
}