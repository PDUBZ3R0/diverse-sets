// Pure-JS ExclusionList.
//
// Design: two Sets keyed on the raw string.
//   present  — items that have been pushed and are not excluded
//   excluded — items that have been removed (or pre-seeded as exclusions)
//
// Invariant: present ∩ excluded = ∅. An item moves from `present` to `excluded`
// when removed; once excluded, it stays excluded and future pushes of the same
// value count as `removed` (consistent with the BinaryTree semantics).
//
// Tradeoffs vs the SQL version:
//   + ~30–50x faster on the hot path (Set.has is ~100ns vs ~1–5µs SQLite point lookup)
//   + Zero deps
//   + Tracks duplicates without extra cost
//   - Lives entirely in RAM. At 2M short strings expect ~150–300MB; 2M long
//     strings (URLs, UAs) can be 1GB+. Use the SQL version if you need spill-to-disk.
//   - No persistence across process restarts.

export class ExclusionSet {
	constructor(exclude) {
		this._present = new Set();
		this._excluded = new Set();
		this._duplicates = 0;
		this._removedHits = 0; // pushes of already-excluded items

		if (exclude) {
			for (const item of exclude) {
				this._excluded.add(typeof item === 'object' ? JSON.stringify(item) : item);
			}
		}
	}

	// Single-item push. Hot path — kept tight.
	_pushOne(item) {
		const key = typeof item === 'object' ? JSON.stringify(item) : item;
		if (this._excluded.has(key)) {
			this._removedHits++;
			return;
		}
		if (this._present.has(key)) {
			this._duplicates++;
			return;
		}
		this._present.add(key);
	}

	_removeOne(item) {
		const key = typeof item === 'object' ? JSON.stringify(item) : item;
		if (this._excluded.has(key)) return; // already excluded, no-op
		this._present.delete(key);
		this._excluded.add(key);
	}

	push(item) {
		if (Array.isArray(item)) {
			for (const x of item) this._pushOne(x);
		} else {
			this._pushOne(item);
		}
	}

	remove(item) {
		if (Array.isArray(item)) {
			for (const x of item) this._removeOne(x);
		} else {
			this._removeOne(item);
		}
	}

	stats() {
		const size = this._present.size;
		const removed = this._excluded.size + this._removedHits;
		const duplicates = this._duplicates;
		return {
			size,
			removed,
			duplicates,
			total() { return this.size + this.removed + this.duplicates; }
		};
	}

	// Sorted export. Single Array.from + sort, both V8-optimized.
	export() {
		const arr = Array.from(this._present);
		arr.sort();
		return arr;
	}

	// Insertion-order export (Sets preserve insertion order).
	disarray() {
		return Array.from(this._present);
	}
}

ExclusionSet.fromArray = function (exclude) {
	return new ExclusionSet(exclude);
};
