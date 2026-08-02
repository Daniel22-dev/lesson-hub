export class SlidingWindowLimiter {
  constructor({ windowMs, maxAttempts, cleanupEvery = 100 }) {
    this.windowMs = windowMs;
    this.maxAttempts = maxAttempts;
    this.cleanupEvery = cleanupEvery;
    this.entries = new Map();
    this.operations = 0;
  }

  #valid(key, now) {
    const valid = (this.entries.get(key) || []).filter((time) => now - time < this.windowMs);
    if (valid.length) this.entries.set(key, valid);
    else this.entries.delete(key);
    return valid;
  }

  #cleanup(now) {
    this.operations += 1;
    if (this.operations % this.cleanupEvery !== 0) return;
    for (const key of this.entries.keys()) this.#valid(key, now);
  }

  assert(key) {
    const now = Date.now();
    this.#cleanup(now);
    const valid = this.#valid(key, now);
    if (valid.length >= this.maxAttempts) {
      const retryAfterSeconds = Math.max(1, Math.ceil((this.windowMs - (now - valid[0])) / 1000));
      const error = new Error('Příliš mnoho pokusů. Zkuste to později.');
      error.status = 429;
      error.code = 'rate_limited';
      error.retryAfterSeconds = retryAfterSeconds;
      throw error;
    }
    valid.push(now);
    this.entries.set(key, valid);
  }

  reset(key) {
    this.entries.delete(key);
  }
}
