export function createSlidingWindowCounter({
  windowMs,
  threshold,
  now = Date.now,
}: {
  windowMs: number;
  threshold: number;
  now?: () => number;
}) {
  const events = new Map<string, number[]>();
  return {
    record(key: string): { crossed: boolean; count: number } {
      const timestamp = now();
      const retained = (events.get(key) ?? []).filter(
        (item) => item > timestamp - windowMs,
      );
      retained.push(timestamp);
      events.set(key, retained);
      return { crossed: retained.length === threshold, count: retained.length };
    },
    clear(key: string) {
      events.delete(key);
    },
  };
}
