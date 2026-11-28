import type { ReactNode } from 'react';
import { ENTER_CRYPT_LABEL, SAMPLE_CRYPT_LABEL } from '@escape-the-crypt/core';
import type { SampleEntry } from './shelf-entry';
import { ParchmentTag } from '../costume/ornaments';

export interface SampleShelfProps {
  readonly samples: readonly SampleEntry[];
  readonly onPlay: (id: string) => void;
}

/**
 * The sample crypts, one button each. They carry the "Sample crypt" label and nothing about review:
 * the "Human-reviewed" label is only for samples a person has reviewed, and none is marked so here.
 */
export function SampleShelf({ samples, onPlay }: SampleShelfProps): ReactNode {
  if (samples.length === 0) return null;
  return (
    <ul className="sample-shelf" data-testid="sample-shelf">
      {samples.map((sample) => (
        <li key={sample.id}>
          <button type="button" className="fh-button sample-shelf__button" onClick={() => onPlay(sample.id)}>
            <span>{`${ENTER_CRYPT_LABEL}: ${sample.title}`}</span>
            <ParchmentTag className="sample-shelf__label">{SAMPLE_CRYPT_LABEL}</ParchmentTag>
          </button>
        </li>
      ))}
    </ul>
  );
}
