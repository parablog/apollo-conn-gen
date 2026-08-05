import _ from 'lodash';
import fs from 'fs';
import { test } from 'node:test';
import assert from 'node:assert';
import { oasBasePath, runOasTest } from '../../src/tests/runners.js';
import { OasGen } from '../../src/index.js';
import { T } from '../../src/oas/nodes/internal.js';
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

  await runOasTest(`post-sample.yaml`, paths, 3, 2);
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
  await runOasTest('time-series-1.0.28.yaml', paths, 1, 9);
});

test('test_054_oas_test-better-naming', async () => {
  const paths = [
    'get:/2.3.0/astronauts/>res:r>obj:type:#/c/s/PaginatedPolymorphicAstronautEndpointList>prop:scalar:count',
    'get:/2.3.0/astronauts/>res:r>obj:type:#/c/s/PaginatedPolymorphicAstronautEndpointList>prop:array:#results>union:type:#/c/s/PolymorphicAstronautEndpoint>obj:type:#/c/s/AstronautDetailed>prop:comp:agency>comp:type:#/c/s/AgencyMini>obj:type:#/c/s/AgencyMini>prop:scalar:name',
    'get:/2.3.0/astronauts/>res:r>obj:type:#/c/s/PaginatedPolymorphicAstronautEndpointList>prop:array:#results>union:type:#/c/s/PolymorphicAstronautEndpoint>obj:type:#/c/s/AstronautEndpointNormal>prop:comp:agency>comp:type:#/c/s/AgencyMini>obj:type:#/c/s/AgencyMini>prop:scalar:name',
    // this union is nested inside a named field (`results`), not the op's own response, so it
    // renders as one merged type instead of a real `union` — see docs/issues.md #38. All 3 members
    // still need a selected field or the merge emits an empty one.
    'get:/2.3.0/astronauts/>res:r>obj:type:#/c/s/PaginatedPolymorphicAstronautEndpointList>prop:array:#results>union:type:#/c/s/PolymorphicAstronautEndpoint>obj:type:#/c/s/AstronautEndpointDetailed>prop:comp:agency>comp:type:#/c/s/AgencyMini>obj:type:#/c/s/AgencyMini>prop:scalar:name'
  ]

  await runOasTest('launch_Library_2-docs-v2.3.0.json', paths, 116, 3);
});
test('test_060_oas_test_additionalProperties_support', async () => {
  // Test additionalProperties support with VehicleComponentTree
  const paths = [
    'get:/api/v1/markets/{marketId}/models/{modelId}/configurations/{configurationId}/selectables>res:r>obj:type:#/c/s/VehicleComponentTree>prop:map:vehicleComponents>map:type:VehicleComponentsEntry>obj:type:#/c/s/VehicleComponent>**',
  ];
  await runOasTest('openapi.car_configurator_service_(ccs)_int-10.210.0.yaml', paths, 44, 23, false, false, undefined, false, false);
});

test('test_061_oas_test_vehicleComponents_additionalProperties', async () => {
  // Test vehicleComponents map specifically (object -> VehicleComponent)
  const paths = [
    'get:/api/v1/markets/{marketId}/models/{modelId}/configurations/{configurationId}/selectables>res:r>obj:type:#/c/s/VehicleComponentTree>prop:map:vehicleComponents>**',
  ];
  await runOasTest('openapi.car_configurator_service_(ccs)_int-10.210.0.yaml', paths, 44, 23, false, false, undefined, false, false);
});

test('test_062_oas_test_images_additionalProperties', async () => {
  // Test images map specifically (object -> array of VehicleComponentImage)
  const paths = [
    'get:/api/v1/markets/{marketId}/models/{modelId}/configurations/{configurationId}/selectables>res:r>obj:type:#/c/s/VehicleComponentTree>prop:map:vehicleComponents>map:type:VehicleComponentsEntry>obj:type:#/c/s/VehicleComponent>prop:map:images>**',
  ];
  await runOasTest('openapi.car_configurator_service_(ccs)_int-10.210.0.yaml', paths, 44, 5, false, false, undefined, false, false);
});

test('test_ref_into_paths_pointer_resolves_and_composes', async () => {
  // A parameter shared via a JSON-pointer into #/paths (percent-encoded braces) — the DigitalOcean
  // pattern — must resolve (not throw "Schema not found for ref") and compose. Top coverage gap:
  // GEN-THROW Schema/response not found for ref #/…. runOasTest composes via rover.
  const schema = await runOasTest('ref-into-paths.yaml', ['get:/gadgets/{widget_id}>**'], 2, 1);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('gadgets(widgetId: String!)'), 'resolved shared path param became an arg');
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
  assert.ok(/type Thing \{[^}]*\bid: String\b[^}]*\bname: String\b/s.test(schema!), 'merged type keeps both members\' fields');
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
  // see docs/issues.md #8. runOasTest composes via rover.
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
  // container -> `SaleInfoListPrice`, keeping both shapes. see docs/issues.md #9. composes via rover.
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
  // see docs/issues.md #18. composes via rover.
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
  // (INTERNAL_ERROR). The Composed now splits by container. see docs/issues.md #22. composes via rover.
  const schema = await runOasTest('composed-name-collision.yaml', ['get:/items>**'], 1, 5);
  assert.ok(schema !== undefined);
  assert.ok(/type Permissions \{[^}]*canDownload/s.test(schema!), 'the stored Obj keeps the key name');
  assert.ok(/type MediaPermissions \{[^}]*canAnnotate[^}]*canDelete/s.test(schema!), 'colliding Composed qualified by container');
  assert.ok(/\bpermissions: MediaPermissions\b/.test(schema!), 'media references the split type');
  assert.ok(!/type Permissions \{[^}]*canDelete/s.test(schema!), 'no redefinition of Permissions');
});

test('test_no_duplicate_type_definitions_launch_library', async () => {
  // A $ref reached two ways builds two nodes with the same name but different ids — `AgencyMini`
  // as an array item (`obj:type:…`) and as a single-member allOf (`comp:type:…`). The emit gate
  // keyed on the id missed the repeat and printed `type AgencyMini` twice (invalid SDL; rover
  // connector list is lenient, so it slipped the suite). see docs/issues.md #26.
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
    'petstore.yaml', ['get:/user/{username}>**'], 19, 1, false, true, undefined, false,
    true, // inferEntityResolvers
    {
      connectorSpecVersion: 'v0.4',
      federationVersion: 'v2.14',
      composeFederationVersion: '2.14.1',
      emitConnectorErrors: true,
    },
  );
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
  // see docs/issues.md #17. runOasTest composes via rover.
  const schema = await runOasTest('param-default-bool.yaml', ['get:/credentials>**'], 1, 1);
  assert.ok(schema !== undefined);
  assert.ok(/readWrite: Boolean = false\b/.test(schema!), 'boolean default rendered as literal');
  assert.ok(/expirySeconds: Int = 0\b/.test(schema!), 'number default unchanged');
  assert.ok(!/=\s*[,)]/.test(schema!), 'no dangling = remains');
});

test('test_required_and_nullable_emits_a_nullable_field', async () => {
  // In OpenAPI `required` and `nullable` are orthogonal: `required` says the key is present,
  // `nullable: true` says the value may be null. A field that is both must be NULLABLE in GraphQL —
  // `String!` makes the router error on a legitimately-null value. see docs/issues.md #55
  const schema = await runOasTest('required-nullable.yaml', ['get:/thing>**'], 1, 1, false, true);
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

test('test_required_nested_array_bang_stays_on_the_line', { todo: 'the ! lands on its own line' }, async () => {
  // A required list of lists writes its own line ending before the `!` is added, so the `!` lands
  // alone on the next line. Parses fine (line breaks are ignored), reads wrong. The field is only
  // reachable by naming its path — under `>**` a list of lists has no leaf and is dropped.
  // Marked todo: asserts the wanted output, fails today. see docs/issues.md #59
  const schema = await runOasTest(
    'required-nested-array.yaml',
    ['get:/matrix>res:r>obj:type:matrixResponse>prop:array:#processes', 'get:/matrix>res:r>obj:type:matrixResponse>prop:array:#titles'],
    1,
    1,
    false,
    true,
  );
  assert.ok(schema !== undefined);
  assert.ok(/processes: \[\[String\]\]!/.test(schema!), 'the ! belongs on the same line as the field');
});

test('test_required_oneof_null_field_is_kept', { todo: 'the field is dropped from the type' }, async () => {
  // The third way a spec says "may be null": a oneOf with a null branch. The null branch is
  // skipped, but skipping it currently loses the whole field — it should stay, as a nullable
  // String, exactly like the other two spellings in the tests above.
  // Marked todo: asserts the wanted output, fails today. see docs/issues.md #60
  const schema = await runOasTest('required-nullable-oneof.yaml', ['get:/thing>**'], 1, 1, false, true);
  assert.ok(schema !== undefined);
  assert.ok(/reqOneOf: String\n/.test(schema!), 'oneOf [string, null] must keep the field, nullable');
});

test('test_required_and_nullable_31_type_array', async () => {
  // The OAS 3.1 spelling of the same thing: `type: [string, 'null']`. refA and refB share one
  // component, so the second visit sees it already rewritten and must agree. see docs/issues.md #55
  const schema = await runOasTest('required-nullable-31.yaml', ['get:/thing>**'], 1, 1, false, true);
  assert.ok(schema !== undefined);
  assert.ok(/reqTypeArray: String\n/.test(schema!), 'required + type [string, null] -> nullable');
  assert.ok(/refA: String\n/.test(schema!), 'first visit through the shared component');
  assert.ok(/refB: String\n/.test(schema!), 'second visit must agree with the first');
});

test('test_shapeless_object_schema_becomes_json_scalar', async () => {
  // `{}` / `{ additionalProperties: false }` schemas (Slack shares pattern) used to throw
  // "Cannot handle schema" when reached via fromSchema (array items, members). They are objects
  // with no declared fields -> JSON scalar (NOT an empty Obj, which generate() would skip and
  // dangle the reference). see docs/issues.md #19. runOasTest composes via rover.
  const schema = await runOasTest('shapeless-object.yaml', ['get:/messages>**'], 1, 2);
  assert.ok(schema !== undefined);
  assert.ok(/privateChannels: \[JSON\]/.test(schema!), 'additionalProperties:false items -> [JSON]');
  assert.ok(/publicChannels: \[JSON\]/.test(schema!), 'empty {} items -> [JSON]');
});

test('test_typeless_object_items_degrade_to_json', async () => {
  // `items: { type: object }` — an object with a declared type but no properties — degrades to
  // [JSON] exactly like `items: {}` and `additionalProperties: false` in the test above. It used to
  // be dropped from the emitted type entirely. Same fixture, `archivedChannels`.
  // see docs/issues.md #56
  const schema = await runOasTest('shapeless-object.yaml', ['get:/messages>**'], 1, 2);
  assert.ok(schema !== undefined);
  assert.ok(/archivedChannels: \[JSON\]/.test(schema!), 'items:{type:object} should degrade to [JSON]');
});

test('test_response_allof_snake_path_def_ref_names_converge', async () => {
  // A response-root allOf on a snake_case path synthesizes a name carrying the `_`
  // (`v2…Billing_historyResponse`); the definition (Composed.generate) used upperFirst(getRefName)
  // while the reference used genTypeName, so they diverged -> INVALID_GRAPHQL ("cannot find type").
  // Both now route through genTypeName. see docs/issues.md #15. runOasTest composes via rover.
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
  // definition and the nested field referencing it stay in agreement. see docs/issues.md #45
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
  // always the true element type everywhere else already assumes it is. see docs/issues.md #46
  const schema = await runOasTest('array-refs-array-typed-schema.yaml', ['get:/widgets>**'], 1, 2);
  assert.ok(schema !== undefined);
  assert.ok(/widgets: \[WidgetsItem\]/.test(schema!), 'field type matches the emitted object definition');
  assert.ok(schema!.includes('type WidgetsItem {'), 'the real object is emitted under that name');
  assert.ok(!/WidgetList/.test(schema!), 'the redundant array-typed component name must not leak in');
  assert.ok(/widgets \{\n\s*count\n\s*name\n\s*\}/.test(schema!), 'the selection nests inside braces, not flattened');
});

test('test_inline_renamed_when_colliding_with_component_emitted_name', async () => {
  // An inline object named by its property key ('user') must not emit under the same GraphQL name as
  // a stored component ('#/c/s/User' -> `User`): occupancy is checked on the EMITTED name too, and the
  // inline (never the $ref-named component) is qualified by its container. see docs/issues.md #12.
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
  // see docs/issues.md #12, #37. composes via rover.
  const schema = await runOasTest('inline-wrapper-vs-component.yaml', ['get:/permission>**'], 3, 6);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('type SubjectsGroup'), 'subjects.group qualified by its container');
  assert.ok(schema!.includes('type MembersGroup'), 'members.group qualified by its container');
  assert.ok((schema!.match(/^type Group /gm) || []).length === 1, 'exactly one type Group (the component)');
  assert.ok(/\bgroup: SubjectsGroup\b/.test(schema!), 'subjects selection follows its own rename');
  assert.ok(/\bgroup: MembersGroup\b/.test(schema!), 'members selection follows its own rename');
});

test('test_inline_not_renamed_without_contained_same_named_ref', async () => {
  // The check is on the wrapper's own contents, not just a matching name: `status` matches a scalar
  // component (which emits no type) and `label` matches a component this op never reaches — neither
  // contains a ref to itself, so neither is renamed. see docs/issues.md #37.
  const schema = await runOasTest('inline-wrapper-vs-component.yaml', ['get:/widget>**'], 3, 3);
  assert.ok(schema !== undefined);
  assert.ok((schema!.match(/^type Status /gm) || []).length === 1, 'inline status keeps its name (scalar is not an occupant)');
  assert.ok((schema!.match(/^type Label /gm) || []).length === 1, 'inline label keeps its name (component unreached)');
  assert.ok(/\bstatus: Status\b/.test(schema!) && /\blabel: Label\b/.test(schema!), 'references keep the bare names');
});

test('test_same_key_wrapper_co_emits_safely_across_input_output', async () => {
  // The same `subjects.user` wrapper appears on the request body and the response, with different fields.
  // Both would take the same name; they stay distinct because the input one becomes `SubjectsUserInput`
  // and the output one is pushed to a longer name (`SpaceLikeSubjectsUser`). No duplicate, so it composes.
  // see docs/issues.md #37.
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
  // see docs/issues.md #10. runOasTest composes via rover.
  const schema = await runOasTest('recursive-cycle.yaml', ['get:/nodes>**'], 1, 2, false, true, undefined, false, false, {
    connectorSpecVersion: 'v0.4',
    federationVersion: 'v2.14',
    composeFederationVersion: '2.14.1',
  });
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('# children: [Node] - circular reference omitted'), 'array-items cycle cut in SDL');
  assert.ok(schema!.includes('# parent: Node - circular reference omitted'), 'direct self-cycle cut in SDL');
  assert.ok(/# children: circular reference omitted/.test(schema!), 'array cut commented in selection');
  assert.ok(/# parent: circular reference omitted/.test(schema!), 'self-cycle cut commented in selection');
  // shared non-recursive type expands fully under BOTH referencing fields (no over-cutting)
  assert.ok(/\bmeta: Shared\b/.test(schema!) && /\bextra: Shared\b/.test(schema!), 'both Shared refs kept');
  assert.ok((schema!.match(/label/g) || []).length >= 3, 'Shared.label selected under both fields');
});

test('test_bare_scalar_response_not_dropped', async () => {
  // A response that resolves directly to a scalar (no property wrapper) has nothing selectable
  // under the old leaf-detection, so the op was silently dropped from the schema entirely — not
  // degraded, not an error, just absent. `deleteWidgetsByWidgetId` returns a bare `true` on
  // success, matching adobe commerce's write-endpoint convention. Composes via rover.
  const schema = await runOasTest('bare-scalar-response.yaml', ['del:/widgets/{widgetId}>**'], 1, 0, false, true);
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
  // a bare array-of-scalar response like a bare scalar. Composes via rover. see docs/issues.md #47
  const schema = await runOasTest('bare-scalar-array-response.yaml', ['get:/me/widgets/contains>**'], 1, 0);
  assert.ok(schema !== undefined);
  assert.ok(/meWidgetsContains\(ids: String!\): \[Boolean\]/.test(schema!), 'field present, returns [Boolean]');
  assert.ok(/selection: """\s*\$\s*"""/.test(schema!), 'selection passes through the raw array value');
});

test('test_enum_query_param_is_a_scalar_argument', async () => {
  // An argument can only be a plain value, so petstore's `status` is written as `String`:
  //   status: { in: query, schema: { type: string, enum: [available, pending, sold] } }
  // The list of allowed values must never be written inside the argument. see docs/issues.md #53
  const schema = await runOasTest('petstore.yaml', ['get:/pet/findByStatus>**'], 19, 3, false, true);
  assert.ok(schema !== undefined);
  assert.ok(/petFindByStatus\(status: String/.test(schema!), 'the enum param is a scalar argument');
  assert.ok(!/enum Enum \{/.test(schema!), 'no enum definition inside the argument list');
});

test('test_webhooks_are_ignored_not_generated', async () => {
  // A spec can list `webhooks:` next to `paths:`. We only ever read the paths, so a webhook is
  // skipped rather than refused. see docs/issues.md #53
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
  // see docs/issues.md #50
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
  // selection. see docs/issues.md #51
  const schema = await runOasTest(
    'empty-response-with-body.yaml',
    ['post:/goals/{goalId}/removeSupportingRelationship>**'],
    1,
    4,
  );
  assert.ok(schema !== undefined);
  assert.ok(/\bdata: JSON\b/.test(schema!), 'the empty response object degrades to JSON');
  assert.ok(/selection: """\s*data\s*"""/.test(schema!), 'the selection asks for the field');
  assert.ok(!/type \w+Response \{\s*\}/.test(schema!), 'no empty response type is written');
});

test('test_inline_array_wrapping_another_array_unwraps_to_the_real_element', async () => {
  // `messages: { type: array, items: { items: … } }` — the inner schema's only key is `items`, so it
  // is a wrapper, not an element (slack `get:/conversations.replies`). Left alone it made the
  // field reference a type nobody defines and flattened the element's fields into the parent's
  // selection, unbracketed. Sibling of #46, which covered only the `$ref` form.
  // see docs/issues.md #52
  const schema = await runOasTest('nested-array-items.yaml', ['get:/wrapper-array>**'], 2, 2);
  assert.ok(schema !== undefined);
  assert.ok(/messages: \[MessagesUnion\]/.test(schema!), 'the field names the type that is defined');
  assert.ok(/^type MessagesUnion /m.test(schema!), 'that type is emitted');
  assert.ok(/messages \{/.test(schema!), 'the element nests inside braces in the selection');
});

test('test_genuine_array_of_arrays_stays_nested', async () => {
  // The guard for the test above: an explicit inner `type: array` is a real list of lists (docker's
  // `top`, one array of column values per process), NOT a wrapper — unwrapping it would publish a
  // shape the service never sends. `processes` is dropped today for a separate reason (an array of
  // arrays of plain values has no leaf to select), so what this pins is that it never appears
  // flattened. Relaxing the unwrap test to accept `type: array` makes it appear, and fails here.
  // see docs/issues.md #52
  const schema = await runOasTest('nested-array-items.yaml', ['get:/matrix>**'], 2, 1);
  assert.ok(schema !== undefined);
  assert.ok(!/processes: \[String\]/.test(schema!), 'the matrix must not be flattened into one list');
  assert.ok(/titles: \[String\]/.test(schema!), 'the genuinely flat sibling is unaffected');
});

test('test_same_name_fields_not_cut_as_circular', async () => {
  // docs/issues.md #36: two `extension` fields of DIFFERENT types on one path must NOT be treated as a
  // cycle. Before the object-identity fix the inner `extension` was cut by name (emptying Inner, failing
  // composition); now it is kept. Exercises BOTH fromProp and Type.add. Composes via rover.
  const schema = await runOasTest('same-name-fields.yaml', ['get:/thing>**'], 1, 4, false, true);
  assert.ok(schema !== undefined);
  assert.ok(/\bextension: InnerExtension\b/.test(schema!), 'inner same-named field kept (not cut)');
  assert.ok(/^type InnerExtension /m.test(schema!), 'InnerExtension emitted');
  assert.ok(/^type Inner /m.test(schema!), 'Inner emitted, not empty');
});

test('test_genuine_cycles_cut_by_route', async () => {
  // docs/issues.md #36 companion: a genuine Node self-cycle reached via each route must STILL be cut by
  // object identity, while the shared non-recursive Shared stays expanded under both referencing fields.
  // Composes via rover (default v0.4 / fed 2.14).
  const schema = await runOasTest('cycles-by-route.yaml', ['get:/nodes>**'], 1, 3, false, true);
  assert.ok(schema !== undefined);
  assert.ok(/# parent: Node - circular reference omitted/.test(schema!), 'direct $ref cycle cut');
  assert.ok(/# children: \[Node\] - circular reference omitted/.test(schema!), 'array-items cycle cut');
  assert.ok(/# back: Node - circular reference omitted/.test(schema!), 'inline deep $ref cycle cut');
  assert.ok(/\bwrapper: Wrapper\b/.test(schema!) && /\blabel: String\b/.test(schema!), 'Wrapper kept non-empty');
  assert.ok(/\bmeta: Shared\b/.test(schema!) && /\bextra: Shared\b/.test(schema!), 'shared non-recursive kept under both');
});

test('test_anyof_param_coerced_to_string_arg', async () => {
  // A path/query param typed as anyOf/oneOf has no single GraphQL arg type (it would become a union,
  // emitting `id: !`); coerce it to String. see docs/issues.md #11. runOasTest composes via rover.
  const schema = await runOasTest('param-anyof.yaml', ['get:/things/{id}>**'], 1, 1);
  assert.ok(schema !== undefined);
  assert.ok(/\bid: String!/.test(schema!), 'anyOf param coerced to a String arg');
  assert.ok(!/\bid: !/.test(schema!), 'no empty arg type');
});

test('test_object_array_param_degrades_to_json_scalar', async () => {
  // A query param typed as an array of a real object schema has no GraphQL argument shape — the
  // generator used to emit a full `type SearchFilter {...}` body inline inside the argument list
  // (invalid GraphQL). Degrades to JSON, same convention as #19/#14, preserving array cardinality
  // ([JSON], not a flattened bare JSON). see docs/issues.md #40. runOasTest composes via rover.
  const schema = await runOasTest('param-object-array.yaml', ['get:/search>**'], 1, 1);
  assert.ok(schema !== undefined);
  assert.ok(/\bfilters: \[JSON\]/.test(schema!), 'object array param degraded to [JSON]');
  assert.ok(!/type SearchFilter\s*\{/.test(schema!), 'no inline type body for the degraded param');
});

test('test_server_url_falls_back_past_bad_first_server', async () => {
  // servers[0] is "/v1.33" (no host) — docker-engine's real shape — so it's skipped for the next
  // server that has one. see docs/issues.md #41
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
  // second) already has a scheme. see docs/issues.md #41
  const schema = await runOasTest('server-order-preserved.yaml', ['get:/ping>**'], 1, 1);
  assert.ok(schema !== undefined);
  assert.ok(/baseURL: "https:\/\/prod\.example\.com"/.test(schema!), 'first declared server wins');
  assert.ok(!/sandbox\.example\.com/.test(schema!), 'later server is not used just for being absolute');
});

test('test_map_field_key_aliasing_not_duplicated', async () => {
  // A map field whose JSON key needs aliasing (currency_options -> currencyOptions) used to write
  // the alias twice: currencyOptions: "currency_options": currencyOptions: "currency_options"->entries
  // — invalid selection syntax rover can't parse. see docs/issues.md #42
  const gen = await OasGen.fromFile(`${oasBasePath}/map-key-aliasing.yaml`, {
    skipValidation: false,
    showParentInSelections: false,
  });
  await gen.visit();
  const sdl = gen.generateSchema(['get:/coupons>**']);
  const occurrences = (sdl.match(/currencyOptions: "currency_options"/g) ?? []).length;
  assert.strictEqual(occurrences, 1, 'the alias must be written exactly once');
  assert.match(sdl, /currencyOptions: "currency_options"->entries \{/);
});

test('test_oas31_type_array_collapses_to_nullable_scalar', async () => {
  // OAS 3.1 nullable syntax `type: [string, 'null']` (no more `nullable: true`) reached
  // createScalarType as the literal "string,null" and threw. The array collapses to its first
  // non-null entry — GraphQL fields are nullable by default. see docs/issues.md #23
  const schema = await runOasTest('type-array-null.yaml', ['get:/settings>**'], 1, 1, false, true);
  assert.ok(schema !== undefined);
  assert.ok(/projectRootPath: String\b/.test(schema!), 'string-or-null prop becomes String');
  assert.ok(/retries: Int\b/.test(schema!), 'integer-or-null prop becomes Int');
  assert.ok(/name: String\b/.test(schema!), 'plain single-type prop unchanged');
});

test('test_enum_fields_selected_and_degraded', async () => {
  // `>**` expansion must include enum props (slack's ok-only stubs collapsed to zero types), and
  // enums without a GraphQL form degrade honestly. see docs/issues.md #24
  const schema = await runOasTest('enum-fields.yaml', ['get:/status>**'], 1, 2, false, true);
  assert.ok(schema !== undefined);
  assert.ok(/ok: Boolean!/.test(schema!), 'boolean enum degrades to Boolean');
  assert.ok(/state: State\b/.test(schema!), 'valid string enum keeps its enum type');
  assert.ok(/enum State \{/.test(schema!), 'enum definition emitted (sanitised name)');
  assert.ok(/\bsuspended\b/.test(schema!) && !/suspended /.test(schema!), 'sloppy value trimmed');
  assert.ok(/reaction: String\b/.test(schema!), 'non-identifier enum values degrade to String');
  assert.ok(/plus1: Int/.test(schema!) && /minus1: Int/.test(schema!), 'signed fields disambiguated');
  assert.ok(/plus1: "\+1"/.test(schema!) && /minus1: "-1"/.test(schema!), 'selection aliases keep raw keys');
});

test('test_mutation_params_and_body_share_one_argument_list', async () => {
  // an op with params AND a body emitted two parenthesised lists — `(username: String!)(input:
  // UserInput!)` — which is not valid GraphQL. One list, body last. see docs/issues.md #27
  const schema = await runOasTest('petstore.yaml', ['put:/user/{username}>**'], 19, 2, false, true);
  assert.ok(schema !== undefined);
  assert.ok(
    /updateUserByUsername\(username: String!, input: UserInput!\)/.test(schema!),
    'params and body in one argument list',
  );
  assert.ok(!/\)\(/.test(schema!), 'no adjacent argument lists anywhere');
});

test('test_body_alias_direction_and_default_literals', async () => {
  // request-body selections map jsonKey <- graphqlField (the reverse of responses), string
  // defaults are quoted literals, and 0/false are real defaults. see docs/issues.md #28, #29
  const schema = await runOasTest('body-aliases-defaults.yaml', ['post:/things>**'], 3, 3, false, true);
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
  const schema = await runOasTest('body-aliases-defaults.yaml', ['post:/keys>**'], 3, 2, false, true);
  assert.ok(schema !== undefined);
  assert.ok(/createKeys\(input: SshKeyInput!\)/.test(schema!), 'body arg uses the sanitised input name');
  assert.ok(/input SshKeyInput \{/.test(schema!), 'definition matches the reference');
});

test('test_empty_response_schema_synthesizes_success', async () => {
  // a response with no fields to select (googlebooks `Empty`: `type: object, properties: {}`)
  // produced zero types; it now gets the synthetic success response. see #31
  const schema = await runOasTest('body-aliases-defaults.yaml', ['post:/flush>**'], 3, 1, false, true);
  assert.ok(schema !== undefined);
  assert.ok(/success: Boolean/.test(schema!), 'synthetic success field emitted');
  assert.ok(/success: \$\(true\)/.test(schema!), 'selection sets the boolean literal');
});

test('test_overrides_rewire_path_and_query_params', async () => {
  // user-intent request rewiring (R8): replace the path (`$` templates left alone), and
  // per query param: a string replaces the value, null drops it, an unknown key is appended
  const schema = await runOasTest('r7r8-selection.yaml', ['get:/things>**'], 1, 1, false, true, undefined, false, false, {
    overrides: {
      'get:/things': {
        path: '/v2/things/{$config.tenant}',
        queryParams: { ids: 'ids->joinNotNull(";")', page: null, 'api-version': '$("2024-01")' },
        headers: { 'X-Version': '{$config.version}', 'X-Trace': null, 'X-Api-Key': '{$config.apiKey}' },
      },
    },
  });
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
  const replaced = await runOasTest('r9-body.yaml', ['post:/things>**'], 1, 2, false, true, undefined, false, false, {
    overrides: { 'post:/things': { body: 'name: $args.input.name\nsource: $("web")' } },
  });
  assert.ok(replaced !== undefined);
  assert.ok(/name: \$args\.input\.name/.test(replaced!), 'computed body emitted');
  assert.ok(/source: \$\("web"\)/.test(replaced!), 'literal body field emitted');
  assert.ok(!/\$args\.input \{/.test(replaced!), 'inferred mapping replaced');

  const dropped = await runOasTest('r9-body.yaml', ['post:/things>**'], 1, 2, false, true, undefined, false, false, {
    overrides: { 'post:/things': { body: null } },
  });
  assert.ok(dropped !== undefined);
  assert.ok(!/body:/.test(dropped!), 'null drops the body');
});

test('test_base_url_overrides_servers', async () => {
  // a spec's servers[0] can be stale or wrong (petstore) — an explicit baseURL replaces it
  const schema = await runOasTest('r7r8-selection.yaml', ['get:/things>**'], 1, 1, false, true, undefined, false, false, {
    baseURL: 'https://api.example.test/v2',
  });
  assert.ok(schema !== undefined);
  assert.ok(/baseURL: "https:\/\/api\.example\.test\/v2"/.test(schema!), 'override wins');
  assert.ok(!/https:\/\/example\.com/.test(schema!), 'spec server URL gone');
});

test('test_R7_default_coalesces_R8_array_params_join', async () => {
  // R7: defaults coalesce (`tag: tag ?? $("latest")`); R8: non-exploded array params join
  // (`ids->joinNotNull(",")`). Both on the default versions (connect v0.4, fed v2.14).
  const schema = await runOasTest('r7r8-selection.yaml', ['get:/things>**'], 1, 1, false, true);
  assert.ok(schema !== undefined);
  assert.ok(/tag: tag \?\? \$\("latest"\)/.test(schema!), 'default coalesces instead of replacing');
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
  // resultType is filled in while generating, not while visiting
  gen.generateSchema(['get:/pet/findByStatus>**', 'get:/pet/{petId}>**']);

  const list = gen.paths.get('get:/pet/findByStatus')!;
  const single = gen.paths.get('get:/pet/{petId}')!;
  assert.ok(T.isOp(list) && T.isOp(single));

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
