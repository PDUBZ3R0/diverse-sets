import { DisArray } from './disarray.js'

const verbose = process.argv.includes("--verbose");

class Node {
	constructor(obj, excluded) {
		this.obj = obj;
		this.excluded = excluded;
		this.left = null;
		this.right = null;
	}
}

export class BinaryTree {
	constructor() {
		const stats = {
			size: 0,
			removed: 0,
			duplicates: 0,
			total() {
				return this.size + this.removed + this.duplicates;
			}
		};

		this._top = null;

		// Iterative insert. exmode=false → push, exmode=true → remove.
		// One function, no per-node closures, no recursion.
		const insert = (obj, exmode) => {
			if (this._top === null) {
				this._top = new Node(obj, exmode);
				if (exmode) stats.removed++;
				else stats.size++;
				if (verbose) console.log("_top", obj);
				return;
			}

			let current = this._top;
			while (true) {
				const b = current.obj;
				if (obj === b) {
					if (exmode) {
						if (!current.excluded) {
							current.excluded = true;
							stats.size--;
							stats.removed++;
						}
					} else {
						if (current.excluded) stats.removed++;
						else stats.duplicates++;
					}
					return;
				}
				// === handled above, so "not <" means strictly >.
				if (obj < b) {
					if (current.left !== null) {
						current = current.left;
					} else {
						current.left = new Node(obj, exmode);
						if (exmode) stats.removed++;
						else stats.size++;
						if (verbose) console.log("left", obj);
						return;
					}
				} else {
					if (current.right !== null) {
						current = current.right;
					} else {
						current.right = new Node(obj, exmode);
						if (exmode) stats.removed++;
						else stats.size++;
						if (verbose) console.log("right", obj);
						return;
					}
				}
			}
		};

		this.push = (obj) => {
			if (Array.isArray(obj)) {
				for (const item of obj) insert(item, false);
			} else {
				insert(obj, false);
			}
		};

		this.remove = (obj) => {
			if (Array.isArray(obj)) {
				for (const item of obj) insert(item, true);
			} else {
				insert(obj, true);
			}
		};

		// Iterative in-order traversal — no recursion, single output array.
		this.export = () => {
			const output = [];
			if (this._top === null) return output;
			const stack = [];
			let current = this._top;
			while (current !== null || stack.length > 0) {
				while (current !== null) {
					stack.push(current);
					current = current.left;
				}
				current = stack.pop();
				if (!current.excluded) output.push(current.obj);
				current = current.right;
			}
			return output;
		};

		this.disarray = () => {
			const output = new DisArray();
			if (this._top === null) return output;
			const stack = [];
			let current = this._top;
			while (current !== null || stack.length > 0) {
				while (current !== null) {
					stack.push(current);
					current = current.left;
				}
				current = stack.pop();
				if (!current.excluded) output.displace(current.obj);
				current = current.right;
			}
			return output;
		};

		this.stats = () => stats;
	}
}
