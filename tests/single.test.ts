import { test } from 'node:test';
import { runOasTest } from '../src/tests/runners.js';
import { OasGen } from '../src/oas/oasGen.js';
import fs from 'fs';
import _ from 'lodash';
import assert from 'assert';
// import diff from 'deep-diff';
// import { stringify } from 'flatted';
// import { stringify } from 'superjson'

/*
test('test_053_oas_test_036_time-series', async () => {
  const paths = ['post:/market-data-services/time-series/search>**'];
  await runOasTest('time-series-1.0.28.yaml', paths, 1, 12);
});
*/


// test('test_055_test-parser-reset', async () => {
//   const file = 'launch_Library_2-docs-v2.3.0.json';
//   const oasBasePath = '/Users/fernando/Development/Apollo/connectors/projects/gen/tests/resources/oas';

//   const content = fs.readFileSync(`${oasBasePath}/${file}`)

//   const gen = await OasGen.fromData(content as ArrayBuffer, {
//     skipValidation: false,
//     consolidateUnions: true,
//     showParentInSelections: false,
//   });

//   await gen.visit();

//   // 1st pass
//   const paths = [
//     "get:/2.3.0/agencies/>res:r>obj:type:#/c/s/PaginatedPolymorphicAgencyEndpointList>prop:array:#results>union:#/c/s/PolymorphicAgencyEndpoint>obj:type:#/c/s/AgencyMini>prop:scalar:id"
//   ]

//   const types = gen.getTypes(paths);
//   const schema = gen.generateSchema(paths);
//   // const g1 = _.cloneDeep(gen);
//   console.log(schema);

//   // 2nd pass
//   const types2 = gen.getTypes(paths);
//   const schema2 = gen.generateSchema(paths);

//   // fs.writeFileSync('schema1.graphql', schema);
//   // fs.writeFileSync('schema2.graphql', schema2);

//   assert.ok(_.isEqual(schema, schema2), "Schema should be equal");
//   assert.ok(_.isEqual(Array.from(types.keys()), Array.from(types2.keys())), "Types keys should be equal")
// });

test('test_054_oas_fhir-simple', async () => {
  const paths = ['get:/Account>**'];
  await runOasTest('FHIR-baseR4.yaml', paths, 4306, 0);
});
