import { z } from 'zod';

// Zod compiles object parsers with `new Function` unless jitless is set. That is dynamic code
// execution, which this project never allows, and a strict CSP (`script-src 'self'`) blocks it.
// The probe runs when a schema is created, so this must run before any schema is defined:
// every schema in core imports `z` from here, never from 'zod' directly.
z.config({ jitless: true });

export { z };
