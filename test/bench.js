import { BinaryTree } from "../features/tree.js"
import { ExclusionSet } from "../features/exclusion.js"
import { ExclusionQuery } from "../features/sqlmemory.js"
import { randomBytes } from "crypto"

const SIZES = [
	{ name: "small",  seed:   1000, input:  10000, pool:   3000 },
	{ name: "medium", seed:  20000, input: 100000, pool:  30000 },
	{ name: "large",  seed: 200000, input: 1000000, pool: 300000 },
];

function gen(pool_size, seed_size, input_size) {
	const pool = new Array(pool_size);
	for (let i = 0; i < pool_size; i++) pool[i] = randomBytes(8).toString('hex');
	const seed = pool.slice(0, seed_size);
	const inputs = new Array(input_size);
	for (let i = 0; i < input_size; i++) {
		inputs[i] = pool[Math.floor(Math.random() * pool_size)];
	}
	return { seed, inputs };
}

function bench(label, factory, seed, inputs) {
	if (global.gc) global.gc();
	const t0 = performance.now();
	const x = factory(seed);
	const tSeed = performance.now() - t0;

	const t1 = performance.now();
	x.push(inputs);
	const tPush = performance.now() - t1;

	const t2 = performance.now();
	const out = x.export();
	const tExp = performance.now() - t2;

	const total = tSeed + tPush + tExp;
	if (x.close) x.close();
	return { label, tSeed, tPush, tExp, total, outLen: out.length };
}

for (const size of SIZES) {
	console.log(`\n=== ${size.name.toUpperCase()}: ${size.seed.toLocaleString()} seed, ${size.input.toLocaleString()} inputs, pool=${size.pool.toLocaleString()} ===`);
	const { seed, inputs } = gen(size.pool, size.seed, size.input);

	const results = [];

	// BinaryTree gets skipped on large because the unbalanced tree degrades badly
	if (size.name !== "large") {
		results.push(bench("BinaryTree",     () => { const t = new BinaryTree(); t.remove(seed); return t; }, seed, inputs));
	}
	results.push(bench("ExclusionSet",   ExclusionSet.fromArray,   seed, inputs));
	results.push(bench("ExclusionQuery", ExclusionQuery.fromArray, seed, inputs));

	console.log("");
	console.log("Class            | seed(ms) | push(ms) | export(ms) | total(ms) | output");
	console.log("-----------------|----------|----------|------------|-----------|-------");
	for (const r of results) {
		console.log(
			r.label.padEnd(16) + " | " +
			r.tSeed.toFixed(1).padStart(8) + " | " +
			r.tPush.toFixed(1).padStart(8) + " | " +
			r.tExp.toFixed(1).padStart(10) + " | " +
			r.total.toFixed(1).padStart(9) + " | " +
			r.outLen.toString().padStart(6)
		);
	}
}
