export async function withRequestDeadline<T>(
  signal: AbortSignal,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  // AbortSignal.any and AbortSignal.timeout are newer than some supported browsers.
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  if (signal.aborted) cancel();
  else signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), timeoutMs);

  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}
