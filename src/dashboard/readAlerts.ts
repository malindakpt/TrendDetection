import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseAlerts } from "@/dashboard/alertData";
import type { TrendAlert } from "@/dashboard/types";

const alertsPath = path.join(process.cwd(), "output", "alerts.json");

export async function readAlerts(): Promise<TrendAlert[]> {
  try {
    return parseAlerts(JSON.parse(await readFile(alertsPath, "utf8")));
  } catch (error: unknown) {
    if (isMissingFileError(error) || error instanceof SyntaxError) return [];
    throw error;
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}