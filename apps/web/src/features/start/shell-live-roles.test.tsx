import { describe, expect, it } from 'vitest';
import { useMount } from '../../test-support/flow-dom';
import { ExportControl } from './export-control';
import type { ExportControlProps } from './export-control';
import { ResumeEntryView } from './resume-entry';

/** Props the control does not read until the button is pressed. */
const PROPS = { state: {}, assets: {}, eventLog: [], runId: 'r', deps: {} } as unknown as ExportControlProps;

describe('live roles', () => {
  const mount = useMount();

  it('the resume message has its own status role unless a host announcer reads it', () => {
    mount.render(<ResumeEntryView onContinue={() => undefined} onStartAgain={() => undefined} failure="write-failed" />);
    expect(mount.container.querySelectorAll('[role="status"]')).toHaveLength(1);
    mount.render(
      <ResumeEntryView onContinue={() => undefined} onStartAgain={() => undefined} failure="write-failed" live={false} />,
    );
    expect(mount.container.querySelectorAll('[role="status"]')).toHaveLength(0);
    expect(mount.container.querySelector('.resume-entry__message')?.textContent).not.toBe('');
  });

  it('the export sentence is a live region unless a host announcer reads it', () => {
    mount.render(<ExportControl {...PROPS} />);
    expect(mount.container.querySelectorAll('[aria-live]')).toHaveLength(1);
    mount.render(<ExportControl {...PROPS} onStatus={() => undefined} />);
    expect(mount.container.querySelectorAll('[aria-live]')).toHaveLength(0);
  });
});
