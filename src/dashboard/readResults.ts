import { readFile } from "node:fs/promises";
import path from "node:path";

export type Trend = {
  topic: string;
  score: number;
};

const trendsPath = path.join(process.cwd(), "output", "trends.json");

export async function readTrends(): Promise<Trend[]> {
  try {
    const content = await readFile(trendsPath, "utf8");
    return JSON.parse(content) as Trend[];
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return [];
    }

    throw error;
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}