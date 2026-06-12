import { test } from 'node:test';
import assert from 'node:assert';
import { runOasTest } from '../../src/tests/runners.js';
import { captureWarnings } from './_setup.js';

// --- R5 (slice 1): @source auth header from OAS global security ---------------
//
// The suite globally no-ops console.warn (top of file). Deferred-is-loud cases below
// temporarily install a capturing stub and restore the original in a `finally` so the
// warnings are actually observable.
test('test_R5_security_bearer_emits_authorization_header', async () => {
  // Global bearerAuth (http/bearer), no per-op overrides -> Authorization: Bearer.
  const schema = await runOasTest('simple-time-series.yaml', ['get:/search>**'], 1, 6);
  assert.ok(schema !== undefined);
  assert.ok(
    schema!.includes('{ name: "Authorization", value: "Bearer {$config.token}" }'),
    'expected a Bearer Authorization header on @source',
  );
});

test('test_R5_security_basic_emits_authorization_header', async () => {
  // Global http/basic, no per-op overrides -> Authorization: Basic. (No corpus spec uses
  // global basic auth, so this slice ships a minimal fixture.)
  const schema = await runOasTest('r5-basic-auth.yaml', ['get:/things>**'], 1, 1);
  assert.ok(schema !== undefined);
  assert.ok(
    schema!.includes('{ name: "Authorization", value: "Basic {$config.token}" }'),
    'expected a Basic Authorization header on @source',
  );
});

test('test_R5_security_apikey_header_emits_named_header', async () => {
  // Global ApiKeyAuthentication (apiKey in header, name x-api-key), no per-op overrides.
  const paths = [
    'get:/api/v1/markets/{marketId}/models/{modelId}/configurations/{configurationId}/selectables>res:r>obj:type:#/c/s/VehicleComponentTree>prop:map:vehicleComponents>**',
  ];
  const schema = await runOasTest('openapi.car_configurator_service_(ccs)_int-10.210.0.yaml', paths, 44, 22, false, false, undefined, false, false, {
    // pinned to v0.3: composing v0.4 ->entries on stock rover hits the unreleased #14 fix
    connectorSpecVersion: 'v0.3',
    federationVersion: 'v2.12',
    composeFederationVersion: '2.12.0',
  });
  assert.ok(schema !== undefined);
  assert.ok(
    schema!.includes('{ name: "x-api-key", value: "{$config.apiKey}" }'),
    'expected the named apiKey header on @source',
  );
});

test('test_R5_security_oauth2_first_scheme_emits_and_warns_dropped_alternative', async () => {
  // Global requirement lists `main_auth` (oauth2) then `bearerAuth` (http/bearer). The
  // first header-producing scheme (oauth2 -> Bearer) is emitted; the alternative is warned.
  const paths = [
    'get:/productSelectorItems>res:r>array:ProductSelectorItemsItem>obj:type:ProductSelectorItemsItem>prop:scalar:activationDate',
  ];
  let schema: string | undefined;
  const warnings = await captureWarnings(async () => {
    schema = await runOasTest('js-mva-homepage-product-selector_v3.yaml', paths, 3, 1);
  });
  assert.ok(schema !== undefined);
  assert.ok(
    schema!.includes('{ name: "Authorization", value: "Bearer {$config.token}" }'),
    'expected oauth2 mapped to a Bearer Authorization header',
  );
  assert.ok(
    warnings.some((w) => /bearerAuth/.test(w) && /not emitted/.test(w)),
    `expected a dropped-alternative warning naming bearerAuth, got: ${warnings.join(' | ')}`,
  );
});

test('test_R5_security_none_is_byte_identical', async () => {
  // A spec with no security at all -> headerless @source, exactly as before.
  const paths = [
    'get:/individual/{id}>res:r>comp:type:#/c/s/Individual>comp:type:#/c/s/Party>comp:type:#/c/s/Entity>obj:type:#/c/s/Addressable>prop:scalar:id',
    'get:/individual/{id}>res:r>comp:type:#/c/s/Individual>obj:type:[inline:#/c/s/Individual]>prop:array:#individualIdentification>comp:type:#/c/s/IndividualIdentification>obj:type:[inline:#/c/s/IndividualIdentification]>prop:scalar:identificationId',
  ];
  const schema = await runOasTest('TMF632-Party_Management-v5.0.0.oas.yaml', paths, 20, 2);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('@source(name: "api", http: { baseURL: "'), 'expected an @source block');
  assert.ok(!schema!.includes('headers:'), 'no security -> no headers on @source');
});

test('test_R5_security_apikey_in_query_is_deferred_with_warning', async () => {
  // Global apiKey in query (Swagger 2.0 most-popular-product) -> no header, loud warning.
  let schema: string | undefined;
  const warnings = await captureWarnings(async () => {
    schema = await runOasTest('most-popular-product.yaml', ['get:/emailed/{period}.json>**'], 4, 4);
  });
  assert.ok(schema !== undefined);
  assert.ok(!schema!.includes('headers:'), 'apiKey-in-query must not emit an @source header');
  assert.ok(
    warnings.some((w) => /query/.test(w)),
    `expected an apiKey-in-query deferral warning, got: ${warnings.join(' | ')}`,
  );
});

test('test_R5_security_per_op_only_emits_no_global_header_and_warns', async () => {
  // petstore declares per-op security on every operation, no global -> no @source header,
  // a per-operation warning each (concern-2 guard).
  let schema: string | undefined;
  const warnings = await captureWarnings(async () => {
    schema = await runOasTest('petstore.yaml', ['get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:scalar:id'], 19, 1);
  });
  assert.ok(schema !== undefined);
  assert.ok(!schema!.includes('headers:'), 'per-op security must not emit a global @source header');
  assert.ok(
    warnings.some((w) => /declares its own `security`/.test(w)),
    `expected per-operation override warnings, got: ${warnings.join(' | ')}`,
  );
});

test('test_R5_security_global_plus_op_override_emits_no_global_header_and_warns', async () => {
  // time-series-1.0.28 has a global requirement AND an op-level override -> guard fires:
  // no @source header, a per-operation warning.
  let schema: string | undefined;
  const warnings = await captureWarnings(async () => {
    schema = await runOasTest('time-series-1.0.28.yaml', ['post:/market-data-services/time-series/search>**'], 1, 9);
  });
  assert.ok(schema !== undefined);
  assert.ok(!schema!.includes('headers:'), 'op override must suppress the global @source header');
  assert.ok(
    warnings.some((w) => /declares its own `security`/.test(w)),
    `expected a per-operation override warning, got: ${warnings.join(' | ')}`,
  );
});
