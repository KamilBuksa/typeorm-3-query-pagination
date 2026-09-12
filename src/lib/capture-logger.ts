import { Logger } from 'typeorm';

export interface CapturedQuery {
  sql: string;
  parameters: unknown[];
}

/** Collects the SQL actually sent to the database - the evidence behind the claims. */
export class CaptureLogger implements Logger {
  captured: CapturedQuery[] = [];
  enabled = false;

  reset(): void {
    this.captured = [];
  }

  logQuery(query: string, parameters?: unknown[]): void {
    if (this.enabled) {
      this.captured.push({ sql: query, parameters: parameters ?? [] });
    }
  }

  logQueryError(): void {}
  logQuerySlow(): void {}
  logSchemaBuild(): void {}
  logMigration(): void {}
  log(): void {}
}

export const captureLogger = new CaptureLogger();
