<?php
/**
 * One-time migration: MySQL metadata + SWF cell parsing -> PostgreSQL
 *
 * Uses arakne/php-map-parser to correctly parse cells from SWF files.
 * MySQL provides metadata (positions, places, monsters).
 *
 * Usage: cd tools/map-migration && php migrate.php
 */

require_once __DIR__ . '/vendor/autoload.php';

use Arakne\MapParser\Loader\MapLoader;
use Arakne\MapParser\Loader\MapStructure;
use Arakne\MapParser\Loader\MapKey;
use Arakne\Swf\SwfFile;

// --- Config ---
$mysqlHost = getenv('MYSQL_HOST') ?: 'localhost';
$mysqlDb   = getenv('MYSQL_DB')   ?: 'dofus';
$mysqlUser = getenv('MYSQL_USER') ?: 'grandnainconnu';
$mysqlPass = getenv('MYSQL_PASS') ?: '';

$pgHost = getenv('PG_HOST') ?: 'localhost';
$pgPort = getenv('PG_PORT') ?: '5432';
$pgDb   = getenv('PG_DB')   ?: 'dofus';
$pgUser = getenv('PG_USER') ?: 'dofus';
$pgPass = getenv('PG_PASS') ?: 'dofus';

$mapsDir    = '/Users/grandnainconnu/Work/personal/dofus/dofus1.29/clients/Retro1.47/Dofus Retro.app/Contents/Resources/app/retroclient/data/maps';
$mapKeysDir = '/Users/grandnainconnu/Work/personal/dofus/dofus1.29/MapKeys-DR/maps';

// --- Helpers ---

function parseMapPos(string $mappos): array {
    $parts = explode(',', $mappos);
    return [
        'x'         => (int)($parts[0] ?? 0),
        'y'         => (int)($parts[1] ?? 0),
        'superarea' => (int)($parts[2] ?? 0),
    ];
}

function findSwfFile(int $mapId, string $dir): ?string {
    $files = glob("$dir/{$mapId}_*X.swf");
    return $files[0] ?? null;
}

function findKeyFile(int $mapId, string $swfPath, string $keysDir): ?string {
    // Key file name matches SWF but without the trailing X and with .txt
    $baseName = basename($swfPath);
    $keyName = str_replace('X.swf', '.txt', $baseName);
    $keyPath = "$keysDir/$keyName";
    if (file_exists($keyPath)) return $keyPath;

    // Fallback: glob for any key matching the map ID
    $files = glob("$keysDir/{$mapId}_*.txt");
    return $files[0] ?? null;
}

// --- Connect ---
$mysql = new PDO("mysql:host=$mysqlHost;dbname=$mysqlDb;charset=utf8", $mysqlUser, $mysqlPass);
$mysql->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

$pg = new PDO("pgsql:host=$pgHost;port=$pgPort;dbname=$pgDb", $pgUser, $pgPass);
$pg->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

echo "Connected to MySQL and PostgreSQL.\n";

// --- Load MySQL metadata ---
echo "Loading MySQL map metadata...\n";
$stmt = $mysql->query('SELECT id, width, heigth, mappos, places, monsters FROM maps');
$mysqlMaps = [];
while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
    $mysqlMaps[(int)$row['id']] = $row;
}
echo "Found " . count($mysqlMaps) . " maps in MySQL.\n";

// --- Prepare PostgreSQL insert ---
$pgInsert = $pg->prepare('
    INSERT INTO maps (id, width, height, x, y, superarea, background, places, cells, cells_gzip, walkable_ids, monsters)
    VALUES (:id, :width, :height, :x, :y, :superarea, :background, :places, :cells, :cells_gzip, :walkable_ids, :monsters)
    ON CONFLICT (id) DO UPDATE SET
        width = EXCLUDED.width, height = EXCLUDED.height,
        x = EXCLUDED.x, y = EXCLUDED.y, superarea = EXCLUDED.superarea,
        background = EXCLUDED.background, places = EXCLUDED.places,
        cells = EXCLUDED.cells, cells_gzip = EXCLUDED.cells_gzip,
        walkable_ids = EXCLUDED.walkable_ids, monsters = EXCLUDED.monsters
');

// --- Parse SWF files and migrate ---
echo "Scanning SWF map files...\n";

$loader = new MapLoader();
$success = 0;
$errors = 0;
$skipped = 0;

$swfFiles = glob("$mapsDir/*_*X.swf");
echo "Found " . count($swfFiles) . " SWF map files.\n";

foreach ($swfFiles as $swfPath) {
    $baseName = basename($swfPath);
    // Extract map ID from filename like "7411_0711291819X.swf"
    $mapId = (int)explode('_', $baseName)[0];

    // Get MySQL metadata (optional — SWF-only maps get defaults)
    $meta = $mysqlMaps[$mapId] ?? null;

    // Find key file
    $keyPath = findKeyFile($mapId, $swfPath, $mapKeysDir);
    if (!$keyPath) {
        $errors++;
        if ($errors <= 10) echo "  SKIP map $mapId: no key file\n";
        continue;
    }

    try {
        $swfFile = new SwfFile($swfPath);
        if (!$swfFile->valid()) {
            $errors++;
            if ($errors <= 10) echo "  SKIP map $mapId: invalid SWF\n";
            continue;
        }

        $mapStructure = MapStructure::fromSwfFile($swfFile);
        $mapKey = MapKey::fromFile($keyPath);
        $map = $loader->load($mapStructure, $mapKey);

        // Extract cells
        $cells = [];
        $walkableIds = [];
        foreach ($map->cells as $cellId => $cell) {
            $walkable = $cell->movement > 0;
            $cells[] = [
                'id'               => $cellId,
                'ground'           => $cell->ground->number,
                'groundLevel'      => $cell->ground->level,
                'groundSlope'      => $cell->ground->slope,
                'layer1'           => $cell->layer1->number,
                'layer2'           => $cell->layer2->number,
                'lineOfSight'      => $cell->lineOfSight,
                'walkable'         => $walkable,
                'movement'         => $cell->movement,
                'layerGroundRot'   => $cell->ground->rotation,
                'layerGroundFlip'  => $cell->ground->flip,
                'layerObject1Rot'  => $cell->layer1->rotation,
                'layerObject1Flip' => $cell->layer1->flip,
                'layerObject2Rot'  => $cell->layer2->rotation,
                'layerObject2Flip' => $cell->layer2->flip,
            ];
            if ($walkable) {
                $walkableIds[] = $cellId;
            }
        }

        // MySQL metadata for positions/game data, defaults for SWF-only maps
        $pos = $meta ? parseMapPos($meta['mappos'] ?? '0,0,0') : ['x' => 0, 'y' => 0, 'superarea' => 0];
        $places   = $meta['places'] ?? '';
        $monsters = $meta['monsters'] ?? '';
        if (!$meta) $skipped++; // track SWF-only maps

        $cellsJson = json_encode($cells, JSON_UNESCAPED_UNICODE);
        $cellsGzip = gzencode($cellsJson, 6);
        $walkableArr = '{' . implode(',', $walkableIds) . '}';

        $pgInsert->bindValue(':id', $mapId, PDO::PARAM_INT);
        $pgInsert->bindValue(':width', $map->width, PDO::PARAM_INT);
        $pgInsert->bindValue(':height', $map->height, PDO::PARAM_INT);
        $pgInsert->bindValue(':x', $pos['x'], PDO::PARAM_INT);
        $pgInsert->bindValue(':y', $pos['y'], PDO::PARAM_INT);
        $pgInsert->bindValue(':superarea', $pos['superarea'], PDO::PARAM_INT);
        $pgInsert->bindValue(':background', $map->background, PDO::PARAM_INT);
        $pgInsert->bindValue(':places', $places, PDO::PARAM_STR);
        $pgInsert->bindValue(':cells', $cellsJson, PDO::PARAM_STR);
        $pgInsert->bindValue(':cells_gzip', $cellsGzip, PDO::PARAM_LOB);
        $pgInsert->bindValue(':walkable_ids', $walkableArr, PDO::PARAM_STR);
        $pgInsert->bindValue(':monsters', $monsters, PDO::PARAM_STR);
        $pgInsert->execute();

        $success++;
        if ($success % 500 === 0) echo "  Migrated $success maps...\n";
    } catch (Exception $e) {
        $errors++;
        if ($errors <= 10) echo "  ERROR map $mapId: " . $e->getMessage() . "\n";
    }
}

echo "Maps migration complete: $success success ($skipped SWF-only with defaults), $errors errors.\n";

// --- Migrate scripted_cells (map triggers) ---

echo "\nMigrating scripted_cells...\n";

$pg->exec('DELETE FROM scripted_cells');

$scStmt = $mysql->query('SELECT MapID, CellID, ActionID, EventID, ActionsArgs, Conditions FROM scripted_cells');
$scRows = $scStmt->fetchAll(PDO::FETCH_ASSOC);
echo "Found " . count($scRows) . " scripted cells.\n";

$scInsert = $pg->prepare('
    INSERT INTO scripted_cells (map_id, cell_id, action_id, event_id, action_args, conditions)
    VALUES (:map_id, :cell_id, :action_id, :event_id, :action_args, :conditions)
');

$scSuccess = 0;
foreach ($scRows as $sc) {
    try {
        $scInsert->execute([
            ':map_id'      => (int)$sc['MapID'],
            ':cell_id'     => (int)$sc['CellID'],
            ':action_id'   => (int)$sc['ActionID'],
            ':event_id'    => (int)$sc['EventID'],
            ':action_args'  => $sc['ActionsArgs'] ?? '',
            ':conditions'  => $sc['Conditions'] ?? '',
        ]);
        $scSuccess++;
    } catch (Exception $e) {
        echo "  ERROR scripted cell MapID={$sc['MapID']} CellID={$sc['CellID']}: " . $e->getMessage() . "\n";
    }
}

echo "Scripted cells migration complete: $scSuccess success.\n";
