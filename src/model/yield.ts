/**
 * Cooperative yielding for the main thread, where the sandbox allows no
 * workers. A fixed yield every N steps spends far more time waiting on timer
 * clamps than working: a 10,000-cell notebook yields 99 times, and Chromium
 * clamps nested `setTimeout(0)` to 4 ms each. So the loop only yields once the
 * current batch has actually run for `budgetMs`, checked every `every` steps.
 */

const yieldToBrowserImpl = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** The longest a batch may run before the loop yields, in milliseconds. */
export const YIELD_BUDGET_MS = 30

/**
 * Returns a function that reports, every `every` steps, whether the loop
 * should now yield. Batches stay short even when each step is expensive,
 * because the decision is time-based, not step-based.
 */
export function createYieldPolicy(every: number, budgetMs = YIELD_BUDGET_MS): (step: number) => boolean {
  const checkEvery = Number.isFinite(every) && every > 0 ? Math.floor(every) : 1
  let lastYield = performance.now()
  return (step) => {
    if (step <= 0 || step % checkEvery !== 0) return false
    const now = performance.now()
    if (now - lastYield < budgetMs) return false
    lastYield = now
    return true
  }
}

/** Pauses the loop for one turn of the event loop. */
export function yieldToBrowser(): Promise<void> {
  return yieldToBrowserImpl()
}
