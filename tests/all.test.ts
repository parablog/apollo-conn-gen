import _ from 'lodash';
import fs from 'fs';
import { test } from 'node:test';
import assert from 'node:assert';
import { JsonGen } from '../src/index.js';
import { JsonContext, JsonType } from '../src/json/index.js';
import { oasBasePath, runJsonTest, runOasTest } from '../src/tests/runners.js';

console.log = () => {};
console.warn = () => {};
console.error = () => {};

test('should construct Walker from JSON string and store types in context', () => {
  const json = `{
      "name": "Test User",
      "age": 25,
      "address": {
        "street": "Main St",
        "city": "Anytown"
      }
    }`;

  const walker = JsonGen.fromReader(json);
  const context: JsonContext = walker.getContext();
  const types: JsonType[] = context.getTypes();

  // ConnectorWriter.write(walker, writer);
  // writer.clear();
  const schema = walker.generateSchema();

  assert.ok(types.length > 0);
});

test('should construct Walker from JSON file and store types in context', async () => {
  await runJsonTest('test/merge/a.json');
});

test('should read and output a single file', async () => {
  await runJsonTest('preferences/user/50.json');
});

test('should read all the json files and combine the output into one', async () => {
  await runJsonTest('live-scores/all');
});

test('stats/fixtures/championship', async () => {
  await runJsonTest('stats/fixtures/championship');
});

test('stats/leagues', async () => {
  await runJsonTest('stats/leagues');
});

test('stats/line-ups', async () => {
  await runJsonTest('stats/line-ups');
});

test('stats/results/scottish-premiership', async () => {
  await runJsonTest('stats/results/scottish-premiership');
});

test('stats/tables/championship', async () => {
  await runJsonTest('stats/tables/championship');
});

test('stats/tables/not-found.json', async () => {
  await runJsonTest('stats/tables/not-found.json');
});

test('fronts', async () => {
  await runJsonTest('fronts');
});

test('articles/search.json', async () => {
  await runJsonTest('articles/search.json');
});

test('articles/clockwatch', async () => {
  const output = await runJsonTest('articles/clockwatch', { shouldFail: true });
  assert.ok(output !== undefined);
  assert.ok(output!.includes('SELECTED_FIELD_NOT_FOUND'));
});

test('test/merge', async () => {
  await runJsonTest('test/merge');
});

test('articles/blog', async () => {
  await runJsonTest('articles/blog', {
    shouldFail: true,
    outputContains: 'SELECTED_FIELD_NOT_FOUND',
  });
});

test('articles/article', async () => {
  await runJsonTest('articles/article', {
    shouldFail: true,
    outputContains: 'SELECTED_FIELD_NOT_FOUND',
  });
});

test('articles/article/2023_dec_01_premier-league-10-things-to-look-out-for-this-weekend', async () => {
  await runJsonTest('articles/article/2023_dec_01_premier-league-10-things-to-look-out-for-this-weekend.json', {
    shouldFail: true,
    outputContains: 'SELECTED_FIELD_NOT_FOUND',
  });
});

test('live-scores/all/2023-12-23_15_00.json', async () => {
  await runJsonTest('live-scores/all/2023-12-23_15_00.json');
});

test('test/all/2023-12-23_15_00.json', async () => {
  await runJsonTest('test/names_with_colon.json');
});

test('test/null_fields.json', async () => {
  await runJsonTest('test/null_fields.json');
});

/// OAS TESTS
test('test_001_oas_test minimal petstore', async () => {
  const paths = [
    'get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:scalar:id',
    'get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:scalar:name',
    'get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:obj:category>obj:type:#/c/s/Category>prop:scalar:name',
  ];

  await runOasTest(`petstore.yaml`, paths, 19, 2);
});

test('test_002_oas_test minimal petstore 02', async () => {
  const paths = [
    'get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:scalar:id',
    'get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:scalar:name',
    'get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:array:#photoUrls',
    'get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:scalar:status',
    'get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:obj:category>obj:type:#/c/s/Category>prop:scalar:id',
    'get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:obj:category>obj:type:#/c/s/Category>prop:scalar:name',
    'get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:array:#tags>obj:type:#/c/s/Tag>prop:scalar:id',
    'get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:array:#tags>obj:type:#/c/s/Tag>prop:scalar:name',
  ];

  await runOasTest(`petstore.yaml`, paths, 19, 3);
});

test('test_003_oas_test minimal petstore 03 array', async () => {
  const paths = ['get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:array:#photoUrls'];

  await runOasTest(`petstore.yaml`, paths, 19, 1);
});

test('test_004_oas_test minimal petstore 03 all GETs', async () => {
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

  await runOasTest(`petstore.yaml`, paths, 19, 6);
});

test('test_005_oas_test full get petstore', async () => {
  assert.ok(fs.existsSync(`${oasBasePath}/petstore.yaml`));

  const file = fs.readFileSync(`${oasBasePath}/petstore.yaml`);
  assert.ok(file !== undefined);

  const paths = [
    'get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:obj:category>obj:type:#/c/s/Category>prop:scalar:id',
    'get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:obj:category>obj:type:#/c/s/Category>prop:scalar:name',
    'get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:scalar:id',
    'get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:scalar:name',
    'get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:array:#photoUrls',
    'get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:scalar:status',
    'get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:array:#tags>obj:type:#/c/s/Tag>prop:scalar:id',
    'get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:array:#tags>obj:type:#/c/s/Tag>prop:scalar:name',
    'get:/pet/findByStatus>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:obj:category>obj:type:#/c/s/Category>prop:scalar:id',
    'get:/pet/findByStatus>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:obj:category>obj:type:#/c/s/Category>prop:scalar:name',
    'get:/pet/findByStatus>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:scalar:id',
    'get:/pet/findByStatus>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:scalar:name',
    'get:/pet/findByStatus>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:array:#photoUrls',
    'get:/pet/findByStatus>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:scalar:status',
    'get:/pet/findByStatus>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:array:#tags>obj:type:#/c/s/Tag>prop:scalar:id',
    'get:/pet/findByStatus>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:array:#tags>obj:type:#/c/s/Tag>prop:scalar:name',
    'get:/pet/findByTags>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:obj:category>obj:type:#/c/s/Category>prop:scalar:id',
    'get:/pet/findByTags>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:obj:category>obj:type:#/c/s/Category>prop:scalar:name',
    'get:/pet/findByTags>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:scalar:id',
    'get:/pet/findByTags>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:scalar:name',
    'get:/pet/findByTags>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:array:#photoUrls',
    'get:/pet/findByTags>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:scalar:status',
    'get:/pet/findByTags>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:array:#tags>obj:type:#/c/s/Tag>prop:scalar:id',
    'get:/pet/findByTags>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:array:#tags>obj:type:#/c/s/Tag>prop:scalar:name',
    'get:/store/order/{orderId}>res:r>obj:type:#/c/s/Order>prop:scalar:complete',
    'get:/store/order/{orderId}>res:r>obj:type:#/c/s/Order>prop:scalar:id',
    'get:/store/order/{orderId}>res:r>obj:type:#/c/s/Order>prop:scalar:petId',
    'get:/store/order/{orderId}>res:r>obj:type:#/c/s/Order>prop:scalar:quantity',
    'get:/store/order/{orderId}>res:r>obj:type:#/c/s/Order>prop:scalar:shipDate',
    'get:/store/order/{orderId}>res:r>obj:type:#/c/s/Order>prop:scalar:status',
    'get:/user/{username}>res:r>obj:type:#/c/s/User>prop:scalar:email',
    'get:/user/{username}>res:r>obj:type:#/c/s/User>prop:scalar:firstName',
    'get:/user/{username}>res:r>obj:type:#/c/s/User>prop:scalar:id',
    'get:/user/{username}>res:r>obj:type:#/c/s/User>prop:scalar:lastName',
    'get:/user/{username}>res:r>obj:type:#/c/s/User>prop:scalar:password',
    'get:/user/{username}>res:r>obj:type:#/c/s/User>prop:scalar:phone',
    'get:/user/{username}>res:r>obj:type:#/c/s/User>prop:scalar:username',
    'get:/user/{username}>res:r>obj:type:#/c/s/User>prop:scalar:userStatus',
  ];

  await runOasTest(`petstore.yaml`, paths, 19, 5);
});

test('test_006_oas_test_003_testConsumerJourney', async () => {
  const paths = [
    'get:/consumer/{id}>res:r>obj:type:#/c/s/Consumer>prop:scalar:firstName',
    'get:/consumer/{id}>res:r>obj:type:#/c/s/Consumer>prop:scalar:lastName',
  ];

  await runOasTest('js-mva-consumer-info_v1.yaml', paths, 1, 1);
});

test('test_007_oas_test_004_testConsumerJourneyScalarsOnly', async () => {
  const paths = [
    'get:/consumer/{id}>res:r>obj:type:#/c/s/Consumer>prop:scalar:birthDate',
    'get:/consumer/{id}>res:r>obj:type:#/c/s/Consumer>prop:scalar:firstName',
    'get:/consumer/{id}>res:r>obj:type:#/c/s/Consumer>prop:scalar:gender',
    'get:/consumer/{id}>res:r>obj:type:#/c/s/Consumer>prop:scalar:lastName',
    'get:/consumer/{id}>res:r>obj:type:#/c/s/Consumer>prop:scalar:me',
    'get:/consumer/{id}>res:r>obj:type:#/c/s/Consumer>prop:scalar:taxIdentifier',
    'get:/consumer/{id}>res:r>obj:type:#/c/s/Consumer>prop:scalar:title',
  ];

  await runOasTest('js-mva-consumer-info_v1.yaml', paths, 1, 1);
});

test('test_008_oas_simple-allOf-example', async () => {
  const paths = [
    'get:/user>res:r>comp:type:#/c/s/User>obj:type:#/c/s/Address>prop:scalar:city',
    'get:/user>res:r>comp:type:#/c/s/User>obj:type:#/c/s/BaseUser>prop:scalar:id',
    'get:/user>res:r>comp:type:#/c/s/User>obj:type:[inline:#/c/s/User]>prop:scalar:email',
  ];
  await runOasTest('simple-allOf-example.yaml', paths, 1, 1);
});

test('test_009_oas_inline-allOf-example', async () => {
  const paths = [
    'get:/product>res:r>comp:type:productResponse>obj:type:[inline:productResponse]:1>prop:scalar:currency',
    'get:/product>res:r>comp:type:productResponse>obj:type:[inline:productResponse]>prop:scalar:id',
    'get:/product>res:r>comp:type:productResponse>obj:type:[inline:productResponse]:2>prop:scalar:inStock',
    'get:/product>res:r>comp:type:productResponse>obj:type:[inline:productResponse]>prop:scalar:name',
    'get:/product>res:r>comp:type:productResponse>obj:type:[inline:productResponse]:1>prop:scalar:price',
  ];
  await runOasTest('inline-allOf-example.yaml', paths, 1, 1);
});

test('test_010_oas_anidated-allOf-example', async () => {
  const paths = [
    'get:/pet>res:r>comp:type:petResponse>comp:type:[inline:petResponse]>obj:type:#/c/s/AnimalDetails>prop:scalar:age',
    'get:/pet>res:r>comp:type:petResponse>obj:type:#/c/s/PetBase>prop:scalar:id',
    'get:/pet>res:r>comp:type:petResponse>obj:type:#/c/s/PetBase>prop:scalar:name',
    'get:/pet>res:r>comp:type:petResponse>comp:type:[inline:petResponse]>comp:type:[inline:[inline:petResponse]]>obj:type:#/c/s/Domestication>prop:scalar:owner',
    'get:/pet>res:r>comp:type:petResponse>comp:type:[inline:petResponse]>comp:type:[inline:[inline:petResponse]]>obj:type:#/c/s/MammalFeatures>prop:scalar:sound',
    'get:/pet>res:r>comp:type:petResponse>obj:type:#/c/s/PetBase>prop:scalar:species',
  ];
  await runOasTest('anidated-allOf-example.yaml', paths, 1, 1);
});

test('test_011_oas_test_004_testAccountSegment', async () => {
  const paths = [
    'get:/consumer/{id}>res:r>obj:type:#/c/s/Consumer>prop:array:#accounts>obj:type:#/c/s/Account>prop:obj:segment>obj:type:#/c/s/SegmentCharacteristic>prop:scalar:category',
    'get:/consumer/{id}>res:r>obj:type:#/c/s/Consumer>prop:scalar:firstName',
    'get:/consumer/{id}>res:r>obj:type:#/c/s/Consumer>prop:scalar:lastName',
  ];

  await runOasTest('js-mva-consumer-info_v1.yaml', paths, 1, 3);
});

test('test_012_oas_test_005_testHomepageProductSelector', async () => {
  const paths = [
    'get:/productSelectorItems>res:r>array:ProductSelectorItemsItem>obj:type:ProductSelectorItemsItem>prop:scalar:activationDate',
  ];

  await runOasTest('js-mva-homepage-product-selector_v3.yaml', paths, 3, 1);
});

test('test_013_oas_test_005_testHomepageProductSelector 02', async () => {
  const paths = [
    'get:/productSelectorItems>res:r>array:ProductSelectorItemsItem>obj:type:ProductSelectorItemsItem>prop:scalar:activationDate',
    'get:/productSelectorItems>res:r>array:ProductSelectorItemsItem>obj:type:ProductSelectorItemsItem>prop:scalar:contractEndDate',
    'get:/productSelectorItems>res:r>array:ProductSelectorItemsItem>obj:type:ProductSelectorItemsItem>prop:scalar:description',
    'get:/productSelectorItems>res:r>array:ProductSelectorItemsItem>obj:type:ProductSelectorItemsItem>prop:scalar:deviceCounter',
    'get:/productSelectorItems>res:r>array:ProductSelectorItemsItem>obj:type:ProductSelectorItemsItem>prop:scalar:hasUsage',
    'get:/productSelectorItems>res:r>array:ProductSelectorItemsItem>obj:type:ProductSelectorItemsItem>prop:scalar:id',
    'get:/productSelectorItems>res:r>array:ProductSelectorItemsItem>obj:type:ProductSelectorItemsItem>prop:scalar:isBundle',
    'get:/productSelectorItems>res:r>array:ProductSelectorItemsItem>obj:type:ProductSelectorItemsItem>prop:scalar:isBundled',
    'get:/productSelectorItems>res:r>array:ProductSelectorItemsItem>obj:type:ProductSelectorItemsItem>prop:scalar:isOneNumber',
    'get:/productSelectorItems>res:r>array:ProductSelectorItemsItem>obj:type:ProductSelectorItemsItem>prop:scalar:name',
    'get:/productSelectorItems>res:r>array:ProductSelectorItemsItem>obj:type:ProductSelectorItemsItem>prop:scalar:phoneNumber',
    'get:/productSelectorItems>res:r>array:ProductSelectorItemsItem>obj:type:ProductSelectorItemsItem>prop:scalar:price',
    'get:/productSelectorItems>res:r>array:ProductSelectorItemsItem>obj:type:ProductSelectorItemsItem>prop:scalar:renewalDate',
    'get:/productSelectorItems>res:r>array:ProductSelectorItemsItem>obj:type:ProductSelectorItemsItem>prop:scalar:serviceId',
    'get:/productSelectorItems>res:r>array:ProductSelectorItemsItem>obj:type:ProductSelectorItemsItem>prop:scalar:speed',
    'get:/productSelectorItems>res:r>array:ProductSelectorItemsItem>obj:type:ProductSelectorItemsItem>prop:scalar:status',
    'get:/productSelectorItems>res:r>array:ProductSelectorItemsItem>obj:type:ProductSelectorItemsItem>prop:scalar:type',
  ];

  await runOasTest('js-mva-homepage-product-selector_v3.yaml', paths, 3, 1);
});

test('test_014_oas_test_006_testHomepageProductSelectorInlineArray', async () => {
  const paths = [
    'get:/productSelectorItemDetails>res:r>obj:type:#/c/s/productSelectorItemDetails>prop:scalar:serviceId',
    'get:/productSelectorItemDetails>res:r>obj:type:#/c/s/productSelectorItemDetails>prop:array:#usageConsumption>obj:type:UsageConsumptionItem>prop:scalar:productId',
    'get:/productSelectorItemDetails>res:r>obj:type:#/c/s/productSelectorItemDetails>prop:array:#usageConsumption>obj:type:UsageConsumptionItem>prop:array:#usageSummary>obj:type:UsageSummaryItem>prop:scalar:isUnlimited',
    'get:/productSelectorItemDetails>res:r>obj:type:#/c/s/productSelectorItemDetails>prop:array:#usageConsumption>obj:type:UsageConsumptionItem>prop:array:#usageSummary>obj:type:UsageSummaryItem>prop:scalar:remainingValue',
    'get:/productSelectorItemDetails>res:r>obj:type:#/c/s/productSelectorItemDetails>prop:array:#usageConsumption>obj:type:UsageConsumptionItem>prop:array:#usageSummary>obj:type:UsageSummaryItem>prop:scalar:totalValue',
    'get:/productSelectorItemDetails>res:r>obj:type:#/c/s/productSelectorItemDetails>prop:array:#usageConsumption>obj:type:UsageConsumptionItem>prop:array:#usageSummary>obj:type:UsageSummaryItem>prop:scalar:type',
    'get:/productSelectorItemDetails>res:r>obj:type:#/c/s/productSelectorItemDetails>prop:array:#usageConsumption>obj:type:UsageConsumptionItem>prop:array:#usageSummary>obj:type:UsageSummaryItem>prop:scalar:unit',
    'get:/productSelectorItemDetails>res:r>obj:type:#/c/s/productSelectorItemDetails>prop:array:#usageConsumption>obj:type:UsageConsumptionItem>prop:array:#usageSummary>obj:type:UsageSummaryItem>prop:scalar:usageType',
    'get:/productSelectorItemDetails>res:r>obj:type:#/c/s/productSelectorItemDetails>prop:array:#usageConsumption>obj:type:UsageConsumptionItem>prop:array:#usageSummary>obj:type:UsageSummaryItem>prop:scalar:usedValue',
    'get:/productSelectorItemDetails>res:r>obj:type:#/c/s/productSelectorItemDetails>prop:array:#usageConsumption>obj:type:UsageConsumptionItem>prop:array:#usageSummary>obj:type:UsageSummaryItem>prop:scalar:validFor',
  ];
  await runOasTest('js-mva-homepage-product-selector_v3.yaml', paths, 3, 3);
});

test('test_015_oas_test_008_testHomepageProductSelectorAnonymousObject', async () => {
  const paths = [
    'get:/productSelectorItems>res:r>array:ProductSelectorItemsItem>obj:type:ProductSelectorItemsItem>prop:array:#productRelationship>obj:type:#/c/s/productRelationship>prop:scalar:relationshipType',
  ];
  await runOasTest('js-mva-homepage-product-selector_v3.yaml', paths, 3, 2);
});

test('test_016_oas_test_008_testHomepageProductSelectorAnonymousObject 02', async () => {
  const paths = [
    'get:/productSelectorItems>res:r>array:ProductSelectorItemsItem>obj:type:ProductSelectorItemsItem>prop:array:#productRelationship>obj:type:#/c/s/productRelationship>prop:scalar:relationshipType',
    'get:/productSelectorItems>res:r>array:ProductSelectorItemsItem>obj:type:ProductSelectorItemsItem>prop:array:#productRelationship>obj:type:#/c/s/productRelationship>prop:obj:product>obj:type:product>prop:scalar:id',
    'get:/productSelectorItems>res:r>array:ProductSelectorItemsItem>obj:type:ProductSelectorItemsItem>prop:array:#productRelationship>obj:type:#/c/s/productRelationship>prop:obj:product>obj:type:product>prop:scalar:name',
    'get:/productSelectorItems>res:r>array:ProductSelectorItemsItem>obj:type:ProductSelectorItemsItem>prop:array:#productRelationship>obj:type:#/c/s/productRelationship>prop:obj:product>obj:type:product>prop:scalar:type',
  ];
  await runOasTest('js-mva-homepage-product-selector_v3.yaml', paths, 3, 3);
});

test('test_017_oas_test_009_Customer360_ScalarsOnly', async () => {
  const paths = [
    //
    'get:/customer360/{id}>res:r>comp:type:#/c/s/Customer360>comp:type:#/c/s/Entity>obj:type:#/c/s/Addressable>prop:scalar:id',
  ];

  await runOasTest('TMF717_Customer360-v5.0.0.oas.yaml', paths, 8, 1);
});

test('test_018_oas_anidated-allOf-example-**', async () => {
  const paths = ['get:/pet>**'];
  await runOasTest('anidated-allOf-example.yaml', paths, 1, 1);
});

test('test_019_oas_test_010_TMF633_IntentOrValue_to_Union', async () => {
  const paths = [
    'get:/product/{id}>res:r>comp:type:#/c/s/Product>comp:type:#/c/s/Entity>obj:type:#/c/s/Addressable>prop:scalar:id',
    'get:/product/{id}>res:r>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:comp:intent>union:#/c/s/IntentRefOrValue>comp:type:#/c/s/IntentRef>comp:type:#/c/s/EntityRef>obj:type:[inline:#/c/s/EntityRef]>prop:scalar:@referredType',
    'get:/product/{id}>res:r>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:comp:intent>union:#/c/s/IntentRefOrValue>comp:type:#/c/s/IntentRef>comp:type:#/c/s/EntityRef>obj:type:[inline:#/c/s/EntityRef]>prop:scalar:id',
    'get:/product/{id}>res:r>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:comp:intent>union:#/c/s/IntentRefOrValue>comp:type:#/c/s/Intent>obj:type:[inline:#/c/s/Intent]>prop:scalar:name',
    'get:/product/{id}>res:r>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:comp:intent>union:#/c/s/IntentRefOrValue>comp:type:#/c/s/Intent>comp:type:#/c/s/Entity>obj:type:#/c/s/Addressable>prop:scalar:id',
    'get:/product/{id}>res:r>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:comp:intent>union:#/c/s/IntentRefOrValue>comp:type:#/c/s/Intent>obj:type:[inline:#/c/s/Intent]>prop:scalar:description',
  ];
  await runOasTest('TMF637-001-UnionTest.yaml', paths, 1, 4);
});

test('test_020_oas_test_010_TMF633_IntentOrValue_to_Union_Full', async () => {
  const paths = ['get:/product/{id}>**'];

  await runOasTest('TMF637-001-UnionTest.yaml', paths, 1, 4);
});

test('test_021_oas_test_011_TMF637_001_ComposedTest', async () => {
  const paths = ['get:/product/{id}>**'];

  await runOasTest('TMF637-001-ComposedTest.yaml', paths, 1, 2);
});

test('test_022_oas_test_011_TMF637_001_ComposedTest', async () => {
  const paths = [
    'get:/product/{id}>res:r>comp:type:#/c/s/Product>comp:type:#/c/s/Entity>obj:type:#/c/s/Addressable>prop:scalar:id',
    'get:/product/{id}>res:r>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:scalar:name',
    'get:/product/{id}>res:r>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:comp:billingAccount>comp:type:#/c/s/BillingAccountRef>comp:type:#/c/s/EntityRef>obj:type:#/c/s/Extensible>prop:scalar:@baseType',
    'get:/product/{id}>res:r>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:comp:billingAccount>comp:type:#/c/s/BillingAccountRef>comp:type:#/c/s/EntityRef>obj:type:[inline:#/c/s/EntityRef]>prop:scalar:@referredType',
    'get:/product/{id}>res:r>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:comp:billingAccount>comp:type:#/c/s/BillingAccountRef>comp:type:#/c/s/EntityRef>obj:type:#/c/s/Extensible>prop:scalar:@schemaLocation',
    'get:/product/{id}>res:r>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:comp:billingAccount>comp:type:#/c/s/BillingAccountRef>comp:type:#/c/s/EntityRef>obj:type:#/c/s/Extensible>prop:scalar:@type',
    'get:/product/{id}>res:r>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:comp:billingAccount>comp:type:#/c/s/BillingAccountRef>comp:type:#/c/s/EntityRef>obj:type:[inline:#/c/s/EntityRef]>prop:scalar:href',
    'get:/product/{id}>res:r>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:comp:billingAccount>comp:type:#/c/s/BillingAccountRef>comp:type:#/c/s/EntityRef>obj:type:[inline:#/c/s/EntityRef]>prop:scalar:id',
    'get:/product/{id}>res:r>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:comp:billingAccount>comp:type:#/c/s/BillingAccountRef>comp:type:#/c/s/EntityRef>obj:type:[inline:#/c/s/EntityRef]>prop:scalar:name',
    'get:/product/{id}>res:r>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:comp:billingAccount>comp:type:#/c/s/BillingAccountRef>obj:type:[inline:#/c/s/BillingAccountRef]>prop:scalar:ratingType',
  ];

  await runOasTest('TMF637-001-ComposedTest.yaml', paths, 1, 2);
});

test('test_023_oas_test_013_testTMF637_TestSimpleRecursion no type found', async () => {
  const paths = [
    'get:/productById>res:r>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:scalar:sku',
    'get:/productById>res:r>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:comp:relatedProduct>obj:type:[inline:#/c/s/Product]>prop:scalar:sku',
  ];

  // two checks in the runOasTest function + 1 here
  // expect.assertions(4);
  try {
    await runOasTest('TMF637-002-SimpleRecursionTest.yaml', paths, 1, 2, true);
  } catch (error) {
    console.error(error);
    assert.ok(error !== undefined);

    const message = _.get(error, 'message') ?? '';
    assert.ok(message.includes('Could not find type'));
  }
});

test('test_024_oas_test_014_testTMF637_TestRecursion', async () => {
  const paths = [
    'get:/productById>res:r>comp:type:#/c/s/Product>obj:type:#/c/s/Entity>prop:scalar:id',
    'get:/productById>res:r>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:scalar:terminationDate',
    'get:/productById>res:r>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:array:#relatedParty',
    'get:/productById>res:r>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:array:#relatedParty>comp:type:#/c/s/RelatedPartyOrPartyRole>obj:type:#/c/s/Extensible>prop:scalar:@baseType',
    'get:/productById>res:r>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:array:#relatedParty>comp:type:#/c/s/RelatedPartyOrPartyRole>obj:type:#/c/s/Extensible>prop:scalar:@schemaLocation',
    'get:/productById>res:r>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:array:#relatedParty>comp:type:#/c/s/RelatedPartyOrPartyRole>obj:type:#/c/s/Extensible>prop:scalar:@type',
    'get:/productById>res:r>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:array:#relatedParty>comp:type:#/c/s/RelatedPartyOrPartyRole>obj:type:[inline:#/c/s/RelatedPartyOrPartyRole]>prop:scalar:role',
    'get:/productById>res:r>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:array:#relatedParty>comp:type:#/c/s/RelatedPartyOrPartyRole>obj:type:[inline:#/c/s/RelatedPartyOrPartyRole]>prop:comp:partyOrPartyRole>union:#/c/s/PartyOrPartyRole>comp:type:#/c/s/Producer>comp:type:#/c/s/PartyRole>obj:type:#/c/s/Entity>prop:scalar:href',
    'get:/productById>res:r>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:array:#relatedParty>comp:type:#/c/s/RelatedPartyOrPartyRole>obj:type:[inline:#/c/s/RelatedPartyOrPartyRole]>prop:comp:partyOrPartyRole>union:#/c/s/PartyOrPartyRole>comp:type:#/c/s/Producer>comp:type:#/c/s/PartyRole>obj:type:#/c/s/Entity>prop:scalar:id',
    'get:/productById>res:r>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:array:#relatedParty>comp:type:#/c/s/RelatedPartyOrPartyRole>obj:type:[inline:#/c/s/RelatedPartyOrPartyRole]>prop:comp:partyOrPartyRole>union:#/c/s/PartyOrPartyRole>comp:type:#/c/s/Producer>comp:type:#/c/s/PartyRole>obj:type:[inline:#/c/s/PartyRole]>prop:scalar:name',
    // 'get:/productById>res:r>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:array:#relatedParty>comp:type:#/c/s/RelatedPartyOrPartyRole>obj:type:[inline:#/c/s/RelatedPartyOrPartyRole]>prop:comp:partyOrPartyRole>union:#/c/s/PartyOrPartyRole>comp:type:#/c/s/Producer>comp:type:#/c/s/PartyRole>obj:type:[inline:#/c/s/PartyRole]>prop:circular-ref:#relatedParty'
  ];

  // expect.assertions(6);
  const error = await runOasTest('TMF637-002-RecursionTest.yaml', paths, 1, 4);
  // expect(error).toContain("Circular reference detected in `@connect(selection:)` on `Query.productById`");
});

test('test_025_oas_test_015_testTMF637_ProductStatusEnum', async () => {
  const paths = ['get:/product/{id}>res:r>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:enum:status'];
  const output = await runOasTest('TMF637-ProductInventory-v5.0.0.oas.yaml', paths, 12, 2);
});

test('test_026_oas_test_016_testMostPopularProductScalarsOnly', async () => {
  const paths = [
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:scalar:copyright',
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:scalar:num_results',
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:scalar:status',
  ];
  await runOasTest('most-popular-product.yaml', paths, 4, 1);
});

test('test_027_oas_test_017_testMostPopularProduct', async () => {
  const paths = [
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:scalar:copyright',
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:scalar:num_results',
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:scalar:status',
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:array:#results>obj:type:#/c/s/EmailedArticle>prop:scalar:abstract',
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:array:#results>obj:type:#/c/s/EmailedArticle>prop:scalar:adx_keywords',
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:array:#results>obj:type:#/c/s/EmailedArticle>prop:scalar:asset_id',
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:array:#results>obj:type:#/c/s/EmailedArticle>prop:scalar:byline',
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:array:#results>obj:type:#/c/s/EmailedArticle>prop:scalar:column',
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:array:#results>obj:type:#/c/s/EmailedArticle>prop:array:#des_facet',
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:array:#results>obj:type:#/c/s/EmailedArticle>prop:scalar:eta_id',
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:array:#results>obj:type:#/c/s/EmailedArticle>prop:array:#geo_facet',
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:array:#results>obj:type:#/c/s/EmailedArticle>prop:scalar:id',
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:array:#results>obj:type:#/c/s/EmailedArticle>prop:scalar:nytdsection',
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:array:#results>obj:type:#/c/s/EmailedArticle>prop:array:#org_facet',
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:array:#results>obj:type:#/c/s/EmailedArticle>prop:array:#per_facet',
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:array:#results>obj:type:#/c/s/EmailedArticle>prop:scalar:published_date',
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:array:#results>obj:type:#/c/s/EmailedArticle>prop:scalar:section',
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:array:#results>obj:type:#/c/s/EmailedArticle>prop:scalar:source',
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:array:#results>obj:type:#/c/s/EmailedArticle>prop:scalar:subsection',
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:array:#results>obj:type:#/c/s/EmailedArticle>prop:scalar:title',
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:array:#results>obj:type:#/c/s/EmailedArticle>prop:scalar:type',
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:array:#results>obj:type:#/c/s/EmailedArticle>prop:scalar:updated',
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:array:#results>obj:type:#/c/s/EmailedArticle>prop:scalar:uri',
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:array:#results>obj:type:#/c/s/EmailedArticle>prop:scalar:url',
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:array:#results>obj:type:#/c/s/EmailedArticle>prop:array:#media>obj:type:#/c/s/Media>prop:scalar:approved_for_syndication',
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:array:#results>obj:type:#/c/s/EmailedArticle>prop:array:#media>obj:type:#/c/s/Media>prop:scalar:caption',
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:array:#results>obj:type:#/c/s/EmailedArticle>prop:array:#media>obj:type:#/c/s/Media>prop:scalar:copyright',
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:array:#results>obj:type:#/c/s/EmailedArticle>prop:array:#media>obj:type:#/c/s/Media>prop:scalar:subtype',
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:array:#results>obj:type:#/c/s/EmailedArticle>prop:array:#media>obj:type:#/c/s/Media>prop:scalar:type',
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:array:#results>obj:type:#/c/s/EmailedArticle>prop:array:#media>obj:type:#/c/s/Media>prop:array:#media-metadata>obj:type:#/c/s/MediaMetadata>prop:scalar:format',
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:array:#results>obj:type:#/c/s/EmailedArticle>prop:array:#media>obj:type:#/c/s/Media>prop:array:#media-metadata>obj:type:#/c/s/MediaMetadata>prop:scalar:height',
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:array:#results>obj:type:#/c/s/EmailedArticle>prop:array:#media>obj:type:#/c/s/Media>prop:array:#media-metadata>obj:type:#/c/s/MediaMetadata>prop:scalar:url',
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:array:#results>obj:type:#/c/s/EmailedArticle>prop:array:#media>obj:type:#/c/s/Media>prop:array:#media-metadata>obj:type:#/c/s/MediaMetadata>prop:scalar:width',
  ];

  await runOasTest('most-popular-product.yaml', paths, 4, 4);
});

test('test_028_oas_test_017_testMostPopularProduct_star', async () => {
  const paths = ['get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>*'];

  await runOasTest('most-popular-product.yaml', paths, 4, 1);
});

test('test_029_oas_test_017_testMostPopularProduct_double-star', async () => {
  const paths = ['get:/emailed/{period}.json>**'];

  await runOasTest('most-popular-product.yaml', paths, 4, 4);
});

test('test_030_oas_test_017_testMostPopularProduct_double-star - partial paths', async () => {
  const paths = [
    'get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>prop:array:#results>obj:type:#/c/s/EmailedArticle>**',
  ];

  await runOasTest('most-popular-product.yaml', paths, 4, 4);
});

test('test_031_oas_test_018_testTMF637_01', async () => {
  const paths = [
    'get:/product>res:r>array:#/c/s/Product>comp:type:#/c/s/Product>comp:type:#/c/s/Entity>obj:type:#/c/s/Addressable>prop:scalar:id',
    'get:/product>res:r>array:#/c/s/Product>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:array:#agreementItem>comp:type:#/c/s/AgreementItemRef>obj:type:[inline:#/c/s/AgreementItemRef]>prop:scalar:agreementId',
    'get:/product>res:r>array:#/c/s/Product>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:array:#agreementItem>comp:type:#/c/s/AgreementItemRef>obj:type:[inline:#/c/s/AgreementItemRef]>prop:scalar:agreementName',
    'get:/product>res:r>array:#/c/s/Product>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:comp:billingAccount>comp:type:#/c/s/BillingAccountRef>comp:type:#/c/s/EntityRef>obj:type:[inline:#/c/s/EntityRef]>prop:scalar:name',
    'get:/product>res:r>array:#/c/s/Product>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:comp:billingAccount>comp:type:#/c/s/BillingAccountRef>obj:type:[inline:#/c/s/BillingAccountRef]>prop:scalar:ratingType',
    'get:/product>res:r>array:#/c/s/Product>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:comp:billingAccount>comp:type:#/c/s/BillingAccountRef>comp:type:#/c/s/EntityRef>obj:type:#/c/s/Addressable>prop:scalar:id',
  ];
  await runOasTest('TMF637-ProductInventory-v5.0.0.oas.yaml', paths, 12, 3);
});

test('test_032_oas_test_018_testTMF637_02', async () => {
  const paths = [
    'get:/product>res:r>array:#/c/s/Product>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:array:#agreementItem>comp:type:#/c/s/AgreementItemRef>obj:type:#/c/s/Extensible>prop:scalar:@baseType',
  ];
  await runOasTest('TMF637-ProductInventory-v5.0.0.oas.yaml', paths, 12, 2);
});

test('test_033_oas_test_018_testTMF637_SimpleRecursion', async () => {
  const paths = ['get:/productById>**'];
  await runOasTest('TMF637-002-SimpleRecursionTest.yaml', paths, 1, 1);
});

test('test_034_oas_test_019_testUnionInParam', async () => {
  const paths = [
    'get:/consumer/{id}>res:r>obj:type:#/c/s/Consumer>prop:array:#accounts>obj:type:#/c/s/Account>prop:scalar:id',
    'get:/consumer/{id}>res:r>obj:type:#/c/s/Consumer>prop:array:#accounts>obj:type:#/c/s/Account>prop:scalar:state',
    'get:/consumer/{id}>res:r>obj:type:#/c/s/Consumer>prop:array:#accounts>obj:type:#/c/s/Account>prop:scalar:stateReason',
    'get:/consumer/{id}>res:r>obj:type:#/c/s/Consumer>prop:scalar:birthDate',
    'get:/consumer/{id}>res:r>obj:type:#/c/s/Consumer>prop:scalar:firstName',
    'get:/consumer/{id}>res:r>obj:type:#/c/s/Consumer>prop:scalar:gender',
    'get:/consumer/{id}>res:r>obj:type:#/c/s/Consumer>prop:scalar:lastName',
    'get:/consumer/{id}>res:r>obj:type:#/c/s/Consumer>prop:scalar:me',
    'get:/consumer/{id}>res:r>obj:type:#/c/s/Consumer>prop:scalar:taxIdentifier',
    'get:/consumer/{id}>res:r>obj:type:#/c/s/Consumer>prop:scalar:title',
  ];

  await runOasTest('js-mva-consumer-info_v1.yaml', paths, 1, 2);
});

test('test_035_oas_test_020_testDuplicateRefPath_test', async () => {
  const paths = [
    'get:/productSelectorItems>res:r>array:ProductSelectorItemsItem>obj:type:ProductSelectorItemsItem>prop:array:#productPrice>obj:type:#/c/s/productPrice>prop:obj:price>obj:type:#/c/s/price>prop:obj:dutyFreeAmount>obj:type:#/c/s/money>prop:scalar:unit',
    'get:/productSelectorItems>res:r>array:ProductSelectorItemsItem>obj:type:ProductSelectorItemsItem>prop:array:#productPrice>obj:type:#/c/s/productPrice>prop:obj:price>obj:type:#/c/s/price>prop:obj:dutyFreeAmount>obj:type:#/c/s/money>prop:scalar:value',
    'get:/productSelectorItems>res:r>array:ProductSelectorItemsItem>obj:type:ProductSelectorItemsItem>prop:array:#productPrice>obj:type:#/c/s/productPrice>prop:obj:price>obj:type:#/c/s/price>prop:obj:taxIncludedAmount>obj:type:#/c/s/money>prop:scalar:unit',
    'get:/productSelectorItems>res:r>array:ProductSelectorItemsItem>obj:type:ProductSelectorItemsItem>prop:array:#productPrice>obj:type:#/c/s/productPrice>prop:obj:price>obj:type:#/c/s/price>prop:obj:taxIncludedAmount>obj:type:#/c/s/money>prop:scalar:value',
    'get:/productSelectorItems>res:r>array:ProductSelectorItemsItem>obj:type:ProductSelectorItemsItem>prop:array:#productPrice>obj:type:#/c/s/productPrice>prop:scalar:priceType',
    'get:/productSelectorItems>res:r>array:ProductSelectorItemsItem>obj:type:ProductSelectorItemsItem>prop:array:#productPrice>obj:type:#/c/s/productPrice>prop:scalar:recurringChargePeriod',
  ];

  await runOasTest('js-mva-homepage-product-selector_v3.yaml', paths, 3, 4);
});

test('test_036_oas_test_021_testInlineItemsArray', async () => {
  const paths = [
    'get:/productSelectorItemDetails>res:r>obj:type:#/c/s/productSelectorItemDetails>prop:array:#usageConsumption>obj:type:UsageConsumptionItem>prop:scalar:productId',
  ];
  await runOasTest('js-mva-homepage-product-selector_v3.yaml', paths, 3, 2);
});

test('test_037_oas_test_022_common-room_01', async () => {
  const paths = [
    'get:/activityTypes>**',
    'get:/api-token-status>**',
    'get:/members>**',
    'get:/members/customFields>**',
    'get:/segments>**',
    'get:/segments/:id/status>**',
    'get:/tags>**',
    'get:/tags/{id}>**',
    'get:/user/{email}>**',
  ];

  // last 2 args: don't expect to fail, and skip validation
  await runOasTest('common-room-core.json', paths, 22, 12, false, true);
  // await runOasTest("common-room-original.json", paths, 9, 19, false, true);
});

test('test_038_oas_test_024_TMF632_IndividualIdentification', async () => {
  const paths = [
    'get:/individual/{id}>res:r>comp:type:#/c/s/Individual>comp:type:#/c/s/Party>comp:type:#/c/s/Entity>obj:type:#/c/s/Addressable>prop:scalar:id',
    'get:/individual/{id}>res:r>comp:type:#/c/s/Individual>obj:type:[inline:#/c/s/Individual]>prop:array:#individualIdentification>comp:type:#/c/s/IndividualIdentification>obj:type:[inline:#/c/s/IndividualIdentification]>prop:scalar:identificationId',
  ];
  await runOasTest('TMF632-Party_Management-v5.0.0.oas.yaml', paths, 20, 2);
});

test('test_039_oas_test_025_AdobeCommerce', async () => {
  const paths = [
    'get:/V1/carts/licence>res:r>array:#/c/s/checkout-agreements-data-agreement-interface>obj:type:#/c/s/checkout-agreements-data-agreement-interface>prop:scalar:agreement_id',
    'get:/V1/carts/licence>res:r>array:#/c/s/checkout-agreements-data-agreement-interface>obj:type:#/c/s/checkout-agreements-data-agreement-interface>prop:scalar:checkbox_text',
    'get:/V1/carts/licence>res:r>array:#/c/s/checkout-agreements-data-agreement-interface>obj:type:#/c/s/checkout-agreements-data-agreement-interface>prop:scalar:content',
    'get:/V1/carts/licence>res:r>array:#/c/s/checkout-agreements-data-agreement-interface>obj:type:#/c/s/checkout-agreements-data-agreement-interface>prop:scalar:content_height',
    'get:/V1/carts/licence>res:r>array:#/c/s/checkout-agreements-data-agreement-interface>obj:type:#/c/s/checkout-agreements-data-agreement-interface>prop:scalar:is_active',
    'get:/V1/carts/licence>res:r>array:#/c/s/checkout-agreements-data-agreement-interface>obj:type:#/c/s/checkout-agreements-data-agreement-interface>prop:scalar:is_html',
    'get:/V1/carts/licence>res:r>array:#/c/s/checkout-agreements-data-agreement-interface>obj:type:#/c/s/checkout-agreements-data-agreement-interface>prop:scalar:mode',
    'get:/V1/carts/licence>res:r>array:#/c/s/checkout-agreements-data-agreement-interface>obj:type:#/c/s/checkout-agreements-data-agreement-interface>prop:scalar:name',
  ];
  await runOasTest('adobe-commerce-swagger.json', paths, 586, 1);
});

test('test_040_oas_test_025_AdobeCommerce_customer-paths', async () => {
  const paths = [
    'get:/V1/customers/{customerId}>**',
    'get:/V1/customers/{customerId}/billingAddress>**',
    'get:/V1/customers/{customerId}/companies>**',
    'get:/V1/customers/{customerId}/companies/{companyId}>**',
    'get:/V1/customers/{customerId}/confirm>**',
    'get:/V1/customers/{customerId}/password/resetLinkToken/{resetPasswordLinkToken}>**',
    'get:/V1/customers/{customerId}/permissions/readonly>**',
    'get:/V1/customers/{customerId}/shippingAddress>**',
    'get:/V1/customers/addresses/{addressId}>**',
    'get:/V1/customers/companies>**',
    'get:/V1/customers/me>**',
    'get:/V1/customers/me/billingAddress>**',
    'get:/V1/customers/me/shippingAddress>**',
    'get:/V1/customers/search>**',
  ];
  await runOasTest('adobe-commerce-swagger.json', paths, 586, 15);
});

test('test_041_oas_test_026_petstore-paths', async () => {
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

  await runOasTest(`petstore.yaml`, paths, 19, 6);
});

// TODO: we should have a proper Enum status here
test('test_042_oas_test_026_petstore-status-enum', async () => {
  const paths = [
    'get:/pet/findByStatus>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:scalar:id',
    'get:/pet/findByStatus>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:scalar:name',
    'get:/pet/findByStatus>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:array:#photoUrls',
    'get:/pet/findByStatus>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:scalar:status',
  ];

  await runOasTest(`petstore.yaml`, paths, 19, 1);
});

test('test_043_oas_test_027_petstore-simple-post', async () => {
  const paths = ['post:/pet>**'];

  await runOasTest(`petstore.yaml`, paths, 19, 6);
});

test('test_044_oas_test_028_post-with-no-body', async () => {
  const paths = ['post:/pet/{petId}>**'];

  await runOasTest(`petstore.yaml`, paths, 19, 1);
});

test('test_045_oas_test_029_post-simple-body-selection', async () => {
  const paths = [
    'post:/pet>body:b>obj:input:#/c/s/Pet>prop:scalar:id',
    'post:/pet>body:b>obj:input:#/c/s/Pet>prop:scalar:name',
    'post:/pet>body:b>obj:input:#/c/s/Pet>prop:array:#photoUrls',
    'post:/pet>body:b>obj:input:#/c/s/Pet>prop:scalar:status',
    'post:/pet>res:r>obj:type:#/c/s/Pet>prop:scalar:id',
    'post:/pet>res:r>obj:type:#/c/s/Pet>prop:scalar:name',
    'post:/pet>res:r>obj:type:#/c/s/Pet>prop:array:#photoUrls',
    'post:/pet>res:r>obj:type:#/c/s/Pet>prop:scalar:status',
    'post:/pet>res:r>obj:type:#/c/s/Pet>prop:obj:category>obj:type:#/c/s/Category>prop:scalar:id',
    'post:/pet>res:r>obj:type:#/c/s/Pet>prop:obj:category>obj:type:#/c/s/Category>prop:scalar:name',
    'post:/pet>res:r>obj:type:#/c/s/Pet>prop:array:#tags>obj:type:#/c/s/Tag>prop:scalar:id',
    'post:/pet>res:r>obj:type:#/c/s/Pet>prop:array:#tags>obj:type:#/c/s/Tag>prop:scalar:name',
  ];

  await runOasTest(`petstore.yaml`, paths, 19, 4);
});

test('test_046_oas_test_029_post-complex-body-selection', async () => {
  const paths = [
    'post:/pet>body:b>obj:input:#/c/s/Pet>prop:scalar:id',
    'post:/pet>body:b>obj:input:#/c/s/Pet>prop:scalar:name',
    'post:/pet>body:b>obj:input:#/c/s/Pet>prop:array:#photoUrls',
    'post:/pet>body:b>obj:input:#/c/s/Pet>prop:scalar:status',
    'post:/pet>body:b>obj:input:#/c/s/Pet>prop:obj:category>obj:input:#/c/s/Category>prop:scalar:id',
    'post:/pet>body:b>obj:input:#/c/s/Pet>prop:obj:category>obj:input:#/c/s/Category>prop:scalar:name',
    'post:/pet>body:b>obj:input:#/c/s/Pet>prop:array:#tags>obj:input:#/c/s/Tag>prop:scalar:id',
    'post:/pet>body:b>obj:input:#/c/s/Pet>prop:array:#tags>obj:input:#/c/s/Tag>prop:scalar:name',
    'post:/pet>res:r>obj:type:#/c/s/Pet>prop:scalar:id',
    'post:/pet>res:r>obj:type:#/c/s/Pet>prop:scalar:name',
    'post:/pet>res:r>obj:type:#/c/s/Pet>prop:array:#photoUrls',
    'post:/pet>res:r>obj:type:#/c/s/Pet>prop:scalar:status',
  ];

  await runOasTest(`petstore.yaml`, paths, 19, 4);
});

test('test_047_oas_test_030_post-body-allOf', async () => {
  const paths = [
    'post:/user>body:b>comp:input:Input>obj:input:#/c/s/ExtraInfo>prop:scalar:age',
    'post:/user>body:b>comp:input:Input>obj:input:#/c/s/BaseUser>prop:scalar:email',
    'post:/user>body:b>comp:input:Input>obj:input:#/c/s/ExtraInfo>prop:scalar:subscribed',
    'post:/user>body:b>comp:input:Input>obj:input:#/c/s/BaseUser>prop:scalar:username',
    'post:/user>res:r>obj:type:createUserResponse>prop:scalar:success',
  ];

  await runOasTest(`post-sample.yaml`, paths, 3, 2);
});

test('test_048_oas_test_031_post-body-oneOf', async () => {
  const paths = ['post:/event>**'];

  await runOasTest(`post-sample.yaml`, paths, 3, 4);
});

test('test_049_oas_test_032_mindbody-JSON', async () => {
  // 'data' field should be generated as JSON
  const paths = ['get:/health/information>**'];

  await runOasTest(`mindbody.json`, paths, 11, 2, false, true);
});

test('test_050_oas_test_033_initial-support-for-put', async () => {
  const paths = ['put:/pet>**'];

  await runOasTest(`petstore.yaml`, paths, 19, 6, false, true);
});

test('test_051_oas_test_034_simple-delete', async () => {
  const paths = ['del:/pet/{petId}>**'];
  await runOasTest(`petstore.yaml`, paths, 19, 1, false, true);
});

test('test_052_oas_test_035_adobe-commerce-delete-address', async () => {
  const paths = ['del:/V1/addresses/{addressId}>res:r>scalar:boolean'];
  await runOasTest(`adobe-commerce-swagger.json`, paths, 586, 0);
});

test('test_053_oas_test_036_time-series', async () => {
  const paths = ['post:/market-data-services/time-series/search>**'];
  await runOasTest('time-series-1.0.28.yaml', paths, 1, 12);
});

test('test_054_oas_test-better-naming', async () => {
  const paths = [
    'get:/2.3.0/astronauts/>res:r>obj:type:#/c/s/PaginatedPolymorphicAstronautEndpointList>prop:scalar:count',
    'get:/2.3.0/astronauts/>res:r>obj:type:#/c/s/PaginatedPolymorphicAstronautEndpointList>prop:array:#results>union:#/c/s/PolymorphicAstronautEndpoint>obj:type:#/c/s/AstronautDetailed>prop:comp:agency>comp:type:#/c/s/AgencyMini>obj:type:#/c/s/AgencyMini>prop:scalar:name',
    'get:/2.3.0/astronauts/>res:r>obj:type:#/c/s/PaginatedPolymorphicAstronautEndpointList>prop:array:#results>union:#/c/s/PolymorphicAstronautEndpoint>obj:type:#/c/s/AstronautEndpointNormal>prop:comp:agency>comp:type:#/c/s/AgencyMini>obj:type:#/c/s/AgencyMini>prop:scalar:name'
  ]

  await runOasTest('launch_Library_2-docs-v2.3.0.json', paths, 116, 5);
});