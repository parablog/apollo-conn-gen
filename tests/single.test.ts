import { test } from 'node:test';
import { runOasTest } from '../src/tests/runners.js';

test('test_031_post-body-oneOf', async () => {
  const paths = [
    "post:/event>**"
  ]

  await runOasTest(`post-sample.yaml`, paths, 3, 4);
});

