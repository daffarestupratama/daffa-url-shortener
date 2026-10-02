/**
 * A stand in for the D1 binding in unit tests. It records every statement
 * with its bound parameters, in order, and answers from a responder, so a test
 * can assert which queries ran, which did not, and with what values. A batch
 * stops at the first statement whose responder returns an Error, the way a
 * failing D1 batch rolls back and throws.
 *
 * Real SQL behavior is covered by npm run smoke against the local database.
 */

export interface Call {
  sql: string;
  params: unknown[];
}

export interface Answer {
  results?: unknown[];
  changes?: number;
}

export type Responder = (sql: string, params: unknown[]) => Answer | Error;

interface FakeStatement {
  sql: string;
  params: unknown[];
  bind(...params: unknown[]): FakeStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<D1Result<T>>;
  run<T>(): Promise<D1Result<T>>;
}

export function fakeD1(respond: Responder = () => ({})) {
  const calls: Call[] = [];

  function execute<T>(sql: string, params: unknown[]): D1Result<T> {
    calls.push({ sql, params });
    const answer = respond(sql, params);
    if (answer instanceof Error) throw answer;
    return {
      results: (answer.results ?? []) as T[],
      success: true,
      meta: { changes: answer.changes ?? 0 },
    } as D1Result<T>;
  }

  function statement(sql: string, params: unknown[] = []): FakeStatement {
    return {
      sql,
      params,
      bind: (...next) => statement(sql, next),
      first: async <T>() => (execute<T>(sql, params).results[0] ?? null) as T | null,
      all: async <T>() => execute<T>(sql, params),
      run: async <T>() => execute<T>(sql, params),
    };
  }

  const db = {
    prepare: (sql: string) => statement(sql),
    batch: async (statements: FakeStatement[]) => statements.map((s) => execute(s.sql, s.params)),
  };

  return {
    db: db as unknown as D1Database,
    calls,
    /** Whether any recorded statement is exactly `sql`. */
    ran: (sql: string) => calls.some((call) => call.sql === sql),
    /** Parameters of the first call of `sql`. */
    paramsOf: (sql: string) => calls.find((call) => call.sql === sql)?.params,
  };
}
