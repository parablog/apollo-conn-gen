import { test } from 'node:test';
import { runOasTest } from '../src/tests/runners.js';

test('test_simple-oneOf-example', async () => {
  const paths = [
    'get:/search>**',
  ];

  await runOasTest('simple-time-series.yaml', paths, 1, 9);
});