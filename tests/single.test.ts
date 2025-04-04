import { test } from 'node:test';
import { runOasTest } from '../src/tests/runners.js';

test('test_035_adobe-commerce-delete-address', async () => {
  const paths = [
    "del:/V1/addresses/{addressId}>res:r>scalar:boolean"
  ]
  await runOasTest(`adobe-commerce-swagger.json`, paths, 586, 0);
});
