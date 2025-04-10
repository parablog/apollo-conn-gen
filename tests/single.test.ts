import { test } from 'node:test';
import { runOasTest } from '../src/tests/runners.js';

// test('test_036_time-series', async () => {
//   const paths = [
//     "post:/market-data-services/time-series/search>**"
//   ]
//   await runOasTest('time-series-1.0.28.yaml', paths, 1, 12);
// });

test('test_010_TMF633_IntentOrValue_to_Union', async () => {
  const paths = [
    'get:/product/{id}>res:r>ref:#/c/s/Product>comp:type:#/c/s/Product>ref:#/c/s/Entity>comp:type:#/c/s/Entity>ref:#/c/s/Addressable>obj:type:#/c/s/Addressable>prop:scalar:id',
    'get:/product/{id}>res:r>ref:#/c/s/Product>comp:type:#/c/s/Product>obj:type:[anonymous:#/c/s/Product]>prop:scalar:name',
    'get:/product/{id}>res:r>ref:#/c/s/Product>comp:type:#/c/s/Product>obj:type:[anonymous:#/c/s/Product]>prop:ref:#intent>union:#/c/s/IntentRefOrValue>ref:#/c/s/Intent>comp:type:#/c/s/Intent>ref:#/c/s/Entity>comp:type:#/c/s/Entity>ref:#/c/s/Addressable>obj:type:#/c/s/Addressable>prop:scalar:id',
    'get:/product/{id}>res:r>ref:#/c/s/Product>comp:type:#/c/s/Product>obj:type:[anonymous:#/c/s/Product]>prop:ref:#intent>union:#/c/s/IntentRefOrValue>ref:#/c/s/IntentRef>comp:type:#/c/s/IntentRef>ref:#/c/s/EntityRef>comp:type:#/c/s/EntityRef>obj:type:[anonymous:#/c/s/EntityRef]>prop:scalar:name',
    'get:/product/{id}>res:r>ref:#/c/s/Product>comp:type:#/c/s/Product>obj:type:[anonymous:#/c/s/Product]>prop:ref:#intent>union:#/c/s/IntentRefOrValue>ref:#/c/s/Intent>comp:type:#/c/s/Intent>obj:type:[anonymous:#/c/s/Intent]>prop:scalar:description',
  ];

  await runOasTest('TMF637-001-UnionTest.yaml', paths, 1, 11);
})