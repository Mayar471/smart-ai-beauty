import { AppError } from './errors.mjs';

/** Small in-memory sliding-window counter used to protect the free AI quotas. */
export class RateLimiter {
  constructor() {
    this.entries = new Map();
  }

  /** Counts one use of `key`; throws 429 with `message` after `max` uses inside `windowMs`. */
  take(key, max, windowMs, message) {
    const now = Date.now();
    for (const [k, entry] of this.entries) if (entry.until < now) this.entries.delete(k);
    let entry = this.entries.get(key);
    if (!entry) this.entries.set(key, (entry = { count: 0, until: now + windowMs }));
    if (entry.count >= max) throw new AppError(429, message);
    entry.count++;
  }

  /** Gives a use back, for requests that failed before reaching the paid-for service. */
  refund(key) {
    const entry = this.entries.get(key);
    if (entry && entry.count > 0) entry.count--;
  }
}
