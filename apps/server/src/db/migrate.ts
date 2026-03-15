import { sql } from 'kysely';
import { db } from './database.ts';

async function migrate() {
  console.log('Running migrations...');

  await db.schema
    .createTable('maps')
    .ifNotExists()
    .addColumn('id', 'integer', (col) => col.primaryKey())
    .addColumn('width', 'integer', (col) => col.notNull())
    .addColumn('height', 'integer', (col) => col.notNull())
    .addColumn('x', 'integer', (col) => col.notNull())
    .addColumn('y', 'integer', (col) => col.notNull())
    .addColumn('superarea', 'integer', (col) => col.notNull())
    .addColumn('background', 'integer', (col) => col.defaultTo(0))
    .addColumn('places', 'text', (col) => col.defaultTo(''))
    .addColumn('cells', 'jsonb', (col) => col.notNull())
    .addColumn('cells_gzip', sql`bytea`, (col) => col.notNull())
    .addColumn('walkable_ids', sql`integer[]`, (col) => col.notNull())
    .addColumn('monsters', 'text', (col) => col.defaultTo(''))
    .execute();

  await db.schema
    .createTable('accounts')
    .ifNotExists()
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('username', 'varchar(30)', (col) => col.unique().notNull())
    .addColumn('password', 'varchar(50)', (col) => col.notNull())
    .addColumn('pseudo', 'varchar(30)', (col) => col.notNull())
    .execute();

  await db.schema
    .createTable('characters')
    .ifNotExists()
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('account_id', 'integer', (col) => col.notNull().references('accounts.id'))
    .addColumn('name', 'varchar(30)', (col) => col.unique().notNull())
    .addColumn('class', 'smallint', (col) => col.notNull())
    .addColumn('sex', 'smallint', (col) => col.notNull())
    .addColumn('color1', 'integer', (col) => col.defaultTo(-1))
    .addColumn('color2', 'integer', (col) => col.defaultTo(-1))
    .addColumn('color3', 'integer', (col) => col.defaultTo(-1))
    .addColumn('gfx', 'integer', (col) => col.notNull())
    .addColumn('level', 'integer', (col) => col.defaultTo(1))
    .addColumn('map_id', 'integer', (col) => col.defaultTo(8479))
    .addColumn('cell_id', 'integer', (col) => col.defaultTo(314))
    .addColumn('direction', 'smallint', (col) => col.defaultTo(1))
    .execute();

  await db.schema
    .createTable('scripted_cells')
    .ifNotExists()
    .addColumn('map_id', 'integer', (col) => col.notNull())
    .addColumn('cell_id', 'integer', (col) => col.notNull())
    .addColumn('action_id', 'integer', (col) => col.notNull())
    .addColumn('event_id', 'integer', (col) => col.notNull())
    .addColumn('action_args', 'text', (col) => col.defaultTo(''))
    .addColumn('conditions', 'text', (col) => col.defaultTo(''))
    .execute();

  // Index for fast lookup by map_id
  await sql`CREATE INDEX IF NOT EXISTS idx_scripted_cells_map_id ON scripted_cells (map_id)`.execute(db);

  console.log('Migrations complete.');
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
