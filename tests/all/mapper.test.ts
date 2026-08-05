import _ from 'lodash';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { test } from 'node:test';
import assert from 'node:assert';
import { OasGen } from '../../src/index.js';
import { runOasTest } from '../../src/tests/runners.js';
import { RulesLoader, OpNameMapper } from '../../src/oas/mapper/index.js';
import './_setup.js';

test('test_055_test-parser-reset', async () => {
  const file = 'launch_Library_2-docs-v2.3.0.json';
  const oasBasePath = '/Users/fernando/Development/Apollo/connectors/projects/gen/tests/resources/oas';

  const content = fs.readFileSync(`${oasBasePath}/${file}`)

  // @ts-expect-error - Buffer to ArrayBuffer conversion
  const gen = await OasGen.fromData(content as ArrayBuffer, {
    skipValidation: false,
    showParentInSelections: false,
  });

  await gen.visit();

  // 1st pass
  const paths = [
    "get:/2.3.0/agencies/>res:r>obj:type:#/c/s/PaginatedPolymorphicAgencyEndpointList>prop:array:#results>union:type:#/c/s/PolymorphicAgencyEndpoint>obj:type:#/c/s/AgencyMini>prop:scalar:id"
  ]

  const types = gen.getTypes(paths);
  const schema = gen.generateSchema(paths);

  // 2nd pass
  const types2 = gen.getTypes(paths);
  const schema2 = gen.generateSchema(paths);

  assert.ok(_.isEqual(schema, schema2), "Schema should be equal");
  assert.ok(_.isEqual(Array.from(types.keys()), Array.from(types2.keys())), "Types keys should be equal")
});


// Transform rules tests
test('test_056_should load valid transform rules from file', async () => {
  const tempFile = path.join(os.tmpdir(), 'test-rules.json');
  const rulesContent = {
    description: 'Test rules',
    rules: [
      {
        pattern: 'apiV1(.*)',
        replacement: 'api_v1_$1'
      }
    ]
  };

  fs.writeFileSync(tempFile, JSON.stringify(rulesContent));

  try {
    const rules = RulesLoader.fromFile(tempFile);
    
    assert.strictEqual(rules.description, 'Test rules');
    assert.strictEqual(rules.rules.length, 1);
    assert.strictEqual(rules.rules[0].pattern, 'apiV1(.*)');
    assert.strictEqual(rules.rules[0].replacement, 'api_v1_$1');
    assert.strictEqual(rules.rules[0].description, undefined);
    assert.strictEqual(rules.rules[0].enabled, undefined);
  } finally {
    fs.unlinkSync(tempFile);
  }
});

test('should map operation names with multiple rules', async () => {
  const rules = {
    rules: [
      {
        pattern: 'apiV1(.*)',
        replacement: 'api_v1_$1'
      },
      {
        pattern: 'get(.*)',
        replacement: 'fetch$1'
      }
    ]
  };

  const mapper = OpNameMapper.fromRules(rules);
  const result = mapper.operationName('apiV1getUser');
  
  // Should apply both rules: apiV1getUser -> api_v1_getUser -> api_v1_fetchUser
  assert.strictEqual(result, 'api_v1_fetchUser');
});

test('should handle legacy pattern conversion', async () => {
  const rule = OpNameMapper.fromPattern('apiV1(.*):api_v1_$1');
  const result = rule.operationName('apiV1getUser');
  
  assert.strictEqual(result, 'api_v1_getUser');
});

test('should apply rules in priority order', async () => {
  const rules = {
    rules: [
      {
        pattern: 'apiV1(.*)',
        replacement: 'api_v1_$1',
        priority: 1
      },
      {
        pattern: 'get(.*)',
        replacement: 'fetch$1',
        priority: 10 // Higher priority, should be applied first
      },
      {
        pattern: 'fetchUser',
        replacement: 'getUser',
        priority: 5
      }
    ]
  };

  const mapper = OpNameMapper.fromRules(rules);
  const result = mapper.operationName('apiV1getUser');
  
  // Priority order: 10, 5, 1
  // 1. get(.*) -> fetch$1: apiV1getUser -> apiV1fetchUser
  // 2. fetchUser -> getUser: apiV1fetchUser -> apiV1getUser  
  // 3. apiV1(.*) -> api_v1_$1: apiV1getUser -> api_v1_getUser
  assert.strictEqual(result, 'api_v1_getUser');
});

test('test_057_oas_test_petstore_with_transform_rules', async () => {
  // Load the petstore transform rules
  const rules = RulesLoader.fromFile('./tests/resources/petstore-transform-rules.json');
  const mapper = OpNameMapper.fromRules(rules);
  
  // Test that the mapper correctly transforms operation names
  assert.strictEqual(mapper.operationName('createPet'), 'create_Pet');
  assert.strictEqual(mapper.operationName('updateUserByUsername'), 'updateUser');
  assert.strictEqual(mapper.operationName('createUser'), 'create_User');
  
  // Test with petstore operations that should be transformed
  const paths = [
    'get:/pet/{petId}>**',
    'get:/pet/findByStatus>**',
    'get:/pet/findByTags>**',
    'get:/store/inventory>**',
    'get:/store/order/{orderId}>**',
    'get:/user/{username}>**',
    'get:/user/login>**',
    'get:/user/logout>**',
  ];

  await runOasTest('petstore.yaml', paths, 19, 8, false, false, mapper);
});

test('test_058_oas_test_mb_cc_with_transform_rules', async () => {
  // Load the mb-cc transform rules
  const rules = RulesLoader.fromFile('./tests/resources/mb-cc-transform-rules.json');
  const mapper = OpNameMapper.fromRules(rules);
  
  // Test that the mapper correctly transforms operation names with exact matching
  assert.strictEqual(mapper.operationName('apiV1Markets'), 'markets');
  assert.strictEqual(mapper.operationName('marketsByMarketIdModels'), 'marketModels');
  assert.strictEqual(mapper.operationName('marketsByMarketIdByModelIdModelsByMarketIdByModelId'), 'vehicleModel');
  assert.strictEqual(mapper.operationName('modelByMarketIdAndModelIdConfigurationsInitial'), 'initialVehicleConfiguration');
  assert.strictEqual(mapper.operationName('marketsByMarketIdByModelIdByConfigurationIdModelsByMarketIdByModelIdByConfigurationIdConfigurationsByMarketIdByModelIdByConfigurationId'), 'vehicleConfiguration');
  
  // Test that the mapper doesn't transform unrelated names
  assert.strictEqual(mapper.operationName('getUser'), 'getUser');
  assert.strictEqual(mapper.operationName('createPet'), 'createPet');
  
  // Test that the mapper doesn't transform partial matches (this was the problem before anchors)
  assert.strictEqual(mapper.operationName('apiV1MarketsExtended'), 'apiV1MarketsExtended');
  assert.strictEqual(mapper.operationName('ExtendedApiV1Markets'), 'ExtendedApiV1Markets');
  assert.strictEqual(mapper.operationName('marketsByMarketIdModelsExtended'), 'marketsByMarketIdModelsExtended');
  assert.strictEqual(mapper.operationName('ExtendedMarketsByMarketIdModels'), 'ExtendedMarketsByMarketIdModels');
});

test('test_059_oas_test_mb_cc_problematic_rules_without_anchors', async () => {
  // Create rules without anchors to demonstrate the problem
  const problematicRules = {
    description: "Problematic rules without anchors",
    rules: [
      { "pattern": "apiV1Markets", "replacement": "markets" },
      { "pattern": "marketsByMarketIdModels", "replacement": "marketModels" }
    ]
  };
  
  const mapper = OpNameMapper.fromRules(problematicRules);
  
  // This shows the problem: rules without anchors affect multiple names
  assert.strictEqual(mapper.operationName('apiV1Markets'), 'markets');
  assert.strictEqual(mapper.operationName('apiV1MarketsExtended'), 'marketsExtended'); // ❌ Problem: partial match
  assert.strictEqual(mapper.operationName('ExtendedApiV1Markets'), 'ExtendedApiV1Markets'); // This doesn't match because pattern is at start
  
  assert.strictEqual(mapper.operationName('marketsByMarketIdModels'), 'marketModels');
  assert.strictEqual(mapper.operationName('marketsByMarketIdModelsExtended'), 'marketModelsExtended'); // ❌ Problem: partial match
  
  // Let's show a better example of the problem with a pattern that could match anywhere
  const problematicRules2 = {
    description: "Problematic rules that could match anywhere",
    rules: [
      { "pattern": "Markets", "replacement": "MarketsFixed" },
      { "pattern": "Models", "replacement": "ModelsFixed" }
    ]
  };
  
  const mapper2 = OpNameMapper.fromRules(problematicRules2);
  
  // This shows the real problem: patterns match anywhere in the string
  assert.strictEqual(mapper2.operationName('apiV1Markets'), 'apiV1MarketsFixed');
  assert.strictEqual(mapper2.operationName('ExtendedApiV1Markets'), 'ExtendedApiV1MarketsFixed'); // ❌ Problem: matches anywhere
  assert.strictEqual(mapper2.operationName('marketsByMarketIdModels'), 'marketsByMarketIdModelsFixed'); // ❌ Problem: matches "Models" anywhere
});
