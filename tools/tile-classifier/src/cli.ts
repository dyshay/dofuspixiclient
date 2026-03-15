import * as fs from "node:fs";
import * as path from "node:path";

import { Command } from "commander";
import pino from "pino";

import { classify, loadExistingClassifications } from "./analyzer.ts";
import { startServer } from "./server.ts";
import type { TileBehavior, TileClassifications } from "./types.ts";

const logger = pino({
  name: "tile-classifier",
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
      ignore: "pid,hostname",
      translateTime: "HH:MM:ss",
    },
  },
});

function diffClassifications(
  oldData: TileClassifications,
  newData: TileClassifications
): { added: number; removed: number; changed: number; details: string[] } {
  const details: string[] = [];
  let added = 0;
  let removed = 0;
  let changed = 0;

  for (const type of ["ground", "objects"] as const) {
    const oldEntries = oldData[type];
    const newEntries = newData[type];

    for (const id of Object.keys(newEntries)) {
      if (!oldEntries[id]) {
        added++;
        details.push(`+ ${type}/${id}: ${newEntries[id].behavior}`);
      } else if (oldEntries[id].behavior !== newEntries[id].behavior) {
        changed++;
        details.push(
          `~ ${type}/${id}: ${oldEntries[id].behavior} -> ${newEntries[id].behavior}`
        );
      }
    }

    for (const id of Object.keys(oldEntries)) {
      if (!newEntries[id]) {
        removed++;
        details.push(`- ${type}/${id}: ${oldEntries[id].behavior}`);
      }
    }
  }

  return { added, removed, changed, details };
}

const program = new Command();

program
  .name("tile-classifier")
  .description(
    "Classify tile behaviors (static/slope/animated/random/resource) for the spritesheet pipeline"
  )
  .version("1.0.0");

program
  .command("generate")
  .description("Generate tile-classifications.json from tile directories")
  .argument("<tiles-dir>", "Path to tile SVG directories (e.g., assets/rasters/tiles/svg)")
  .option(
    "-m, --php-manifest <dir>",
    "Path to PHP-generated manifest directory (same as tiles-dir if manifests are alongside tiles)"
  )
  .option(
    "-o, --overrides <path>",
    "Path to manual overrides JSON file"
  )
  .option(
    "--output <path>",
    "Output path for tile-classifications.json",
    "tile-classifications.json"
  )
  .option("--diff", "Show diff against existing classifications file")
  .action(
    (
      tilesDir: string,
      opts: {
        phpManifest?: string;
        overrides?: string;
        output: string;
        diff?: boolean;
      }
    ) => {
      const resolvedTilesDir = path.resolve(tilesDir);
      const resolvedOutput = path.resolve(opts.output);

      logger.info("=== Tile Classifier ===");
      logger.info(`Tiles directory: ${resolvedTilesDir}`);

      if (opts.phpManifest) {
        logger.info(`PHP manifest: ${path.resolve(opts.phpManifest)}`);
      }
      if (opts.overrides) {
        logger.info(`Overrides: ${path.resolve(opts.overrides)}`);
      }

      const { classifications, stats } = classify({
        tilesDir: resolvedTilesDir,
        phpManifestDir: opts.phpManifest
          ? path.resolve(opts.phpManifest)
          : undefined,
        overridesPath: opts.overrides
          ? path.resolve(opts.overrides)
          : undefined,
      });

      // Show stats
      logger.info("=== Classification Results ===");
      logger.info(`Total tiles: ${stats.total}`);
      logger.info(
        `Sources: ${stats.fromPhp} from PHP manifest, ${stats.fromOverrides} from overrides, ${stats.fromHeuristic} from heuristics`
      );

      logger.info("--- Ground ---");
      for (const [behavior, count] of Object.entries(stats.ground)) {
        if (count > 0) {
          logger.info(`  ${behavior}: ${count}`);
        }
      }

      logger.info("--- Objects ---");
      for (const [behavior, count] of Object.entries(stats.objects)) {
        if (count > 0) {
          logger.info(`  ${behavior}: ${count}`);
        }
      }

      // Show diff if requested
      if (opts.diff) {
        const existing = loadExistingClassifications(resolvedOutput);

        if (existing) {
          const diff = diffClassifications(existing, classifications);
          logger.info("=== Diff ===");
          logger.info(
            `Added: ${diff.added}, Removed: ${diff.removed}, Changed: ${diff.changed}`
          );

          for (const detail of diff.details.slice(0, 50)) {
            logger.info(`  ${detail}`);
          }

          if (diff.details.length > 50) {
            logger.info(`  ... and ${diff.details.length - 50} more`);
          }
        } else {
          logger.info("No existing classifications to diff against");
        }
      }

      // Write output
      fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
      fs.writeFileSync(
        resolvedOutput,
        JSON.stringify(classifications, null, 2)
      );
      logger.info(`Written to: ${resolvedOutput}`);
    }
  );

program
  .command("stats")
  .description("Show statistics from an existing tile-classifications.json")
  .argument("<file>", "Path to tile-classifications.json")
  .action((file: string) => {
    const data = loadExistingClassifications(path.resolve(file));

    if (!data) {
      logger.error(`File not found: ${file}`);
      process.exit(1);
    }

    const countByBehavior = (
      entries: Record<string, { behavior: TileBehavior }>
    ) => {
      const counts: Record<string, number> = {};

      for (const entry of Object.values(entries)) {
        counts[entry.behavior] = (counts[entry.behavior] ?? 0) + 1;
      }

      return counts;
    };

    logger.info("=== Classifications Stats ===");
    logger.info(`Generated at: ${data.generatedAt}`);

    logger.info(
      `Ground: ${Object.keys(data.ground).length} tiles`
    );

    for (const [behavior, count] of Object.entries(
      countByBehavior(data.ground)
    )) {
      logger.info(`  ${behavior}: ${count}`);
    }

    logger.info(
      `Objects: ${Object.keys(data.objects).length} tiles`
    );

    for (const [behavior, count] of Object.entries(
      countByBehavior(data.objects)
    )) {
      logger.info(`  ${behavior}: ${count}`);
    }
  });

program
  .command("init-overrides")
  .description(
    "Create an empty overrides template file with examples"
  )
  .option("--output <path>", "Output path", "tile-overrides.json")
  .action((opts: { output: string }) => {
    const template = {
      _comment:
        "Manual overrides for tile classifications. Add tile IDs here to fix misclassifications.",
      _behaviors: "static | slope | animated | random | resource",
      ground: {
        _example_511: {
          behavior: "slope",
        },
      },
      objects: {
        _example_2351: {
          behavior: "random",
        },
        _example_2319: {
          behavior: "animated",
          fps: 60,
          autoplay: true,
          loop: true,
        },
        _example_5000: {
          behavior: "resource",
        },
      },
    };

    const resolvedOutput = path.resolve(opts.output);
    fs.writeFileSync(resolvedOutput, JSON.stringify(template, null, 2));
    logger.info(`Overrides template written to: ${resolvedOutput}`);
    logger.info(
      "Remove the _example_ prefix from entries and add real tile IDs to use."
    );
  });

program
  .command("review")
  .description(
    "Open visual gallery in browser to review and classify tiles interactively"
  )
  .argument(
    "<tiles-dir>",
    "Path to tile SVG directories (e.g., assets/rasters/tiles/svg)"
  )
  .option(
    "--classifications <path>",
    "Path to tile-classifications.json (will be created if missing)",
    "assets/tile-classifications.json"
  )
  .option("-p, --port <port>", "Server port", "4200")
  .action(
    (
      tilesDir: string,
      opts: { classifications: string; port: string }
    ) => {
      const resolvedTilesDir = path.resolve(tilesDir);
      const resolvedClassPath = path.resolve(opts.classifications);
      const port = parseInt(opts.port, 10);

      logger.info("=== Tile Classifier — Visual Review ===");
      logger.info(`Tiles: ${resolvedTilesDir}`);
      logger.info(`Classifications: ${resolvedClassPath}`);
      logger.info(`Saving changes to: ${resolvedClassPath}`);

      startServer({
        tilesDir: resolvedTilesDir,
        classificationsPath: resolvedClassPath,
        port,
      });

      logger.info(`Open http://localhost:${port} in your browser`);
    }
  );

program
  .command("list")
  .description("List tiles by behavior from a classifications file")
  .argument("<file>", "Path to tile-classifications.json")
  .argument("<behavior>", "Behavior to filter: static|slope|animated|random|resource")
  .option("-t, --type <type>", "Filter by type: ground|objects")
  .action(
    (
      file: string,
      behavior: string,
      opts: { type?: string }
    ) => {
      const data = loadExistingClassifications(path.resolve(file));

      if (!data) {
        logger.error(`File not found: ${file}`);
        process.exit(1);
      }

      const types = opts.type
        ? [opts.type as "ground" | "objects"]
        : (["ground", "objects"] as const);

      for (const type of types) {
        const entries = Object.entries(data[type]).filter(
          ([, v]) => v.behavior === behavior
        );

        if (entries.length > 0) {
          console.log(`\n${type} (${entries.length}):`);

          for (const [id, entry] of entries) {
            const extras: string[] = [];

            if (entry.fps) extras.push(`fps=${entry.fps}`);
            if (entry.autoplay) extras.push("autoplay");
            if (entry.loop) extras.push("loop");

            const extraStr = extras.length > 0 ? ` [${extras.join(", ")}]` : "";
            console.log(`  ${id}${extraStr}`);
          }
        }
      }
    }
  );

program.parse();
