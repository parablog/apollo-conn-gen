import { test } from 'node:test';
import { runOasTest } from '../src/tests/runners.js';
import { OasGen } from '../src/oas/oasGen.js';
import fs from 'fs';
import _ from 'lodash';
import assert from 'assert';
import { OpNameMapper } from '../src/oas/mapper/index.js';
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

// test('test_054_oas_fhir-simple', async () => {
//   const paths = ['get:/Account>**'];
//   await runOasTest('FHIR-baseR4.yaml', paths, 4306, 0);
// });


// test('test_053_oas_test_036_time-series', async () => {
//   const paths = ['post:/market-data-services/time-series/search>**'];
//   await runOasTest('time-series-1.0.28.yaml', paths, 1, 12);
// });

// test('test_059_oas_test_mb_cc_problematic_rules_without_anchors', async () => {
//   // Create rules without anchors to demonstrate the problem
//   const problematicRules = {
//     description: "Problematic rules without anchors",
//     rules: [
//       { "pattern": "apiV1Markets", "replacement": "markets" },
//       { "pattern": "marketsByMarketIdModels", "replacement": "marketModels" }
//     ]
//   };
  
//   const mapper = OpNameMapper.fromRules(problematicRules);
  
//   // This shows the problem: rules without anchors affect multiple names
//   assert.strictEqual(mapper.operationName('apiV1Markets'), 'markets');
//   assert.strictEqual(mapper.operationName('apiV1MarketsExtended'), 'marketsExtended'); // ❌ Problem: partial match
//   assert.strictEqual(mapper.operationName('ExtendedApiV1Markets'), 'ExtendedApiV1Markets'); // This doesn't match because pattern is at start
  
//   assert.strictEqual(mapper.operationName('marketsByMarketIdModels'), 'marketModels');
//   assert.strictEqual(mapper.operationName('marketsByMarketIdModelsExtended'), 'marketModelsExtended'); // ❌ Problem: partial match
  
//   // Let's show a better example of the problem with a pattern that could match anywhere
//   const problematicRules2 = {
//     description: "Problematic rules that could match anywhere",
//     rules: [
//       { "pattern": "Markets", "replacement": "MarketsFixed" },
//       { "pattern": "Models", "replacement": "ModelsFixed" }
//     ]
//   };
  
//   const mapper2 = OpNameMapper.fromRules(problematicRules2);
  
//   // This shows the real problem: patterns match anywhere in the string
//   assert.strictEqual(mapper2.operationName('apiV1Markets'), 'apiV1MarketsFixed');
//   assert.strictEqual(mapper2.operationName('ExtendedApiV1Markets'), 'ExtendedApiV1MarketsFixed'); // ❌ Problem: matches anywhere
//   assert.strictEqual(mapper2.operationName('marketsByMarketIdModels'), 'marketsByMarketIdModelsFixed'); // ❌ Problem: matches "Models" anywhere
// });

// test('test_060_oas_test_mb_cc_fixed_rules_with_anchors', async () => {
//   // Create rules with anchors to demonstrate the fix
//   const fixedRules = {
//     description: "Fixed rules with anchors",
//     rules: [
//       { "pattern": "^apiV1Markets$", "replacement": "markets" },
//       { "pattern": "^marketsByMarketIdModels$", "replacement": "marketModels" },
//       { "pattern": "^Markets$", "replacement": "MarketsFixed" },
//       { "pattern": "^Models$", "replacement": "ModelsFixed" }
//     ]
//   };
  
//   const mapper = OpNameMapper.fromRules(fixedRules);
  
//   // This shows the fix: rules with anchors only match exact names
//   assert.strictEqual(mapper.operationName('apiV1Markets'), 'markets');
//   assert.strictEqual(mapper.operationName('marketsByMarketIdModels'), 'marketModels');
  
//   // Test that partial matches are NOT affected (this is the fix)
//   assert.strictEqual(mapper.operationName('apiV1MarketsExtended'), 'apiV1MarketsExtended'); // ✅ Fixed: no partial match
//   assert.strictEqual(mapper.operationName('ExtendedApiV1Markets'), 'ExtendedApiV1Markets'); // ✅ Fixed: no partial match
//   assert.strictEqual(mapper.operationName('marketsByMarketIdModelsExtended'), 'marketsByMarketIdModelsExtended'); // ✅ Fixed: no partial match
  
//   // Test that patterns only match exact strings
//   assert.strictEqual(mapper.operationName('Markets'), 'MarketsFixed'); // Only exact match
//   assert.strictEqual(mapper.operationName('Models'), 'ModelsFixed'); // Only exact match
//   assert.strictEqual(mapper.operationName('apiV1Markets'), 'markets'); // Exact match for apiV1Markets
//   assert.strictEqual(mapper.operationName('marketsByMarketIdModels'), 'marketModels'); // Exact match for marketsByMarketIdModels
// });


test('test-single', async () => {
  // const paths = ["get:/api/v1/markets/{marketId}/dataversion/{dataversion}/models/{modelId}/configurations/{configurationId}/selectables>res:r>obj:type:#/c/s/VehicleComponentTree>prop:map:vehicleComponents>**"];
  const paths = [
    // 'get:/api/v1/markets/{marketId}/models/{modelId}/configurations/{configurationId}/selectables>res:r>obj:type:#/c/s/VehicleComponentTree>prop:map:vehicleComponents>map:type:VehicleComponentsEntry>obj:type:#/c/s/VehicleComponent>**',
    "get:/api/v1/markets>res:r>array:#/c/s/Market>obj:type:#/c/s/Market>prop:scalar:country",
  ]
  await runOasTest('openapi.car_configurator_service_(ccs)_int-10.210.0.yaml', paths, 44, 1, false, true, undefined, true);
});
