import type { DbClient, DbTransaction } from "./client";

export type DbExecutor = DbClient | DbTransaction;
