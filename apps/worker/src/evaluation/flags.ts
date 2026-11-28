/** `--name value` pairs, repeatable. A flag with no value (or followed by another flag) is `'true'`. */
export function parseFlags(argv: readonly string[]): Record<string, string[]> {
  const flags: Record<string, string[]> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i] ?? '';
    if (!key.startsWith('--')) continue;
    const value = argv[i + 1];
    const name = key.slice(2);
    if (value === undefined || value.startsWith('--')) (flags[name] ??= []).push('true');
    else {
      (flags[name] ??= []).push(value);
      i += 1;
    }
  }
  return flags;
}
