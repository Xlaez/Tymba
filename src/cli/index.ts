import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runDemoSimulation } from "../../examples/demo-market.js";
import { compileDocument, formatCompileReport } from "./compile.js";
import { formatAttackDocument, runAttackDocument } from "./attack.js";
import { createDemoInspectionDocument, formatDemoInspection } from "./inspect.js";
import { serializeCliJson } from "./output.js";
import { createSimulationDocument, formatSimulationReport } from "./simulate.js";
import { formatValidationReport, validateDocuments } from "./validate.js";

type ValidateArguments = Readonly<{
  intentPath: string;
  feesPath?: string;
  migrationPath?: string;
  json: boolean;
}>;

type CompileArguments = Readonly<{ requestPath: string; json: boolean }>;

type AttackArguments = Readonly<{ requestPath: string; scenario: string; json: boolean }>;

type OutputOptions = Readonly<{ json: boolean; advanced: boolean }>;

export async function runCli(args: readonly string[]): Promise<number> {
  const [command, ...commandArgs] = args;
  if (command === "--help" || command === "-h" || command === undefined) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (command === "simulate") {
    if (showHelp(commandArgs)) {
      process.stdout.write(`${usage()}\n`);
      return 0;
    }
    let options: OutputOptions;
    try {
      options = parseOutputOptions(commandArgs, "simulate");
    } catch (error) {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n${usage()}\n`,
      );
      return 2;
    }
    try {
      const result = runDemoSimulation();
      const output = options.json
        ? serializeCliJson(createSimulationDocument(result, options.advanced))
        : formatSimulationReport(result, options.advanced);
      process.stdout.write(`${output}\n`);
      return 0;
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      return 2;
    }
  }
  if (command === "inspect") {
    if (showHelp(commandArgs)) {
      process.stdout.write(`${usage()}\n`);
      return 0;
    }
    let options: OutputOptions;
    try {
      options = parseOutputOptions(commandArgs, "inspect");
    } catch (error) {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n${usage()}\n`,
      );
      return 2;
    }
    try {
      const output = options.json
        ? serializeCliJson(createDemoInspectionDocument(options.advanced))
        : formatDemoInspection(options.advanced);
      process.stdout.write(`${output}\n`);
      return 0;
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      return 2;
    }
  }
  if (command === "compile") {
    if (showHelp(commandArgs)) {
      process.stdout.write(`${usage()}\n`);
      return 0;
    }
    let parsed: CompileArguments;
    try {
      parsed = parseCompileArguments(commandArgs);
    } catch (error) {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n${usage()}\n`,
      );
      return 2;
    }
    try {
      const report = compileDocument(await readJson(parsed.requestPath));
      const output = parsed.json ? serializeCliJson(report) : formatCompileReport(report);
      process.stdout.write(`${output}\n`);
      return 1;
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      return 2;
    }
  }
  if (command === "attack") {
    if (showHelp(commandArgs)) {
      process.stdout.write(`${usage()}\n`);
      return 0;
    }
    let parsed: AttackArguments;
    try {
      parsed = parseAttackArguments(commandArgs);
    } catch (error) {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n${usage()}\n`,
      );
      return 2;
    }
    try {
      const report = runAttackDocument(await readJson(parsed.requestPath), parsed.scenario);
      process.stdout.write(
        `${parsed.json ? serializeCliJson(report) : formatAttackDocument(report)}\n`,
      );
      return report.status === "completed" ? 0 : 1;
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      return 2;
    }
  }
  if (command !== "validate") {
    process.stderr.write(`Unsupported command: ${command}\n${usage()}\n`);
    return 2;
  }

  let parsed: ValidateArguments;
  try {
    parsed = parseValidateArguments(commandArgs);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${usage()}\n`);
    return 2;
  }

  try {
    const intentInput = await readJson(parsed.intentPath);
    const feesInput = parsed.feesPath ? await readJson(parsed.feesPath) : undefined;
    const migrationInput = parsed.migrationPath ? await readJson(parsed.migrationPath) : undefined;
    const report = validateDocuments(intentInput, feesInput, migrationInput);
    process.stdout.write(
      `${parsed.json ? serializeCliJson(report) : formatValidationReport(report)}\n`,
    );
    return report.status === "valid" ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

function parseCompileArguments(args: readonly string[]): CompileArguments {
  let requestPath: string | undefined;
  let json = false;
  for (const argument of args) {
    if (argument === "--json" && !json) json = true;
    else if (argument.startsWith("-"))
      throw new TypeError(`Unknown or repeated compile option: ${argument}`);
    else if (requestPath === undefined) requestPath = argument;
    else throw new TypeError("Only one compile-request JSON path is supported");
  }
  if (!requestPath) throw new TypeError("A compile-request JSON file path is required");
  return { requestPath, json };
}

function parseAttackArguments(args: readonly string[]): AttackArguments {
  let requestPath: string | undefined;
  let scenario: string | undefined;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json" && !json) json = true;
    else if (argument === "--scenario" && scenario === undefined) {
      const value = args[index + 1];
      if (!value || value.startsWith("-"))
        throw new TypeError("--scenario requires a scenario name");
      scenario = value;
      index += 1;
    } else if (argument?.startsWith("-")) {
      throw new TypeError(`Unknown or repeated attack option: ${argument}`);
    } else if (argument) {
      if (requestPath !== undefined)
        throw new TypeError("Only one attack-request JSON path is supported");
      requestPath = argument;
    }
  }
  if (!requestPath) throw new TypeError("An attack-request JSON file path is required");
  if (!scenario) throw new TypeError("--scenario is required");
  return { requestPath, scenario, json };
}

function parseValidateArguments(args: readonly string[]): ValidateArguments {
  let intentPath: string | undefined;
  let feesPath: string | undefined;
  let migrationPath: string | undefined;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      json = true;
    } else if (argument === "--fees" || argument === "--migration") {
      const path = args[index + 1];
      if (!path || path.startsWith("--")) {
        throw new TypeError(`${argument} requires a JSON file path`);
      }
      if (argument === "--fees") feesPath = path;
      else migrationPath = path;
      index += 1;
    } else if (argument?.startsWith("-")) {
      throw new TypeError(`Unknown option: ${argument}`);
    } else if (argument) {
      if (intentPath) throw new TypeError("Only one market-intent JSON path is supported");
      intentPath = argument;
    }
  }

  if (!intentPath) throw new TypeError("A market-intent JSON file path is required");
  return {
    intentPath,
    ...(feesPath ? { feesPath } : {}),
    ...(migrationPath ? { migrationPath } : {}),
    json,
  };
}

function parseOutputOptions(args: readonly string[], command: string): OutputOptions {
  let json = false;
  let advanced = false;
  for (const argument of args) {
    if (argument === "--json" && !json) json = true;
    else if (argument === "--advanced" && !advanced) advanced = true;
    else throw new TypeError(`Unknown or repeated ${command} option: ${argument}`);
  }
  return { json, advanced };
}

function showHelp(args: readonly string[]): boolean {
  return args.length === 1 && (args[0] === "--help" || args[0] === "-h");
}

async function readJson(path: string): Promise<unknown> {
  const absolutePath = resolve(path);
  let text: string;
  try {
    text = await readFile(absolutePath, "utf8");
  } catch {
    throw new Error(`Cannot read JSON file: ${absolutePath}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    throw new Error(`Invalid JSON in ${absolutePath}: ${message}`);
  }
}

function usage(): string {
  return [
    "Usage:",
    "  pnpm tymba compile <compile-request.json> [--json]",
    "  pnpm tymba attack <attack-request.json> --scenario <scenario> [--json]",
    "  pnpm tymba validate <market-intent.json> [--fees <fees.json>] [--migration <migration.json>] [--json]",
    "  pnpm tymba simulate [--json] [--advanced]",
    "  pnpm tymba inspect [--json] [--advanced]",
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runCli(process.argv.slice(2));
}
