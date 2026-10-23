// Local help belongs to the browser, independently of the tutor or SQL grader.
export function createHintLadder(storage) {
  const key = 'tc.hint-rungs';
  let counters = {};
  try {
    const saved = JSON.parse(storage.getItem(key));
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      for (const [floor, rules] of Object.entries(saved)) {
        if (!/^\d+$/.test(floor) || !rules || typeof rules !== 'object' || Array.isArray(rules)) continue;
        counters[floor] = {};
        for (const [rule, rung] of Object.entries(rules)) {
          if (/^[a-z][a-z0-9_]*$/.test(rule) && Number.isInteger(rung) && rung >= 1 && rung <= 3) counters[floor][rule] = rung;
        }
      }
    }
  } catch { /* Unavailable or malformed storage starts fresh, with in-memory help. */ }
  const save = () => { try { storage.setItem(key, JSON.stringify(counters)); } catch { /* Keep helping in memory. */ } };
  return {
    fail(floor, rule) {
      const rules = counters[floor] ??= {};
      const rung = rules[rule] = Math.min(3, (Object.hasOwn(rules, rule) ? rules[rule] : 0) + 1);
      save(); return rung;
    },
    reset(floor, rule) {
      if (rule) delete counters[floor]?.[rule];
      else delete counters[floor];
      save();
    },
  };
}
