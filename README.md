# diverse-sets

Special collections for special situations.

Three set-like collections with different performance and persistence tradeoffs, plus a randomized array. All share a common shape: `push`, `remove`, `export`, `stats`, and a static `fromArray` constructor.

## When to use what

| Class | Backing | Best for |
|---|---|---|
| `BinaryTree` | In-memory BST | Small-to-medium, random-order input, want sorted output as a side effect. Extensible to range queries. |
| `ExclusionSet` | In-memory `Set` | Maximum throughput. Fits in RAM. Ephemeral. The default choice. |
| `ExclusionQuery` | SQLite (`node:sqlite`, `bun:sqlite`, or `better-sqlite3`) | Datasets too large for RAM, or that need to persist across runs, or be queried from another tool. |
| `DisArray` | `Array` subclass | Items that need to be shuffled or arrive at random positions. |

`ExclusionSet` is typically 5–8x faster than `ExclusionQuery` for in-RAM workloads (see [Benchmarks](#benchmarks)). `ExclusionQuery` wins when memory pressure matters more than throughput, or when persistence is required.

---

## DisArray

An `Array` subclass with utilities for randomized ordering.

```js
import { DisArray } from 'diverse-sets'

const d = new DisArray()
d.push('a', 'b', 'c')       // native append, in order
d.disarrange()              // shuffle in place
console.log([...d])         // e.g. ['c', 'a', 'b']
```

### `new DisArray(...items)`
Constructs an empty DisArray, or one seeded with the given items.

### *static* `DisArray.fromArray(items)`
Constructs a DisArray from an existing iterable. Items are inserted in their original order with deduplication. Call `.disarrange()` afterward to shuffle.

### `displace(item | [items])`
Inserts the item (or each item from an array) at a uniformly-random position. Skips duplicates. Returns the number of items actually inserted.

**Note:** `displace` is O(n) per item because it splices. For bulk loading where you'll shuffle at the end anyway, prefer `push` + `disarrange()` — that's O(n) total instead of O(n²).

### `disarrange(times = 1)`
Fisher–Yates shuffle in place. Returns `this`. The `times` parameter reshuffles; one pass is already uniformly distributed, so `times > 1` is mathematically redundant but accepted for API convenience.

### `push(...items)`
Native `Array.prototype.push` — appends to the end in order. No deduplication. Use `displace` when you need random-position insertion with dedupe.

### `concat(...arrays)`
Returns a new DisArray containing this array's items followed by all items from each argument array, deduped across all inputs.

---

## BinaryTree

An iterative binary search tree with a built-in exclusion list. Tracks events (size, duplicates, removed) per operation.

```js
import { BinaryTree } from 'diverse-sets'

const tree = new BinaryTree()
tree.remove(['spam@example.com', 'bot@example.com'])  // pre-exclude
tree.push(['alice@example.com', 'bob@example.com', 'spam@example.com'])
console.log(tree.export())  // ['alice@example.com', 'bob@example.com']
```

Insertion and removal are iterative (no recursion, no stack overflow risk). Export uses an explicit stack — safe on degenerate trees.

The tree is **not self-balancing**. Random-order input stays roughly O(log n) per operation; sorted input degrades to O(n²). If your input order is adversarial, shuffle first or use `ExclusionSet`.

### `push(item | [items])`
Insert one item or a batch.

### `remove(item | [items])`
Mark items as excluded. Excluded items remain in the tree but are filtered from `export` / `disarray`. Removing an item not yet in the tree creates an excluded placeholder, so pre-seeding exclusions before pushes works.

### `stats()`
Returns `{ size, removed, duplicates, total() }`. Event-counted: every `push` and `remove` call updates exactly one counter.

### `export()`
Returns a sorted array of non-excluded items (in-order traversal).

### `disarray()`
Returns a `DisArray` of non-excluded items in random order.

---

## ExclusionSet

A `Set`-backed exclusion list. Highest throughput for in-RAM workloads.

```js
import { ExclusionSet } from 'diverse-sets'

const x = ExclusionSet.fromArray(['spam@example.com'])
x.push(['alice@example.com', 'spam@example.com'])  // 'spam' is filtered
console.log(x.export())                            // ['alice@example.com']
```

Same external API as `BinaryTree`. Item membership is O(1). Strings are used directly as keys; objects are stringified via `JSON.stringify`.

Rough memory cost: ~150–300 bytes per short-string entry in V8 overhead. 2M short strings ≈ 300–600MB; 2M URLs ≈ 1GB+. If you're beyond what fits in RAM, use `ExclusionQuery`.

### `new ExclusionSet(exclude)` / *static* `ExclusionSet.fromArray(exclude)`
Constructs an instance with the given items pre-excluded.

### `push(item | [items])`
Add items. Duplicates and items already excluded are tracked in `stats` and otherwise ignored.

### `remove(item | [items])`
Mark items as excluded. Future pushes of the same item count as a `removed` event.

### `stats()`
Returns `{ size, removed, duplicates, total() }`. Event-counted — same semantics as `BinaryTree`.

### `export()`
Returns a sorted array of non-excluded items.

### `disarray()`
Returns a `DisArray` of non-excluded items in insertion order (call `.disarrange()` to shuffle).

---

## ExclusionQuery

A SQLite-backed exclusion list. Slower than `ExclusionSet` but supports large datasets, optional disk persistence, and post-hoc querying.

```js
import { ExclusionQuery } from 'diverse-sets'

const x = ExclusionQuery.fromArray(['spam@example.com', 'bot@example.com'])
x.push(largeArrayOfEmails)
const cleaned = x.export()
x.close()
```

### Driver selection

Detected at module load, in this order:
1. **`bun:sqlite`** if running on Bun
2. **`node:sqlite`** (built-in; stable on Node 24 LTS, experimental on 22 with `--experimental-sqlite`)
3. **`better-sqlite3`** as a fallback if neither built-in is available

This means `better-sqlite3` is no longer a required dependency on modern Node. Install it only if you need to run on older Node versions.

### Flags

- `--tmp` — persist the database to a temporary file under `os.tmpdir()/sqlmem/` instead of `:memory:`. Useful for datasets larger than RAM.
- `--verbose` — log driver selection and internal events.

### `new ExclusionQuery(exclude)` / *static* `ExclusionQuery.fromArray(exclude)`
Constructs an instance with the given items pre-excluded.

### `push(item | [items])`
Adds items. Arrays are batched into transactions of 10,000 rows for throughput. Duplicates are silently dropped via `INSERT OR IGNORE`.

### `remove(item | [items])`
Marks items as excluded. Items not yet in the table are inserted directly as excluded (UPSERT).

### `stats()`
Returns `{ size, removed, duplicates, total() }`. **Bucket-counted, not event-counted:** `size` is the number of distinct un-excluded items, `removed` is the number of distinct excluded items, `duplicates` is `null` (not tracked). Computed on demand via `COUNT()` — keeping the hot path free of per-op stat updates is a significant part of why this class is faster than the naive SQL approach.

If you need duplicate event counting, use `ExclusionSet`.

### `export(close = false)`
Returns a sorted array of non-excluded items. Pass `true` to close the underlying database after export.

### `disarray(close = false)`
Returns an array of non-excluded items in storage order.

### `close()`
Closes the underlying database. Required for `--tmp` mode to release the file handle.

---

## Benchmarks

Measured on Node.js 22.22 (`--experimental-sqlite`), random 16-char hex string keys, single run after JIT warmup. Numbers are wall-clock milliseconds; lower is better.

Workload: seed N exclusions, then push M inputs drawn from a pool of unique keys (so duplicates appear naturally), then export the sorted result.

**Small** — 1,000 seed exclusions, 10,000 inputs, pool of 3,000:

| Class            | seed | push  | export | total |
|------------------|-----:|------:|-------:|------:|
| `ExclusionSet`   |  0.2 |   2.0 |    0.5 |   2.7 |
| `BinaryTree`     |  1.8 |   5.7 |    0.4 |   7.9 |
| `ExclusionQuery` |  2.0 |  12.3 |    1.1 |  15.4 |

**Medium** — 20,000 seed exclusions, 100,000 inputs, pool of 30,000:

| Class            |  seed |   push | export | total |
|------------------|------:|-------:|-------:|------:|
| `ExclusionSet`   |   4.3 |   11.3 |    2.5 |  18.0 |
| `BinaryTree`     |  15.5 |   58.0 |    5.0 |  78.5 |
| `ExclusionQuery` |  27.8 |  108.2 |    4.6 | 140.5 |

**Large** — 200,000 seed exclusions, 1,000,000 inputs, pool of 300,000:

| Class            |   seed |    push | export |  total |
|------------------|-------:|--------:|-------:|-------:|
| `ExclusionSet`   |   42.5 |   147.5 |   35.3 |  225.3 |
| `ExclusionQuery` |  315.1 |  1437.8 |   79.1 | 1832.0 |

(`BinaryTree` is omitted at this scale — without self-balancing it degrades on near-uniform input and pulls the comparison out of shape. It remains the right choice when sorted output during traversal is what you actually want.)

### Takeaways

- **`ExclusionSet` is 5–8x faster than `ExclusionQuery` across all sizes**, growing slightly with scale. For in-RAM workloads, it's the default choice.
- **`ExclusionQuery` is bounded by SQLite's per-op overhead** (B-tree descent, statement bind, result marshalling) at roughly 1–2µs per push. That's a fixed cost that doesn't go down with optimization at the JS layer.
- **Per-million-input cost** for `ExclusionSet` lands around 150ms on this hardware. If your workload is into the tens of millions of inputs and the data fits in RAM, you're looking at low single-digit seconds.
- **Memory matters more than CPU at scale.** For 10M+ unique long-string entries, RAM pressure pushes you toward `ExclusionQuery` despite the throughput cost.

### Reproducing

The benchmark used to generate these numbers is in `bench.js`. Run with:

```sh
node --experimental-sqlite --expose-gc bench.js
```

(`--experimental-sqlite` is not needed on Node 24+; `--expose-gc` is optional and only used to force GC between runs.)



`BinaryTree` and `ExclusionSet` count **events**: each `push` or `remove` call increments exactly one of `size`, `duplicates`, or `removed`. So `total()` equals the number of operations performed.

`ExclusionQuery` counts **buckets**: `size` and `removed` are distinct-item counts derived from `SELECT COUNT()`. `duplicates` is `null`. This is a deliberate tradeoff — event counting in SQL requires per-op JS work that meaningfully slows the hot path.

If you swap implementations and need consistent stats, normalize on bucket semantics (`size` and `removed` only) — those agree across all three classes.

---

## License

ISC (or whatever you actually want here).
