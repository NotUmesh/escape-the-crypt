/**
 * The files the haunting-polish spec may touch, and the ones it must not. Test support only:
 * `scope-fence.test.ts` reads it, and `haunting-copy.test.ts` scans the files it names.
 */
const CRYPT = 'apps/web/src/features/crypt';

/** New files the spec adds, relative to the repository root. */
export const HAUNTING_NEW_FILES: readonly string[] = [
  'haunting-scope.ts',
  'scope-fence.test.ts',
  'overlay-stacking.test.ts',
  'overlay-contrast.test.ts',
  'motion-css-audit.ts',
  'crypt-motion-css.test.ts',
  'haunting-stage-motion.test.tsx',
  'motion-moments.ts',
  'motion-moments.test.ts',
  'motion-moments-properties.test.ts',
  'motion-moments-boundary.test.ts',
  'autopsy-parchment.test.tsx',
  'quill-mark.tsx',
  'quill-mark.css',
  'quill-mark.test.tsx',
  'lantern-screens.test.tsx',
  'outside-crypt-motion-audit.test.ts',
  'haunting-copy.test.ts',
].map((name) => `${CRYPT}/${name}`);

/** Existing files that must not change under this spec. */
export const HAUNTING_FROZEN_FILES: readonly string[] = [
  'room-screen.tsx',
  'art-room.ts',
  'question-controls.tsx',
  'rune-cipher-panel.tsx',
  'room-panel.tsx',
  'lock-panel-context.ts',
  'lock-panel-registry.ts',
  'bone-ordering-panel.tsx',
  'bound-threads-panel.tsx',
  'combination-dial-panel.tsx',
  'cursed-object-panel.tsx',
].map((name) => `${CRYPT}/${name}`);

const FROZEN_DIRECTORIES: readonly string[] = [
  'packages/core/src/pipeline/',
  'packages/core/src/checks/',
  'packages/core/src/mapper/',
  'packages/core/src/authoring/',
  'apps/worker/',
  'eval/',
  'apps/web/src/state/',
];
const ALLOWED_PATTERNS: readonly RegExp[] = [
  new RegExp(`^${CRYPT}/[\\w-]+\\.css$`),
  /^\.kiro\/specs\/haunting-polish\//,
  /^docs\/build-log\.md$/,
  /^apps\/web\/e2e\/haunting-[\w-]+\.e2e\.ts$/,
  // integration renames swept into a32c426
  /^packages\/core\/src\/copy-front-of-house\.ts$/,
  /^packages\/core\/src\/copy-front-of-house\.test\.ts$/,
  /^packages\/core\/src\/copy-share\.ts$/,
  /^packages\/core\/src\/copy-share\.test\.ts$/,
];

/** The paths in `changed` that this spec may not change. */
export function scopeViolations(changed: readonly string[]): readonly string[] {
  return changed.filter((path) => {
    if (HAUNTING_FROZEN_FILES.includes(path)) return true;
    if (FROZEN_DIRECTORIES.some((dir) => path.startsWith(dir))) return true;
    if (HAUNTING_NEW_FILES.includes(path)) return false;
    return !ALLOWED_PATTERNS.some((pattern) => pattern.test(path));
  });
}
