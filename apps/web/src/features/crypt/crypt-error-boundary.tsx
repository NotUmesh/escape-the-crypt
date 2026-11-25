import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

export interface CryptErrorBoundaryProps {
  readonly children: ReactNode;
}

interface BoundaryState {
  readonly failed: boolean;
}

/**
 * Catches render errors in the crypt. It logs only the error name and the component stack,
 * never the message, because a message can carry text from the learner's notes.
 */
export class CryptErrorBoundary extends Component<CryptErrorBoundaryProps, BoundaryState> {
  override state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('crypt-flow error', error.name, info.componentStack ?? '');
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <section role="alert" className="crypt-flow__error">
          <p>Something went wrong in the crypt.</p>
          <p>Reload the page and try again.</p>
        </section>
      );
    }
    return this.props.children;
  }
}
