// Shared test setup: mute console noise and expose captureWarnings.
// Imported first by every split test file so muting is in effect before tests run.
console.log = () => {};
console.warn = () => {};
console.error = () => {};

// The suite globally no-ops console.warn (above). Deferred-is-loud cases temporarily install a
// capturing stub and restore the original in a `finally` so the warnings are actually observable.
export async function captureWarnings(fn: () => Promise<void>): Promise<string[]> {
  return capture('warn', fn);
}

// Same, for warnings routed through the project logger (`log/trace.ts` `warn`), which writes to
// console.error (e.g. the R4 errors version-downgrade notice).
export async function captureErrors(fn: () => Promise<void>): Promise<string[]> {
  return capture('error', fn);
}

async function capture(channel: 'warn' | 'error', fn: () => Promise<void>): Promise<string[]> {
  const orig = console[channel];
  const messages: string[] = [];
  console[channel] = (...a: unknown[]) => {
    messages.push(a.join(' '));
  };
  try {
    await fn();
  } finally {
    console[channel] = orig;
  }
  return messages;
}
