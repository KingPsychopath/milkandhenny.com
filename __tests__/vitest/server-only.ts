// Vitest runs outside Next's bundler, so the real `server-only` package throws at runtime.
// In tests, we just need it to be a no-op marker import.

export {};

