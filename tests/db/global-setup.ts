import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrl: string;
  }
}

/**
 * Creates a throwaway database, applies the Supabase shim plus every
 * migration in order, and drops it again after the run.
 *
 * TEST_DATABASE_URL must point at a Postgres server where the user can
 * create databases and roles (see README, "Testes de banco").
 */
export default async function setup(project: TestProject) {
  const adminUrl = process.env.TEST_DATABASE_URL;
  if (!adminUrl) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Point it at a disposable Postgres 15+ server, " +
        "e.g. postgres://postgres@127.0.0.1:54329/postgres",
    );
  }

  const dbName = `leadhub_test_${process.pid}_${Date.now()}`;
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${dbName}`);

  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  const dbUrl = url.toString();

  const db = new Client({ connectionString: dbUrl });
  await db.connect();
  try {
    const root = process.cwd();
    await db.query(await readFile(path.join(root, "supabase/tests/supabase-shim.sql"), "utf8"));
    const migrationsDir = path.join(root, "supabase/migrations");
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      try {
        await db.query(await readFile(path.join(migrationsDir, file), "utf8"));
      } catch (error) {
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
    }
    // Events go through lh_server_collect, which needs the server secret.
    await db.query("select lh_private.set_server_secret('test-server-secret-0123456789abcdef')");
  } finally {
    await db.end();
  }

  project.provide("dbUrl", dbUrl);

  return async () => {
    await admin.query(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  };
}
