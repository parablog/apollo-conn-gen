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

test('test_R5_security_skip_auth_omits_all_auth', async () => {
  // Same spec as the bearer test (global bearerAuth), but with --skip-auth: no Authorization
  // header on @source and no auth value anywhere — the scheme is fully ignored.
  const schema = await runOasTest('simple-time-series.yaml', ['get:/search>**'], 1, 6, false, false, undefined, false, false, { skipAuth: true });
  assert.ok(schema !== undefined);
  assert.ok(!schema!.includes('Authorization'), 'no Authorization header anywhere with --skip-auth');
  assert.ok(!schema!.includes('{$config.token'), 'no {$config.token} auth value with --skip-auth');
  assert.ok(!schema!.includes('Bearer '), 'no Bearer prefix with --skip-auth');
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
  const schema = await runOasTest('openapi.car_configurator_service_(ccs)_int-10.210.0.yaml', paths, 44, 23, false, false, undefined, false, false);
  assert.ok(schema !== undefined);
  assert.ok(
    schema!.includes('{ name: "x-api-key", value: "{$config.apiKey}" }'),
    'expected the named apiKey header on @source',
  );
});

test('test_R5_security_oauth2_first_scheme_emits_alternative_silent', async () => {
  // Global requirement lists `main_auth` (oauth2) then `bearerAuth` (http/bearer). The
  // first header-producing scheme (oauth2 -> Bearer) is emitted; the alternative is a
  // legitimate OR choice, so it is NOT warned (only unresolvable schemes warn).
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
    !warnings.some((w) => /bearerAuth/.test(w)),
    `a legitimate OR alternative must not warn, got: ${warnings.join(' | ')}`,
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

test('test_R5_security_apikey_in_query_emits_on_connect', async () => {
  // Global apiKey in query (Swagger 2.0 most-popular-product, name `api-key`). SourceHTTP has no
  // queryParams, so query auth can't live on @source: it is emitted on the @connect instead. The op
  // has no real query params, so this is the auth-only queryParams block (no `$args {}`).
  const schema = await runOasTest('most-popular-product.yaml', ['get:/emailed/{period}.json>**'], 4, 4);
  assert.ok(schema !== undefined);
  assert.ok(!schema!.includes('headers:'), 'apiKey-in-query must not emit an @source header');
  assert.ok(
    schema!.includes('"api-key": $config.apiKey'),
    'expected the apiKey-in-query auth on the @connect queryParams',
  );
  assert.ok(!schema!.includes('$args {'), 'auth-only queryParams must not emit an $args block');
});

// --- R5 (slice 2): per-operation auth on @connect -----------------------------
//
// When ANY operation declares its own `security`, the spec is in *per-op mode*: the shared
// @source auth header is suppressed and each @connect carries its own *effective* auth (own
// requirement, or the inherited global, or nothing for a public op). This is OAS-correct and
// never leaks a credential a public op did not ask for.

// The single @source line of a generated schema (to assert it carries no auth header).
function sourceLine(schema: string): string {
  return schema.split('\n').find((l) => l.includes('@source(')) ?? '';
}

test('test_R5_security_per_op_apikey_emits_on_connect', async () => {
  // petstore: no global, every op declares its own security. GET /pet/{petId} lists
  // `api_key` (apiKey/header) then `petstore_auth` (oauth2) -> api_key wins on the @connect,
  // oauth2 is a legitimate OR alternative (not warned), and @source stays headerless.
  let schema: string | undefined;
  const warnings = await captureWarnings(async () => {
    schema = await runOasTest('petstore.yaml', ['get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:scalar:id'], 19, 1);
  });
  assert.ok(schema !== undefined);
  assert.ok(
    schema!.includes('{ name: "api_key", value: "{$config.apiKey}" }'),
    'expected the per-op apiKey header on @connect',
  );
  assert.ok(!sourceLine(schema!).includes('headers:'), '@source must carry no auth header in per-op mode');
  assert.ok(
    !warnings.some((w) => /petstore_auth/.test(w)),
    `a legitimate OR alternative must not warn, got: ${warnings.join(' | ')}`,
  );
});

test('test_R5_security_per_op_bearer_emits_on_connect', async () => {
  // time-series-1.0.28 has a global bearer requirement AND the op declares the same -> per-op
  // mode: @source headerless, the op's @connect carries Authorization: Bearer.
  const schema = await runOasTest('time-series-1.0.28.yaml', ['post:/market-data-services/time-series/search>**'], 1, 9);
  assert.ok(schema !== undefined);
  assert.ok(
    schema!.includes('{ name: "Authorization", value: "Bearer {$config.token}" }'),
    'expected the per-op Bearer header on @connect',
  );
  assert.ok(!sourceLine(schema!).includes('headers:'), '@source must carry no auth header in per-op mode');
});

test('test_R5_security_per_op_inherits_global_on_connect', async () => {
  // An op with NO own security inherits the global (X-API-Key) on its own @connect, since
  // @source no longer carries it (per-op mode, triggered by the sibling /admin & /public ops).
  const schema = await runOasTest('r5-per-op-auth.yaml', ['get:/inherits>**'], 3, 1);
  assert.ok(schema !== undefined);
  assert.ok(
    schema!.includes('{ name: "X-API-Key", value: "{$config.apiKey}" }'),
    'expected the inherited global apiKey header on @connect',
  );
  assert.ok(!sourceLine(schema!).includes('headers:'), '@source must carry no auth header in per-op mode');
});

test('test_R5_security_per_op_override_different_name_no_global_leak', async () => {
  // Leak (2): global is X-API-Key, the op overrides with Authorization. The op must send ONLY
  // Authorization — never also the global X-API-Key (a @connect header cannot remove a @source
  // one, so the global is suppressed entirely in per-op mode).
  const schema = await runOasTest('r5-per-op-auth.yaml', ['get:/admin>**'], 3, 1);
  assert.ok(schema !== undefined);
  assert.ok(
    schema!.includes('{ name: "Authorization", value: "Bearer {$config.token}" }'),
    'expected the op-own Bearer header on @connect',
  );
  assert.ok(!schema!.includes('X-API-Key'), 'the op must NOT also carry the global X-API-Key header');
});

test('test_R5_security_per_op_public_emits_no_auth', async () => {
  // Leak (1): `security: []` is a public op. It must carry no auth header at all, even though a
  // global default exists (the global is not emitted on @source in per-op mode).
  const schema = await runOasTest('r5-per-op-auth.yaml', ['get:/public>**'], 3, 1);
  assert.ok(schema !== undefined);
  assert.ok(!schema!.includes('Authorization'), 'public op must carry no Authorization header');
  assert.ok(!schema!.includes('X-API-Key'), 'public op must carry no inherited global header');
  assert.ok(!sourceLine(schema!).includes('headers:'), '@source must carry no auth header in per-op mode');
});

test('test_R5_security_per_op_override_header_wins_over_auth', async () => {
  // The user-intent overrides channel stays authoritative: an override of the same header name
  // replaces the inferred auth value.
  const schema = await runOasTest('r5-per-op-auth.yaml', ['get:/admin>**'], 3, 1, false, false, undefined, false, false, {
    overrides: { 'get:/admin': { headers: { Authorization: '{$config.adminToken}' } } },
  });
  assert.ok(schema !== undefined);
  assert.ok(
    schema!.includes('{ name: "Authorization", value: "{$config.adminToken}" }'),
    'expected the override header value to win',
  );
  assert.ok(!schema!.includes('Bearer {$config.token}'), 'the inferred auth value must be replaced by the override');
});

test('test_R5_security_per_op_override_header_is_case_insensitive', async () => {
  // HTTP header names are case-insensitive: a lowercase `authorization` override must replace the
  // resolved `Authorization` auth, not emit a second header that differs only in case.
  const schema = await runOasTest('r5-per-op-auth.yaml', ['get:/admin>**'], 3, 1, false, false, undefined, false, false, {
    overrides: { 'get:/admin': { headers: { authorization: '{$config.adminToken}' } } },
  });
  assert.ok(schema !== undefined);
  assert.ok(
    schema!.includes('{ name: "authorization", value: "{$config.adminToken}" }'),
    'the lowercase override header is emitted',
  );
  assert.ok(!schema!.includes('Bearer {$config.token}'), 'the resolved auth must be suppressed by the case-insensitive override');
});

// --- R5 (slice 3): apiKey-in-query auth on @connect queryParams ----------------
//
// SourceHTTP has no queryParams field, so query auth can never live on @source — it is ALWAYS
// emitted per-@connect (no mode gate), as a JSONSelection sibling of the `$args { … }` block.

test('test_R5_security_per_op_inherits_global_query_auth_on_connect', async () => {
  // /inherits has no own security -> it inherits the global query auth (api_key) on its @connect.
  const schema = await runOasTest('r5-query-auth.yaml', ['get:/inherits>**'], 4, 1);
  assert.ok(schema !== undefined);
  assert.ok(
    schema!.includes('"api_key": $config.apiKey'),
    'expected the inherited global apiKey-in-query auth on @connect',
  );
  assert.ok(!sourceLine(schema!).includes('headers:'), '@source must carry no auth header');
});

test('test_R5_security_per_op_own_query_auth_on_connect', async () => {
  // /own declares its own query scheme with a DIFFERENT key name (token) -> that key wins.
  const schema = await runOasTest('r5-query-auth.yaml', ['get:/own>**'], 4, 1);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('"token": $config.apiKey'), 'expected the op-own apiKey-in-query auth on @connect');
  assert.ok(!schema!.includes('"api_key"'), 'the op must NOT also carry the global api_key');
});

test('test_R5_security_per_op_public_emits_no_query_auth', async () => {
  // /public is `security: []` -> no query auth at all, even though a global default exists.
  const schema = await runOasTest('r5-query-auth.yaml', ['get:/public>**'], 4, 1);
  assert.ok(schema !== undefined);
  assert.ok(!schema!.includes('$config.apiKey'), 'public op must carry no query auth');
  assert.ok(!schema!.includes('queryParams:'), 'public op with no real params emits no queryParams block');
});

test('test_R5_security_query_auth_merges_with_real_query_params', async () => {
  // /search has a real `status` query param AND inherits the global query auth: both merge into one
  // queryParams block, with the auth as a sibling OUTSIDE the `$args { … }` block.
  const schema = await runOasTest('r5-query-auth.yaml', ['get:/search>**'], 4, 1);
  assert.ok(schema !== undefined);
  const block = schema!.slice(schema!.indexOf('queryParams:'), schema!.indexOf('"""', schema!.indexOf('queryParams:') + 20));
  assert.ok(/\$args \{[^}]*"status": status[^}]*\}/s.test(block), 'expected the real param inside the $args block');
  assert.ok(
    /\}\s*"api_key": \$config\.apiKey/s.test(block),
    'expected the apiKey-in-query auth as a sibling after the $args block',
  );
});

test('test_R5_security_apikey_in_cookie_is_deferred_with_warning', async () => {
  // apiKey in cookie has no spec field (only a Cookie: header hack) -> still deferred and warned.
  let schema: string | undefined;
  const warnings = await captureWarnings(async () => {
    schema = await runOasTest('r5-apikey-cookie.yaml', ['get:/things>**'], 1, 1);
  });
  assert.ok(schema !== undefined);
  assert.ok(!schema!.includes('$config.apiKey'), 'apiKey-in-cookie must not emit any auth');
  assert.ok(!schema!.includes('headers:'), 'apiKey-in-cookie must not emit an @source header');
  assert.ok(
    warnings.some((w) => /cookie/.test(w)),
    `expected an apiKey-in-cookie deferral warning, got: ${warnings.join(' | ')}`,
  );
});

// --- unmappable schemes & the per-op-mode scan ------------------------------

test('test_R5_security_http_digest_unmappable_warns_no_header', async () => {
  // http/digest is neither bearer nor basic -> mapSchemeToAuth returns null -> resolveAuth warns
  // "has no supported connector mapping" and emits no auth header anywhere.
  let schema: string | undefined;
  const warnings = await captureWarnings(async () => {
    schema = await runOasTest('r5-digest-auth.yaml', ['get:/things>**'], 1, 1);
  });
  assert.ok(schema !== undefined);
  assert.ok(!schema!.includes('Authorization'), 'digest must not emit an Authorization header');
  assert.ok(!schema!.includes('headers:'), 'digest must not emit any auth header on @source');
  assert.ok(
    warnings.some((w) => /digestAuth/.test(w) && /no supported connector mapping/.test(w)),
    `expected an unmappable-scheme warning naming digestAuth, got: ${warnings.join(' | ')}`,
  );
});

test('test_R5_security_on_unemitted_method_keeps_uniform_mode', async () => {
  // Only the HEAD op (which the generator doesn't emit) declares its own security.
  // hasPerOperationSecurity scans only get/post/put/patch/delete, so HEAD is ignored and the spec
  // stays in uniform mode: the global bearer header lives on @source (per-op mode would leave
  // @source headerless).
  const schema = await runOasTest('r5-head-security.yaml', ['get:/things>**'], 1, 1);
  assert.ok(schema !== undefined);
  assert.ok(
    sourceLine(schema!).includes('{ name: "Authorization", value: "Bearer {$config.token}" }'),
    '@source must carry the global bearer header — HEAD-only security must not trigger per-op mode',
  );
});

test('test_R5_security_per_op_global_warning_fires_once_across_inheriting_ops (C3)', async () => {
  // C3: in per-op mode, every op that inherits the global re-runs resolveAuth on the same global
  // requirement — so a dropped global scheme would re-fire its warning N times for N inheriting
  // ops. The fix pre-resolves the global once and dedupes: the cookie-deferred warning fires
  // exactly once total, no matter how many ops inherit it. (Genuinely op-specific warnings would
  // still carry the `(operation …)` suffix — this fixture has none of those.)
  let schema: string | undefined;
  const warnings = await captureWarnings(async () => {
    // 4 paths: /inherits1, /inherits2, /inherits3 (all inherit the cookie global), and /admin
    // (which triggers per-op mode via its own AdminBearer security). Without C3 the cookie
    // warning would print 3 times — once per inheriting op.
    schema = await runOasTest(
      'r5-per-op-global-warning-dedup.yaml',
      ['get:/inherits1>**', 'get:/inherits2>**', 'get:/inherits3>**', 'get:/admin>**'],
      4,
      4,
    );
  });
  assert.ok(schema !== undefined);
  const cookieWarnings = warnings.filter((w) => /CookieAuth.*cookie.*deferred/.test(w));
  assert.strictEqual(
    cookieWarnings.length,
    1,
    `the global cookie warning must fire exactly once across 3 inheriting ops, got ${cookieWarnings.length}: ${cookieWarnings.join(' | ')}`,
  );
});
