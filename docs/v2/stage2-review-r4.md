SHIP

No actionable defects found in `f805c00..8ecd8b2` on `v2/stage2`. The round 3 timestamp finding is closed across all four packs, and the earlier grading findings remain closed.

Verified:

- **2,506 database tests passed**, including the generated comparison matrix and new `24:00` cases.
- **69 server tests passed.**
- **12 focused browser tests passed with the real engine**, including fourth-pack checking/rendering, guide placement, JavaScript-off content, desktop and 375 px layouts, and emulated iPhone typing.
- Additional real-engine probes accepted equivalent offsets, native TIMESTAMPTZ values, trailing fractional zeros, and date-only text representing midnight. They rejected changed instants, discarded hours, nonzero subnanosecond changes, invalid clocks, and infinity substituted for ordinary timestamps.
- **40 additional shared-comparison cases passed** under UTC, New York, Kolkata, and Kiritimati session time zones in the DuckDB CLI. The browser engine blocks session-time-zone changes.
- No comparison bypass found in the key, partition, reason, or row-count paths reviewed.
- The revised guide sentence matches the tested behavior and appears in each floor’s “How the check works” detail.
- All **21 generated assets** match their sources. Protected Rerun paths and the three named shared files remain untouched. No source files were modified.

Nondefault session time zones were tested in the CLI rather than the browser engine. Real iPhone Safari remains a manual check; emulated WebKit passing does not establish that #32 is fixed on the phone.