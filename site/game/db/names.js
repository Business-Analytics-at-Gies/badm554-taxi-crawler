export const BASE = '_base';
export const ref = n => `_ref${n}`;
export const learner = n => `floor${n}`;
export const TUTOR = 'tutor';
export const qi = name => `"${String(name).replace(/"/g, '""')}"`;
export const qs = text => `'${String(text).replace(/'/g, "''")}'`;
