import _ from 'lodash';
import fs from 'fs';
import { spawnSync } from 'child_process';
import { test } from 'node:test';
import assert from 'node:assert';
import { oasBasePath, runOasTest } from '../../src/tests/runners.js';
import { DirectivesConfig, OasGen } from '../../src/index.js';
import { Prop, T } from '../../src/oas/nodes/internal.js';
import './_setup.js';

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
    'get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:enum:status',
    'get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:obj:category>obj:type:#/c/s/Category>prop:scalar:id',
    'get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:obj:category>obj:type:#/c/s/Category>prop:scalar:name',
    'get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:array:#tags>obj:type:#/c/s/Tag>prop:scalar:id',
    'get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:array:#tags>obj:type:#/c/s/Tag>prop:scalar:name',
  ];

  await runOasTest(`petstore.yaml`, paths, 19, 4);
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

  await runOasTest(`petstore.yaml`, paths, 19, 9);
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
    'get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:enum:status',
    'get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:array:#tags>obj:type:#/c/s/Tag>prop:scalar:id',
    'get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:array:#tags>obj:type:#/c/s/Tag>prop:scalar:name',
    'get:/pet/findByStatus>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:obj:category>obj:type:#/c/s/Category>prop:scalar:id',
    'get:/pet/findByStatus>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:obj:category>obj:type:#/c/s/Category>prop:scalar:name',
    'get:/pet/findByStatus>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:scalar:id',
    'get:/pet/findByStatus>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:scalar:name',
    'get:/pet/findByStatus>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:array:#photoUrls',
    'get:/pet/findByStatus>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:enum:status',
    'get:/pet/findByStatus>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:array:#tags>obj:type:#/c/s/Tag>prop:scalar:id',
    'get:/pet/findByStatus>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:array:#tags>obj:type:#/c/s/Tag>prop:scalar:name',
    'get:/pet/findByTags>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:obj:category>obj:type:#/c/s/Category>prop:scalar:id',
    'get:/pet/findByTags>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:obj:category>obj:type:#/c/s/Category>prop:scalar:name',
    'get:/pet/findByTags>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:scalar:id',
    'get:/pet/findByTags>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:scalar:name',
    'get:/pet/findByTags>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:array:#photoUrls',
    'get:/pet/findByTags>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:enum:status',
    'get:/pet/findByTags>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:array:#tags>obj:type:#/c/s/Tag>prop:scalar:id',
    'get:/pet/findByTags>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:array:#tags>obj:type:#/c/s/Tag>prop:scalar:name',
    'get:/store/order/{orderId}>res:r>obj:type:#/c/s/Order>prop:scalar:complete',
    'get:/store/order/{orderId}>res:r>obj:type:#/c/s/Order>prop:scalar:id',
    'get:/store/order/{orderId}>res:r>obj:type:#/c/s/Order>prop:scalar:petId',
    'get:/store/order/{orderId}>res:r>obj:type:#/c/s/Order>prop:scalar:quantity',
    'get:/store/order/{orderId}>res:r>obj:type:#/c/s/Order>prop:scalar:shipDate',
    'get:/store/order/{orderId}>res:r>obj:type:#/c/s/Order>prop:enum:status',
    'get:/user/{username}>res:r>obj:type:#/c/s/User>prop:scalar:email',
    'get:/user/{username}>res:r>obj:type:#/c/s/User>prop:scalar:firstName',
    'get:/user/{username}>res:r>obj:type:#/c/s/User>prop:scalar:id',
    'get:/user/{username}>res:r>obj:type:#/c/s/User>prop:scalar:lastName',
    'get:/user/{username}>res:r>obj:type:#/c/s/User>prop:scalar:password',
    'get:/user/{username}>res:r>obj:type:#/c/s/User>prop:scalar:phone',
    'get:/user/{username}>res:r>obj:type:#/c/s/User>prop:scalar:username',
    'get:/user/{username}>res:r>obj:type:#/c/s/User>prop:scalar:userStatus',
  ];

  await runOasTest(`petstore.yaml`, paths, 19, 7);
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
    'get:/productSelectorItems>res:r>array:ProductSelectorItemsItem>obj:type:ProductSelectorItemsItem>prop:enum:type',
  ];

  await runOasTest('js-mva-homepage-product-selector_v3.yaml', paths, 3, 2);
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
    'get:/productSelectorItemDetails>res:r>obj:type:#/c/s/productSelectorItemDetails>prop:array:#usageConsumption>obj:type:UsageConsumptionItem>prop:array:#usageSummary>obj:type:UsageSummaryItem>prop:enum:usageType',
    'get:/productSelectorItemDetails>res:r>obj:type:#/c/s/productSelectorItemDetails>prop:array:#usageConsumption>obj:type:UsageConsumptionItem>prop:array:#usageSummary>obj:type:UsageSummaryItem>prop:scalar:usedValue',
    'get:/productSelectorItemDetails>res:r>obj:type:#/c/s/productSelectorItemDetails>prop:array:#usageConsumption>obj:type:UsageConsumptionItem>prop:array:#usageSummary>obj:type:UsageSummaryItem>prop:scalar:validFor',
  ];
  await runOasTest('js-mva-homepage-product-selector_v3.yaml', paths, 3, 4);
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
    'get:/productSelectorItems>res:r>array:ProductSelectorItemsItem>obj:type:ProductSelectorItemsItem>prop:array:#productRelationship>obj:type:#/c/s/productRelationship>prop:obj:product>obj:type:product>prop:enum:type',
  ];
  await runOasTest('js-mva-homepage-product-selector_v3.yaml', paths, 3, 4);
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
    'get:/product/{id}>res:r>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:comp:intent>union:type:#/c/s/IntentRefOrValue>comp:type:#/c/s/IntentRef>comp:type:#/c/s/EntityRef>obj:type:[inline:#/c/s/EntityRef]>prop:scalar:@referredType',
    'get:/product/{id}>res:r>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:comp:intent>union:type:#/c/s/IntentRefOrValue>comp:type:#/c/s/IntentRef>comp:type:#/c/s/EntityRef>obj:type:[inline:#/c/s/EntityRef]>prop:scalar:id',
    'get:/product/{id}>res:r>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:comp:intent>union:type:#/c/s/IntentRefOrValue>comp:type:#/c/s/Intent>obj:type:[inline:#/c/s/Intent]>prop:scalar:name',
    'get:/product/{id}>res:r>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:comp:intent>union:type:#/c/s/IntentRefOrValue>comp:type:#/c/s/Intent>comp:type:#/c/s/Entity>obj:type:#/c/s/Addressable>prop:scalar:id',
    'get:/product/{id}>res:r>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:comp:intent>union:type:#/c/s/IntentRefOrValue>comp:type:#/c/s/Intent>obj:type:[inline:#/c/s/Intent]>prop:scalar:description',
  ];
  await runOasTest('TMF637-001-UnionTest.yaml', paths, 1, 2);
});

test('test_020_oas_test_010_TMF633_IntentOrValue_to_Union_Full', async () => {
  const paths = ['get:/product/{id}>**'];

  await runOasTest('TMF637-001-UnionTest.yaml', paths, 1, 2);
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
    await runOasTest('TMF637-002-SimpleRecursionTest.yaml', paths, 1, 2, { shouldFail: true });
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
    'get:/productById>res:r>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:array:#relatedParty>comp:type:#/c/s/RelatedPartyOrPartyRole>obj:type:[inline:#/c/s/RelatedPartyOrPartyRole]>prop:comp:partyOrPartyRole>union:type:#/c/s/PartyOrPartyRole>comp:type:#/c/s/Producer>comp:type:#/c/s/PartyRole>obj:type:#/c/s/Entity>prop:scalar:href',
    'get:/productById>res:r>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:array:#relatedParty>comp:type:#/c/s/RelatedPartyOrPartyRole>obj:type:[inline:#/c/s/RelatedPartyOrPartyRole]>prop:comp:partyOrPartyRole>union:type:#/c/s/PartyOrPartyRole>comp:type:#/c/s/Producer>comp:type:#/c/s/PartyRole>obj:type:#/c/s/Entity>prop:scalar:id',
    'get:/productById>res:r>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:array:#relatedParty>comp:type:#/c/s/RelatedPartyOrPartyRole>obj:type:[inline:#/c/s/RelatedPartyOrPartyRole]>prop:comp:partyOrPartyRole>union:type:#/c/s/PartyOrPartyRole>comp:type:#/c/s/Producer>comp:type:#/c/s/PartyRole>obj:type:[inline:#/c/s/PartyRole]>prop:scalar:name',
    // 'get:/productById>res:r>comp:type:#/c/s/Product>obj:type:[inline:#/c/s/Product]>prop:array:#relatedParty>comp:type:#/c/s/RelatedPartyOrPartyRole>obj:type:[inline:#/c/s/RelatedPartyOrPartyRole]>prop:comp:partyOrPartyRole>union:type:#/c/s/PartyOrPartyRole>comp:type:#/c/s/Producer>comp:type:#/c/s/PartyRole>obj:type:[inline:#/c/s/PartyRole]>prop:circular-ref:#relatedParty'
  ];

  // expect.assertions(6);
  const error = await runOasTest('TMF637-002-RecursionTest.yaml', paths, 1, 3);
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
  await runOasTest('common-room-core.json', paths, 22, 12, { skipValidation: true });
  // await runOasTest("common-room-original.json", paths, 9, 19, { skipValidation: true });
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

  await runOasTest(`petstore.yaml`, paths, 19, 9);
});

// TODO: we should have a proper Enum status here
test('test_042_oas_test_026_petstore-status-enum', async () => {
  const paths = [
    'get:/pet/findByStatus>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:scalar:id',
    'get:/pet/findByStatus>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:scalar:name',
    'get:/pet/findByStatus>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:array:#photoUrls',
    'get:/pet/findByStatus>res:r>array:#/c/s/Pet>obj:type:#/c/s/Pet>prop:enum:status',
  ];

  await runOasTest(`petstore.yaml`, paths, 19, 2);
});

test('test_043_oas_test_027_petstore-simple-post', async () => {
  const paths = ['post:/pet>**'];

  await runOasTest(`petstore.yaml`, paths, 19, 7);
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
    'post:/pet>body:b>obj:input:#/c/s/Pet>prop:enum:status',
    'post:/pet>res:r>obj:type:#/c/s/Pet>prop:scalar:id',
    'post:/pet>res:r>obj:type:#/c/s/Pet>prop:scalar:name',
    'post:/pet>res:r>obj:type:#/c/s/Pet>prop:array:#photoUrls',
    'post:/pet>res:r>obj:type:#/c/s/Pet>prop:enum:status',
    'post:/pet>res:r>obj:type:#/c/s/Pet>prop:obj:category>obj:type:#/c/s/Category>prop:scalar:id',
    'post:/pet>res:r>obj:type:#/c/s/Pet>prop:obj:category>obj:type:#/c/s/Category>prop:scalar:name',
    'post:/pet>res:r>obj:type:#/c/s/Pet>prop:array:#tags>obj:type:#/c/s/Tag>prop:scalar:id',
    'post:/pet>res:r>obj:type:#/c/s/Pet>prop:array:#tags>obj:type:#/c/s/Tag>prop:scalar:name',
  ];

  await runOasTest(`petstore.yaml`, paths, 19, 5);
});

test('test_046_oas_test_029_post-complex-body-selection', async () => {
  const paths = [
    'post:/pet>body:b>obj:input:#/c/s/Pet>prop:scalar:id',
    'post:/pet>body:b>obj:input:#/c/s/Pet>prop:scalar:name',
    'post:/pet>body:b>obj:input:#/c/s/Pet>prop:array:#photoUrls',
    'post:/pet>body:b>obj:input:#/c/s/Pet>prop:enum:status',
    'post:/pet>body:b>obj:input:#/c/s/Pet>prop:obj:category>obj:input:#/c/s/Category>prop:scalar:id',
    'post:/pet>body:b>obj:input:#/c/s/Pet>prop:obj:category>obj:input:#/c/s/Category>prop:scalar:name',
    'post:/pet>body:b>obj:input:#/c/s/Pet>prop:array:#tags>obj:input:#/c/s/Tag>prop:scalar:id',
    'post:/pet>body:b>obj:input:#/c/s/Pet>prop:array:#tags>obj:input:#/c/s/Tag>prop:scalar:name',
    'post:/pet>res:r>obj:type:#/c/s/Pet>prop:scalar:id',
    'post:/pet>res:r>obj:type:#/c/s/Pet>prop:scalar:name',
    'post:/pet>res:r>obj:type:#/c/s/Pet>prop:array:#photoUrls',
    'post:/pet>res:r>obj:type:#/c/s/Pet>prop:enum:status',
  ];

  await runOasTest(`petstore.yaml`, paths, 19, 5);
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

  await runOasTest(`post-sample.yaml`, paths, 3, 3);
});

test('test_049_oas_test_032_mindbody-JSON', async () => {
  // `data` is a map with no declared value shape — kept as entries of JSON values since #70
  // (before that it silently vanished): data: [DataEntry], DataEntry { key, value: JSON }
  const paths = ['get:/health/information>**'];

  await runOasTest(`mindbody.json`, paths, 11, 3, { skipValidation: true });
});

test('test_050_oas_test_033_initial-support-for-put', async () => {
  const paths = ['put:/pet>**'];

  await runOasTest(`petstore.yaml`, paths, 19, 7, { skipValidation: true });
});

test('test_051_oas_test_034_simple-delete', async () => {
  const paths = ['del:/pet/{petId}>**'];
  await runOasTest(`petstore.yaml`, paths, 19, 1, { skipValidation: true });
});

test('test_052_oas_test_035_adobe-commerce-delete-address', async () => {
  const paths = ['del:/V1/addresses/{addressId}>res:r>scalar:boolean'];
  await runOasTest(`adobe-commerce-swagger.json`, paths, 586, 0);
});

test('test_053_oas_test_036_time-series', async () => {
  const paths = ['post:/market-data-services/time-series/search>**'];
  await runOasTest('time-series-1.0.28.yaml', paths, 1, 15);
});

test('test_054_oas_test-better-naming', async () => {
  const paths = [
    'get:/2.3.0/astronauts/>res:r>obj:type:#/c/s/PaginatedPolymorphicAstronautEndpointList>prop:scalar:count',
    'get:/2.3.0/astronauts/>res:r>obj:type:#/c/s/PaginatedPolymorphicAstronautEndpointList>prop:array:#results>union:type:#/c/s/PolymorphicAstronautEndpoint>obj:type:#/c/s/AstronautDetailed>prop:comp:agency>comp:type:#/c/s/AgencyMini>obj:type:#/c/s/AgencyMini>prop:scalar:name',
    'get:/2.3.0/astronauts/>res:r>obj:type:#/c/s/PaginatedPolymorphicAstronautEndpointList>prop:array:#results>union:type:#/c/s/PolymorphicAstronautEndpoint>obj:type:#/c/s/AstronautEndpointNormal>prop:comp:agency>comp:type:#/c/s/AgencyMini>obj:type:#/c/s/AgencyMini>prop:scalar:name',
    // this union is nested inside a named field (`results`), not the op's own response, so it
    // renders as one merged type instead of a real `union` — see docs/FIXED.md #38. All 3 members
    // still need a selected field or the merge emits an empty one.
    'get:/2.3.0/astronauts/>res:r>obj:type:#/c/s/PaginatedPolymorphicAstronautEndpointList>prop:array:#results>union:type:#/c/s/PolymorphicAstronautEndpoint>obj:type:#/c/s/AstronautEndpointDetailed>prop:comp:agency>comp:type:#/c/s/AgencyMini>obj:type:#/c/s/AgencyMini>prop:scalar:name',
  ];

  await runOasTest('launch_Library_2-docs-v2.3.0.json', paths, 116, 3);
});
test('test_060_oas_test_additionalProperties_support', async () => {
  // Test additionalProperties support with VehicleComponentTree
  const paths = [
    'get:/api/v1/markets/{marketId}/models/{modelId}/configurations/{configurationId}/selectables>res:r>obj:type:#/c/s/VehicleComponentTree>prop:map:vehicleComponents>map:type:VehicleComponentsEntry>obj:type:#/c/s/VehicleComponent>**',
  ];
  await runOasTest(
    'openapi.car_configurator_service_(ccs)_int-10.210.0.yaml',
    paths,
    44,
    23);
});

test('test_061_oas_test_vehicleComponents_additionalProperties', async () => {
  // Test vehicleComponents map specifically (object -> VehicleComponent)
  const paths = [
    'get:/api/v1/markets/{marketId}/models/{modelId}/configurations/{configurationId}/selectables>res:r>obj:type:#/c/s/VehicleComponentTree>prop:map:vehicleComponents>**',
  ];
  await runOasTest(
    'openapi.car_configurator_service_(ccs)_int-10.210.0.yaml',
    paths,
    44,
    23);
});

test('test_062_oas_test_images_additionalProperties', async () => {
  // Test images map specifically (object -> array of VehicleComponentImage)
  const paths = [
    'get:/api/v1/markets/{marketId}/models/{modelId}/configurations/{configurationId}/selectables>res:r>obj:type:#/c/s/VehicleComponentTree>prop:map:vehicleComponents>map:type:VehicleComponentsEntry>obj:type:#/c/s/VehicleComponent>prop:map:images>**',
  ];
  await runOasTest(
    'openapi.car_configurator_service_(ccs)_int-10.210.0.yaml',
    paths,
    44,
    5);
});

test('test_ref_into_paths_pointer_resolves_and_composes', async () => {
  // A parameter shared via a JSON-pointer into #/paths (percent-encoded braces) — the DigitalOcean
  // pattern — must resolve (not throw "Schema not found for ref") and compose. Top coverage gap:
  // GEN-THROW Schema/response not found for ref #/…. runOasTest composes via rover.
  const schema = await runOasTest('ref-into-paths.yaml', ['get:/gadgets/{widget_id}>**'], 2, 1);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('gadgetsByWidgetId(widgetId: String!)'), 'resolved shared path param became an arg');
  assert.ok(schema!.includes('GET: "/gadgets/{$args.widgetId}"'), 'param templated against the resolved arg');
});

test('test_implied_array_items_without_type_resolves_and_composes', async () => {
  // A schema with `items` but no explicit `type: array` (Slack does this) must be treated as an
  // array, not throw "Cannot handle schema". runOasTest composes via rover.
  const schema = await runOasTest('implied-array.yaml', ['get:/things>**'], 1, 1);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('things: [Thing]'), 'implied array resolved to a list type');
});

test('test_allof_contentless_member_skipped_and_composes', async () => {
  // An allOf with a metadata-only member ({ description } and no $ref/type/properties) must skip
  // that member, not throw "Cannot handle schema" (Box --Full/--Mini pattern). The merged type
  // keeps the real members' fields and composes. Top coverage gap: GEN-THROW Cannot handle schema.
  const schema = await runOasTest('allof-empty-member.yaml', ['get:/things>**'], 1, 1);
  assert.ok(schema !== undefined);
  assert.ok(
    /type Thing \{[^}]*\bid: String\b[^}]*\bname: String\b/s.test(schema!),
    "merged type keeps both members' fields",
  );
});

test('test_inline_allof_property_gets_valid_name_and_composes', async () => {
  // A property whose value is an inline allOf (one real member + one contentless constraint member)
  // must be emitted as a real type (Meta), not the internal placeholder `[inline:meta]` which the
  // composer rejects (INTERNAL_ERROR). DigitalOcean's `meta` shape. runOasTest composes via rover.
  const schema = await runOasTest('inline-allof-prop.yaml', ['get:/things>**'], 1, 2);
  assert.ok(schema !== undefined);
  assert.ok(!schema!.includes('[inline:'), 'internal inline placeholder must not leak into output');
  assert.ok(schema!.includes('type Meta {'), 'inline allOf property type named from the property key');
  assert.ok(/\bmeta: Meta\b/.test(schema!), 'field references the derived type');
  // total stays nullable: the `required` lived only in the skipped contentless member (pre-existing)
  assert.ok(/total: Int\b(?!!)/.test(schema!), 'total emitted nullable (required was on the skipped member)');
});

test('test_schema_ref_into_paths_gets_clean_type_name', async () => {
  // A schema $ref'd via a #/paths JSON-pointer (DigitalOcean pattern) must be emitted with a clean
  // type name derived from the pointer tail, not the raw pointer (which the composer rejects).
  // see docs/FIXED.md #8. runOasTest composes via rover.
  const schema = await runOasTest('ref-schema-into-paths.yaml', ['get:/gadgets>**'], 2, 2);
  assert.ok(schema !== undefined);
  assert.ok(!schema!.includes('#/paths'), 'raw #/paths pointer must not leak as a type name');
  assert.ok(schema!.includes('type WidgetsItem'), 'pointer tail -> clean type name');
  assert.ok(/\bwidget: WidgetsItem\b/.test(schema!), 'reference uses the same derived name');
});

test('test_inline_name_collision_splits_by_container', async () => {
  // Two differently-shaped inline objects sharing a property key (`saleInfo.listPrice` -> {amount},
  // `offers[].listPrice` -> {amountInMicros}) must not collapse into one type (which drops fields and
  // breaks the selection: SELECTED_FIELD_NOT_FOUND). The colliding newcomer is qualified by its
  // container -> `SaleInfoListPrice`, keeping both shapes. see docs/FIXED.md #9. composes via rover.
  const schema = await runOasTest('inline-name-collision.yaml', ['get:/volume>**'], 1, 5);
  assert.ok(schema !== undefined);
  assert.ok(/type ListPrice \{[^}]*amountInMicros/s.test(schema!), 'first shape kept as ListPrice');
  assert.ok(/type SaleInfoListPrice \{[^}]*\bamount\b/s.test(schema!), 'colliding shape split by container');
  assert.ok(/\blistPrice: ListPrice\b/.test(schema!), 'offers item references ListPrice');
  assert.ok(/\blistPrice: SaleInfoListPrice\b/.test(schema!), 'saleInfo references the split type');
});

test('test_inline_identical_shapes_dedup_not_renamed', async () => {
  // Byte-identical inline shapes sharing a key (`file.shared_link` / `folder.shared_link`, the
  // box.yaml pattern) must DEDUP onto one type, not rename: renaming mints a fresh name-derived id
  // whose container dedups away, emitting an orphan type nothing references
  // (CONNECTORS_UNRESOLVED_FIELD). A different shape under the same key still splits per #9.
  // see docs/FIXED.md #18. composes via rover.
  const schema = await runOasTest('inline-identical-dedup.yaml', ['get:/items>**'], 1, 7);
  assert.ok(schema !== undefined);
  assert.ok(/\bsharedLink: SharedLink\b/.test(schema!), 'both parents reference the one SharedLink');
  assert.ok(!/SharedLink2|Permissions2|InlineSharedLink/.test(schema!), 'no renamed duplicate/orphan types');
  assert.ok(/type OfferPermissions \{[^}]*\brole\b/s.test(schema!), 'different shape still splits (#9)');
  assert.ok(/\bpermissions: OfferPermissions\b/.test(schema!), 'offer references the split type');
});

test('test_composed_collision_with_stored_object_splits_by_container', async () => {
  // An inline allOf named from its property key (#7) sharing that key with an already-stored
  // inline OBJECT (`link.permissions` Obj vs `media.permissions` allOf — box `/files/{file_id}`)
  // used to emit `type Permissions` twice: Composed skipped the #9/#12 occupancy check
  // (INTERNAL_ERROR). The Composed now splits by container. see docs/FIXED.md #22. composes via rover.
  const schema = await runOasTest('composed-name-collision.yaml', ['get:/items>**'], 1, 5);
  assert.ok(schema !== undefined);
  assert.ok(/type Permissions \{[^}]*canDownload/s.test(schema!), 'the stored Obj keeps the key name');
  assert.ok(
    /type MediaPermissions \{[^}]*canAnnotate[^}]*canDelete/s.test(schema!),
    'colliding Composed qualified by container',
  );
  assert.ok(/\bpermissions: MediaPermissions\b/.test(schema!), 'media references the split type');
  assert.ok(!/type Permissions \{[^}]*canDelete/s.test(schema!), 'no redefinition of Permissions');
});

test('test_no_duplicate_type_definitions_launch_library', async () => {
  // A $ref reached two ways builds two nodes with the same name but different ids — `AgencyMini`
  // as an array item (`obj:type:…`) and as a single-member allOf (`comp:type:…`). The emit gate
  // keyed on the id missed the repeat and printed `type AgencyMini` twice (invalid SDL; rover
  // connector list is lenient, so it slipped the suite). see docs/FIXED.md #26.
  const gen = await OasGen.fromFile(`${oasBasePath}/launch_Library_2-docs-v2.3.0.json`, {
    skipValidation: true,
    showParentInSelections: false,
  });
  await gen.visit();
  const root = [...gen.paths.keys()].find((k) => k.includes('/agencies/'))!;
  const sdl = gen.generateSchema([`${root}>**`]);

  const typeNames = [...sdl.matchAll(/^type (\w+)/gm)].map((m) => m[1]);
  const duplicates = [...new Set(typeNames.filter((n, i, a) => a.indexOf(n) !== i))];
  assert.deepStrictEqual(duplicates, [], `every named type must be emitted once; duplicated: ${duplicates.join(', ')}`);
  // the surviving node must be complete (guard against keeping a cycle-cut twin)
  assert.match(sdl, /type AgencyMini \{[^}]*type: AgencyType!/s);
});

test('test_entity_resolver_with_errors_emits_wellformed_schema', async () => {
  // Reported combo: Infer Entity Resolvers + Emit Connector Errors + v0.4/consolidate:false on
  // petstore get:/user/{username}. Locks that the entity type block is emitted CONTIGUOUSLY
  // (@key + type-level @connect + selection + fields before any other type) and composes — a
  // scrambled/interleaved variant of this output was traced to app-side post-processing, not gen.
  const schema = await runOasTest(
    'petstore.yaml',
    ['get:/user/{username}>**'],
    19,
    1, { skipValidation: true, inferEntityResolvers: true, ...// inferEntityResolvers
    {
      connectorSpecVersion: 'v0.4',
      federationVersion: 'v2.14',
      composeFederationVersion: '2.14.3',
      emitConnectorErrors: true,
    } });
  assert.ok(schema !== undefined);
  const userIdx = schema!.indexOf('type User');
  const queryIdx = schema!.indexOf('type Query');
  const entitySelIdx = schema!.indexOf('selection', userIdx);
  const userFieldsIdx = schema!.indexOf('username: String', userIdx);
  assert.ok(userIdx >= 0 && queryIdx > userIdx, 'User emitted before Query');
  assert.ok(entitySelIdx > userIdx && entitySelIdx < queryIdx, 'entity selection inside the User block');
  assert.ok(userFieldsIdx > userIdx && userFieldsIdx < queryIdx, 'User fields contiguous with the type');
  assert.ok(/@key\(fields: "username"\)/.test(schema!), 'entity key emitted');
  // errors is now emitted fully expanded: `errors {` then `extensions: """…"""` on its own lines
  assert.ok(/errors: \{[\s\S]*?extensions: """/.test(schema!), 'connector errors emitted on the Query connector');
});

test('test_param_default_boolean_emits_literal', async () => {
  // A boolean (or other non-number/string) param default used to leave a dangling ` = ` →
  // compose syntax error ("expected a valid Value"). Defaults now emit only for renderable types.
  // see docs/FIXED.md #17. runOasTest composes via rover.
  const schema = await runOasTest('param-default-bool.yaml', ['get:/credentials>**'], 1, 1);
  assert.ok(schema !== undefined);
  assert.ok(/readWrite: Boolean = false\b/.test(schema!), 'boolean default rendered as literal');
  assert.ok(/expirySeconds: Int = 0\b/.test(schema!), 'number default unchanged');
  assert.ok(!/=\s*[,)]/.test(schema!), 'no dangling = remains');
});

// --- #57: made-up enum names — collisions, ordering, and cross-selection stability -----------

test('test_57_split_collision_first_visited_keeps_the_base_name', async () => {
  // Order.itemStatus and OrderItem.status both want OrderItemStatus; whoever is visited first
  // keeps it, the other bumps to 2 — driven by selection order, never broken by it.
  const schema = await runOasTest('enum-collisions.yaml', ['get:/orders>**', 'get:/items>**'], 4, 4, { skipValidation: true });
  assert.ok(schema !== undefined);
  assert.ok(/enum OrderItemStatus \{\s+open/.test(schema!), "Order's enum keeps the base name");
  assert.ok(/enum OrderItemStatus2 \{\s+packed/.test(schema!), "OrderItem's bumps to 2");
  assert.ok(/itemStatus: OrderItemStatus\n/.test(schema!), 'field reads its own enum');
  assert.ok(/status: OrderItemStatus2\n/.test(schema!), 'field reads the bumped enum');
});

test('test_57_split_collision_reversed_order_swaps_the_names', async () => {
  const schema = await runOasTest('enum-collisions.yaml', ['get:/items>**', 'get:/orders>**'], 4, 4, { skipValidation: true });
  assert.ok(schema !== undefined);
  assert.ok(/enum OrderItemStatus \{\s+packed/.test(schema!), "OrderItem's enum keeps the base name");
  assert.ok(/enum OrderItemStatus2 \{\s+open/.test(schema!), "Order's bumps to 2");
});

test('test_57_no_coselection_no_collision', async () => {
  const one = await runOasTest('enum-collisions.yaml', ['get:/orders>**'], 4, 2, { skipValidation: true });
  const two = await runOasTest('enum-collisions.yaml', ['get:/items>**'], 4, 2, { skipValidation: true });
  assert.ok(/enum OrderItemStatus \{/.test(one!) && !/OrderItemStatus2/.test(one!), 'stable name alone');
  assert.ok(/enum OrderItemStatus \{/.test(two!) && !/OrderItemStatus2/.test(two!), 'stable name alone');
});

test('test_57_component_name_is_reserved_in_both_visit_orders', async () => {
  // the UserRole component owns its name whether it is stored first or never visited at all
  for (const paths of [
    ['get:/roles>**', 'get:/users>**'],
    ['get:/users>**', 'get:/roles>**'],
  ]) {
    const schema = await runOasTest('enum-collisions.yaml', paths, 4, 4, { skipValidation: true });
    assert.ok(schema !== undefined);
    assert.ok(/type UserRole \{/.test(schema!), 'the component keeps its name');
    assert.ok(/enum UserRole2 \{/.test(schema!), 'User.role bumps past the component');
    assert.ok(/role: UserRole2\n/.test(schema!), 'field reads the bumped enum');
    assert.ok(/enum UserUserRole \{/.test(schema!), 'userRole is qualified, never kept as-is');
    assert.ok(!/UserUserRole2/.test(schema!), 'no double-qualified name anywhere');
  }
});

test('test_57_reserved_names_count_even_when_never_stored', async () => {
  // /users alone: UserRole is reserved but never stored — the bump must still walk past it
  const schema = await runOasTest('enum-collisions.yaml', ['get:/users>**'], 4, 3, { skipValidation: true });
  assert.ok(schema !== undefined);
  assert.ok(/enum UserRole2 \{/.test(schema!), 'bump consults the spec, not just stored types');
  assert.ok((schema!.match(/enum UserRole2 \{/g) ?? []).length === 1, 'defined exactly once');
});

test('test_57_bump_walks_past_every_reserved_component', async () => {
  // UserRole AND UserRole2 are components; the made-up name has to reach 3
  const schema = await runOasTest('enum-collisions-deep.yaml', ['get:/users>**'], 1, 2, { skipValidation: true });
  assert.ok(schema !== undefined);
  assert.ok(/enum UserRole3 \{/.test(schema!), 'both reserved names skipped');
  assert.ok(/role: UserRole3\n/.test(schema!), 'field reads the final name');
});

test('test_57_same_field_names_its_enum_the_same_in_both_selection_styles', async () => {
  // the gap PropEn.visit closed: an explicit path used to skip the rename. see #57
  const gen1 = await OasGen.fromFile(`${oasBasePath}/js-mva-homepage-product-selector_v3.yaml`, {
    skipValidation: true,
    showParentInSelections: false,
  } as never);
  await gen1.visit();
  const wide = gen1.generateSchema(['get:/productSelectorItemDetails>**']);
  const gen2 = await OasGen.fromFile(`${oasBasePath}/js-mva-homepage-product-selector_v3.yaml`, {
    skipValidation: true,
    showParentInSelections: false,
  } as never);
  await gen2.visit();
  const narrow = gen2.generateSchema([
    'get:/productSelectorItemDetails>res:r>obj:type:#/c/s/productSelectorItemDetails>prop:array:#usageConsumption>obj:type:UsageConsumptionItem>prop:array:#usageSummary>obj:type:UsageSummaryItem>prop:enum:usageType',
  ]);
  const name = (sdl: string) => (sdl.match(/enum (\w*UsageType\w*) \{/) ?? [])[1];
  assert.equal(name(wide!), name(narrow!), 'one field, one enum name, regardless of selection style');
  assert.equal(name(narrow!), 'UsageSummaryItemUsageType', 'and it is the qualified one');
});

test('test_57_merged_union_defines_the_enum_it_references', async () => {
  // box's item choice (file | folder | web_link, no discriminator) is merged into one object. It
  // folded its members only at write time, after the reachability walk — the walk collected the
  // web_link member's `type` enum while the writer emitted the file member's: `type: FileBaseType!`
  // with no `enum FileBaseType`, INVALID_GRAPHQL on compose. see #57
  const schema = await runOasTest('box.yaml', ['get:/collaborations>**'], 258, 36);
  assert.ok(schema !== undefined);
  assert.ok(/enum FileBaseType \{/.test(schema!), 'the emitted field type has a definition');
});

test('test_required_and_nullable_emits_a_nullable_field', async () => {
  // In OpenAPI `required` and `nullable` are orthogonal: `required` says the key is present,
  // `nullable: true` says the value may be null. A field that is both must be NULLABLE in GraphQL —
  // `String!` makes the router error on a legitimately-null value. see docs/FIXED.md #55
  const schema = await runOasTest('required-nullable.yaml', ['get:/thing>**'], 1, 1, { skipValidation: true });
  assert.ok(schema !== undefined);
  assert.ok(/reqPlain: String!/.test(schema!), 'required + non-nullable -> String!');
  assert.ok(/optPlain: String\n/.test(schema!), 'optional -> nullable');
  assert.ok(/optNullable: String\n/.test(schema!), 'optional + nullable -> nullable');
  assert.ok(/reqNullable: String\n/.test(schema!), 'required + nullable must be nullable, not String!');
  assert.ok(/reqRefNullable: String\n/.test(schema!), 'nullability on the referenced component counts too');
  // a required argument whose value may be null cannot take `!` either — GraphQL has no way to say
  // "must be sent, may be null", so null wins and a missing parameter is the API's own error
  assert.ok(/since: String[^!]/.test(schema!), 'required + nullable parameter -> no !');
});

test('test_59_required_nested_array_bang_stays_on_the_line', async () => {
  // #59: a required list of lists ended its own line before the `!` was written, so the `!` landed
  // alone on the next one. Parses fine (line breaks mean nothing), reads wrong.
  const schema = await runOasTest(
    'required-nested-array.yaml',
    [
      'get:/matrix>res:r>obj:type:matrixResponse>prop:array:#processes',
      'get:/matrix>res:r>obj:type:matrixResponse>prop:array:#titles',
    ],
    1,
    1, { skipValidation: true });
  assert.ok(schema !== undefined);
  assert.ok(/processes: \[\[String\]\]!/.test(schema!), 'the ! belongs on the same line as the field');
  assert.ok(!/\n\n\s+titles/.test(schema!), 'and no blank line is left behind either');
});

test('test_59_nested_list_of_objects_names_and_selects_its_item', async () => {
  // #59: a list of lists of objects wrote the inner list's own name (`[name_conflicts]`, which
  // nothing defines) and opened no block, so the item's fields were written as the parent's own.
  // box's `post:/zip_downloads` only reaches this since #85 — it answers `202`.
  const schema = await runOasTest('required-nested-array.yaml', ['get:/matrix>**'], 1, 2);
  assert.ok(schema !== undefined);
  assert.ok(/rows: \[\[RowsItem\]\]/.test(schema!), 'the field names what is at the bottom of the lists');
  assert.ok(/type RowsItem \{/.test(schema!), 'which is the name the definition writes');
  assert.ok(/rows\? \{\n\s+label\?\n\s+value\?\n\s+\}/.test(schema!), 'and the selection opens one block for it');
});

test('test_61_sanitised_at_type_must_not_collide', { todo: 'both fields emit as `type`' }, async () => {
  // TMF objects carry `@type` (from the Extensible base) next to a business field literally named
  // `type`. Sanitising strips the `@`, nothing checks the result against the sibling names, and
  // the written type ends up with two `type:` lines. see docs/issues.md #61
  const schema = await runOasTest('TMF717_Customer360-v5.0.0.oas.yaml', ['get:/customer360>**'], 8, 56, { skipValidation: true });
  assert.ok(schema !== undefined);
});

test('test_required_oneof_null_field_is_kept', async () => {
  // The third way a spec says "may be null": a choice list with a null arm. The null arm comes out
  // and the schema is marked nullable instead; the field used to disappear. see docs/FIXED.md #60
  const schema = await runOasTest('required-nullable-oneof.yaml', ['get:/thing>**'], 1, 4, { skipValidation: true });
  assert.ok(schema !== undefined);
  assert.ok(/reqOneOf: String\n/.test(schema!), 'oneOf [string, null] keeps the field, nullable');
  assert.ok(/optAnyOf: String\n/.test(schema!), 'the anyOf spelling takes the same path');
  assert.ok(/reqChoice: \w+\n/.test(schema!), 'two real choices stay a choice, the null takes the ! away');
  assert.ok(/optObjChoice: \w+\n/.test(schema!), 'an object as the one choice keeps its own shape');
  assert.ok(/optArr: \[String\]\n/.test(schema!), 'a list as the one choice becomes the list');
  assert.ok(/nullOnly: JSON\n/.test(schema!), 'only-null degrades to JSON rather than disappearing');
  // the two guards: left exactly as they were, which today means dropped
  assert.ok(/optEnumChoice: ThingOneOfOptEnumChoice\n/.test(schema!), 'enum-or-null promotes AND stays nullable');
  assert.ok(/enum ThingOneOfOptEnumChoice \{/.test(schema!), 'the promoted enum definition is emitted');
  assert.ok(!/doubleNull/.test(schema!), 'two null choices cancel out under oneOf — untouched');
  assert.ok(!/constrained/.test(schema!), 'a type beside the choice list combines with it — untouched');
});

test('test_required_and_nullable_31_type_array', async () => {
  // The OAS 3.1 spelling of the same thing: `type: [string, 'null']`. refA and refB share one
  // component, so the second visit sees it already rewritten and must agree. see docs/FIXED.md #55
  const schema = await runOasTest('required-nullable-31.yaml', ['get:/thing>**'], 1, 1, { skipValidation: true });
  assert.ok(schema !== undefined);
  assert.ok(/reqTypeArray: String\n/.test(schema!), 'required + type [string, null] -> nullable');
  assert.ok(/refA: String\n/.test(schema!), 'first visit through the shared component');
  assert.ok(/refB: String\n/.test(schema!), 'second visit must agree with the first');
});

test('test_shapeless_object_schema_becomes_json_scalar', async () => {
  // `{}` / `{ additionalProperties: false }` schemas (Slack shares pattern) used to throw
  // "Cannot handle schema" when reached via fromSchema (array items, members). They are objects
  // with no declared fields -> JSON scalar (NOT an empty Obj, which generate() would skip and
  // dangle the reference). see docs/FIXED.md #19. runOasTest composes via rover.
  const schema = await runOasTest('shapeless-object.yaml', ['get:/messages>**'], 1, 2);
  assert.ok(schema !== undefined);
  assert.ok(/privateChannels: \[JSON\]/.test(schema!), 'additionalProperties:false items -> [JSON]');
  assert.ok(/publicChannels: \[JSON\]/.test(schema!), 'empty {} items -> [JSON]');
});

test('test_typeless_object_items_degrade_to_json', async () => {
  // `items: { type: object }` — an object with a declared type but no properties — degrades to
  // [JSON] exactly like `items: {}` and `additionalProperties: false` in the test above. It used to
  // be dropped from the emitted type entirely. Same fixture, `archivedChannels`.
  // see docs/FIXED.md #56
  const schema = await runOasTest('shapeless-object.yaml', ['get:/messages>**'], 1, 2);
  assert.ok(schema !== undefined);
  assert.ok(/archivedChannels: \[JSON\]/.test(schema!), 'items:{type:object} should degrade to [JSON]');
});

test('test_response_allof_snake_path_def_ref_names_converge', async () => {
  // A response-root allOf on a snake_case path synthesizes a name carrying the `_`
  // (`v2…Billing_historyResponse`); the definition (Composed.generate) used upperFirst(getRefName)
  // while the reference used genTypeName, so they diverged -> INVALID_GRAPHQL ("cannot find type").
  // Both now route through genTypeName. see docs/FIXED.md #15. runOasTest composes via rover.
  const schema = await runOasTest('response-allof-snake-path.yaml', ['get:/billing_history>**'], 1, 2);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('type BillingHistoryResponse {'), 'definition camelized via genTypeName');
  assert.ok(/billing_history: BillingHistoryResponse\b/.test(schema!), 'reference matches the definition');
  assert.ok(!schema!.includes('Billing_history'), 'no underscore-divergent type name remains');
});

test('test_reserved_root_type_name_gets_suffixed', async () => {
  // A component schema literally named "Subscription" collides with GraphQL's reserved root
  // Subscription type — connectors doesn't support subscriptions, so rover rejects a plain `type
  // Subscription { ... }` with SUBSCRIPTION_IN_CONNECTORS. genTypeName now suffixes the 3 reserved
  // root type names; every call site (definitions and references) resolves through it, so the
  // definition and the nested field referencing it stay in agreement. see docs/FIXED.md #45
  const schema = await runOasTest('reserved-root-type-name.yaml', ['get:/customers/{id}>**'], 1, 2);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('type SubscriptionType {'), 'reserved name gets suffixed at the definition');
  assert.ok(/subscription: SubscriptionType\b/.test(schema!), 'reference matches the suffixed definition');
  assert.ok(!/^type Subscription \{/m.test(schema!), 'no bare reserved-name type remains');
});

test('test_array_item_ref_to_array_typed_schema_unwraps_redundant_nesting', async () => {
  // WidgetList is $ref'd as an array item, but is itself `type: array` (a redundant "list of X"
  // naming artifact, not a genuine array-of-arrays — docker-engine's real-world shape). Left alone,
  // this produced a second, nested Arr: the field referenced an undefined type (`[WidgetList]`)
  // while the real object was emitted under a different, property-derived name (`WidgetsItem`), and
  // the selection lost its nesting braces entirely. Unwrapping the redundant ref keeps `items`
  // always the true element type everywhere else already assumes it is. see docs/FIXED.md #46
  const schema = await runOasTest('array-refs-array-typed-schema.yaml', ['get:/widgets>**'], 1, 2);
  assert.ok(schema !== undefined);
  assert.ok(/widgets: \[WidgetsItem\]/.test(schema!), 'field type matches the emitted object definition');
  assert.ok(schema!.includes('type WidgetsItem {'), 'the real object is emitted under that name');
  assert.ok(!/WidgetList/.test(schema!), 'the redundant array-typed component name must not leak in');
  assert.ok(
    /widgets\? \{\n\s*count\?\n\s*name\?\n\s*\}/.test(schema!),
    'the selection nests inside braces, not flattened',
  );
});

test('test_inline_renamed_when_colliding_with_component_emitted_name', async () => {
  // An inline object named by its property key ('user') must not emit under the same GraphQL name as
  // a stored component ('#/c/s/User' -> `User`): occupancy is checked on the EMITTED name too, and the
  // inline (never the $ref-named component) is qualified by its container. see docs/FIXED.md #12.
  // runOasTest composes via rover.
  const schema = await runOasTest('inline-vs-component-name.yaml', ['get:/accounts>**'], 1, 4);
  assert.ok(schema !== undefined);
  assert.ok(/type User \{[^}]*\bid\b/s.test(schema!), 'component keeps the User name');
  assert.ok(schema!.includes('type SettingsUser'), 'inline wrapper qualified by its container');
  assert.ok(/\buser: SettingsUser\b/.test(schema!), 'reference follows the rename');
  assert.ok((schema!.match(/^type User /gm) || []).length === 1, 'exactly one type User emitted');
});

test('test_wrapper_named_after_contained_component_renames_both_owners', async () => {
  // A wrapper named after the component it lists (`group` containing [Group]) used to emit a second
  // `type Group` and fail to compose. Two `group` wrappers under different parents must each get their
  // own name (`SubjectsGroup`, `MembersGroup`); before the fix both stayed `Group` and clashed.
  // see docs/FIXED.md #12, #37. composes via rover.
  const schema = await runOasTest('inline-wrapper-vs-component.yaml', ['get:/permission>**'], 3, 6);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('type SubjectsGroup'), 'subjects.group qualified by its container');
  assert.ok(schema!.includes('type MembersGroup'), 'members.group qualified by its container');
  assert.ok((schema!.match(/^type Group /gm) || []).length === 1, 'exactly one type Group (the component)');
  assert.ok(/\bgroup: SubjectsGroup\b/.test(schema!), 'subjects selection follows its own rename');
  assert.ok(/\bgroup: MembersGroup\b/.test(schema!), 'members selection follows its own rename');
});

test('test_100_scalar_component_keeps_name_object_component_triggers_rename', async () => {
  // `status` matches scalar component `Status` (no type written) — keeps its name (#37).
  // `label` matches object component `Label` — renamed even though this op doesn't reach it (#100).
  const schema = await runOasTest('inline-wrapper-vs-component.yaml', ['get:/widget>**'], 3, 3);
  assert.ok(schema !== undefined);
  assert.ok(
    (schema!.match(/^type Status /gm) || []).length === 1,
    'inline status keeps its name (scalar component writes no type)',
  );
  assert.ok(/\bstatus: Status\b/.test(schema!), 'status field references the kept name');
  assert.ok(!/^type Label /m.test(schema!), 'inline label no longer uses the component name');
  assert.ok(/Label/.test(schema!), 'the renamed label type still exists in the schema');
  const defs = schema!.match(/^(?:type|input|scalar|enum|interface) \w+/gm) || [];
  assert.strictEqual(new Set(defs).size, defs.length, 'no duplicate definitions');
});

test('test_same_key_wrapper_co_emits_safely_across_input_output', async () => {
  // The same `subjects.user` wrapper appears on the request body and the response, with different fields.
  // Both would take the same name; they stay distinct because the input one becomes `SubjectsUserInput`
  // and the output one is pushed to a longer name (`SpaceLikeSubjectsUser`). No duplicate, so it composes.
  // see docs/FIXED.md #37.
  const schema = await runOasTest('inline-wrapper-vs-component.yaml', ['post:/space>**'], 3, 8);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('input SubjectsUserInput'), 'input-side user wrapper qualified + Input-suffixed');
  assert.ok(schema!.includes('type SpaceLikeSubjectsUser'), 'output-side user wrapper gets its own distinct name');
  const defs = schema!.match(/^(?:type|input|scalar|enum|interface) \w+/gm) || [];
  assert.strictEqual(new Set(defs).size, defs.length, 'no duplicate type/input definitions: ' + defs.join(', '));
});

test('test_recursive_schema_cut_composes_abstract_pass', async () => {
  // A recursive schema (Node.parent -> Node, Node.children -> [Node]) must terminate on the
  // non-consolidating v0.4 path and compose: the re-entering field is cut at the first repeat of a
  // schema already on the expansion path and emitted as a comment in BOTH the SDL and the selection.
  // A shared non-recursive component (Shared, referenced twice from sibling fields) must NOT be cut.
  // see docs/FIXED.md #10. runOasTest composes via rover.
  const schema = await runOasTest(
    'recursive-cycle.yaml',
    ['get:/nodes>**'],
    1,
    2, { skipValidation: true, connectorSpecVersion: 'v0.4',
      federationVersion: 'v2.14',
      composeFederationVersion: '2.14.3' });
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('# children: [Node] - circular reference omitted'), 'array-items cycle cut in SDL');
  assert.ok(schema!.includes('# parent: Node - circular reference omitted'), 'direct self-cycle cut in SDL');
  assert.ok(/# children: circular reference omitted/.test(schema!), 'array cut commented in selection');
  assert.ok(/# parent: circular reference omitted/.test(schema!), 'self-cycle cut commented in selection');
  // shared non-recursive type expands fully under BOTH referencing fields (no over-cutting)
  assert.ok(/\bmeta: Shared\b/.test(schema!) && /\bextra: Shared\b/.test(schema!), 'both Shared refs kept');
  assert.ok((schema!.match(/label/g) || []).length >= 3, 'Shared.label selected under both fields');
});

test('test_118_recursive_oneof_clique_terminates', () => {
  // #118: 7 mutually-recursive oneOf members reached through per-branch-named arrays. The
  // instance cut (#10) never fires (recursion closes through the member LIST, not one schema),
  // so expansion enumerates every ordering of the clique and effectively never returns. A sync
  // busy loop ignores node:test timeouts, so run it in a child process spawnSync can SIGTERM.
  const script = `
    import { OasGen } from './src/index.js';
    const gen = await OasGen.fromFile('tests/resources/oas/recursive-oneof-array-branches.yaml',
      { skipValidation: true, showParentInSelections: false });
    await gen.visit();
    console.log('COUNT=' + gen.expanded(['get:/lists/{id}>**']).length);
  `;
  const res = spawnSync('node', ['--import', 'tsx/esm', '--input-type=module', '-e', script], {
    timeout: 60_000,
    encoding: 'utf-8',
  });
  assert.strictEqual(res.status, 0, 'expansion did not terminate within 60s (pre-#118 behavior)');
  const count = Number(/COUNT=(\d+)/.exec(res.stdout)?.[1]);
  assert.ok(count > 0 && count < 5_000, `expanded selection stays bounded, got ${count}`);
});

test('test_118_recursive_oneof_clique_cut_output', async () => {
  // #118, output side: the no-discriminator union degrades to one merged object, and every
  // branch's re-entry of the same 7-way member set is cut — commented in BOTH SDL and selection,
  // like #10's instance cuts. The shared tag field itself survives the merge.
  const schema = await runOasTest('recursive-oneof-array-branches.yaml', ['get:/lists/{id}>**'], 1, 3);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('type FilterBranchUnion'), 'merged union object emitted');
  for (const branch of ['or', 'and', 'notAll', 'notAny', 'restricted', 'unifiedEvents', 'association']) {
    assert.ok(
      schema!.includes(`# ${branch}Branches: [filterBranchUnion] - circular reference omitted`),
      `${branch}Branches cut in SDL`,
    );
    assert.ok(
      schema!.includes(`# ${branch}Branches: circular reference omitted`),
      `${branch}Branches cut commented in selection`,
    );
  }
  assert.ok(/\bfilterBranchType: OrBranchFilterBranchType\b/.test(schema!), 'tag field kept on the merge');
});

test('test_118_prefix_set', async () => {
  // #118, cost side: Union/Composed selection filters must use the #10 prefix set, not a
  // selection scan per prop — the scan rebuilds prop.path() per entry per prop (55M calls on
  // hubspot lists). Deterministic pin: count path() calls, not wall time. Measured on this
  // fixture: 123 with the prefix set, 578 with the scans it replaced.
  const orig = Prop.prototype.path;
  let calls = 0;
  Prop.prototype.path = function (this: Prop) {
    calls++;
    return orig.call(this);
  };
  try {
    const gen = await OasGen.fromFile(`${oasBasePath}/recursive-oneof-array-branches.yaml`, {
      skipValidation: true,
      showParentInSelections: false,
    });
    await gen.visit();
    gen.generateSchema(['get:/lists/{id}>**']);
  } finally {
    Prop.prototype.path = orig;
  }
  assert.ok(calls < 250, `selection filters scan per prop again (${calls} path() calls, expected < 250)`);
});

test('test_bare_scalar_response_not_dropped', async () => {
  // A response that resolves directly to a scalar (no property wrapper) has nothing selectable
  // under the old leaf-detection, so the op was silently dropped from the schema entirely — not
  // degraded, not an error, just absent. `deleteWidgetsByWidgetId` returns a bare `true` on
  // success, matching adobe commerce's write-endpoint convention. Composes via rover.
  const schema = await runOasTest('bare-scalar-response.yaml', ['del:/widgets/{widgetId}>**'], 1, 0, { skipValidation: true });
  assert.ok(schema !== undefined);
  assert.ok(
    /deleteWidgetsByWidgetId\(widgetId: Int!\): Boolean\b/.test(schema!),
    'delete field present, returns Boolean',
  );
  assert.ok(/selection: """\s*\$\s*"""/.test(schema!), 'selection passes through the raw scalar value');
});

test('test_bare_scalar_array_response_not_dropped', async () => {
  // The same failure mode as the bare-scalar case above, one level up: a response that resolves
  // directly to an ARRAY of scalars (no property wrapper) had no leaf at all under the old
  // detection (PropArray's own leaf case only covers a *named* scalar-array property, and the bare
  // scalar case only covers a direct Scalar, not an Arr-of-scalar) — the op was silently dropped
  // entirely. Even once selectable, the connector selection was empty (Arr.select delegated to
  // Scalar.select, which writes nothing without a default) until Res.select also learned to treat
  // a bare array-of-scalar response like a bare scalar. Composes via rover. see docs/FIXED.md #47
  const schema = await runOasTest('bare-scalar-array-response.yaml', ['get:/me/widgets/contains>**'], 1, 0);
  assert.ok(schema !== undefined);
  assert.ok(/meWidgetsContains\(ids: String!\): \[Boolean\]/.test(schema!), 'field present, returns [Boolean]');
  assert.ok(/selection: """\s*\$\s*"""/.test(schema!), 'selection passes through the raw array value');
});

test('test_enum_query_param_is_a_scalar_argument', async () => {
  // An argument can only be a plain value, so petstore's `status` is written as `String`:
  //   status: { in: query, schema: { type: string, enum: [available, pending, sold] } }
  // The list of allowed values must never be written inside the argument. see docs/FIXED.md #53
  const schema = await runOasTest('petstore.yaml', ['get:/pet/findByStatus>**'], 19, 4, { skipValidation: true });
  assert.ok(schema !== undefined);
  assert.ok(/petFindByStatus\(status: String/.test(schema!), 'the enum param is a scalar argument');
  assert.ok(!/enum Enum \{/.test(schema!), 'no enum definition inside the argument list');
});

test('test_16_optional_response_fields_marked_in_selection', async () => {
  // #16 (petstore /pet/findByStatus): fields outside Pet's `required` list take `?` so an absent
  // key stops warning at runtime; required name/photoUrls stay plain so real gaps still warn.
  const schema = await runOasTest('petstore.yaml', ['get:/pet/findByStatus>**'], 19, 4, { skipValidation: true });
  assert.ok(schema !== undefined);
  assert.ok(/\n\s+id\?\n/.test(schema!), 'optional id is marked');
  assert.ok(schema!.includes('\n      name\n'), 'required name stays plain');
  assert.ok(schema!.includes('\n      photoUrls\n'), 'required photoUrls stays plain');
  assert.ok(schema!.includes('category? {'), 'optional object field is marked before its block');
  assert.ok(schema!.includes('tags? {'), 'optional array field is marked before its block');
  assert.ok(/\n\s+status\?\n/.test(schema!), 'optional enum-ish scalar is marked');
});

test('test_16_optional_markers_fail_composition_below_215', async () => {
  // Pinned behaviour, not a bug: composition 2.14.3 leaves a `?` group's fields uncredited. This is
  // the reason skipOptionalMarkers exists. forceRover because the local composer ignores the pin.
  const output = await runOasTest(
    'petstore.yaml',
    ['get:/pet/findByStatus>**'],
    19,
    4, { shouldFail: true, skipValidation: true, composeFederationVersion: '2.14.3', forceRover: true });
  assert.ok(output !== undefined);
  assert.match(output!, /CONNECTORS_UNRESOLVED_FIELD/, 'composition rejects the marked groups');
  assert.match(output!, /Category\.id|Tag\.id/, 'and names the fields the `?` group left uncredited');
});

test('test_16_skip_optional_markers_composes_below_215', async () => {
  // The same op with the markers dropped composes on the same old composition.
  const schema = await runOasTest(
    'petstore.yaml',
    ['get:/pet/findByStatus>**'],
    19,
    4, { skipValidation: true, composeFederationVersion: '2.14.3', forceRover: true, skipOptionalMarkers: true });
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('category {'), 'the group is still selected');
  assert.ok(schema!.includes('tags {'), 'and so is the array group');
  assert.ok(!schema!.includes('category? {'), 'without its marker');
  assert.ok(!/\n\s+id\?\n/.test(schema!), 'a plain optional scalar loses its marker too');
  assert.ok(schema!.includes('\n      name\n'), 'required fields are unchanged');
});

test('test_16_skip_optional_markers_reaches_the_cli', async () => {
  // A and B call fromFile directly, so an unforwarded CLI option would still pass them.
  const cli = [
    '--import',
    'tsx/esm',
    'src/cli/oas.ts',
    'tests/resources/oas/petstore.yaml',
    '-n',
    '-g',
    'findByStatus',
  ];
  const marked = spawnSync('node', cli, { encoding: 'utf-8' });
  const plain = spawnSync('node', [...cli, '--skip-optional-markers'], { encoding: 'utf-8' });
  assert.ok(marked.stdout.includes('category? {'), 'the CLI marks by default');
  assert.ok(plain.stdout.includes('category {'), 'and drops the marker when asked');
  assert.ok(!plain.stdout.includes('category? {'), 'with no marked group left');
});

test('test_16_skip_optional_markers_moves_nothing_else', async () => {
  // petstore has neither, so these two cover the shapes where a `?` is not a marker: the arrow
  // e.g. (map-key-aliasing) `currency_options?->entries`, and (r7r8-selection) `emails ?? $("")`
  const generate = async (file: string, path: string, skipOptionalMarkers: boolean) => {
    const gen = await OasGen.fromFile(`${oasBasePath}/${file}`, {
      skipValidation: true,
      showParentInSelections: false,
      skipOptionalMarkers,
    });
    await gen.visit();
    return gen.generateSchema([path]);
  };
  // a lone `?` is the marker; neither half of `??` is, and nor is `?!`
  const stripMarkers = (sdl: string) => sdl.replace(/(?<!\?)\?(?![?!])/g, '');

  const maps = await generate('map-key-aliasing.yaml', 'get:/coupons>**', false);
  const mapsPlain = await generate('map-key-aliasing.yaml', 'get:/coupons>**', true);
  assert.match(maps, /currency_options\?->entries \{/, 'the map marker is there by default');
  assert.match(mapsPlain, /currency_options->entries \{/, 'and gone with the flag, arrow untouched');
  assert.equal(mapsPlain, stripMarkers(maps), 'nothing else about the map schema moves');

  const defaults = await generate('r7r8-selection.yaml', 'get:/things>**', false);
  const defaultsPlain = await generate('r7r8-selection.yaml', 'get:/things>**', true);
  assert.equal((defaultsPlain.match(/\?\?/g) ?? []).length, 2, 'both `??` fallbacks keep both marks');
  assert.equal(defaultsPlain, stripMarkers(defaults), 'and nothing else moves there either');
});

test('test_webhooks_are_ignored_not_generated', async () => {
  // A spec can list `webhooks:` next to `paths:`. We only ever read the paths, so a webhook is
  // skipped rather than refused. see docs/FIXED.md #53
  const gen = await OasGen.fromFile(`${oasBasePath}/webhooks.yaml`, {
    showParentInSelections: false,
    skipValidation: true,
  });
  await gen.visit();

  // the spec really does have a webhook — otherwise the next check would pass on its own
  assert.deepStrictEqual(Object.keys(gen.parser.getWebhooks() ?? {}), ['petCreated']);
  assert.deepStrictEqual(Array.from(gen.paths.keys()), ['get:/ping'], 'only the path op is collected');
});

test('test_anyof_only_body_keeps_its_members', async () => {
  // A body listing its variants under `anyOf` with no `oneOf` (digitalocean's create-record, one
  // member per DNS record type). Members used to be read from `oneOf` alone, so the union was built
  // empty and wrote `input InputInput { }` — invalid SDL, and nothing was sent either.
  // see docs/FIXED.md #50
  const schema = await runOasTest('anyof-only-body.yaml', ['post:/records>**'], 1, 2);
  assert.ok(schema !== undefined);
  assert.ok(/input InputInput \{[^}]*\bname: String!/.test(schema!), 'the body carries the anyOf members');
  assert.ok(!/input \w+ \{\s*\}/.test(schema!), 'no empty input block is written');
  assert.ok(/body: """[^"]*\bpriority\b/.test(schema!), 'the members reach the body selection');
});

test('test_empty_response_alongside_a_selectable_body', async () => {
  // A write answering with an object that has no fields (asana's success-is-the-status-code
  // convention). The free-form-JSON fallback only fired when the WHOLE op had nothing selectable,
  // and this op's body does, so the response was written as an empty `type … { }` with an empty
  // selection. see docs/FIXED.md #51
  const schema = await runOasTest(
    'empty-response-with-body.yaml',
    ['post:/goals/{goalId}/removeSupportingRelationship>**'],
    1,
    4,
  );
  assert.ok(schema !== undefined);
  assert.ok(/\bdata: JSON\b/.test(schema!), 'the empty response object degrades to JSON');
  assert.ok(/selection: """\s*data\?\s*"""/.test(schema!), 'the selection asks for the field');
  assert.ok(!/type \w+Response \{\s*\}/.test(schema!), 'no empty response type is written');
});

test('test_inline_array_wrapping_another_array_unwraps_to_the_real_element', async () => {
  // `messages: { type: array, items: { items: … } }` — the inner schema's only key is `items`, so it
  // is a wrapper, not an element (slack `get:/conversations.replies`). Left alone it made the
  // field reference a type nobody defines and flattened the element's fields into the parent's
  // selection, unbracketed. Sibling of #46, which covered only the `$ref` form.
  // see docs/FIXED.md #52
  const schema = await runOasTest('nested-array-items.yaml', ['get:/wrapper-array>**'], 2, 2);
  assert.ok(schema !== undefined);
  assert.ok(/messages: \[MessagesUnion\]/.test(schema!), 'the field names the type that is defined');
  assert.ok(/^type MessagesUnion /m.test(schema!), 'that type is emitted');
  assert.ok(/messages\? \{/.test(schema!), 'the element nests inside braces in the selection');
});

test('test_genuine_array_of_arrays_stays_nested', async () => {
  // The guard for the test above: an explicit inner `type: array` is a real list of lists (docker's
  // `top`, one array of column values per process), NOT a wrapper — unwrapping it would publish a
  // shape the service never sends. see docs/FIXED.md #52; #96 made `processes` selectable at all.
  const schema = await runOasTest('nested-array-items.yaml', ['get:/matrix>**'], 2, 1);
  assert.ok(schema !== undefined);
  assert.ok(!/processes: \[String\]/.test(schema!), 'the matrix must not be flattened into one list');
  assert.ok(/processes: \[\[String\]\]/.test(schema!), 'it is declared whole, one list inside the other (#96)');
  assert.ok(/titles: \[String\]/.test(schema!), 'the genuinely flat sibling is unaffected');
});

test('test_96_nested_list_of_values_under_a_property_is_a_leaf', async () => {
  // #96: a list of lists of plain values had no leaf case in `>**`, so the field vanished — and
  // digitalocean's droplet_neighbors_ids, where it is the only property, lost the whole op.
  //   e.g. neighbor_ids: { type: array, items: { type: array, items: integer } }
  const schema = await runOasTest('nested-list-of-values.yaml', ['get:/neighbors>**'], 1, 1);
  assert.ok(schema !== undefined);
  assert.ok(/neighborIds: \[\[Int\]\]/.test(schema!), 'the field is declared as a list of lists');
  assert.ok(/neighborIds: neighbor_ids\b/.test(schema!), 'and selected whole, no block after it');
});

test('test_98_union_of_unknown_scalars_still_generates', async () => {
  // #98: common-room writes format names in the type slot — value: oneOf [{type: url}, {type: date}]
  // — and the factory threw on `url` (and would on `date` one call later); both of the vendor's
  // POST ops crashed before writing anything. An unknown type now reads as JSON, with a warning.
  const schema = await runOasTest('unknown-scalar-type.yaml', ['post:/fields>**'], 1, 2, { skipValidation: true });
  assert.ok(schema !== undefined);
  assert.ok(/input FieldUpdateInput \{/.test(schema!), 'the body input type is written');
  assert.ok(/name: String/.test(schema!), 'with its plain field');
  assert.ok(!/\bvalue[:?]/.test(schema!), 'the scalar-only union field stays absent — no `>**` leaf, as before');
});

test('test_99_dangling_ref_response_degrades_to_json', async () => {
  // #99: a 200 schema of `$ref: '#../'` — a pointer to nowhere, as published in common-room's
  // del:/user/{email} — stopped the whole run. The reference now reads as free-form JSON.
  const schema = await runOasTest('dangling-ref.yaml', ['get:/status>**'], 1, 0, { skipValidation: true });
  assert.ok(schema !== undefined);
  assert.ok(/\bstatus: JSON/.test(schema!), 'the op answers free-form JSON');
  assert.ok(/selection: """\s*\n\s*\$\s*\n/.test(schema!), 'and the selection takes the response whole');
});

test('test_same_name_fields_not_cut_as_circular', async () => {
  // docs/FIXED.md #36: two `extension` fields of DIFFERENT types on one path must NOT be treated as a
  // cycle. Before the object-identity fix the inner `extension` was cut by name (emptying Inner, failing
  // composition); now it is kept. Exercises BOTH fromProp and Type.add. Composes via rover.
  const schema = await runOasTest('same-name-fields.yaml', ['get:/thing>**'], 1, 4, { skipValidation: true });
  assert.ok(schema !== undefined);
  assert.ok(/\bextension: InnerExtension\b/.test(schema!), 'inner same-named field kept (not cut)');
  assert.ok(/^type InnerExtension /m.test(schema!), 'InnerExtension emitted');
  assert.ok(/^type Inner /m.test(schema!), 'Inner emitted, not empty');
});

test('test_genuine_cycles_cut_by_route', async () => {
  // docs/FIXED.md #36 companion: a genuine Node self-cycle reached via each route must STILL be cut by
  // object identity, while the shared non-recursive Shared stays expanded under both referencing fields.
  // Composes via rover (default v0.4 / fed 2.14).
  const schema = await runOasTest('cycles-by-route.yaml', ['get:/nodes>**'], 1, 3, { skipValidation: true });
  assert.ok(schema !== undefined);
  assert.ok(/# parent: Node - circular reference omitted/.test(schema!), 'direct $ref cycle cut');
  assert.ok(/# children: \[Node\] - circular reference omitted/.test(schema!), 'array-items cycle cut');
  assert.ok(/# back: Node - circular reference omitted/.test(schema!), 'inline deep $ref cycle cut');
  assert.ok(/\bwrapper: Wrapper\b/.test(schema!) && /\blabel: String\b/.test(schema!), 'Wrapper kept non-empty');
  assert.ok(
    /\bmeta: Shared\b/.test(schema!) && /\bextra: Shared\b/.test(schema!),
    'shared non-recursive kept under both',
  );
});

test('test_89_field_removed_on_any_route_is_removed_everywhere', async () => {
  // #89: a field cycle detection removed on some routes but kept on others was declared in the SDL
  // (#13's donation) while the removed routes' selections provided nothing — rover wants a declared
  // field provided at every position the type appears (confluence's relation GETs, `Content.space`).
  // A field removed on any route is now removed on every route and in the SDL, a comment in its place.
  const schema = await runOasTest('cycle-cut-on-some-routes.yaml', ['get:/graph>**'], 1, 9);
  assert.ok(schema !== undefined);
  // family A: the written Content kept `space`; removed here because homepage's Content lost it
  assert.ok(/# space: Space - circular reference omitted/.test(schema!), 'space commented in the SDL');
  assert.ok(!/\n {2}space: Space/.test(schema!), 'and not declared as a real field');
  assert.ok(/# space: circular reference omitted \(re-visit/.test(schema!), 'the keeping route writes the comment');
  assert.ok(!/space \{/.test(schema!), 'no route selects space');
  // family B: the written Doc had `folder` removed; the subject route kept it (the old donation direction)
  assert.ok(/# folder: Folder - circular reference omitted/.test(schema!), 'folder commented in the SDL');
  assert.ok(!/\n {2}folder: Folder/.test(schema!), 'and not declared as a real field');
  assert.ok(/# folder: circular reference omitted \(re-visit/.test(schema!), 'the keeping route writes the comment');
  assert.ok(!/folder \{/.test(schema!), 'no route selects folder');
  // guards against removing too much: fields kept on every route stay real in SDL and selection
  assert.ok(
    /\btitle: String\b/.test(schema!) && /\bkey: String\b/.test(schema!) && /\bnote: String\b/.test(schema!),
    'kept-everywhere fields stay declared',
  );
  assert.ok(/\btitle\b/.test(schema!) && /\bnote\b/.test(schema!), 'and selected');
});

test('test_101_type_with_every_field_removed_becomes_json', async () => {
  // #101: a type whose every field was removed printed nothing real between its braces, which does
  // not parse — confluence post:…/{id}/version and put:…/child/attachment/{attachmentId}. The field
  // is now free-form JSON, the selection takes it whole, and the definition is never written.
  const schema = await runOasTest('only-field-in-a-cycle.yaml', ['get:/history>**', 'post:/history>**'], 2, 2);
  assert.ok(schema !== undefined);
  assert.ok(/\bcontributors: JSON\b/.test(schema!), 'the field reads as free-form JSON');
  assert.ok(!/^type Contributors/m.test(schema!), 'no comment-only type is written');
  assert.ok(!/^input ContributorsInput/m.test(schema!), 'no comment-only input is written');
  assert.ok(!/contributors\?? \{/.test(schema!), 'the selection opens no group for it');
  assert.ok(/^\s+contributors\??$/m.test(schema!), 'and still takes the field');
});

test('test_102_enum_value_listed_twice_is_written_once', async () => {
  // #102: openfigi's stateCode lists 16 values twice and the enum wrote them as listed —
  // `INVALID_GRAPHQL: duplicate value`. A repeated value now keeps its first place only.
  const schema = await runOasTest('duplicate-enum-values.yaml', ['get:/jobs>**'], 1, 2);
  assert.ok(schema !== undefined);
  const block = schema!.match(/enum JobStateCode \{[^}]*\}/)?.[0] ?? '';
  assert.ok(block !== '', 'the enum is written');
  assert.strictEqual((block.match(/\bactive\b/g) || []).length, 1, 'a repeated value appears once');
  assert.strictEqual((block.match(/\bpending\b/g) || []).length, 1, 'in its first position');
  assert.ok(/pending[\s\S]*active[\s\S]*done/.test(block), 'listed order is kept');
});

test('test_97_object_stamped_on_a_list_reads_the_items', async () => {
  // #97: slack's reactions.get answers `{ type: object, items: { anyOf: […] } }` — an object with
  // no fields of its own and an `items` beside it. The op generated nothing and was dropped; the
  // items schema is the real shape (the example next to it is one object), read in its place.
  const schema = await runOasTest('object-stamped-on-a-list.yaml', ['get:/reaction>**'], 1, 4);
  assert.ok(schema !== undefined);
  assert.ok(/reaction: ReactionResponse/.test(schema!), 'the op answers the merged choice');
  assert.ok(/\bok: Boolean!/.test(schema!) && /message: Message/.test(schema!) && /file: File/.test(schema!),
    'the members\' fields are merged');
});

test('test_114_nested_object_stamped_on_a_list_reads_the_items', async () => {
  // #114: #97's repair only ran in fromSchema, so the same malformed shape one level down — a
  // PROPERTY that is `type: object` with no fields and an `items` beside it — dropped the field
  // entirely (absent from the type AND the selection), worse than degrading to JSON.
  const schema = await runOasTest('object-stamped-on-a-list-nested.yaml', ['get:/widgets>**'], 1, 2);
  assert.ok(schema !== undefined);
  assert.ok(/broken: Broken/.test(schema!), 'the field survives and points at a real type');
  assert.ok(/type Broken \{[^}]*id: String[^}]*label: String[^}]*\}/.test(schema!), 'items fields are read');
  assert.ok(/broken\? \{/.test(schema!), 'the selection keeps the field group');
});

test('test_anyof_param_coerced_to_string_arg', async () => {
  // A path/query param typed as anyOf/oneOf has no single GraphQL arg type (it would become a union,
  // emitting `id: !`); coerce it to String. see docs/FIXED.md #11. runOasTest composes via rover.
  const schema = await runOasTest('param-anyof.yaml', ['get:/things/{id}>**'], 1, 1);
  assert.ok(schema !== undefined);
  assert.ok(/\bid: String!/.test(schema!), 'anyOf param coerced to a String arg');
  assert.ok(!/\bid: !/.test(schema!), 'no empty arg type');
});

test('test_object_array_param_degrades_to_json_scalar', async () => {
  // A query param typed as an array of a real object schema has no GraphQL argument shape — the
  // generator used to emit a full `type SearchFilter {...}` body inline inside the argument list
  // (invalid GraphQL). Degrades to JSON, same convention as #19/#14, preserving array cardinality
  // ([JSON], not a flattened bare JSON). see docs/FIXED.md #40. runOasTest composes via rover.
  const schema = await runOasTest('param-object-array.yaml', ['get:/search>**'], 1, 1);
  assert.ok(schema !== undefined);
  assert.ok(/\bfilters: \[JSON\]/.test(schema!), 'object array param degraded to [JSON]');
  assert.ok(!/type SearchFilter\s*\{/.test(schema!), 'no inline type body for the degraded param');
});

test('test_server_url_falls_back_past_bad_first_server', async () => {
  // servers[0] is "/v1.33" (no host) — docker-engine's real shape — so it's skipped for the next
  // server that has one. see docs/FIXED.md #41
  const schema = await runOasTest('server-fallback-relative.yaml', ['get:/ping>**'], 1, 1);
  assert.ok(schema !== undefined);
  assert.ok(/baseURL: "https:\/\/example\.com\/1\.0"/.test(schema!), 'falls back to the usable server');
  assert.ok(!/baseURL: "\/v1\.33"/.test(schema!), 'the unusable relative server is not used');
});

test('test_server_url_prefixes_protocol_relative', async () => {
  // servers[0] is "//api.example.com" (no http/https) — just needs a scheme added.
  const schema = await runOasTest('server-protocol-relative.yaml', ['get:/ping>**'], 1, 1);
  assert.ok(schema !== undefined);
  assert.ok(/baseURL: "https:\/\/api\.example\.com"/.test(schema!), 'protocol-relative server gets a scheme');
  assert.ok(!/baseURL: "\/\/api\.example\.com"/.test(schema!), 'no bare protocol-relative baseURL');
});

test('test_server_url_preserves_declared_order', async () => {
  // "//prod.example.com" is listed first, so it wins even though "https://sandbox..." (listed
  // second) already has a scheme. see docs/FIXED.md #41
  const schema = await runOasTest('server-order-preserved.yaml', ['get:/ping>**'], 1, 1);
  assert.ok(schema !== undefined);
  assert.ok(/baseURL: "https:\/\/prod\.example\.com"/.test(schema!), 'first declared server wins');
  assert.ok(!/sandbox\.example\.com/.test(schema!), 'later server is not used just for being absolute');
});

test('test_map_field_key_aliasing_not_duplicated', async () => {
  // A map field whose JSON key needs aliasing (currency_options -> currencyOptions) used to write
  // the alias twice: currencyOptions: "currency_options": currencyOptions: "currency_options"->entries
  // — invalid selection syntax rover can't parse. see docs/FIXED.md #42
  const gen = await OasGen.fromFile(`${oasBasePath}/map-key-aliasing.yaml`, {
    skipValidation: false,
    showParentInSelections: false,
  });
  await gen.visit();
  const sdl = gen.generateSchema(['get:/coupons>**']);
  const occurrences = (sdl.match(/currencyOptions: currency_options/g) ?? []).length;
  assert.strictEqual(occurrences, 1, 'the alias must be written exactly once');
  assert.match(sdl, /currencyOptions: currency_options\?->entries \{/);
});

test('test_oas31_type_array_collapses_to_nullable_scalar', async () => {
  // OAS 3.1 nullable syntax `type: [string, 'null']` (no more `nullable: true`) reached
  // createScalarType as the literal "string,null" and threw. The array collapses to its first
  // non-null entry — GraphQL fields are nullable by default. see docs/FIXED.md #23
  const schema = await runOasTest('type-array-null.yaml', ['get:/settings>**'], 1, 1, { skipValidation: true });
  assert.ok(schema !== undefined);
  assert.ok(/projectRootPath: String\b/.test(schema!), 'string-or-null prop becomes String');
  assert.ok(/retries: Int\b/.test(schema!), 'integer-or-null prop becomes Int');
  assert.ok(/name: String\b/.test(schema!), 'plain single-type prop unchanged');
});

test('test_enum_fields_selected_and_degraded', async () => {
  // `>**` expansion must include enum props (slack's ok-only stubs collapsed to zero types), and
  // enums without a GraphQL form degrade honestly. see docs/FIXED.md #24
  const schema = await runOasTest('enum-fields.yaml', ['get:/status>**'], 1, 3, { skipValidation: true });
  assert.ok(schema !== undefined);
  assert.ok(/ok: Boolean!/.test(schema!), 'boolean enum degrades to Boolean');
  assert.ok(/state: State\b/.test(schema!), 'valid string enum keeps its enum type');
  assert.ok(/enum State \{/.test(schema!), 'enum definition emitted (sanitised name)');
  assert.ok(/\bsuspended\b/.test(schema!) && !/suspended /.test(schema!), 'sloppy value trimmed');
  assert.ok(/reaction: String\b/.test(schema!), 'non-identifier enum values degrade to String');
  assert.ok(/plus1: Int/.test(schema!) && /minus1: Int/.test(schema!), 'signed fields disambiguated');
  assert.ok(/plus1: \$\."\+1"/.test(schema!) && /minus1: \$\."-1"/.test(schema!), 'selection aliases keep raw keys');
  // Declaration site decides whether an enum survives: `inlineState` carries the same value set as
  // `state` but is declared on the property instead of as a named component, and degrades to String
  // with no warning. Generators targeting this tool must hoist enums to components. see #57
  assert.ok(/inlineState: StatusResponseInlineState\b/.test(schema!), 'inline enum promoted, named after type + field');
  assert.ok(/enum StatusResponseInlineState \{/.test(schema!), 'the promoted enum definition is emitted');
  assert.ok(!/enum InlineState\b/.test(schema!), 'no enum type is emitted for an inline enum');
});

test('test_mutation_params_and_body_share_one_argument_list', async () => {
  // an op with params AND a body emitted two parenthesised lists — `(username: String!)(input:
  // UserInput!)` — which is not valid GraphQL. One list, body last. see docs/FIXED.md #27
  const schema = await runOasTest('petstore.yaml', ['put:/user/{username}>**'], 19, 2, { skipValidation: true });
  assert.ok(schema !== undefined);
  assert.ok(
    /updateUserByUsername\(username: String!, input: UserInput!\)/.test(schema!),
    'params and body in one argument list',
  );
  assert.ok(!/\)\(/.test(schema!), 'no adjacent argument lists anywhere');
});

test('test_body_alias_direction_and_default_literals', async () => {
  // request-body selections map jsonKey <- graphqlField (the reverse of responses), string
  // defaults are quoted literals, and 0/false are real defaults. see docs/FIXED.md #28, #29
  const schema = await runOasTest('body-aliases-defaults.yaml', ['post:/things>**'], 3, 3, { skipValidation: true });
  assert.ok(schema !== undefined);
  assert.ok(/log_destinations: logDestinations \{/.test(schema!), 'body alias maps key <- field');
  assert.ok(!/logDestinations: "log_destinations"/.test(schema!), 'no response-direction alias in the body');
  // R7: body defaults coalesce too — the caller's value wins, the default only fills gaps
  assert.ok(/tag: tag \?\? \$\("latest"\)/.test(schema!), 'string default quoted, coalesced');
  assert.ok(/retries: retries \?\? \$\(0\)/.test(schema!), 'zero default emitted, coalesced');
});

test('test_body_input_name_matches_definition', async () => {
  // the body arg referenced the raw payload name (`input: ssh_keysItemInput!`) while the input
  // definition emits the sanitised one — the #15 def/ref discipline applies. see #30
  const schema = await runOasTest('body-aliases-defaults.yaml', ['post:/keys>**'], 3, 2, { skipValidation: true });
  assert.ok(schema !== undefined);
  assert.ok(/createKeys\(input: SshKeyInput!\)/.test(schema!), 'body arg uses the sanitised input name');
  assert.ok(/input SshKeyInput \{/.test(schema!), 'definition matches the reference');
});

test('test_empty_response_schema_synthesizes_success', async () => {
  // a response with no fields to select (googlebooks `Empty`: `type: object, properties: {}`)
  // produced zero types; it now gets the synthetic success response. see #31
  const schema = await runOasTest('body-aliases-defaults.yaml', ['post:/flush>**'], 3, 1, { skipValidation: true });
  assert.ok(schema !== undefined);
  assert.ok(/success: Boolean/.test(schema!), 'synthetic success field emitted');
  assert.ok(/success: \$\(true\)/.test(schema!), 'selection sets the boolean literal');
});

test('test_overrides_rewire_path_and_query_params', async () => {
  // user-intent request rewiring (R8): replace the path (`$` templates left alone), and
  // per query param: a string replaces the value, null drops it, an unknown key is appended
  const schema = await runOasTest(
    'r7r8-selection.yaml',
    ['get:/things>**'],
    1,
    1, { skipValidation: true, overrides: {
        'get:/things': {
          path: '/v2/things/{$config.tenant}',
          queryParams: { ids: 'ids->joinNotNull(";")', page: null, 'api-version': '$("2024-01")' },
          headers: { 'X-Version': '{$config.version}', 'X-Trace': null, 'X-Api-Key': '{$config.apiKey}' },
        },
      } });
  assert.ok(schema !== undefined);
  assert.ok(/GET: "\/v2\/things\/\{\$config\.tenant\}"/.test(schema!), 'path replaced, $ template untouched');
  assert.ok(/"ids": ids->joinNotNull\(";"\)/.test(schema!), 'param value replaced');
  assert.ok(!/"page"/.test(schema!), 'null drops the param');
  assert.ok(/"api-version": \$\("2024-01"\)/.test(schema!), 'unknown key appended');
  assert.ok(/\{ name: "X-Version", value: "\{\$config\.version\}" \}/.test(schema!), 'header value replaced');
  assert.ok(!/X-Trace/.test(schema!), 'null drops the header');
  assert.ok(/\{ name: "X-Api-Key", value: "\{\$config\.apiKey\}" \}/.test(schema!), 'unknown header appended');
});

test('test_overrides_replace_or_drop_body', async () => {
  // R9: an override body (raw JSONSelection) replaces the inferred `$args.input { … }`
  // mapping — literals and renamed keys included; null drops the body altogether
  const replaced = await runOasTest('r9-body.yaml', ['post:/things>**'], 1, 2, { skipValidation: true, overrides: { 'post:/things': { body: 'name: $args.input.name\nsource: $("web")' } } });
  assert.ok(replaced !== undefined);
  assert.ok(/name: \$args\.input\.name/.test(replaced!), 'computed body emitted');
  assert.ok(/source: \$\("web"\)/.test(replaced!), 'literal body field emitted');
  assert.ok(!/\$args\.input \{/.test(replaced!), 'inferred mapping replaced');

  const dropped = await runOasTest('r9-body.yaml', ['post:/things>**'], 1, 2, { skipValidation: true, overrides: { 'post:/things': { body: null } } });
  assert.ok(dropped !== undefined);
  assert.ok(!/body:/.test(dropped!), 'null drops the body');
});

test('test_base_url_overrides_servers', async () => {
  // a spec's servers[0] can be stale or wrong (petstore) — an explicit baseURL replaces it
  const schema = await runOasTest(
    'r7r8-selection.yaml',
    ['get:/things>**'],
    1,
    1, { skipValidation: true, baseURL: 'https://api.example.test/v2' });
  assert.ok(schema !== undefined);
  assert.ok(/baseURL: "https:\/\/api\.example\.test\/v2"/.test(schema!), 'override wins');
  assert.ok(!/https:\/\/example\.com/.test(schema!), 'spec server URL gone');
});

test('test_R7_default_coalesces_R8_array_params_join', async () => {
  // R7: defaults coalesce (`tag: tag ?? $("latest")`); R8: non-exploded array params join
  // (`ids->joinNotNull(",")`). Both on the default versions (connect v0.4, fed v2.14).
  const schema = await runOasTest('r7r8-selection.yaml', ['get:/things>**'], 1, 1, { skipValidation: true });
  assert.ok(schema !== undefined);
  assert.ok(/tag: tag \?\? \$\("latest"\)/.test(schema!), 'default coalesces instead of replacing');
  // #16 regression (digitalocean apps_list_alerts): a defaulted-items array must not also take
  // the marker — `emails?: emails ?? $("")` is unreadable, the fallback alone handles absence
  assert.ok(/emails: emails \?\? \$\(""\)/.test(schema!), 'array items default coalesces, unmarked');
  assert.ok(!/emails\?/.test(schema!), 'no marker on the defaulted array');
  assert.ok(/name\?/.test(schema!), 'the plain optional sibling still marks');
  assert.ok(/"ids": ids->joinNotNull\(","\)/.test(schema!), 'form/explode:false joins with comma');
  assert.ok(/"tags": tags->joinNotNull\("\|"\)/.test(schema!), 'pipeDelimited joins with |');
  assert.ok(/"page": page\n/.test(schema!), 'plain params unchanged');
});

test('test_http_block_layout_with_all_members', async () => {
  // A POST carrying all three http-object member types (queryParams + headers + body) renders
  // the expanded form: `http: {` on its own line, the verb and each member at indent 8, the
  // closing `}` aligned under `http:` (indent 6), and no commas between members.
  const schema = await runOasTest('r5-http-layout.yaml', ['post:/things>**'], 1, 2);
  assert.ok(schema !== undefined);
  const http = schema!.slice(schema!.indexOf('http: {'), schema!.indexOf('selection: """'));
  assert.ok(/http: \{\n {8}POST: "\/things"\n/.test(http), `expected http: { then POST at indent 8:\n${http}`);
  assert.ok(/\n {8}queryParams: """/.test(http), 'queryParams block at indent 8');
  assert.ok(/\n {8}headers: \[/.test(http), 'headers block at indent 8');
  assert.ok(/\n {8}body: """/.test(http), 'body block at indent 8');
  assert.ok(/\n {6}\}\n/.test(http), 'http closing brace at indent 6 (aligned under http:)');
  assert.ok(!/,\n/.test(http), 'no commas between http members');
});

// A list response and a single-object response, through the response helpers. They answer different
// questions and both are needed: `responseType` is the shape of the whole answer, `responseItemType`
// and `responseItemSchema` are the shape of one item. Anything asking "what kind of thing does this
// op return" wants the item — reading the whole answer instead is what hid #58 for a list of unions.
test('test_oas_responseType_keeps_the_list_wrapper', async () => {
  const gen = await OasGen.fromFile(`${oasBasePath}/petstore.yaml`, {} as never);
  await gen.visit();

  const list = gen.paths.get('get:/pet/findByStatus')!;
  const single = gen.paths.get('get:/pet/{petId}')!;
  assert.ok(T.isOp(list) && T.isOp(single));
  // resultType is only set once the op and its response child are visited. Generation visits
  // its own copy of the nodes since #71, so the ops read here are visited directly.
  for (const op of [list, single]) {
    for (const child of gen.expand(op)) {
      gen.expand(child);
    }
  }

  // `[Pet]` stays an array here
  assert.equal(T.responseType(list)!.id.startsWith('array:'), true);
  // ... but the schema behind it is Pet's, because the selection maps each element
  assert.deepEqual(Object.keys(T.responseItemSchema(list)?.properties ?? {}).sort(), [
    'category',
    'id',
    'name',
    'photoUrls',
    'status',
    'tags',
  ]);

  // a single object answers the same schema through both
  assert.equal(T.responseType(single)!.id.startsWith('obj:'), true);
  assert.deepEqual(
    Object.keys(T.responseItemSchema(single)?.properties ?? {}).sort(),
    Object.keys(T.responseItemSchema(list)?.properties ?? {}).sort(),
  );
});

test('test_directives_cover_fields_and_join_the_import', async () => {
  // R14: declared directives land on the types and fields they name; the federation ones join the
  // @link import. Near-miss names stay clean: `notadminUsers` is not `admin*`, `emailAddress`
  // is not `email`, and the same directive declared twice for `createUsers` is written once.
  const all = ['get:/admin/users>**', 'get:/admin/teams>**', 'get:/notadmin/users>**', 'post:/users>**'];
  const schema = await runOasTest('r14-directives.yaml', all, 4, 4, { skipValidation: true, directives: {
      'Mutation.*': ['@tag(name: "require-approval")'],
      'Mutation.createUsers': ['@tag(name: "require-approval")'],
      'Query.admin*': ['@tag(name: "admin")'],
      'User.email': ['@tag(name: "pii-high")', '@authenticated'],
    } });
  assert.ok(schema !== undefined);
  assert.ok(/adminUsers: \[AdminUser\] @tag\(name: "admin"\)\n/.test(schema!), 'glob covers adminUsers');
  assert.ok(/adminTeams: \[Team\] @tag\(name: "admin"\)\n/.test(schema!), 'glob covers adminTeams');
  assert.ok(/email: String @tag\(name: "pii-high"\) @authenticated\n/.test(schema!), 'field declaration applied');
  assert.ok(/import: \["@key", "@authenticated", "@tag"\]/.test(schema!), 'federation directives imported');

  assert.ok(/notadminUsers: \[User\]\n/.test(schema!), 'the whole field name must match admin*');
  assert.ok(/emailAddress: String\n/.test(schema!), 'email does not cover emailAddress');
  const approvals = schema!.match(/@tag\(name: "require-approval"\)/g) ?? [];
  assert.equal(approvals.length, 1, 'both createUsers declarations write the directive once');
});

test('test_directives_on_the_type_line_and_input_fields', async () => {
  // R14: a selector with no field part goes on the type line itself; request-body types are
  // declared by their written name, e.g. `CreateUserInput`, not the spec's `CreateUser`
  const all = ['get:/admin/users>**', 'get:/admin/teams>**', 'get:/notadmin/users>**', 'post:/users>**'];
  const schema = await runOasTest('r14-directives.yaml', all, 4, 4, { skipValidation: true, directives: {
      User: ['@tag(name: "pii")'],
      CreateUserInput: ['@tag(name: "pii")'],
      'CreateUserInput.email': ['@tag(name: "pii-high")'],
    } });
  assert.ok(schema !== undefined);
  assert.ok(/type User @tag\(name: "pii"\) \{/.test(schema!), 'on the type line');
  assert.ok(/input CreateUserInput @tag\(name: "pii"\) \{/.test(schema!), 'on the input line');
  assert.ok(/email: String @tag\(name: "pii-high"\)\n/.test(schema!), 'on the input field');
  const piiHigh = schema!.match(/@tag\(name: "pii-high"\)/g) ?? [];
  assert.equal(piiHigh.length, 1, 'User.email stays clean, only the input field is declared');
});

test('test_directives_on_an_allof_type', async () => {
  // R14: an allOf type is written by its own path (comp, not obj) — the declaration still lands
  const all = ['get:/admin/users>**'];
  const schema = await runOasTest('r14-directives.yaml', all, 4, 1, { skipValidation: true, directives: { AdminUser: ['@tag(name: "internal")'] } });
  assert.ok(schema !== undefined);
  assert.ok(/type AdminUser @tag\(name: "internal"\) \{/.test(schema!), 'on the allOf type line');
});

test('test_directives_unknown_directive_written_as_is', async () => {
  // R14: a directive gen does not know is written untouched and does not join the federation
  // import — declaring it is up to the user, so this schema is not composed here
  const gen = await OasGen.fromFile(`${oasBasePath}/r14-directives.yaml`, {
    skipValidation: true,
    showParentInSelections: false,
    directives: { 'Query.adminUsers': ['@cacheControl(maxAge: 60)'] },
  });
  await gen.visit();
  const schema = gen.generateSchema(['get:/admin/users>**']);
  assert.ok(/adminUsers: \[AdminUser\] @cacheControl\(maxAge: 60\)\n/.test(schema), 'written as declared');
  assert.ok(/import: \["@key"\]\)/.test(schema), 'the federation import is unchanged');
});

test('test_directives_bad_declarations_throw', async () => {
  // R14: a declaration that names nothing, or one that is not a directive, stops the run —
  // warning past it would ship the schema looking governed when it is not
  const gen = await OasGen.fromFile(`${oasBasePath}/r14-directives.yaml`, {
    skipValidation: true,
    showParentInSelections: false,
    directives: { 'User.nope': ['@tag(name: "x")'] },
  });
  await gen.visit();
  assert.throws(() => gen.generateSchema(['get:/notadmin/users>**']), /User\.nope/);

  gen.options.directives = { User: ['tag'] };
  assert.throws(() => gen.generateSchema(['get:/notadmin/users>**']), /must map to directive strings/);
});

test('test_directives_file_from_disk_applies', async () => {
  // R14: the checked-in example file is the one the CLI would load with
  // `--directives tests/resources/oas/r14-directives.json` — reading it here keeps it working
  const config = JSON.parse(fs.readFileSync(`${oasBasePath}/r14-directives.json`, 'utf-8'));
  const all = ['get:/admin/users>**', 'get:/admin/teams>**', 'get:/notadmin/users>**', 'post:/users>**'];
  const schema = await runOasTest('r14-directives.yaml', all, 4, 4, { skipValidation: true, directives: config });
  assert.ok(schema !== undefined);
  assert.ok(/createUsers\(input: CreateUserInput!\): User @tag\(name: "require-approval"\)\n/.test(schema!));
  assert.ok(/adminUsers: \[AdminUser\] @tag\(name: "admin"\)\n/.test(schema!));
  assert.ok(/email: String @tag\(name: "pii-high"\) @authenticated\n/.test(schema!));
  assert.ok(/type AdminUser @tag\(name: "internal"\) \{/.test(schema!));
  assert.ok(/import: \["@key", "@authenticated", "@tag"\]/.test(schema!));
});

test('test_config_broken_json_file_does_not_parse', () => {
  // a config file that does not parse must stop the run — every CLI loader (--directives,
  // --overrides, --batch, --transform-rules) exits instead of generating without the file
  assert.throws(() => JSON.parse(fs.readFileSync(`${oasBasePath}/broken-config.json`, 'utf-8')), SyntaxError);
});

test('test_overrides_file_from_disk_applies', async () => {
  // the checked-in example file is the one the CLI would load with
  // `--overrides tests/resources/oas/r9-overrides.json` — reading it here keeps it working
  const config = JSON.parse(fs.readFileSync(`${oasBasePath}/r9-overrides.json`, 'utf-8'));
  const schema = await runOasTest('r9-body.yaml', ['post:/things>**'], 1, 2, { skipValidation: true, overrides: config });
  assert.ok(schema !== undefined);
  assert.ok(/POST: "\/v2\/things"/.test(schema!), 'path replaced');
  assert.ok(/name: \$args\.input\.name/.test(schema!), 'computed body emitted');
  assert.ok(!/\$args\.input \{/.test(schema!), 'inferred mapping replaced');
  assert.ok(/\{ name: "X-Api-Key", value: "\{\$config\.apiKey\}" \}/.test(schema!), 'header appended');
});

test('test_directives_wrong_shapes_throw', async () => {
  // R14: the config usually comes straight from JSON.parse, so every wrong shape a valid JSON
  // file can carry gets its own clear error instead of a TypeError mid-run
  const gen = await OasGen.fromFile(`${oasBasePath}/r14-directives.yaml`, {
    skipValidation: true,
    showParentInSelections: false,
  });
  await gen.visit();
  const generate = (directives: unknown) => {
    gen.options.directives = directives as DirectivesConfig;
    return () => gen.generateSchema(['get:/notadmin/users>**']);
  };

  assert.throws(generate([]), /must be an object/, 'top level is a list');
  assert.throws(generate('User'), /must be an object/, 'top level is a string');
  assert.throws(generate({ User: 'not-a-list' }), /must map to directive strings/, 'value is not a list');
  assert.throws(generate({ User: [] }), /must map to directive strings/, 'value is empty');
  assert.throws(
    generate({ User: ['@tag(name: "x")', 42] }),
    /must map to directive strings/,
    'value mixes in a number',
  );
  assert.throws(
    generate({ 'User.email.domain': ['@tag(name: "x")'] }),
    /expected "Type" or "Type\.field"/,
    'three segments',
  );
  assert.throws(generate({ '.email': ['@tag(name: "x")'] }), /expected "Type" or "Type\.field"/, 'empty type part');
  assert.throws(generate({ 'User.': ['@tag(name: "x")'] }), /expected "Type" or "Type\.field"/, 'empty field part');
  assert.throws(
    generate({ 'Us*r.email': ['@tag(name: "x")'] }),
    /only the field part may use/,
    'glob in the type part',
  );
});

test('test_63_inline_wrapper_must_not_steal_component_name', async () => {
  // #63: the inline `Parent.body` gets the made-up name `ParentBody` — a real component's name.
  // The made-up name now bumps to `ParentBody2`, so `type ParentBody` is written once.
  const schema = await runOasTest('inline-wrapper-steals-component-name.yaml', ['post:/things>**'], 1, 6, { skipValidation: true });
  assert.ok(schema !== undefined);
  assert.ok(/body: ParentBody2\n/.test(schema!), 'the wrapper field uses the bumped name');
  assert.ok(/type ParentBody2 \{/.test(schema!), 'the wrapper is defined under the bumped name');
  assert.ok(/type ParentBody \{/.test(schema!), 'the component keeps its own name');
  const typeNames = [...schema!.matchAll(/^type (\w+)/gm)].map((m) => m[1]);
  const duplicates = [...new Set(typeNames.filter((n, i, a) => a.indexOf(n) !== i))];
  assert.deepEqual(duplicates, [], 'no type is defined twice');
});

test('test_100_inline_wrapper_must_not_take_a_later_components_name', async () => {
  // #100: inline `group` and component `Group` both write `GroupInput` — duplicate type.
  // collidesWithReservedComponentName is the only trigger that catches this shape.
  const check = (schema: string, label: string) => {
    const defs = schema.match(/^(?:type|input|scalar|enum|interface) \w+/gm) || [];
    assert.strictEqual(new Set(defs).size, defs.length, `${label}: no duplicates: ${defs.join(', ')}`);
    assert.ok(/^input GroupInput \{/m.test(schema), `${label}: component keeps its name`);
    assert.ok(/^input SubjectsGroupInput \{/m.test(schema), `${label}: inline wrapper is container-qualified`);
    assert.ok(/\bgroup: SubjectsGroupInput\b/.test(schema), `${label}: field references renamed wrapper`);
  };

  // inline `group` visits before component `Group` (body tree only)
  const alone = await runOasTest('inline-wrapper-vs-component-input.yaml', ['post:/space>**'], 2, 9);
  check(alone!, 'inline-first');

  // component `Group` visits first (get:/groups brings it in before the body walk)
  const both = await runOasTest('inline-wrapper-vs-component-input.yaml', ['get:/groups>**', 'post:/space>**'], 2, 10);
  check(both!, 'component-first');
});

test('test_67_allof_decorated_array_body_keeps_the_field', async () => {
  // #67: a property whose allOf only decorates an array lost the field, leaving an empty input.
  // The array now IS the field; required + nullable stays nullable (#55).
  const schema = await runOasTest('allof-array-body.yaml', ['post:/firewalls/{firewallId}/tags>**'], 1, 2);
  assert.ok(schema !== undefined);
  assert.ok(/tags: \[String\]\n/.test(schema!), 'the wrapped array is the field, nullable');
  assert.ok(/input: InputInput!/.test(schema!), 'the body argument stays');
  assert.ok(/tags\n/.test(schema!), 'and the body mapping sends it');
});

test('test_67_fieldless_bodies_stop_dangling', async () => {
  // #67: a body with nothing to send used to reference a type that was never written
  // (`input: InputInput!`). One value is now sent whole; nothing at all drops the argument.
  const schema = await runOasTest('fieldless-bodies.yaml', ['post:/notes>**', 'post:/empty>**', 'post:/free>**'], 3, 1);
  assert.ok(schema !== undefined);
  assert.ok(/createNotes\(input: String!\)/.test(schema!), 'a string body is one value, sent whole');
  assert.ok(/body: "\$args\.input"/.test(schema!), 'with the whole-value mapping');
  assert.ok(/createEmpty:/.test(schema!), 'an object with no fields takes no argument');
  assert.ok(/createFree\(input: JSON!\)/.test(schema!), 'a free-form body degrades to JSON');
  assert.ok(!/InputInput/.test(schema!), 'no dangling name remains');
});

test('test_70_scalar_valued_maps_stay', async () => {
  // #70: a map of plain values silently vanished from bodies and responses — nothing under it
  // counted as a selection leaf, so the field was never selected. The map itself is the leaf now.
  // A body map is `JSON` since #84, so what #70 fixed is now asserted on the response side only.
  const schema = await runOasTest('map-input-suffix.yaml', ['post:/snapshots>**', 'get:/snapshots>**'], 2, 6);
  assert.ok(schema !== undefined);
  assert.ok(/labels: \[LabelsEntry\]/.test(schema!), 'the response keeps its map of strings');
  assert.ok(/type LabelsEntry \{\n {2}key: String\n {2}value: String\n\}/.test(schema!), 'with its entry type');
  assert.ok(
    /labels: labels\?->entries \{\n\s+key\n\s+value\n\s+\}/.test(schema!),
    'and the selection reads the value whole',
  );
  assert.ok(/value: Manifest\n/.test(schema!), 'a map of objects keeps the object as its value');
});

test('test_76_cycle_cut_map_value_drops_the_field', async () => {
  // #76: a map value pointing back to a type above it (ccs: Amount.alternatives -> Amount) wrote
  // `value` with no fields under it, and composing failed. The field is dropped instead; maps of
  // plain values (#70) stay.
  const schema = await runOasTest('map-recursive-value.yaml', ['get:/prices>**'], 1, 3);
  assert.ok(schema !== undefined);
  assert.ok(!/alternatives/.test(schema!), 'the cycle-cut map field is gone from SDL and selection');
  assert.ok(/type Amount \{\n {2}unit: String\n {2}value: Float\n\}/.test(schema!), 'its owner keeps the plain fields');
  assert.ok(/fuelPrices: \[FuelPricesEntry\]/.test(schema!), 'the scalar-valued map stays');
  assert.ok(/fuelPrices: fuelPrices\?->entries \{\n\s+key\n\s+value\n\s+\}/.test(schema!), 'read whole in the mapping');
});

test('test_77_empty_composed_map_value_reads_whole', async () => {
  // #77: a map value that is an allOf of empty objects vanished, while a plain empty object (#70)
  // was kept as JSON. An empty Composed now counts as a leaf too — same field, same treatment.
  const schema = await runOasTest('map-empty-composed-value.yaml', ['get:/containers>**'], 1, 5);
  assert.ok(schema !== undefined);
  assert.ok(/mergedPorts: \[MergedPortsEntry\]/.test(schema!), 'the composed-valued map stays');
  assert.ok(
    /type MergedPortsEntry \{\n {2}key: String\n {2}value: JSON\n\}/.test(schema!),
    'its value degrades to JSON',
  );
  assert.ok(
    /mergedPorts: mergedPorts\?->entries \{\n\s+key\n\s+value\n\s+\}/.test(schema!),
    'read whole, no value block',
  );
  assert.ok(/exposedPorts: \[ExposedPortsEntry\]/.test(schema!), 'the empty-object control behaves the same');
});

test('test_78_same_named_maps_over_different_values_split', async () => {
  // #78: two maps with one field name and two different values got one entry type — the selection
  // then asked for fields the written value type does not have. The second map now takes a new
  // name, like #9; two maps with the same schema (metadata) still share one entry type.
  const schema = await runOasTest('map-entry-name-collision.yaml', ['get:/promotions>**'], 1, 8);
  assert.ok(schema !== undefined);
  assert.ok(
    /type CurrencyOptionsEntry \{\n {2}key: String\n {2}value: CouponCurrencyOption\n\}/.test(schema!),
    'first map keeps the plain name',
  );
  assert.ok(
    /type RestrictionsCurrencyOptionsEntry \{\n {2}key: String\n {2}value: RestrictionCurrencyOption\n\}/.test(schema!),
    'the second renames by its container',
  );
  assert.ok(/currencyOptions: \[RestrictionsCurrencyOptionsEntry\]/.test(schema!), 'and is referenced by the new name');
  assert.equal(
    schema!.match(/type MetadataEntry \{/g)?.length,
    1,
    'maps with the same schema still share one entry type',
  );
});

test('test_107_inline_map_values_split_with_their_wrappers', async () => {
  // #107: both gist models' files maps minted one [inline:FilesEntry] value, so one shape shadowed
  // the other. The value now follows its wrapper's #78-resolved name. see docs/FIXED.md #107
  const schema = await runOasTest('map-inline-value-collision.yaml', ['get:/gists>**', 'get:/starred>**'], 2, 6);
  assert.ok(schema !== undefined);
  assert.ok(/type inlineFilesEntry \{/.test(schema!), 'the first value keeps the plain name');
  assert.ok(/type inlineStarredGistFilesEntry \{/.test(schema!), 'the second follows its renamed wrapper');
  assert.ok(/type FilesEntry \{[^}]*value: inlineFilesEntry/.test(schema!), 'first wrapper references its own value');
  assert.ok(
    /type StarredGistFilesEntry \{[^}]*value: inlineStarredGistFilesEntry/.test(schema!),
    'second wrapper references its own value',
  );
  assert.ok(/content/.test(schema!) && /truncated/.test(schema!), 'the shadowed fields are back');
  assert.ok(!schema!.includes('[inline:'), 'internal inline placeholder must not leak into output');
  const defs = schema!.match(/^(?:type|input|scalar|enum|interface) \w+/gm) || [];
  assert.strictEqual(new Set(defs).size, defs.length, 'no duplicate definitions: ' + defs.join(', '));
});

test('test_80_union_of_unions_merges_member_fields', async () => {
  // #80: a union whose members are themselves unions merged to an empty type and an empty
  // selection. The members' members now contribute their fields to the merge.
  // e.g. (stripe) del bank_accounts answers anyOf [payment_source, deleted_payment_source], both anyOf too.
  const schema = await runOasTest('union-of-unions.yaml', ['del:/sources/{id}>**'], 1, 1);
  assert.ok(schema !== undefined);
  assert.ok(/type DeleteSourcesByIdResponse \{[^}]*last4: String/.test(schema!), 'the merged type carries the fields');
  assert.ok(/deleted: Boolean/.test(schema!), 'from every member of every member');
  assert.ok(/bankName: bank_name\?/.test(schema!), 'and the selection reads them');
  assert.ok(!/\{\s*\}/.test(schema!), 'no empty type body remains');
});

test('test_80_union_of_arrays_answers_json', async () => {
  // #80: a union whose members are arrays has no fields to merge — an array member cannot put its
  // list shape into a merged object. The field answers JSON and passes the value through.
  // e.g. (github) get stargazers answers anyOf [array of simple-user, array of stargazer].
  const schema = await runOasTest('union-of-arrays.yaml', ['get:/watchers>**'], 1, 1);
  assert.ok(schema !== undefined);
  assert.ok(/watchers: JSON/.test(schema!), 'the field answers JSON');
  assert.ok(/selection: """\n\s+\$\n\s+"""/.test(schema!), 'the whole value passes through');
  assert.ok(!/replacement for Union/.test(schema!), 'no merged type is written');
});

test('test_81_path_tokens_match_declared_params', async () => {
  // #81: the URL templates every path token as `{$args.<token>}` while the args came from the
  // declared parameters alone, so a spec that disagrees with its own path lost the argument.
  // e.g. (omni) `put /v1/labels/{labelName}` declares the parameter as `name`.
  const paths = [
    'get:/api-keys/{id}>**',
    'put:/labels/{labelName}>**',
    'put:/subscribers/{subscriberId}/add-ons/{addOnId}>**',
  ];
  const schema = await runOasTest('path-param-mismatch.yaml', paths, 3, 1, { skipValidation: true });
  assert.ok(schema !== undefined);
  assert.ok(/apiKeysById\(id: String!\)/.test(schema!), 'an undeclared token still becomes an argument');
  assert.ok(/GET: "\/api-keys\/\{\$args\.id\}"/.test(schema!), 'and the URL reads it');
  assert.ok(/\(labelName: String!, userId: String\)/.test(schema!), 'a renamed param answers to its token');
  assert.ok(/PUT: "\/labels\/\{\$args\.labelName\}"/.test(schema!), 'and keeps its place in the URL');
  assert.ok(!/\bname: String!/.test(schema!), 'the old name is gone, not duplicated');
  assert.ok(/\(subscriberId: String!, addOnId: String!\)/.test(schema!), 'case-only disagreement matches too');
});

test('test_82_keyword_prefixed_keys_take_the_path_form', async () => {
  // #82: after an alias the router matches `null` by prefix, so a bare `null_sort` read as the null
  // literal plus a stray identifier. Both directions now write the key as a path.
  // e.g. (omni) `post /v1/query/run` sorts carry a `null_sort` field.
  const schema = await runOasTest('literal-prefixed-field.yaml', ['post:/sorts>**'], 1, 2);
  assert.ok(schema !== undefined);
  assert.ok(/null_sort: \$\.nullSort/.test(schema!), 'the body reads the input field as a path');
  assert.ok(/nullSort: \$\."null_sort"\?/.test(schema!), 'the response reads the JSON key as a path');
  assert.ok(/column_name: columnName/.test(schema!), 'an ordinary alias stays bare');
  assert.ok(/columnName: column_name\?/.test(schema!), 'in both directions');
});

test('test_74_request_body_component_ref', async () => {
  // #74: a body written as `requestBody: { $ref: '#/components/requestBodies/…' }` used to emit a
  // mutation with no input and no body at all. It now generates exactly what the inline form does.
  const referenced = await runOasTest('request-body-component-ref.yaml', ['post:/things>**'], 1, 2);
  assert.ok(referenced !== undefined);
  assert.ok(/createThings\(input: ThingInput!\)/.test(referenced!), 'the input argument is back');
  assert.ok(/input ThingInput \{/.test(referenced!), 'and its type is defined');
  assert.ok(/\$args\.input \{/.test(referenced!), 'and the body mapping is written');

  const inline = await runOasTest('request-body-inline.yaml', ['post:/things>**'], 1, 2);
  assert.strictEqual(referenced, inline, 'a referenced body means exactly what the inline one means');
});

test('test_75_param_via_content_generates', async () => {
  // #75: a parameter carrying `content: { application/json: { schema } }` instead of `schema:`
  // crashed on `schema.default`. It now takes the same route as a `schema:` parameter.
  const viaContent = await runOasTest('param-via-content.yaml', ['get:/things>**'], 1, 1);
  assert.ok(viaContent !== undefined);
  const args = (schema: string) => /things\(([^)]*)\)/.exec(schema)?.[1];
  assert.equal(args(viaContent!), 'filter: JSON, sort: String', 'object degrades to JSON, the enum to String');

  const viaSchema = await runOasTest('param-via-schema.yaml', ['get:/things>**'], 1, 1);
  assert.equal(args(viaContent!), args(viaSchema!), 'both spellings give the same argument types');
});

test('test_68_map_value_names_the_type_it_points_at', async () => {
  // #68 gave a map value the `Input` ending its definition carries (`value: ManifestInput`). Since
  // #84 a map in a body is written as `JSON`, so no map is left under an input and only the
  // response side still has a value to name.
  const schema = await runOasTest('map-input-suffix.yaml', ['post:/snapshots>**', 'get:/snapshots>**'], 2, 6);
  assert.ok(schema !== undefined);
  assert.ok(
    /type ManifestsEntry \{\n {2}key: String\n {2}value: Manifest\n\}/.test(schema!),
    'a response map value points at the type as it is defined',
  );
  assert.ok(!/ManifestInput|EntryInput/.test(schema!), 'and no map input type is written at all');
});

test('test_84_body_map_is_sent_as_json', async () => {
  // #84: a body map was written as key/value pairs and mapped with `->entries`, which needs an
  // object — the router refused it and the field never left. The body sends the object itself now.
  const schema = await runOasTest('map-input-suffix.yaml', ['post:/snapshots>**', 'get:/snapshots>**'], 2, 6);
  assert.ok(schema !== undefined);
  assert.ok(/labels: JSON\n/.test(schema!), 'a map of strings is one JSON field');
  assert.ok(/portBindings: JSON\n/.test(schema!), 'so is a map of maps — the inner one is never built');
  assert.ok(!/EntryInput/.test(schema!), 'and no entry input type is written');

  const body = /body: """([\s\S]*?)"""/.exec(schema!)?.[1];
  assert.ok(body !== undefined);
  assert.ok(/\n\s+labels\n/.test(body!), 'the body sends the field as it comes');
  assert.ok(!/->entries/.test(body!), 'with no ->entries, which only reads an object');
  assert.ok(/labels\?->entries \{/.test(schema!), 'while the response still reads its map as pairs');

  // a map that is not in a body is untouched: this one is a query param, JSON since #40
  assert.ok(/snapshots\(filter: JSON\)/.test(schema!), 'a query param that is a map stays as it was');
});

test('test_66_array_body_references_item_input_type', async () => {
  // #66: a body that is an array (gong `fields`) used to emit `input: InputInput!`, a type nothing
  // defines. Now the arg is a list of the item's type. Composing checks the body mapping too.
  const schema = await runOasTest('array-body.yaml', ['post:/crm/stages>**'], 1, 2);
  assert.ok(schema !== undefined);
  assert.ok(/input: \[GenericSchemaFieldRequestInput!\]!/.test(schema!), 'the arg is a list of the item input type');
  assert.ok(!/InputInput/.test(schema!), 'the placeholder-derived name is gone');
});

test('test_83_form_body_is_sent_with_its_content_type', async () => {
  // #83: a body written as a form was dropped for not being JSON, and the mutation came out with no
  // argument and no body. The fields are mapped now, and the connector says it is sending a form.
  // 4 types, not 5: since #84 the `metadata` map is one JSON field, with no entry type of its own
  const schema = await runOasTest('form-encoded-body.yaml', ['post:/approve>**', 'post:/customers>**'], 7, 4);
  assert.ok(schema !== undefined);
  assert.ok(/createApprove\(input: InputInput!\)/.test(schema!), 'the flat form takes an argument');
  assert.ok(/app_id: appId\n/.test(schema!), 'and sends its fields');
  assert.ok(/createCustomers\(input: BInputInput!\)/.test(schema!), 'the nested form takes one too');
  assert.ok(/address \{\n\s+city\n\s+line1\n/.test(schema!), 'sending the nested object');
  assert.ok(/expand\n/.test(schema!), 'and the list');
  assert.equal(
    schema!.match(/\{ name: "Content-Type", value: "application\/x-www-form-urlencoded" \}/g)?.length,
    2,
    'each form connector carries the bare content type, with no charset',
  );
});

test('test_83_a_form_the_router_refuses_stays_bodyless', async () => {
  // #83: a form is sent as an object, so a body that is one value or a list still sends nothing —
  // `rover connector run` refuses both. Multipart has no mapping we can write and is unchanged.
  const schema = await runOasTest('form-encoded-body.yaml', ['post:/note>**', 'post:/tags>**', 'post:/files>**'], 7, 1);
  assert.ok(schema !== undefined);
  assert.ok(/createNote: Result/.test(schema!), 'a form of one value takes no argument');
  assert.ok(/createTags: Result/.test(schema!), 'nor does a form that is a list');
  assert.ok(/createFiles: Result/.test(schema!), 'nor a multipart upload');
  assert.ok(!/body:/.test(schema!), 'and none of them map a body');
  assert.ok(!/Content-Type/.test(schema!), 'so none of them write the form content type');
});

test('test_83_json_still_wins_over_a_form', async () => {
  // #83: JSON is picked first when a body offers both, and a body written as
  // `requestBody: { $ref: … }` reads its content type the same way the inline spelling does.
  const schema = await runOasTest('form-encoded-body.yaml', ['post:/both>**', 'post:/coupons>**'], 7, 3);
  assert.ok(schema !== undefined);
  assert.ok(/createBoth\(input: AddressInput!\)/.test(schema!), 'the JSON body is the one taken');
  assert.ok(/createCoupons\(input: InputInput!\)/.test(schema!), 'a referenced form is sent as well');
  assert.equal(
    schema!.match(/\{ name: "Content-Type", value: "application\/x-www-form-urlencoded" \}/g)?.length,
    1,
    'only the form connector writes the content type',
  );
});

test('test_83_stripe_writes_its_form_bodies', async () => {
  // #83: 326 of the 445 dropped bodies are stripe's, and every one of them is a form — each used to
  // come out with nothing to send. `metadata` comes out `JSON` because stripe writes it as an
  // anyOf, not as a map, so #84 does not reach it.
  const customers = await runOasTest('stripe.json', ['post:/v1/customers>**'], 589, 102);
  assert.ok(customers !== undefined);
  assert.ok(/createV1Customers\(input: InputInput!\)/.test(customers!), 'stripe takes its form body');
  assert.ok(
    /\{ name: "Content-Type", value: "application\/x-www-form-urlencoded" \}/.test(customers!),
    'with the header',
  );
  assert.ok(/cash_balance: cashBalance \{/.test(customers!), 'nested objects are sent under their spec names');
  assert.ok(/expand\n/.test(customers!), 'and lists are sent whole');

  // multipart: nothing we can map, so it keeps composing with no argument and no body
  const files = await runOasTest('stripe.json', ['post:/v1/files>**'], 589, 8);
  assert.ok(files !== undefined);
  assert.ok(/createV1Files: File/.test(files!), 'the multipart upload takes no argument');
  assert.ok(!/body:/.test(files!), 'and maps no body');
});

test(
  'test_73_curated_multi_op_stripe_selection_composes',
  {
    todo: 'CORRECTION 2026-08-18: this was wrongly marked passing — the test never pinned composeFederationVersion, so it silently under-validated against a mismatched default (2.15.1 vs the v2.13 this schema declares). Pinning it shows real errors again. See docs/issues.md #73.',
  },
  async () => {
    // stripe's real 34-op production selection failed with 1161 unresolved fields; #104's fix made
    // identical union twins converge on one name, but under a correctly-pinned federation version
    // real CONNECTORS_UNRESOLVED_FIELD errors remain (TaxId, several MetadataEntry variants).
    // see docs/issues.md #73 — and forceRover: only stock rover catches it
    const selections = JSON.parse(fs.readFileSync(`${oasBasePath}/stripe-curated-selection.json`, 'utf-8'));
  // 365: the 40 numbered twin copies across 9 name families collapse into their canonical types
  // composeFederationVersion MUST match federationVersion — compose()'s own default (2.15.1)
  // doesn't match what gen emits here (v2.13), and a mismatch doesn't fail cleanly, it makes
  // rover silently validate less (confirmed: this exact schema went from real errors to a clean
  // pass with no version-mismatch complaint at all — see docs/issues.md #109's methodology note).
  const schema = await runOasTest('stripe-curated.yaml', selections, 587, 365, {
    skipValidation: true,
    skipAuth: true,
    federationVersion: 'v2.13',
    composeFederationVersion: '2.13.0',
    forceRover: true,
  });
  assert.ok(schema !== undefined);
  },
);

// The three tests below use the exact same "every path" selection the corresponding real
// manifest produces (none of confluence/omni/pagerduty's manifests set operations.include) —
// not a hand-picked subtree. gen's own tests/all/corpus.test.ts also carries confluence.json/
// omni.yaml, but that file is gitignored (.gitignore: "published specs carry example secrets…
// kept on disk only, not committed") and those two fixtures are stale, different-version
// snapshots (confluence.json is REST v1/89 paths vs the real v2/213 paths here; omni.yaml is
// 90 paths vs 163) tested only against narrow hand-picked subtrees, never the full spec — so
// this is the first tracked, shared test any of these three specs have had at all.
test(
  'test_108_confluence_full_production_selection',
  { todo: 'a map value that is anyOf[enum, string] drops its whole property — see docs/issues.md #108' },
  async () => {
    const selections = JSON.parse(fs.readFileSync(`${oasBasePath}/confluence-full-selection.json`, 'utf-8'));
    const schema = await runOasTest('confluence-full.json', selections, 213, 327, {
      skipValidation: true,
      skipAuth: true,
      federationVersion: 'v2.14',
      composeFederationVersion: '2.14.0',
    });
    assert.ok(schema !== undefined);
  },
);

test(
  'test_109_omni_full_production_selection',
  { todo: '359 CONNECTORS_UNRESOLVED_FIELD across 71 types, cause not established — see docs/issues.md #109' },
  async () => {
    const selections = JSON.parse(fs.readFileSync(`${oasBasePath}/omni-full-selection.json`, 'utf-8'));
    const schema = await runOasTest('omni-full.json', selections, 163, 419, {
      skipValidation: true,
      skipAuth: true,
      federationVersion: 'v2.14',
      composeFederationVersion: '2.14.0',
    });
    assert.ok(schema !== undefined);
  },
);

test(
  'test_110_pagerduty_full_production_selection',
  { todo: 'an array of a shapeless $ref in a request body is dropped instead of degrading to [JSON] — see docs/issues.md #110' },
  async () => {
    // PagerDuty had no corpus entry at all before this — not stale, simply untested.
    const selections = JSON.parse(fs.readFileSync(`${oasBasePath}/pagerduty-full-selection.json`, 'utf-8'));
    const schema = await runOasTest('pagerduty-full.json', selections, 95, 333, {
      skipValidation: true,
      skipAuth: true,
      federationVersion: 'v2.14',
      composeFederationVersion: '2.14.0',
    });
    assert.ok(schema !== undefined);
  },
);

test(
  'test_108_map_with_anyof_enum_or_string_values_drops_the_map_and_selection',
  { todo: 'the map property is dropped entirely, leaving an empty type and an empty selection — see docs/issues.md #108' },
  async () => {
    // Confluence's real `POST /content/convert-ids-to-types`: response is one property, a map
    // whose values are `anyOf: [enum-of-strings, plain-string]`. Generating confluence's full,
    // unfiltered spec (graphos-service-factory/scripts/gen-ts.mjs) writes `type
    // ContentIdToContentTypeResponse { }` — zero fields, invalid GraphQL on its own — and an empty
    // `selection: """ """`. Combined with --service-prefix (Namespace.apply parses the raw SDL
    // before prefixing it) this crashes the whole CLI with an uncaught GraphQLError instead of a
    // clean, actionable message.
    const schema = await runOasTest('map-value-anyof-enum-string.yaml', ['post:/content/convert-ids-to-types>**'], 1, 2);
    assert.ok(schema !== undefined);
    assert.ok(!/type ContentIdToContentTypeResponse \{\s*\}/.test(schema!), 'the map property should not vanish, leaving an empty type');
  },
);

test(
  'test_110_array_of_shapeless_ref_body_prop_is_not_dropped',
  { todo: 'the whole request-body property vanishes instead of degrading to [JSON] — see docs/issues.md #110' },
  async () => {
    // PagerDuty's real `PUT /incidents/{id}/merge`: request body has one property,
    // `source_incidents`, an array of `$ref: IncidentReference` where IncidentReference is
    // shapeless (`{ type: object, additionalProperties: true }`). A bare shapeless ref correctly
    // degrades to JSON (factory.ts's documented fallback) — but as an array's `items` inside a
    // request body, the whole property is dropped instead, leaving `input InputInput { }` and
    // `body: """ $args.input { } """` — both empty. Same crash-under-service-prefix interaction
    // as #108 (Namespace.apply parses the raw, already-invalid SDL before prefixing it).
    const schema = await runOasTest('array-of-shapeless-ref-body-prop.yaml', ['put:/incidents/{id}/merge>**'], 1, 2);
    assert.ok(schema !== undefined);
    assert.ok(!/input InputInput \{\s*\}/.test(schema!), 'source_incidents should degrade to [JSON], not vanish');
  },
);

test('test_90_map_at_the_response_root_takes_entries', async () => {
  // #90: a response body that is itself a dictionary had no field name to hang the arrow off, so
  // the selection started inside the value and rover answered SELECTED_FIELD_NOT_FOUND. Res.select
  // now reads the entries of the response itself, and the field is the list ->entries answers.
  const schema = await runOasTest('map-response-root.yaml', ['get:/restrictions>**'], 4, 2);
  assert.ok(schema !== undefined);
  assert.ok(/restrictions: \[REntry\]/.test(schema!), 'the whole-response map is a list of entries');
  assert.ok(/type REntry \{\n {2}key: String\n {2}value: Restriction\n\}/.test(schema!), 'entry type is written');
  assert.ok(/selection: """\n\s*\$->entries \{/.test(schema!), 'the selection reads the response entries');
  assert.ok(/key\n\s*value \{\n\s*allowed\?/.test(schema!), "the value's fields sit inside value, not at the root");
});

test('test_90_map_under_a_field_is_unchanged', async () => {
  // the same map one level down still goes through PropMap, which writes the field name in front
  // of the arrow. Both callers now share one ->entries body, so this guards the extraction.
  const schema = await runOasTest('map-response-root.yaml', ['get:/pages>**'], 4, 3);
  assert.ok(schema !== undefined);
  assert.ok(/labels: \[LabelsEntry\]/.test(schema!), 'a map under a field keeps its own entry type');
  assert.ok(/labels: labels\?->entries \{/.test(schema!), 'and the field name still precedes the arrow');
});

test('test_92_map_of_plain_values_at_the_response_root_expands', async () => {
  // #92: `>**` had no leaf case for a whole-response map over a plain value, so it expanded to zero
  // paths and the op was dropped before any writer ran. github's /emojis and /languages both did.
  const strings = await runOasTest('map-response-root.yaml', ['get:/emoji>**'], 4, 1);
  assert.ok(strings !== undefined);
  assert.ok(/emoji: \[REntry\]/.test(strings!), 'the map is a list of entries');
  assert.ok(/type REntry \{\n {2}key: String\n {2}value: String\n\}/.test(strings!), 'a string value');
  assert.ok(/\$->entries \{\n\s*key\n\s*value\n\s*\}/.test(strings!), 'key and a bare value — no value block');

  const numbers = await runOasTest('map-response-root.yaml', ['get:/languages>**'], 4, 1);
  assert.ok(numbers !== undefined);
  assert.ok(/type REntry \{\n {2}key: String\n {2}value: Int\n\}/.test(numbers!), 'and an integer value');
});

test('test_94_union_body_with_an_array_member_keeps_its_input_type', async () => {
  // #94: a request body that is a oneOf of an object and an array of the same $ref referenced
  // `RestrictionArrayInput!` and never defined it — rover answered INVALID_BODY on confluence's
  // two `content/{id}/restriction` mutations. The array member carries the union's own name, so
  // merging it away decremented the union's own ref count to zero and the writer skipped it.
  const schema = await runOasTest('union-body-array-member.yaml', ['post:/restrictions>**'], 1, 3);
  assert.ok(schema !== undefined);
  assert.ok(/createRestrictions\(input: RestrictionArrayInput!\)/.test(schema!), 'the argument is the merged input');
  assert.ok(
    /input RestrictionArrayInput \{ [^}]*results: \[RestrictionInput\]\n {2}size: Int\n\}/.test(schema!),
    'and the input type is defined, with the object member fields',
  );
});
