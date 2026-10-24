Reviewed HEAD `e62371d`, read-only. I built all three packs in memory, inspected the actual guides and generated content, and tested with the pinned DuckDB **1.5.4** engine. All 16 current refresher examples ran. No files changed.

| Round 2 finding | Status | Current spec line |
|---|---|---|
| Inline expressions parsed but not inspected | **Closed.** Both layers apply, and the wrapped expression is explicitly inspected. | [259–261](docs/v2/stage2-resume-2026-10-23.md#L259), acceptance [315–316](docs/v2/stage2-resume-2026-10-23.md#L315) |
| Acceptance contradicts allowed inline names and phrases | **Open.** The source-kind acceptance is corrected, but the blanket instruction that every earlier-review input must fail still includes those permitted inputs. | [293–295](docs/v2/stage2-resume-2026-10-23.md#L293) versus [313–317](docs/v2/stage2-resume-2026-10-23.md#L313) |
| Token rules confuse names with functions and clauses | **Closed.** Functions are checked on actual function nodes. Keyword-shaped names now have an explicit quoting rule and positive tests. | [235–246](docs/v2/stage2-resume-2026-10-23.md#L235), acceptance [318–320](docs/v2/stage2-resume-2026-10-23.md#L318) |

**A permitted implementation can still accept an untaught construct. The prescribed guide-blank rewrite also leaves valid current teaching examples rejected.**

**FIX**

1. **[P1] Recognizing every field does not establish that every use of that field is supported.** Spec [238–247](docs/v2/stage2-resume-2026-10-23.md#L238), with acceptance at [305–312](docs/v2/stage2-resume-2026-10-23.md#L305).

   Concrete scenario: replace floor 1’s reference with `SELECT DISTINCT ON (the six trip-key columns) * FROM trips_raw ORDER BY the same columns, row_id`. I ran this against the actual taxi data: it returned **7,171 rows, with zero differences from the current reference**.

   Ordinary `DISTINCT` already produces a `distinct_on_targets` field containing an empty list. `DISTINCT ON` fills that existing list with ordinary column references. My comparison against the current packs found **no new field names, node types, function names, enum values, or keywords**. A builder can therefore recognize every field and inspect every child, map the modifier to the existing `SELECT_DISTINCT` concept, and accept this query using floor 1’s ordinary DISTINCT refresher. That lesson does not teach choosing one whole row per distinct key with `DISTINCT ON`.

   Require the map to distinguish inactive and active optional features—for example, empty versus nonempty lists—and require separate teaching credit or rejection for `DISTINCT ON`. Add acceptance tests that activate existing fields using otherwise familiar expressions. Unknown-field, unknown-enum, and COALESCE tests do not establish this.

2. **[P2] The blanket earlier-review acceptance rule still contradicts permitted sources.** Spec [293–295](docs/v2/stage2-resume-2026-10-23.md#L293), conflicting with [262–266](docs/v2/stage2-resume-2026-10-23.md#L262) and [315](docs/v2/stage2-resume-2026-10-23.md#L315).

   The first R3b review explicitly includes current guide inputs such as `trips_raw` and `SELECT DISTINCT`. Line 295 requires every input from that review to fail, with only the AVG-frame exception. The revised source rules require these names and phrases to pass in a pack with the necessary declarations.

   Replace “all of them fail” with explicit fixture expectations and pack context. Keep the bad-pack reproductions failing while accepting permitted names, supported phrases, and positive controls.

3. **[P2] Replacing comment blanks cannot make the current standalone CASE blocks complete SQL.** Spec [251–258](docs/v2/stage2-resume-2026-10-23.md#L251), with acceptance at [313–317](docs/v2/stage2-resume-2026-10-23.md#L313).

   Concrete examples are [floor 2’s flag example](site/floors/floor2/guide.html#L84) and [floor 3’s reason example](site/floors/floor3/guide.html#L64). Both `<pre>` blocks start with `CASE WHEN` and end with a column alias. Neither is a complete statement. Filling their blanks with placeholder names or `SELECT NULL` still produces a syntax error at `CASE`; the inline-expression wrapper does not apply inside `<pre>`.

   Explicitly include these blocks in the migration: turn them into complete `SELECT` examples, or define an inspected wrapper for expression blocks. The current blank-only instruction cannot satisfy the requirement that all current sources pass after rewriting.