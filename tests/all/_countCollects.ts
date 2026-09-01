// Preload for test_174_each_pass_builds_its_tree_once: counts how many times the generator builds
// its whole type tree (TypesCollector.collect) while the coverage tool runs, then writes the count
// to COV_COLLECTS on exit. The tool mutes console.log (coverage-spec.mts:27), so its own trace
// can't be read from outside — wrapping the method here is what makes the count observable.
//   e.g. one op like get:/pets/{id} used to cost 2 collect() calls — one for the coverage tool's
//   GEN-EMPTY check (getTypes), one for the schema it then writes (generateSchema) — see #174.
import fs from 'fs';
import { TypesCollector } from '../../src/oas/generator/typesCollector.js';

let count = 0;
const collect = TypesCollector.prototype.collect;
TypesCollector.prototype.collect = function (this: TypesCollector, selection: string[]) {
  count++;
  return collect.call(this, selection);
};

process.on('exit', () => fs.writeFileSync(process.env.COV_COLLECTS!, String(count)));
