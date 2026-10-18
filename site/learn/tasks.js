// Stage 1 shared task wording. Floor packs will own the complete floor content in stage 2.
export const FLOOR1_TASK = 'Create trips_clean with exactly one row per trip key, and every column of trips_raw. A trip key is the set of columns that together identify one trip. Two trips that differ in any amount are different trips. row_id and loaded_at describe the load, not the trip.';
export const RERUN_INSTRUCTION = 'Use CREATE OR REPLACE TABLE to run your SQL again without a DROP.';
