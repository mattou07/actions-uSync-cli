/** Waits for `ms` milliseconds. Kept in its own module so tests can mock it. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
