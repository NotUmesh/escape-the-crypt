import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Chunk } from '@escape-the-crypt/core';
import type { CryptStartContext } from '../crypt/crypt-start-context';
import { DigScreen } from '../dig/dig-screen';
import { digStagesFromGeneration } from '../dig/job-stages';
import type { NotesStats } from '../dig/notes-stats';
import { IngestFlow } from '../ingest/ingest-flow';
import type { IngestFlowProps } from '../ingest/ingest-flow';
import type { NotesStore } from '../ingest/notes-store';
import { ResumeEntry } from '../start/resume-entry';
import { BookExport } from './book-export';
import { JudgeAccess } from './judge-access';
import { BringNotesScreen } from './bring-notes-screen';
import { DeskHub } from './desk-hub';
import { playableSamples } from './sample-list';
import { screenFor } from './screen-flow';
import type { FrontOfHouseRoute } from './screen-flow';
import { SettingsSlot } from './settings-slot';
import { ShellAnnouncer } from './shell-announcer';
import { StartActions } from './start-actions';
import { ImportCrypt } from './import-crypt';
import { useShelf } from './use-shelf';
import type { ShelfLoader } from './use-shelf';
import { listShelf } from '../../state/storage/shelf-repository';
import type { ImportedCrypt } from '../../state/storage/import-result';
import type { ShelfEntry } from './shelf-entry';

export interface FrontOfHouseNotes {
  readonly stats: NotesStats;
}

export interface FrontOfHouseStartProps {
  readonly context: CryptStartContext;
  readonly route: FrontOfHouseRoute;
  /** Where the hub is, and where the notes book is. Plain links, so reload and Back work. */
  readonly homeHref: string;
  readonly ingestHref: string;
  readonly store: NotesStore;
  readonly createClient?: IngestFlowProps['createClient'];
  /** Set once the notes are confirmed; null before, and again after the run starts. */
  readonly notes: FrontOfHouseNotes | null;
  readonly onConfirmed: (chunks: readonly Chunk[]) => void;
  /** Called when the notes book goes away (a run started): the host forgets the notes. */
  readonly onNotesGone: () => void;
  /** The one live region's message and its setter. */
  readonly message: string;
  readonly announce: (message: string) => void;
  /** The judge access code, held in memory by the host, and its setter. */
  readonly judgeCode: string;
  readonly onJudgeCode: (code: string) => void;
}

/**
 * The screens before the crypt: the desk, the open book, and the dig. Which one shows is derived by
 * `screenFor` from the generation state; nothing is stored here. The book stays mounted (hidden)
 * during the dig so the notes survive Cancel, and goes away when a run starts. The shell announcer
 * is the only live region while these screens are up.
 */
export function FrontOfHouseStart({
  context,
  route,
  homeHref,
  ingestHref,
  store,
  createClient,
  notes,
  onConfirmed,
  onNotesGone,
  message,
  announce,
  judgeCode,
  onJudgeCode,
}: FrontOfHouseStartProps): ReactNode {
  const screen = screenFor({ route, generation: context.generation.status, phase: 'not-started', descending: false });
  // The shelf reloads when `shelfVersion` changes: after an import, the new book is read from storage.
  const [shelfVersion, setShelfVersion] = useState(0);
  const [importedKey, setImportedKey] = useState<string | undefined>(undefined);
  const factory = context.deps.factory;
  const loader = useMemo<ShelfLoader>(
    () => async () => {
      void shelfVersion;
      const listed = await listShelf(factory);
      return listed.ok ? listed.value : [];
    },
    [factory, shelfVersion],
  );
  const shelf = useShelf(loader);
  const onImported = useCallback((imported: ImportedCrypt): void => {
    setImportedKey(imported.manifestId);
    setShelfVersion((version) => version + 1);
  }, []);
  const samples = useMemo(() => playableSamples(), []);

  // What is said here is stale once a run starts or the learner leaves.
  useEffect(() => {
    return () => {
      announce('');
      onNotesGone();
    };
  }, [announce, onNotesGone]);

  const { deps, onContinue, onStartAgain } = context;
  const renderBookActions = (entry: ShelfEntry): ReactNode =>
    entry.runId === null ? null : (
      <>
        <ResumeEntry
          key={entry.runId}
          runId={entry.runId}
          deps={deps}
          onContinue={onContinue}
          onStartAgain={onStartAgain}
          announce={announce}
        />
        <BookExport runId={entry.runId} deps={deps} onStatus={announce} />
      </>
    );

  return (
    <>
      {screen === 'hub' ? (
        <DeskHub
          shelf={shelf}
          samples={samples}
          bringHref={ingestHref}
          onPlaySample={context.playSample}
          renderBookActions={renderBookActions}
          importSlot={<ImportCrypt deps={deps} onImported={onImported} announce={announce} />}
          selectKey={importedKey}
        />
      ) : null}
      {route === 'ingest' ? (
        <BringNotesScreen
          hidden={screen !== 'bring'}
          backHref={homeHref}
          confirmed={notes !== null}
          ingest={<IngestFlow store={store} createClient={createClient} onConfirmed={onConfirmed} onAnnouncement={announce} />}
          settingsSlot={
            <SettingsSlot
              value={context.choice.value}
              onChange={context.choice.onChange}
              availability={context.choice.availability}
            />
          }
          judgeAccess={
            context.canGenerate ? (
              <JudgeAccess
                code={judgeCode}
                onChange={onJudgeCode}
                denied={context.generation.status === 'failed' && context.generation.kind === 'judge-access-denied'}
              />
            ) : undefined
          }
          actions={
            <StartActions
              onEnter={() => context.playSample()}
              generation={
                context.canGenerate
                  ? {
                      state: context.generation,
                      onGenerate: context.onGenerate,
                      onCancel: context.onCancelGeneration,
                      onPlaySample: () => context.playSample(),
                    }
                  : undefined
              }
            />
          }
        />
      ) : null}
      {screen === 'dig' && notes !== null ? (
        <DigScreen
          state={context.generation}
          onCancel={context.onCancelGeneration}
          notes={notes.stats}
          stages={digStagesFromGeneration(context.generation)}
          announce={announce}
        />
      ) : null}
      <ShellAnnouncer message={message} />
    </>
  );
}
