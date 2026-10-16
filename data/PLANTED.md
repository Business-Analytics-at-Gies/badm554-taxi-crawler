# What is real and what is planted

Created: 2026-10-16
Last Updated: 2026-10-16

Source: TLC yellow taxi trips, January 2024 (2,964,624 rows), and the TLC zone lookup, both from
`https://d37ci6vzurychx.cloudfront.net/`. Built by `tools/build_extract.sql`; a rebuild gives the
same content (row-wise md5 `b3250b54337f64d9e3f2eb874bc2421d`).

## Real (as TLC published it)

- About 7,000 trips by hash sample, plus forced real cases so each rule has enough rows:
  up to 40 negative fares, 20 drop-offs before pick-up, all 18 pick-ups outside January,
  20 zero-distance trips with a fare of $50 or more, 60 trips touching zone 264, 30 touching 265.
- Columns renamed to snake_case; `RatecodeID`, `store_and_fwd_flag`, surcharges and fees dropped.

## Planted (not in the TLC data)

| What | How many | How to tell |
|---|---|---|
| Duplicate load of 2024-01-15 pick-ups | 174 rows | `loaded_at = 2024-02-01 06:40`, `row_id` above 7,171 |
| Drop-off id 0 (not in the lookup) | 15 rows | `do_location_id = 0` |
| Drop-off id NULL | 10 rows | `do_location_id IS NULL` |
| `row_id`, `loaded_at` columns | all rows | added by the build |

Tell learners which dirt is planted when they ask; it is not a secret.
