// DisArray — an Array subclass for randomized insertion order and shuffling.
//
// - displace(item | items[]): inserts at a uniformly-random position. Skips
//   duplicates. O(1) membership check via internal Set.
// - disarrange(times=1): Fisher–Yates shuffle in place. `times` reshuffles.
// - concat(...arrays): returns a new DisArray with all elements appended.
// - push: aliased to displace, so it can drop into Array-shaped APIs.

export class DisArray extends Array {
    constructor(...args) {
        super(...args);
        // Non-enumerable internal Set for O(1) `includes` checks.
        // Non-enumerable so it doesn't show up in spreads / Object.keys / for..in.
        Object.defineProperty(this, '_seen', {
            value: new Set(args),
            writable: true,
            enumerable: false,
            configurable: true,
        });
    }

    // Insert one item, or each item of an array, at uniformly-random positions.
    // Returns the number of items actually inserted (skips duplicates).
    displace(item) {
        if (Array.isArray(item)) {
            let inserted = 0;
            for (const x of item) {
                if (this._displaceOne(x)) inserted++;
            }
            return inserted;
        }
        return this._displaceOne(item) ? 1 : 0;
    }

    _displaceOne(item) {
        if (this._seen.has(item)) return false;
        // length+1 positions available: 0..length inclusive. Uniform over all slots.
        const pos = Math.floor(Math.random() * (this.length + 1));
        this.splice(pos, 0, item);
        this._seen.add(item);
        return true;
    }

    // Fisher–Yates shuffle, in place. O(n) per pass.
    // `times > 1` is mathematically redundant (one F–Y is already uniform) but
    // preserved for API compatibility.
    disarrange(times = 1) {
        const n = this.length;
        while (times-- > 0) {
            for (let i = n - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                if (i !== j) {
                    const tmp = this[i];
                    this[i] = this[j];
                    this[j] = tmp;
                }
            }
        }
        return this;
    }

    // Returns a new DisArray containing this array's items followed by all
    // items from each argument array. Duplicates across inputs are dropped.
    concat(...arrs) {
        const out = new DisArray();
        for (const item of this) out._displaceOne(item);
        for (const arr of arrs) {
            for (const item of arr) out._displaceOne(item);
        }
        return out;
    }

    // Construct a DisArray from an existing array. Items are inserted in their
    // original order (not shuffled). Call .disarrange() afterward to shuffle.
    static fromArray(items) {
        const d = new DisArray();
        for (const item of items) d._displaceOne(item);
        return d;
    }
}