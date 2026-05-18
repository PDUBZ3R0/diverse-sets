import { mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { DisArray } from './disarray.js'

const verbose = process.argv.includes("--verbose");
const tmpfile = process.argv.includes("--tmp");

// Driver detection: bun:sqlite → node:sqlite → better-sqlite3.
// All three expose enough API surface (prepare/exec/run/get/all/close) for our needs.

const init = await (async function () {
	if (process.versions.bun) {
		if (verbose) console.log("Detected bun runtime, using: 'bun:sqlite'");
		const { Database } = await import("bun:sqlite");
		return (path) => {
			const db = new Database(path, { strict: true });
			return db;
		};
	}
	try {
		const { DatabaseSync } = await import("node:sqlite");
		if (verbose) console.log("Using built-in 'node:sqlite'");
		return (path) => new DatabaseSync(path);
	} catch {
		if (verbose) console.log("Falling back to 'better-sqlite3'");
		const { default: Database } = await import("better-sqlite3");
		return Database;
	}
})();

// Tunables
const BATCH_SIZE = 10000;       // rows per transaction during bulk operations
const CACHE_KB = 200000;        // 200 MB page cache (use negative pragma value)

export class ExclusionQuery {
	constructor(exclude) {
		const db = (function () {
			if (tmpfile) {
				const dir = join(tmpdir(), "sqlmem");
				mkdirSync(dir, { recursive: true });
				return init(join(dir, randomUUID() + ".sqlite"));
			}
			return init(":memory:");
		})();

		// Pragmas — exec works on all three drivers, unlike db.pragma().
		db.exec("PRAGMA journal_mode = WAL");
		db.exec("PRAGMA synchronous = NORMAL");
		db.exec("PRAGMA temp_store = MEMORY");
		db.exec(`PRAGMA cache_size = -${CACHE_KB}`);
		db.exec("PRAGMA locking_mode = EXCLUSIVE");

		// WITHOUT ROWID puts the data directly in the PK B-tree — one traversal
		// per lookup instead of two. Big win for our access pattern.
		db.exec(`
			CREATE TABLE xclu (
				data TEXT PRIMARY KEY,
				excluded INTEGER NOT NULL DEFAULT 0
			) WITHOUT ROWID
		`);

		// Prepared once, reused for the life of the instance.
		const stmts = {
			// INSERT OR IGNORE is one B-tree traversal + conditional write,
			// vs. SELECT-then-INSERT which is always two traversals.
			insertNew: db.prepare("INSERT OR IGNORE INTO xclu (data, excluded) VALUES (?, 0)"),
			insertExcluded: db.prepare("INSERT OR IGNORE INTO xclu (data, excluded) VALUES (?, 1)"),
			// Mark an existing item excluded. If it doesn't exist yet, insert as excluded.
			// UPSERT (INSERT ... ON CONFLICT) handles both cases in one statement.
			markExcluded: db.prepare(`
				INSERT INTO xclu (data, excluded) VALUES (?, 1)
				ON CONFLICT(data) DO UPDATE SET excluded = 1 WHERE excluded = 0
			`),
			selectAll: db.prepare("SELECT data FROM xclu WHERE excluded = 0"),
			selectAllSorted: db.prepare("SELECT data FROM xclu WHERE excluded = 0 ORDER BY data"),
			countSize: db.prepare("SELECT COUNT(*) AS n FROM xclu WHERE excluded = 0"),
			countRemoved: db.prepare("SELECT COUNT(*) AS n FROM xclu WHERE excluded = 1"),
		};

		// Manual BEGIN/COMMIT, portable across all three drivers.
		const txBegin = () => db.exec("BEGIN");
		const txCommit = () => db.exec("COMMIT");
		const txRollback = () => db.exec("ROLLBACK");

		// Bulk insert with batched transactions. Single statement reused.
		const bulkInsert = (stmt, items) => {
			let i = 0;
			txBegin();
			try {
				for (const item of items) {
					stmt.run(item);
					if (++i % BATCH_SIZE === 0) {
						txCommit();
						txBegin();
					}
				}
				txCommit();
			} catch (err) {
				txRollback();
				throw err;
			}
		};

		// Seed initial exclusions.
		if (exclude && exclude.length > 0) {
			bulkInsert(stmts.insertExcluded, exclude);
		}

		// Public API. push/remove accept single items or arrays. We deliberately
		// avoid maintaining a running stats object — counts come from SQL on demand.
		// This removes per-op JS work from the hot loop.
		Object.assign(this, {
			push(item) {
				if (Array.isArray(item)) {
					bulkInsert(stmts.insertNew, item);
				} else {
					stmts.insertNew.run(typeof item === 'object' ? JSON.stringify(item) : item);
				}
			},

			remove(item) {
				if (Array.isArray(item)) {
					bulkInsert(stmts.markExcluded, item);
				} else {
					stmts.markExcluded.run(typeof item === 'object' ? JSON.stringify(item) : item);
				}
			},

			// Stats computed on demand. Cheap with the PK index.
			// `duplicates` and `total` aren't tracked — they require running counters,
			// and the whole point of this rewrite is to keep the hot path clean.
			// If you need them, switch to the pure-JS implementation or add a separate counter.
			stats() {
				const size = stmts.countSize.get().n;
				const removed = stmts.countRemoved.get().n;
				return {
					size,
					removed,
					duplicates: null, // not tracked
					total() { return this.size + this.removed; }
				};
			},

			export(close = false) {
				const rows = stmts.selectAllSorted.all();
				const out = new Array(rows.length);
				for (let i = 0; i < rows.length; i++) out[i] = rows[i].data;
				if (close) db.close();
				return out;
			},

			disarray(close = false) {
				const rows = stmts.selectAll.all();
				const out = new DisArray(rows.length);
				for (let i = 0; i < rows.length; i++) out[i] = rows[i].data;
				out.disarrange();
				if (close) db.close();
				return out;
			},

			close() { db.close(); },
		});
	}
}

ExclusionQuery.fromArray = function (exclude) {
	return new ExclusionQuery(exclude);
};
