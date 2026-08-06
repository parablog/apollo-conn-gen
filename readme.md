# Generator library and CLI for Apollo Connectors

## Introduction

This project is a library designed to generate an [Apollo Connector](https://www.apollographql.com/graphos/apollo-connectors) schema from either

- an OpenAPI Specification (OAS) file (YAML or JSON), or
- a set of JSON payloads.

It also includes CLI tools to facilitate this conversion process.

Key features:

- Generates an Apollo Connector from an OAS specification, converting all types and HTTP entry points defined in the spec (supports `GET`, `POST`, `PUT`, `PATCH`, `DELETE` methods)
- Generates a schema based on a single or a collection of `JSON` files
- Maps OAS security schemes to connector auth (headers / query params with `{$config.*}` placeholders)
- Optional entity resolver inference, batch endpoints, connector `errors` blocks and per-operation request overrides

## Changelog

See the [changelog](./CHANGELOG.md) for the latest changes.

## Versions

The generator emits `connect/v0.4` schemas (the only supported connector spec version) with `federation/v2.14` by default.

- `--federation-version` accepts any `vMAJOR.MINOR` value `>= v2.13` (the floor required by connect v0.4).
- `--connector-spec-version` accepts only `v0.4`; anything else is rejected at startup.

Note: connect v0.4 is experimental. The router must enable `connectors: preview_connect_v0_4: true` and use federation `>= v2.13` — the CLI prints a reminder on every run.

## Prerequisites

- [Node.js](https://nodejs.org/) version 18 or higher.

## Installation

1. **Clone the Repository**:

   ```bash
   git clone https://github.com/fernando-apollo/apollo-conn-gen.git
   cd apollo-conn-gen
   ```

2. **Install Dependencies**:

   ```bash
   npm install
   ```

3. **Build the Project**:

   ```bash
   npm run build
   ```

## Running the `cli/oas` tool

To generate an Apollo Connector from your OAS file, run:

```bash
node ./dist/cli/oas <path-to-oas-spec>
```

Replace `<path-to-oas-spec>` with the relative or absolute path to your OAS YAML or JSON file.

### Example with *Petstore*

*Note: the petstore spec can be downloaded from (<https://petstore3.swagger.io>)*

```bash
node ./dist/cli/oas ./tests/resources/petstore.yaml
```

The output should be similar to the following:
![Screenshot showing a list of paths available to generate](./docs/screenshot-01.png)

## Running the `cli/json` tool

To generate an Apollo Connector from a `JSON` (or a set of) file(s) you can use the `json` command:

```bash
node ./dist/cli/json <file|folder>
```

Replace `<file|folder>` with a path to a `JSON` file or a folder that contains `JSON` files.

#### Additional JSON CLI Examples

```bash
# Generate only types and save to file
node ./dist/cli/json ./tests/resources/json/test/test.json --schema-types --output-file types.graphql

# Generate selection set for debugging
node ./dist/cli/json ./tests/resources/json/test/merge/ --selection-set

# Use a custom Federation version
node ./dist/cli/json ./tests/resources/json/test/test.json --federation-version v2.13
```

### Example with the following `JSON` payload

If we have a file `tests/resources/json/preferences/user/50.json` with the following contents:

```json
{
  "userId": 50,
  "favouriteTeams": ["Luton"],
  "favouriteLeagues": [
    "premier-league",
    "championship",
    "scottish-premiership"
  ],
  "joiningDate": "2023-12-11"
}
```

Then running the tool with

```shell
node ./dist/cli/json tests/resources/json/preferences/user/50.json
```

Will result in the following Apollo connector schema:

```graphql
extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.14", import: ["@key"])
  @link(
    url: "https://specs.apollo.dev/connect/v0.4"
    import: ["@connect", "@source"]
  )
  @source(name: "api", http: { baseURL: "http://localhost:4010" })

scalar JSON

type Root {
 userId: Int
 favouriteTeams: [String]
 favouriteLeagues: [String]
 joiningDate: String
}


type Query {
  root: Root
    @connect(
      source: "api"
      http: { GET: "/test" }
      selection: """
       userId
       favouriteTeams
       favouriteLeagues
       joiningDate
      """
    )}
```

## Using the `apollo-conn-gen` library

The library provides two entry classes:

- `OasGen`, for generating from OAS specifications, and
- `JsonGen` for working with `JSON` files

### Installation for JS/TS projects

In your project, run to install the library:

```shell
npm i apollo-conn-gen@latest
```

Next, in your JS/TS file, you can import the tools using

```typescript
import { OasGen } from "apollo-conn-gen/oas"
import { JsonGen } from "apollo-conn-gen/json"
```

### OasGen Library Usage Examples

```typescript
// Basic usage - load and process an OAS file
const gen = await OasGen.fromFile('./petstore.yaml', {
  skipValidation: false,
  showParentInSelections: false,
  federationVersion: 'v2.14',
  connectorSpecVersion: 'v0.4',
  skipOptionalArgs: false  // Include all query parameters (default)
});

// Process the specification to build internal structures
await gen.visit();

// Generate schema for all available paths
const allPaths = Array.from(gen.paths.values()).map(p => p.path() + '>**');
const fullSchema = gen.generateSchema(allPaths);
console.log(fullSchema);

// Generate schema for specific selections
const specificPaths = [
  'get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:scalar:id',
  'get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:scalar:name'
];
const customSchema = gen.generateSchema(specificPaths);

// Get type information without generating full schema
const types = gen.getTypes(specificPaths);

// Load from data buffer instead of file
const fileBuffer = fs.readFileSync('./api-spec.yaml');
const genFromData = await OasGen.fromData(fileBuffer, { skipValidation: true });
```

### OasGen options

All options are optional unless noted. They can be passed to `OasGen.fromFile` / `OasGen.fromData`:

| Option | Type | Default | Description |
|---|---|---|---|
| `skipValidation` | `boolean` | `false` | Skip OAS validation before generating. |
| `baseURL` | `string` | `servers[0]` from the spec | Override the `@source` base URL. |
| `federationVersion` | `string` | `v2.14` | Federation version for the `@link` URL (`>= v2.13`). |
| `connectorSpecVersion` | `string` | `v0.4` | Connector spec version (only `v0.4` is supported). |
| `overrides` | `Record<string, RequestOverride>` | — | Per-operation request rewiring, keyed by op id. See [Request overrides](#request-overrides). |
| `batch` | `BatchConfig` | — | Batch endpoints, keyed by op id. See [Batch endpoints](#batch-endpoints). |
| `mapper` | `Mapper` | — | Operation name mapper. See [Transform Rules](#transform-rules). |
| `skipOptionalArgs` | `boolean` | `false` | Omit optional query parameters from generated operations. |
| `inferEntityResolvers` | `boolean` | `false` | Infer entity resolvers and emit `@key` / `entity: true`. |
| `emitConnectorErrors` | `boolean` | `false` | Emit an `errors { message extensions { statusCode: $status } }` block for operations that document HTTP error responses (library-only, no CLI flag). |
| `skipAuth` | `boolean` | `false` | Omit all auth: no headers on `@source`, no auth on `@connect`. |
| `showParentInSelections` | `boolean` | `false` | Annotate selection output with the parent each field comes from (debugging aid). |

### Security schemes and auth

When the spec declares `securitySchemes` (API key, HTTP bearer/basic, OAuth2), the generator maps them to connector auth automatically: headers or query params with `{$config.*}` placeholders, emitted on `@source` when the whole spec shares the same security, or per-operation on `@connect` when it varies. Pass `skipAuth: true` (CLI: `--skip-auth`) to omit all of it.

### JsonGen Library Usage Examples

```typescript
// Generate from a single JSON string
const jsonData = '{"user": {"id": 1, "name": "John", "email": "john@example.com"}}';
const jsonGen = JsonGen.fromReader(jsonData, {
  federationVersion: 'v2.14',
  connectorSpecVersion: 'v0.4',
  rootType: 'User',           // optional: customizes root type (default: 'Root'), use '[User]' for list
  baseURL: 'https://api.example.com', // optional: @source baseURL (default: 'http://localhost:4010')
  relativePath: '/users',     // optional: @connect HTTP path (default: '/test')
  queryField: 'allUsers',    // optional: query field name (default: derived from rootType)
});

// Generate full Apollo Connector schema
const connectorSchema = jsonGen.generateSchema();
console.log(connectorSchema);

// Generate only GraphQL types
const typesOnly = jsonGen.writeTypes();
console.log(typesOnly);

// Generate only the selection set
const selectionOnly = jsonGen.writeSelection();
console.log(selectionOnly);

// Generate from multiple JSON files/strings
const multipleJsons = [
  '{"product": {"id": 1, "name": "Widget"}}',
  '{"product": {"id": 2, "price": 19.99}}'
];
const multiGen = JsonGen.fromJsons(multipleJsons);
const mergedSchema = multiGen.generateSchema();

// Add JSON data to existing generator
const gen = JsonGen.new();
gen.walkJson('{"order": {"id": 1, "total": 50.00}}');
gen.walkJson('{"order": {"id": 2, "items": ["book", "pen"]}}');
const combinedSchema = gen.generateSchema();
```

### Advanced Library Features

#### OasGen Advanced Methods

Beyond the basic usage, `OasGen` provides additional methods for advanced use cases:

```typescript
const gen = await OasGen.fromFile('./api.yaml');
await gen.visit();

// Find a node by its full path (expands lazily as it walks)
const foundType = gen.find('get:/pet/{petId}>res:r>obj:type:#/c/s/Pet');

// Get type information without generating full schema
const typeMap = gen.getTypes(['get:/pet/{petId}>**']);
console.log('Available types:', Array.from(typeMap.keys()));

// Get expanded selections for debugging
const expandedPaths = gen.expanded(['get:/pet/{petId}>**']);
console.log('Expanded paths:', expandedPaths);

// Synchronous processing (for smaller specs)
gen.visitSync(); // Alternative to async visit()
```

#### JsonGen Advanced Capabilities

The `JsonGen` class supports incremental JSON processing and multiple output formats:

```typescript
// Incremental JSON processing
const gen = JsonGen.new({
  rootType: 'User',           // optional: root type becomes 'User', nested types become 'UserAddress', etc.
  baseURL: 'https://api.example.com',
  relativePath: '/users',
});

// Add JSON data incrementally (merges structures)
gen.walkJson('{"user": {"id": 1, "name": "John"}}');
gen.walkJson('{"user": {"email": "john@example.com", "age": 30}}');
gen.walkJson('{"product": {"id": 1, "title": "Widget"}}');

// The final schema will include merged user type and product type
const mergedSchema = gen.generateSchema();

// Different output modes for different use cases
const typesOnly = gen.writeTypes();      // GraphQL types without connectors
const selectionsOnly = gen.writeSelection(); // Selection sets for debugging
const fullSchema = gen.generateSchema();     // Complete Apollo Connector schema
```

#### Modular Imports

The library supports modular imports for smaller bundle sizes:

```typescript
// Import only what you need
import { OasGen } from 'apollo-conn-gen/oas';
import { JsonGen } from 'apollo-conn-gen/json';

// Or import from main module
import { OasGen, JsonGen } from 'apollo-conn-gen';

// Advanced: transform rules and JSON writers
import { RulesLoader, OpNameMapper } from 'apollo-conn-gen/oas';
import { StringWriter, ConnectorWriter } from 'apollo-conn-gen/json';
```

## Additional details

### Detailed usage for the `oas` CLI

Navigate using the `arrow` keys and select the fields you want to include in the generated connector schema using the 'x' key. Other options are:

- `a` to select all fields in the current type, or
- `n` key to deselect all fields.

Once you've made your selection, press the `Enter` key to generate the Apollo Connector.

Here's an example of the output when selecting all the fields from `[GET] /pet/{petId}`:

```graphql
extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.14", import: ["@key"])
  @link(
    url: "https://specs.apollo.dev/connect/v0.4"
    import: ["@connect", "@source"]
  )
  @source(name: "api", http: { baseURL: "https://petstore3.swagger.io/api/v3" })


scalar JSON

type Category {
  id: Int
  name: String
}

type Pet {
  category: Category
  id: Int
  name: String!
  photoUrls: [String]!
  "pet status in the store"
  status: PetStatus
  tags: [Tag]
}

type Tag {
  id: Int
  name: String
}

enum PetStatus {
 available,
 pending,
 sold
}

type Query {
  """
  Returns a single pet Find pet by ID (/pet/{petId})
  """
  petByPetId(petId: Int!): Pet
    @connect(
      source: "api"
      http: {
        GET: "/pet/{$args.petId}"
        headers: [
          { name: "api_key", value: "{$config.apiKey}" }
        ]
      }
      selection: """
      category {
       id
       name
      }
      id
      name
      photoUrls
      status
      tags {
       id
       name
      }
      """
    )
}
```

Note the `api_key` header: petstore declares an `apiKey` security scheme, which the generator maps to a `{$config.apiKey}` placeholder automatically (see [Security schemes and auth](#security-schemes-and-auth)).

## Options

- `-i, --skip-validation`: Skip the validation step (default: `false`).
- `-n, --skip-selection`: Generate all filtered paths without prompting for selection (default: `false`).
- `-l, --list-paths`: Only list the paths that can be generated (default: `false`).
- `-g, --grep <regex>`: Filter the list of paths with the passed expression (default: `*`).
- `-p, --page-size <num>`: Number of rows to display in selection mode (default: `10`).
- `-s, --load-selections <file>`: Load a JSON file with field selections (other options are ignored).
- `-v, --verbose`: Log all messages from generator.
- `-m, --print-selections`: Print selections from generator.
- `-t, --transform-rules <file>`: Load transform rules from a JSON file to apply multiple name transformations.
- `--federation-version <version>`: Federation version to use (default: `v2.14`).
- `--connector-spec-version <version>`: Connector spec version to use (default: `v0.4`, the only supported value).
- `--skip-optional-args`: Skip optional arguments in queries (default: `false`).
- `--base-url <url>`: Override the `@source` base URL (default: `servers[0]` from the spec).
- `--overrides <file>`: Load per-operation request overrides from a JSON file, keyed by op id. See [Request overrides](#request-overrides).
- `--batch <file>`: Load batch endpoints (op id -> `{ maxSize? }`) from a JSON file. See [Batch endpoints](#batch-endpoints).
- `--infer-entity-resolvers`: Infer entity resolvers and emit `@key` / `entity: true` (default: `false`).
- `--skip-auth`: Omit all auth — no headers on `@source`, no auth on `@connect` (default: `false`).

For a complete list of options, run:

```bash
node ./dist/cli/oas -h
```

### Request overrides

`--overrides <file>` (library: the `overrides` option) loads per-operation request overrides from a JSON file, keyed by op id. `path` replaces the HTTP path; `queryParams` values are raw JSONSelection, `headers` values are string templates — in both, a string replaces the inferred value, `null` drops the entry, an unknown key is appended:

```json
{
  "get:/pets/{id}": {
    "path": "/v2/pets/{id}",
    "queryParams": { "page": null, "api-version": "$(\"2024-01\")" },
    "headers": { "X-Api-Key": "{$config.apiKey}" }
  },
  "post:/pets": {
    "body": "name: $args.input.name\nsource: $(\"web\")"
  }
}
```

`body` is one raw JSONSelection string replacing the whole inferred `$args.input { … }` mapping (`null` drops the body).

An override key that matches no operation is ignored with a warning.

### Batch endpoints

`--batch <file>` (library: the `batch` option) marks operations as batch endpoints, keyed by op id. The only knob is the batch size cap; the entity, key, request and selection are all inferred. `{}` or `null` means defaults:

```json
{
  "post:/products/batch": { "maxSize": 50 },
  "post:/users/lookup": {}
}
```

A batch endpoint is emitted as a type-level `@connect` using `$batch`, letting the router resolve N entities in one request instead of N.

### Entity inference

With `--infer-entity-resolvers` (library: `inferEntityResolvers`), operations whose path parameters match fields of the returned type qualify as entity resolvers: the generator emits the type-level `@connect` with `$this` bindings (or `entity: true`) and the matching `@key`, so other subgraphs can reference the entity.

### Transform Rules

The tool supports loading multiple transform rules from a JSON file to apply complex name transformations. This is useful when you need to apply multiple transformations in sequence or maintain a set of consistent naming rules.

#### Transform Rules File Format

Create a JSON file with the following structure:

```json
{
  "description": "Example transform rules for operation names",
  "rules": [
    {
      "pattern": "apiV1(.*)",
      "replacement": "api_v1_$1"
    },
    {
      "pattern": "get(.*)",
      "replacement": "fetch$1"
    },
    {
      "pattern": "([a-z])([A-Z])",
      "replacement": "$1_$2",
      "enabled": false
    }
  ]
}
```

#### Using Transform Rules

```bash
# Apply transform rules from a file
node ./dist/cli/oas petstore.yaml --transform-rules ./transform-rules.json --grep ".*" --skip-selection
```

In library code:

```typescript
import { RulesLoader, OpNameMapper } from 'apollo-conn-gen/oas';

const rules = {
  "description": "Complex API transformation rules",
  "rules": [
    {
      "pattern": "^apiV1(.*)$",
      "replacement": "api_v1_$1",
      "priority": 10,
      "description": "Convert apiV1 prefix to snake_case"
    },
    {
      "pattern": "^get(.*)$",
      "replacement": "fetch$1",
      "priority": 5,
      "description": "Convert get operations to fetch"
    },
    {
      "pattern": "([a-z])([A-Z])",
      "replacement": "$1_$2",
      "priority": 1,
      "enabled": true,
      "description": "Convert camelCase to snake_case"
    }
  ]
};

const mapper = OpNameMapper.fromRules(rules);
const gen = await OasGen.fromFile('./api.yaml', { mapper });

// Results in: apiV1GetUser -> api_v1_GetUser -> api_v1_fetchUser -> api_v1_fetch_user
```

#### Rule Properties

- `pattern`: The regex pattern to match
- `replacement`: The replacement string (supports capture groups like `$1`, `$2`, etc.)
- `description`: Optional description of what the rule does
- `enabled`: Optional boolean to enable/disable the rule (default: `true` - rules are enabled by default)
- `priority`: Optional number to control the order of rule application (higher numbers = higher priority, default: `0`)

Rules are applied in priority order (highest number first), then in the order they appear in the file for rules with the same priority, allowing for complex transformation chains.

### Filtering paths

The tool allows filtering the list of paths using a regular expression. This is useful when you have large specs and only want to generate (or list) a subset. As shown above, you can list all the paths using the `-l` flag:

```shell
node ./dist/cli/oas ./tests/resources/petstore.yaml --list-paths

post:/pet
put:/pet
get:/pet/{petId}
post:/pet/{petId}
del:/pet/{petId}
post:/pet/{petId}/uploadImage
get:/pet/findByStatus
get:/pet/findByTags
get:/store/inventory
post:/store/order
get:/store/order/{orderId}
del:/store/order/{orderId}
post:/user
get:/user/{username}
put:/user/{username}
del:/user/{username}
post:/user/createWithList
get:/user/login
get:/user/logout
```

If you'd like to filter the paths using a regular expression, you can use the `-g` flag. For example, to only list the operations ending with an argument, you can use the following command:

```shell
node ./dist/cli/oas ./tests/resources/petstore.yaml --list-paths --grep "{\\w+}$"

get:/pet/{petId}
post:/pet/{petId}
del:/pet/{petId}
get:/store/order/{orderId}
del:/store/order/{orderId}
get:/user/{username}
put:/user/{username}
del:/user/{username}
```

or, for instance, filtering by a specific path:

```shell
node ./dist/cli/oas ./tests/resources/petstore.yaml --list-paths --grep "/pet/"

get:/pet/{petId}
post:/pet/{petId}
del:/pet/{petId}
post:/pet/{petId}/uploadImage
get:/pet/findByStatus
get:/pet/findByTags
```

### Skipping validation

By default, the tool will validate the OAS specification before generating the Apollo Connector. However, sometimes specifications are not fully compliant with the OAS standard, or you may want to skip this step for other reasons. To do so, simply add the `-i` (or `--skip-validation`) flag to the command.

### Page size

When selecting paths, the tool will display a list of paths with a default page size of `10`. You can change this value using the `-p` (or `--page-size`) flag. For example, to display `40` rows per page, you can use the following command:

```shell
node ./dist/cli/oas ./tests/resources/petstore.yaml --page-size 40
```

## Generating a connector from an existing selection set

When a connector is generated, the tool also outputs the list of selected fields as paths. This list can then be used to generate a connector from a file without the need to select the fields again.

To do so, save the output to a file in `JSON` format and run the tool with the `-s` (or `--load-selections`) flag and the path to the file.

Selection paths are `>`-separated node ids; `#/c/s/` is shorthand for `#/components/schemas/`.

### Example

File: `tests/resources/sample-petstore-selection.json`:

```json
[
  "get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:scalar:id",
  "get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:scalar:name",
  "get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:array:#photoUrls",
  "get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:enum:status"
]
```

Running the following command:

```shell
node ./dist/cli/oas -s tests/resources/sample-petstore-selection.json tests/resources/petstore.yaml
```

will output the following:

```graphql
extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.14", import: ["@key"])
  @link(
    url: "https://specs.apollo.dev/connect/v0.4"
    import: ["@connect", "@source"]
  )
  @source(name: "api", http: { baseURL: "https://petstore3.swagger.io/api/v3" })


scalar JSON

type Pet {
  id: Int
  name: String!
  photoUrls: [String]!
  "pet status in the store"
  status: PetStatus
}

enum PetStatus {
 available,
 pending,
 sold
}

type Query {
  """
  Returns a single pet Find pet by ID (/pet/{petId})
  """
  petByPetId(petId: Int!): Pet
    @connect(
      source: "api"
      http: {
        GET: "/pet/{$args.petId}"
        headers: [
          { name: "api_key", value: "{$config.apiKey}" }
        ]
      }
      selection: """
      id
      name
      photoUrls
      status
      """
    )
}
```

## Using wildcards in selection sets

The tool supports the use of wildcards in selection sets. For example, to select all fields in a `type`, you can use the `*` character. For example, the two selection sets below will produce the same result:

`./tests/resources/sample-petstore-selection.json`:

```json
[
  "get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:scalar:id",
  "get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:scalar:name",
  "get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:array:#photoUrls",
  "get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:enum:status"
]
```

`./tests/resources/wildcard-petstore-selection.json`:

```json
[
  "get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>*"
]
```

Note that using wildcards only works for *scalar* (and enum) fields.

### Selecting everything under a specific selection path

The tool also supports selecting everything under a specific path. For example, if we wanted to select everything for the operation `get:/pet/{petId}`, then all we need to do is use a selection like so (note the double `*` at the end):

```json
[
  "get:/pet/{petId}>**"
]
```

With this, the tool will generate the whole schema under that path — including nested object types like `Category` and `Tag`:

```shell
node dist/cli/oas -s ./tests/resources/double-wildcard-petstore-selection.json ./tests/resources/petstore.yaml
```

This is particularly useful for specifications that are bound to change often.

## Skipping Optional Arguments

The `--skip-optional-args` option allows you to generate cleaner schemas by excluding optional query parameters from the generated GraphQL operations. This is useful when:
- You have APIs with many optional query parameters that clutter the schema
- You want to generate a minimal schema focusing on required parameters only
- You need to reduce the complexity of the generated GraphQL operations

### Example

Without `--skip-optional-args` (default behavior):
```bash
node ./dist/cli/oas ./api-spec.yaml
```

Generated query might include all parameters:
```graphql
type Query {
  searchProducts(
    category: String!    # required
    minPrice: Float      # optional
    maxPrice: Float      # optional
    sortBy: String       # optional
    limit: Int           # optional
    offset: Int          # optional
  ): [Product]
}
```

With `--skip-optional-args`:
```bash
node ./dist/cli/oas ./api-spec.yaml --skip-optional-args
```

Generated query includes only required parameters:
```graphql
type Query {
  searchProducts(
    category: String!    # required only
  ): [Product]
}
```

This option applies to all query parameters across all operations in your OpenAPI specification.

## OpenAPI `additionalProperties` Support

The tool fully supports OpenAPI `additionalProperties` for handling map/dictionary patterns in your schemas. When an object type uses `additionalProperties`, it gets converted into a GraphQL-compatible key-value array structure.

### How it works

OpenAPI schemas with `additionalProperties` like this:

```yaml
VehicleComponentTree:
  type: object
  additionalProperties:
    $ref: "#/components/schemas/VehicleComponent"
```

Are automatically converted to GraphQL types like this:

```graphql
type VehicleComponentTree {
  vehicleComponents: [VehicleComponentsEntry]!
}

type VehicleComponentsEntry {
  key: String
  value: VehicleComponent
}
```

### Supported patterns

- **Object maps**: `additionalProperties` pointing to object references
- **Array maps**: `additionalProperties` containing arrays of objects
- **Scalar maps**: `additionalProperties` with primitive types
- **Empty schemas**: `additionalProperties: {}` (treated as JSON)

### GraphQL structure

Each map is converted to an array of entry objects with:
- `key: String` - The map key
- `value: <Type>` - The map value (can be objects, arrays, or scalars)

This allows GraphQL clients to work with map data while maintaining type safety and GraphQL schema compatibility.

## Development and Testing

### Testing a local Supergraph

When running tests, the tool automatically generates a `run-rover.sh` script in the system's temporary directory (`/${TMP_DIR}$/oas-test/run-rover.sh` on Unix systems). This script can be used to start a local supergraph with the generated schema.

The script includes:
- Environment variable validation for `APOLLO_KEY` and `APOLLO_GRAPH_REF`
- Both `rover supergraph compose` and `rover dev` commands
- Helpful error messages if required environment variables are missing

To use the script:

1. **Set your Apollo Studio credentials**:
   ```bash
   export APOLLO_KEY=your_apollo_studio_key
   export APOLLO_GRAPH_REF=your_graph_ref
   ```

2. **Run the generated script**:
   ```bash
   # Navigate to the test directory
   cd /${SYSTEM_TMP_DIR}$/oas-test

   # Make the script executable and run it
   chmod +x run-rover.sh
   ./run-rover.sh
   ```

The script will validate your environment variables and start a local supergraph development server with your generated schema.

### Testing Generated Schemas

```bash
# Run the full suite (node test runner via tsx)
npm test

# Run tests matching a name pattern
node --import tsx/esm --test --test-name-pattern "petstore" tests/all/*.test.ts
```

The test suite includes over 250 test cases covering:
- Basic OAS and JSON generation
- Transform rules and name mapping
- Complex OpenAPI patterns (`allOf`, `oneOf`, unions and interfaces)
- AdditionalProperties and map handling
- Security schemes, entity inference, batch endpoints and request overrides
- Circular reference detection
- Error handling and validation

## Generating all paths

Whilst this option is not recommended for large specifications, you can generate all paths without prompting for a specific selection. To do so, you can use the `-n` (or `--skip-selection`) flag. This may result in a very large Apollo Connector schema, might take a long time to process and not be particularly useful, so use with caution.

## Building the library

The project is built with plain `tsc`:

```shell
npm run build
```

Which outputs everything under the `./dist` folder, including the `cli/oas` and `cli/json` entry points and the type declarations consumed by the `apollo-conn-gen` package exports (`.`, `./oas`, `./json`).

### Detailed usage for the `cli/json` tool

```shell
node ./dist/cli/json -h
Usage: json [options] <file|folder>

Arguments:
  file|folder              A single JSON file or a folder with a collection of JSON files

Options:
  -V, --version                            output the version number
  -s --schema-types                        Output the GraphQL schema types (default: false)
  -e --selection-set                       Output the Apollo Connector selection set (default: false)
  -o --output-file <file>                  Where to write the output (default: "stdout")
  --federation-version <version>           Federation version to use (default: v2.14)
  --connector-spec-version <version>       Connector spec version to use (default: v0.4)
  --root-type <name>                       Root type name, use [Name] for list (default: Root)
  --base-url <url>                         Base URL for the @source directive (default: http://localhost:4010)
  --relative-path <path>                   Relative path for the @connect directive (default: /test)
  --query-field <name>                     Query field name (default: derived from root type)
  -v --verbose                             Log all messages from generator (default: false)
  -h, --help                               display help for command
```

The CLI options affect what is generated by the tool. There are three possibilities:

- generate the whole connector schema,
- generate only the types for the schema, or
- generate the selection set

The `-o` (or `--output-file`) allows sending the output to a file instead of the console.
