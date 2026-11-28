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
  /^apps\/web\/e2e\/haunting-[\w-]+\.(e2e\.)?ts$/,
  /^docs\/screenshots\/haunting\/[\w-]+\.jpg$/,
  // Edits the user approved, one by one. Each landed in a commit named "Haunting polish (decision ...)".
  /^apps\/web\/src\/features\/crypt\/autopsy-view\.tsx$/, // decision 2: the quill and the Lantern toggle
  /^apps\/web\/src\/features\/crypt\/final-door\.tsx$/, // decision 2: the Lantern toggle in the escape view
  /^apps\/web\/src\/features\/crypt\/art-stage\.tsx$/, // decision 3: data-moment on the stage
  /^apps\/web\/src\/features\/crypt\/crypt-flow\.tsx$/, // announcements: notices released a render late
  /^apps\/web\/src\/features\/crypt\/room-screen\.tsx$/, // due ghost: drawn until laid to rest
  /^apps\/web\/src\/features\/crypt\/(door-stage|crypt-run-view|use-placed-ghosts)\.tsx?$/, // supporting edits for the due ghost
  /^apps\/web\/src\/features\/(desk|descent)\/(desk-scene|descent)\.css$/, // decision 4: reduced-motion rules
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
