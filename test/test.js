import { BinaryTree } from "../features/tree.js"
import { ExclusionQuery } from "../features/sqlmemory.js"
import { ExclusionSet } from "../features/exclusion.js"

import assert from 'node:assert'

const EXPECTED_DATA = ['Adam', 'Eve', 'John', 'Lilith', 'Lucifer', 'Mary', 'Paul'];

function runOps(tree, init) {
	init(tree);
	tree.push("John");
	tree.push("Eve");
	tree.push("Eve");
	tree.push("Satan");
	tree.push(["Mary", "Joseph", "Jesus", "God"]);
	tree.push("Paul");
	tree.push("Mohammed");
	tree.push("Allah");
	tree.push("Adam");
	tree.push(["Adam", "Eve", "Lucifer", "Lilith", "Satan"]);
	tree.remove("Satan");
	tree.remove("Joseph");
	tree.push("Eve");
}

// Event-counting semantics: every push/remove call increments something.
// Used by BinaryTree and ExclusionSet.
//
// Trace (init pre-excludes Jesus/Allah/Mohammed/God → removed=4):
//   push John(new)        size=1
//   push Eve(new)         size=2
//   push Eve(dup)         dup=1
//   push Satan(new)       size=3
//   push Mary(new)        size=4
//   push Joseph(new)      size=5
//   push Jesus(excluded)  rem=5
//   push God(excluded)    rem=6
//   push Paul(new)        size=6
//   push Mohammed(excl)   rem=7
//   push Allah(excl)      rem=8
//   push Adam(new)        size=7
//   push Adam(dup)        dup=2
//   push Eve(dup)         dup=3
//   push Lucifer(new)     size=8
//   push Lilith(new)      size=9
//   push Satan(dup)       dup=4
//   remove Satan(flip)    size=8, rem=9
//   remove Joseph(flip)   size=7, rem=10
//   push Eve(dup)         dup=5
// Final: size=7, removed=10, duplicates=5, total=22
function checkEventStats(stats, label) {
	assert.strictEqual(stats.size, 7, `${label}: size`);
	assert.strictEqual(stats.removed, 10, `${label}: removed`);
	assert.strictEqual(stats.duplicates, 5, `${label}: duplicates`);
	assert.strictEqual(stats.total(), 22, `${label}: total`);
}

// Set-membership semantics: counts distinct items in each bucket.
// Used by ExclusionQuery (SQL).
//   size = distinct un-excluded items = 7
//   removed = distinct excluded items = 6 (Jesus, Allah, Mohammed, God, Satan, Joseph)
//   duplicates = not tracked (null)
function checkBucketStats(stats, label) {
	assert.strictEqual(stats.size, 7, `${label}: size`);
	assert.strictEqual(stats.removed, 6, `${label}: removed`);
	assert.strictEqual(stats.duplicates, null, `${label}: duplicates not tracked`);
	assert.strictEqual(stats.total(), 13, `${label}: total`);
}

function checkData(data, label) {
	assert.deepStrictEqual(data, EXPECTED_DATA, `${label}: export contents`);
}

// --- BinaryTree ---
{
	const tree = new BinaryTree();
	runOps(tree, t => t.remove(["Jesus", "Allah", "Mohammed", "God"]));
	const stats = tree.stats();
	console.log("BinaryTree stats:", { size: stats.size, removed: stats.removed, dup: stats.duplicates, total: stats.total() });
	checkEventStats(stats, "BinaryTree");
	const data = tree.export();
	console.log("BinaryTree data:", data);
	checkData(data, "BinaryTree");
	console.log("✓ BinaryTree\n");
}

// --- ExclusionSet (pure JS) ---
{
	const tree = ExclusionSet.fromArray(["Jesus", "Allah", "Mohammed", "God"]);
	runOps(tree, () => {});
	const stats = tree.stats();
	console.log("ExclusionSet stats:", { size: stats.size, removed: stats.removed, dup: stats.duplicates, total: stats.total() });
	checkEventStats(stats, "ExclusionSet");
	const data = tree.export();
	console.log("ExclusionSet data:", data);
	checkData(data, "ExclusionSet");
	console.log("✓ ExclusionSet\n");
}

// --- ExclusionQuery (SQL) ---
{
	const tree = ExclusionQuery.fromArray(["Jesus", "Allah", "Mohammed", "God"]);
	runOps(tree, () => {});
	const stats = tree.stats();
	console.log("ExclusionQuery stats:", { size: stats.size, removed: stats.removed, dup: stats.duplicates, total: stats.total() });
	checkBucketStats(stats, "ExclusionQuery");
	const data = tree.export();
	console.log("ExclusionQuery data:", data);
	checkData(data, "ExclusionQuery");
	tree.close();
	console.log("✓ ExclusionQuery\n");
}

console.log("All tests passed.");
