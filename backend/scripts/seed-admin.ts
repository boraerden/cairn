#!/usr/bin/env tsx
import { parseArgs } from "node:util";
import { hashPassword, loadUsers, saveUsers } from "../src/auth.js";
import type { UserRecord } from "@cairn/types";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      password: { type: "string" },
      role: { type: "string", default: "admin" },
      bucket: { type: "string" },
    },
  });

  if (values.bucket) process.env.CAIRN_BUCKET = values.bucket;
  if (!process.env.CAIRN_BUCKET) {
    console.error("Pass --bucket=<name> or set CAIRN_BUCKET env var");
    process.exit(1);
  }
  if (!values.email || !values.password) {
    console.error("Usage: seed-admin --bucket=<name> --email=<email> --password=<pw> [--role=admin]");
    process.exit(1);
  }

  const role = values.role === "editor" ? "editor" : "admin";
  const { users } = await loadUsers();
  if (users.some((u) => u.email.toLowerCase() === values.email!.toLowerCase())) {
    console.error(`User ${values.email} already exists`);
    process.exit(1);
  }
  const record: UserRecord = {
    email: values.email,
    passwordHash: await hashPassword(values.password),
    role,
    createdAt: new Date().toISOString(),
  };
  await saveUsers([...users, record]);
  console.log(`Seeded ${role}: ${values.email}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
