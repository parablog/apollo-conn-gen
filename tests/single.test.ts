import { test } from 'node:test';
import { runOasTest } from '../src/tests/runners.js';

test('test_030_post-body-allOf', async () => {
  const paths = [
    "post:/user>body:b>comp:input:Input>ref:#/c/s/ExtraInfo>obj:input:#/c/s/ExtraInfo>prop:scalar:age",
    "post:/user>body:b>comp:input:Input>ref:#/c/s/BaseUser>obj:input:#/c/s/BaseUser>prop:scalar:email",
    "post:/user>body:b>comp:input:Input>ref:#/c/s/ExtraInfo>obj:input:#/c/s/ExtraInfo>prop:scalar:subscribed",
    "post:/user>body:b>comp:input:Input>ref:#/c/s/BaseUser>obj:input:#/c/s/BaseUser>prop:scalar:username",
    "post:/user>res:r>obj:type:createUserResponse>prop:scalar:success"
  ]

  await runOasTest(`post-sample.yaml`, paths, 3, 4);
});
