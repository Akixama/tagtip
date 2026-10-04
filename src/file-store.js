import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
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
      const temporaryPath = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      await rename(temporaryPath, path);
    },
  };
}
