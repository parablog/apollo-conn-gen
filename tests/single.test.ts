import { test } from 'node:test';
import { oasBasePath, runOasTest } from '../src/tests/runners.js';
import { OasGen } from '../src/index.js';

// test('test_004_oas_test minimal petstore 03 all GETs', async () => {
//   const paths = ['get:/pet/{petId}>**'];
//
//   const gen = await OasGen.fromFile(`${oasBasePath}/petstore.yaml`, {
//     skipValidation: true,
//     consolidateUnions: true,
//     showParentInSelections: false,
//   });
//
//   await gen.visit();
//
//   const types = gen.getTypes(paths);
//   console.log(Array.from(types.keys()));
//
//   // console.log(T.print(types.get('obj:type:#/components/schemas/Pet')!));
// });

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


/*
test('test_028_oas_test_017_testMostPopularProduct_star', async () => {
  const paths = ['get:/emailed/{period}.json>res:r>obj:type:emailedByPeriodJsonResponse>*'];

  const gen = await OasGen.fromFile(`${oasBasePath}/most-popular-product.yaml`, {
    skipValidation: true,
    consolidateUnions: true,
    showParentInSelections: false,
  });

  await gen.visit();

  const selection = gen.selection(paths);
  console.info(selection);

  const types = gen.getTypes(paths);
  // console.log(Array.from(types.keys()));

  // await runOasTest('most-popular-product.yaml', paths, 4, 1);
});*/
