import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rcedit } from "rcedit";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exePath = path.join(rootDir, "release-package", "win-unpacked", "Umalator.exe");
const iconPath = path.join(rootDir, "icon.ico");

if (!fs.existsSync(exePath)) {
  throw new Error(`Executable not found: ${exePath}`);
}

if (!fs.existsSync(iconPath)) {
  throw new Error(`Icon file not found: ${iconPath}`);
}

await rcedit(exePath, { icon: iconPath });
console.log(`Updated executable icon: ${exePath}`);
