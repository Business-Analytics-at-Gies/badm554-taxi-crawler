// Independent valid-SQL fixtures shared by scanner, native DuckDB and game API tests.
const longTag = `$tag_${'x'.repeat(96)}$`;
const helper = (name, create, value) => ({ name, sql: `${create};\nSELECT note FROM note;`,
  statements: [create, 'SELECT note FROM note'], value });
export const SQL_CASES = [
  helper('nested block comments', `/* Previous attempt:
    /* remove duplicates */
    DELETE FROM trips_clean;
  */
CREATE OR REPLACE TABLE note AS SELECT 'kept' AS note`, 'kept'),
  helper('E-string escaped quote', String.raw`CREATE OR REPLACE TABLE note AS SELECT E'it\'s; a note' AS note`, "it's; a note"),
  helper('lowercase E-string escapes and doubled quotes', String.raw`CREATE OR REPLACE TABLE note AS SELECT e'one\\two; it\'s ''quoted''' AS note`, "one\\two; it's 'quoted'"),
  helper('plain string with literal backslash', String.raw`CREATE OR REPLACE TABLE note AS SELECT 'one\two; it''s quoted' AS note`, "one\\two; it's quoted"),
  helper('plain string ending in a literal backslash', String.raw`CREATE OR REPLACE TABLE note AS SELECT 'path\' AS note`, 'path\\'),
  helper('untagged dollar string', `CREATE OR REPLACE TABLE note AS SELECT $$one; 'two'; /* not a comment */$$ AS note`, "one; 'two'; /* not a comment */"),
  helper('tagged dollar string with different inner tag', `CREATE OR REPLACE TABLE note AS SELECT $tag_12$one; $other$; "two"$tag_12$ AS note`, 'one; $other$; "two"'),
  helper('long dollar tag', `CREATE OR REPLACE TABLE note AS SELECT ${longTag}one; 'two'${longTag} AS note`, "one; 'two'"),
  helper('Unicode dollar tag', `CREATE OR REPLACE TABLE note AS SELECT $ετικέτα$one; 'two'$ετικέτα$ AS note`, "one; 'two'"),
  helper('CR terminates a line comment', `-- previous attempt;\rCREATE OR REPLACE TABLE note AS SELECT 'CR is a line break' AS note`, 'CR is a line break'),
  { name: 'dollar markers within an unquoted identifier',
    sql: `CREATE OR REPLACE TABLE note$tag$name AS SELECT 'kept' AS note; SELECT note FROM note$tag$name;`,
    statements: [`CREATE OR REPLACE TABLE note$tag$name AS SELECT 'kept' AS note`, 'SELECT note FROM note$tag$name'], value: 'kept' },
  { name: 'quoted identifiers and doubled identifier quotes',
    sql: `CREATE OR REPLACE TABLE "note;""/*id*/" AS SELECT 'kept; /* text */' AS "value;""id"; SELECT "value;""id" AS note FROM "note;""/*id*/";`,
    statements: [`CREATE OR REPLACE TABLE "note;""/*id*/" AS SELECT 'kept; /* text */' AS "value;""id"`,
      `SELECT "value;""id" AS note FROM "note;""/*id*/"`], value: 'kept; /* text */' },
];
