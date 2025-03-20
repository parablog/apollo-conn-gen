# Generator library and CLI for Apollo Connectors 

## Introduction

This project is a library designed to generate an an [Apollo Connector](https://www.apollographql.com/graphos/apollo-connectors) schema from either
- an OpenAPI Specification (OAS) file (YAML or JSON), or
- a set of JSON payloads. 

It also includes CLI tools to facilitate this conversion process.

Key features:

* Generates an Apollo Connector from an OAS specification, converting all types and `GET` entry points defined in the spec (*only* `GET` methods are supported for now)
* Generates a schema based on a single or a collection of`JSON` files.

## Prerequisites

* [Node.js](https://nodejs.org/) version 18 or higher. Built using Typescript 5.1.6.

## Installation

1. **Clone the Repository**:

   ```bash
   git clone https://github.com/fernando-apollo/oas-to-connector.git
   cd oas-helpers-to-connector
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
  @link(url: "https://specs.apollo.dev/federation/v2.10", import: ["@key"])
  @link(
    url: "https://specs.apollo.dev/connect/v0.1"
    import: ["@connect", "@source"]
  )
  @source(name: "api", http: { baseURL: "http://localhost:4010" })
  
type Root {
 userId: Int
 favouriteTeams: [String]
 joiningDate: String
 favouriteLeagues: [String]
}

type Query {
  root: Root
    @connect(
      source: "api"
      http: { GET: "/test" }
      selection: """
 userId
 favouriteTeams
 joiningDate
 favouriteLeagues
"""
)}
```

## Using the `apollo-conn-gen` library

The library provides two entry classes:

* `OasGen`, for generating from OAS specifications, and
* `JsonGen` for working with `JSON` files

### Installation for JS/TS projects

In your project, run

```shell
npm i "apollo-conn-gen`
```

to install the library. Next, in your JS/TS file yu can import the tools using

```typescript
import { OasGen } from "apollo-conn-gen/oas"
import { JsonGen } from "apollo-conn-gen/json"
```

## Additional details

### Detailed usage for the `oas` CLI

Navigate using the `arrow` keys and select the fields you want to include in the generated connector schema using the 'x' key. Other options are:

* `a` to select all fields in the current type, or
* `n` key to deselect all fields.

Once you've made your selection, press the `Enter` key to generate the Apollo Connector.

Here's an example of the output when selecting all the fields from `[GET] /pet/{petId`:

```graphql
extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.10", import: ["@key"])
  @link(
    url: "https://specs.apollo.dev/connect/v0.1"
    import: ["@connect", "@source"]
  )
  @source(name: "api", http: { baseURL: "https://petstore3.swagger.io/v3" })

scalar JSON

type Pet {
  category: Category
  id: Int
  name: String
  photoUrls: [String]
  "pet status in the store"
  status: String
  tags: [Tag]
}

type Category {
  id: Int
  name: String
}

type Tag {
  id: Int
  name: String
}

type Query {
  """
  Find pet by ID (/pet/{petId})
  """
  petByPetId(petId: Int!): Pet
    @connect(
      source: "api"
      http: { GET: "/pet/{$args.petId}" }
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

## Options

* `-i, --skip-validation`: Skip the validation step (default: `false`).
* `-n, --skip-selection`: Generate all filtered paths without prompting for selection (default: `false`).
* `-l, --list-paths`: Only list the paths that can be generated (default: `false`).

For a complete list of options, run:

```bash
node ./dist/cli/oas -h
```

### Filtering paths

The tool allows filtering the list of paths using a regular expression. This is useful when you have large specs and only want to generate (or list) a subset. As shown above, you can list all the paths using the `-l` flag:

```shell
node ./dist/cli/oas ./tests/petstore.yaml --list-paths

get:/pet/{petId}
get:/pet/findByStatus
get:/pet/findByTags
get:/store/inventory
get:/store/order/{orderId}
get:/user/{username}
get:/user/login
get:/user/logout
```

If you'd like to filter the paths using a regular expression, you can use the `-g` flag. For example, to only list the operations ending with an argument, you can use the following command:

```shell
node ./dist/cli/oas ./tests/petstore.yaml  --list-paths  --grep "{\\w+}$"

get:/pet/{petId}
get:/store/order/{orderId}
```

or, for instance, filtering by a specific path:

```shell
node ./dist/cli/oas ./tests/petstore.yaml  --list-paths  --grep "/pet/"

get:/pet/{petId}
get:/pet/findByTags
```

### Skipping validation

By default, the tool will validate the OAS specification before generating the Apollo Connector. However, sometimes specifications are not fully compliant with the OAS standard, or you may want to skip this step for other reasons. To do so, simply add the `-i` (or `--skip-validation`) flag to the command.

### Page size

When selecting paths, the tool will display a list of paths with a default page size of `10`. You can change this value using the `-p` (or `--page-size`) flag. For example, to display `40` rows per page, you can use the following command:

```shell
node ./dist/cli/oas ./tests/petstore.yaml  --page-size 40
```

## Generating a connector from an existing selection set

When a connector is generated, the tool also outputs the list of selected fields as paths. This list can then be used to generate a connector from a file without the need to select the fields again.

To do so, save the output to a file in `JSON` format and run the tool with the `-s` (or `--load-selections`) flag and the path to the file.

### Example

File: `tests/sample-petstore-selection.json`:

```json
[
  "get:/pet/{petId}>res:r>ref:#/c/s/Pet>obj:#/c/s/Pet>prop:scalar:id",
  "get:/pet/{petId}>res:r>ref:#/c/s/Pet>obj:#/c/s/Pet>prop:scalar:name",
  "get:/pet/{petId}>res:r>ref:#/c/s/Pet>obj:#/c/s/Pet>prop:array:#photoUrls",
  "get:/pet/{petId}>res:r>ref:#/c/s/Pet>obj:#/c/s/Pet>prop:scalar:status"
]
```

Running the following command:

```shell
  node ./dist/cli/oas -s tests/sample-petstore-selection.json tests/petstore.yaml
```

will output the following:

```graphql
--------------- Apollo Connector schema -----------------
extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.10", import: ["@key"])
  @link(
    url: "https://specs.apollo.dev/connect/v0.1"
    import: ["@connect", "@source"]
  )
  @source(name: "api", http: { baseURL: "https://petstore3.swagger.io/v3" })


scalar JSON

type Pet {
  id: Int
  name: String
  photoUrls: [String]
  "pet status in the store"
  status: String
}

type Query {
  """
  Find pet by ID (/pet/{petId})
  """
  petByPetId(petId: Int!): Pet
    @connect(
      source: "api"
      http: { GET: "/pet/{$args.petId}"
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
  "get:/pet/{petId}>res:r>ref:#/c/s/Pet>obj:#/c/s/Pet>prop:scalar:id",
  "get:/pet/{petId}>res:r>ref:#/c/s/Pet>obj:#/c/s/Pet>prop:scalar:name",
  "get:/pet/{petId}>res:r>ref:#/c/s/Pet>obj:#/c/s/Pet>prop:array:#photoUrls",
  "get:/pet/{petId}>res:r>ref:#/c/s/Pet>obj:#/c/s/Pet>prop:scalar:status"
]
```

`./tests/resources/wildcard-petstore-selection.json`:
```json
[
  "get:/pet/{petId}>res:r>ref:#/c/s/Pet>obj:#/c/s/Pet>*"
]
```

Note that using wildcards only works for *scalar* fields.

### Selecting everything under a specific selection path

The tool also supports selecting everything under a specific path. For example, if we wanted to select everything for the operation `get:/pet/{petId}`, then all we need to do is use a selection like so (note the double `*` at the end):

```json
[
  "get:/pet/{petId}>**"
]
```

With this, the tool will generate the whole schema under that path. Running the following command:

```shell
node dist/cli/oas -s ./tests/resources/double-wildcard-petstore-selection.json ./tests/resources/petstore.yaml
```

will output the following:

```graphql
extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.10", import: ["@key"])
  @link(
    url: "https://specs.apollo.dev/connect/v0.1"
    import: ["@connect", "@source"]
  )
  @source(name: "api", http: { baseURL: "https://petstore3.swagger.io/v3" })


scalar JSON

type Category {
  id: Int
  name: String
}

type Pet {
  category: Category
  id: Int
  name: String
  photoUrls: [String]
  "pet status in the store"
  status: String
  tags: [Tag]
}

type Tag {
  id: Int
  name: String
}

type Query {
  """
  Find pet by ID (/pet/{petId})
  """
  petByPetId(petId: Int!): Pet
    @connect(
      source: "api"
      http: { GET: "/pet/{$args.petId}"
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


This is particularly useful for specifications that are bound to change often.

will select all fields in the `Pet` type:

## Generating all paths

Whilst this option is not recommended for large specifications, you can generate all paths without prompting for a specific selection. To do so, you can use the `-n` (or `--skip-selection`) flag. This may result in a very large Apollo Connector schema, might take a long time to process and not be particularly useful, so use with caution.

## Building the library

The tool can be built as a library to use in other projects. To do this, simply run

```shell
npm run lib
```

Which will build everything under the `./dist` folder:

```shell
ls dist/
index.d.ts       index.esm.js     index.esm.js.map index.js         index.js.map
```

### Detailed usage for the `cli/json` tool

```shell
node ./dist/cli/json -h
Usage: json [options] <file|folder>

Arguments:
  file|folder              A single JSON file or a folder with a collection of JSON files

Options:
  -V, --version            output the version number
  -s --schema-types        Output the GraphQL schema types (default: false)
  -e --selection-set       Output the Apollo Connector selection set (default: false)
  -o --output-file <file>  Where to write the output (default: "stdout")
  -h, --help               display help for command
```

The CLI options affect what is generated by the tool. There are three possibilities:

* generate the whole connector schema,
* generate only the types for the schema, or
* generate the selection set

The `-o` (or `--output-file`) allows sending the output to a file instead of the console.
