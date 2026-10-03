import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export function createFileStore(path) {
  return {
    async load() {
      try {
        return JSON.parse(await readFile(path, "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    },
    async save(value) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    },
  };
}
