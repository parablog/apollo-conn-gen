// Shared test setup: mute console noise and expose captureWarnings.
// Imported first by every split test file so muting is in effect before tests run.
console.log = () => {};
console.warn = () => {};
console.error = () => {};

// The suite globally no-ops console.warn (above). Deferred-is-loud cases temporarily install a
// capturing stub and restore the original in a `finally` so the warnings are actually observable.
export async function captureWarnings(fn: () => Promise<void>): Promise<string[]> {
  const orig = console.warn;
  const warnings: string[] = [];
  console.warn = (...a: unknown[]) => {
    warnings.push(a.join(' '));
  };
  try {
    await fn();
  } finally {
    console.warn = orig;
  }
  return warnings;
}
