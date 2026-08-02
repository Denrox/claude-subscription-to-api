import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "fs";
import { dirname } from "path";

export function writeAtomicJson(file: string, data: unknown): void {
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const contents = JSON.stringify(data, null, 2) + "\n";
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, contents, { mode: 0o600 });
  try {
    renameSync(tmp, file);
  } catch (err: any) {
    if (err?.code !== "EBUSY" && err?.code !== "EXDEV" && err?.code !== "EPERM") throw err;
    writeFileSync(file, contents, { mode: 0o600 });
    rmSync(tmp, { force: true });
  }
}
