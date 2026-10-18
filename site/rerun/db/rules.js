// Created: 2026-10-18. Last Updated: 2026-10-18.
// Frozen R1 scenarios: docs/rerun/floors.md. No pilot floor rules are changed.
export const COLUMNS = Object.freeze(['trip_id', 'row_id', 'vendor_id', 'pickup_at', 'dropoff_at',
  'passenger_count', 'trip_distance', 'pu_location_id', 'do_location_id', 'payment_type',
  'fare_amount', 'tip_amount', 'total_amount', 'loaded_at']);
export const RUNS = Object.freeze([
  { run: 'day1-first', day: 1, condition: 'run twice' },
  { run: 'day1-repeat', day: 1, condition: 'run twice' },
  { run: 'day2-first', day: 2, condition: 'new day' },
  { run: 'day2-repeat', day: 2, condition: 'run twice' },
  { run: 'day3-first', day: 3, condition: 'correction' },
  { run: 'day3-repeat', day: 3, condition: 'run twice' },
  { run: 'day3-rebuild', day: 3, condition: 'rebuild' },
].map(Object.freeze));
export const scenario = (floor) => RUNS.slice(0, floor === 1 ? 2 : floor === 2 ? 4 : 7);
export const quote = (s) => `"${s.replaceAll('"', '""')}"`;
export const projection = (table, metadata = true) => `SELECT ${COLUMNS
  .filter((c) => metadata || !['row_id', 'loaded_at'].includes(c))
  .map((c) => ['fare_amount', 'tip_amount', 'total_amount'].includes(c)
    ? `round(${quote(c)},2) AS ${quote(c)}` : quote(c)).join(',')} FROM ${table}`;
export const equal = (a, b) => `NOT EXISTS (
  (SELECT * FROM (${a}) EXCEPT ALL SELECT * FROM (${b}))
  UNION ALL (SELECT * FROM (${b}) EXCEPT ALL SELECT * FROM (${a})))`;
