import type { ColumnType, Generated } from "kysely";

export interface Database {
  maps: MapsTable;
  accounts: AccountsTable;
  characters: CharactersTable;
  scripted_cells: ScriptedCellsTable;
}

export interface MapsTable {
  id: number;
  width: number;
  height: number;
  x: number;
  y: number;
  superarea: number;
  background: number;
  places: string;
  cells: ColumnType<unknown, string, string>; // JSONB
  cells_gzip: Buffer;
  walkable_ids: number[];
  monsters: string;
}

export interface AccountsTable {
  id: Generated<number>;
  username: string;
  password: string;
  pseudo: string;
}

export interface CharactersTable {
  id: Generated<number>;
  account_id: number;
  name: string;
  class: number;
  sex: number;
  color1: number;
  color2: number;
  color3: number;
  gfx: number;
  level: number;
  map_id: number;
  cell_id: number;
  direction: number;
  // Stats
  vitality: number;
  wisdom: number;
  strength: number;
  chance: number;
  agility: number;
  intelligence: number;
  hp: number;
  max_hp: number;
  ap: number;
  mp: number;
  energy: number;
  max_energy: number;
  bonus_points: number;
  bonus_points_spell: number;
  xp: number;
  xp_low: number;
  xp_high: number;
  kama: number;
  initiative: number;
  discernment: number;
  range: number;
  summon_limit: number;
}

export interface ScriptedCellsTable {
  map_id: number;
  cell_id: number;
  action_id: number;
  event_id: number;
  action_args: string;
  conditions: string;
}
