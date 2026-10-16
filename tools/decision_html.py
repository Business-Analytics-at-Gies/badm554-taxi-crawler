"""Rebuild docs/decisions/2026-10-16-decision-tree.html from the kickoff log's two tables.

The markdown log is the source; run this after every edit to it.
Usage: python3 tools/decision_html.py
"""
import html
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs/decisions/2026-10-16-kickoff.md"
OUT = ROOT / "docs/decisions/2026-10-16-decision-tree.html"

CSS = """:root{--bg:#fbfaf7;--fg:#1d1f22;--mut:#5b6068;--line:#d9d5cc;--acc:#8a5108;--card:#fff}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#16181b;--fg:#e8e6e1;--mut:#a3a8b0;--line:#33373d;--acc:#f0b04a;--card:#1e2125}}
:root[data-theme="dark"]{--bg:#16181b;--fg:#e8e6e1;--mut:#a3a8b0;--line:#33373d;--acc:#f0b04a;--card:#1e2125}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 "Source Sans 3","Source Sans Pro",Georgia,serif;padding:24px 16px}
main{max-width:760px;margin:0 auto}h1{font-size:1.6rem;margin:0 0 4px}h2{font-size:1.15rem;margin:28px 0 8px;color:var(--acc)}
p.meta{color:var(--mut);margin:0 0 16px}details{background:var(--card);border:1px solid var(--line);border-radius:8px;margin:8px 0;padding:0 14px}
summary{cursor:pointer;padding:12px 0;overflow-wrap:anywhere}summary .q{font-weight:700}summary .c{color:var(--mut)}
summary:focus-visible{outline:3px solid var(--acc);outline-offset:2px}dl{margin:0 0 12px}dt{font-weight:700;margin-top:6px}dd{margin:0 0 4px}
code{font-size:.9em;overflow-wrap:anywhere}"""


def inline(text):
    return re.sub(r"`([^`]+)`", r"<code>\1</code>", html.escape(text))


def rows(section):
    out = []
    for line in section.splitlines():
        if line.startswith("| ") and not line.startswith("| Question"):
            cells = [c.strip() for c in line.strip().strip("|").split(" | ")]
            if len(cells) == 4:
                out.append(cells)
    return out


def block(title, items, open_first=False):
    parts = [f"<h2>{title}</h2>"]
    for i, (q, chosen, rejected, revisit) in enumerate(items):
        attr = " open" if open_first and i == 0 else ""
        parts.append(
            f'<details{attr}><summary><span class="q">{inline(q)}</span> '
            f'<span class="c">{inline(chosen)}</span></summary>\n'
            f"<dl><dt>Chosen</dt><dd>{inline(chosen)}</dd><dt>Rejected</dt><dd>{inline(rejected)}</dd>"
            f"<dt>Revisit if</dt><dd>{inline(revisit)}</dd></dl></details>"
        )
    return "\n".join(parts)


def main():
    s = SRC.read_text()
    kickoff = rows(s.split("## Decision tree")[1].split("## Design session")[0])
    design = rows(s.split("## Design session decisions")[1].split("## Open questions")[0])
    updated = re.search(r"Last Updated: (\S+)", s).group(1)
    OUT.write_text(f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Taxi Crawler Decisions</title>
<style>
{CSS}
</style></head><body><main>
<h1>Taxi crawler: decision tree</h1>
<p class="meta">Created 2026-10-16. Last updated {updated}. Built from <code>docs/decisions/2026-10-16-kickoff.md</code> by <code>tools/decision_html.py</code>; the markdown wins if they differ. Open a row to see what was rejected and when to revisit.</p>
{block("Kickoff (control session, 2026-10-16)", kickoff)}
{block("Design session (2026-10-16)", design, open_first=True)}
</main></body></html>
""")
    print(f"{len(kickoff)} kickoff + {len(design)} design rows -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
