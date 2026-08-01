#!/usr/bin/env node
import { randomBytes, scryptSync } from "node:crypto";
import { createInterface } from "node:readline/promises";

function hash(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

let password = process.argv[2];
if (!password) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  password = await rl.question("Password: ");
  rl.close();
}
if (!password) {
  console.error("empty password");
  process.exit(1);
}
console.log(`AUTH_PASSWORD_HASH=${hash(password)}`);
