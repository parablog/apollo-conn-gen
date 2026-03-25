/* eslint-disable @typescript-eslint/no-explicit-any */
import _ from 'lodash';
import { DEFAULT_VERSIONS } from '../../versions.js';
import { ConnectorWriter, JsonArray, JsonContext, JsonObj, JsonScalar, JsonType, StringWriter } from '../index.js';
import { trace, warn } from './log/trace.js';
import { sanitiseField } from './naming.js';

export interface JsonGenOptions {
  federationVersion?: string;
  connectorSpecVersion?: string;
  rootType?: string;
  baseURL?: string;
  relativePath?: string;
}

export class JsonGen {
  private readonly context: JsonContext;
  private readonly options: JsonGenOptions;

  // Private constructor
  private constructor(options: JsonGenOptions = {}) {
    this.context = new JsonContext();
    this.options = {
      federationVersion: DEFAULT_VERSIONS.federationVersion,
      connectorSpecVersion: DEFAULT_VERSIONS.connectorSpecVersion,
      ...options,
    };
  }

  public getContext(): JsonContext {
    return this.context;
  }

  public static new(options?: JsonGenOptions): JsonGen {
    return new JsonGen(options);
  }

  // Factory method from a JSON string
  public static fromReader(json: string, options?: JsonGenOptions): JsonGen {
    const walker = new JsonGen(options);
    walker.walkJson(json);
    return walker;
  }

  public static fromJsons(jsons: string[], options?: JsonGenOptions): JsonGen {
    const walker = new JsonGen(options);
    for (const json of jsons) {
      walker.walkJson(json);
    }
    return walker;
  }

  public generateSchema(): string {
    const writer = new StringWriter();
    ConnectorWriter.write(this, writer, this.options);
    return writer.flush();
  }

  // Writes selection using a given Writer
  public writeSelection(indent: number = 6): string {
    const writer = new StringWriter();
    this.context.setIndent(indent);

    const types = this.context.getTypes();
    const root = types.find((t: JsonType) => t.getParent() === null);
    if (root) {
      root.select(this.context, writer);
    }

    return writer.flush();
  }

  // Writes all types in order using the provided Writer
  public writeTypes(): string {
    const writer = new StringWriter();

    const types = this.context.getTypes();
    const root = types.find((t: JsonType) => t.getParent() === null);
    if (root) {
      const orderedSet = new Set<JsonType>();
      this.writeType(root, orderedSet);

      const generatedSet = new Map<string, JsonType>();
      orderedSet.forEach((t) => {
        // Assumes t is an Obj
        const obj = t as unknown as JsonObj;
        let typeName = obj.getType();
        if (generatedSet.has(typeName)) {
          // If same type, skip generation
          if (_.isEqual(obj, generatedSet.get(typeName))) {
            return;
          }
          obj.setType(JsonGen.generateNewObjType(generatedSet, t, typeName));
          typeName = obj.getType();
        }
        t.write(this.context, writer);
        generatedSet.set(typeName, t);
      });

      console.log('orderedSet =', Array.from(orderedSet));
    }

    return writer.flush();
  }

  // Recursive helper to order types
  private writeType(type: JsonType, orderedSet: Set<JsonType>): void {
    if (type instanceof JsonObj) {
      // Traverse children first
      for (const child of Array.from((type as JsonObj).getFields().values())) {
        this.writeType(child, orderedSet);
      }
      orderedSet.add(type);
    } else if (type instanceof JsonArray) {
      const arrayType = (type as JsonArray).getArrayType();
      if (arrayType) {
        this.writeType(arrayType, orderedSet);
      }
    }
  }

  // Walk the JSON provided as a string
  public walkJson(json: string): void {
    const rootElement = JSON.parse(json);
    const rootName = (this.options.rootType ?? 'root').replace(/^\[|]$/g, '');
    this.walkElement(this.context, null, rootName, rootElement);
    trace(this.context, '   [walkSource]', 'types found: ' + this.context.getTypes().length);
  }

  // Walk an element in the JSON tree
  private walkElement(context: JsonContext, parent: JsonType | null, name: string, element: any): JsonType {
    trace(context, '-> [walkElement]', 'in: ' + name);
    let result: JsonType;

    if (typeof element === 'object' && !Array.isArray(element) && element !== null) {
      // JSON object
      result = this.walkObject(context, parent, name, element);
      context.store(result);
    } else if (Array.isArray(element)) {
      result = this.walkArray(context, parent, name, element);
    } else if (typeof element === 'string' || typeof element === 'number' || typeof element === 'boolean') {
      result = this.walkPrimitive(context, parent, name, element);
    } else if (element === null) {
      // we'll treat null as a string
      result = this.walkPrimitive(context, parent, name, 'string');
    } else {
      throw new Error("Cannot yet handle '" + name + "' of type " + typeof element);
    }

    trace(context, '<- [walkElement]', 'out: ' + name);
    return result;
  }

  // Walk a JSON object
  private walkObject(context: JsonContext, parent: JsonType | null, name: string, object: any): JsonObj {
    trace(context, '-> [walkObject]', 'in: ' + name);
    const result = new JsonObj(name, parent);
    const fieldSet = Object.keys(object);
    trace(context, '  [walkObject]', 'fieldSet: ' + fieldSet);

    for (const field of fieldSet) {
      trace(context, '  [walkObject]', 'field: ' + field);
      const childElement = object[field];
      const type = this.walkElement(context, result, field, childElement);
      result.add(field, type);
    }

    trace(context, '<- [walkObject]', 'out: ' + name);
    return result;
  }

  // Walk a JSON array
  private walkArray(context: JsonContext, parent: JsonType | null, name: string, array: any[]): JsonArray {
    trace(context, '-> [walkArray]', 'in: ' + name);
    const result = new JsonArray(name, parent);
    if (array.length > 0) {
      const firstElement = array[0];
      const arrayType = this.walkElement(context, parent, name, firstElement);
      result.setArrayType(arrayType);
    } else {
      warn(context, '   [walkArray]', "Array is empty -- cannot derive type for field '" + name + "'");
    }
    trace(context, '-> [walkArray]', 'in: ' + name);
    return result;
  }

  // Walk a primitive JSON value
  private walkPrimitive(_context: JsonContext, parent: JsonType | null, name: string, primitive: any): JsonScalar {
    let result: JsonScalar;
    if (typeof primitive === 'string') {
      result = new JsonScalar(name, parent, 'String');
    } else if (typeof primitive === 'boolean') {
      result = new JsonScalar(name, parent, 'Boolean');
    } else if (typeof primitive === 'number') {
      result = new JsonScalar(name, parent, 'Int');
    } else {
      throw new Error('Cannot yet handle primitive: ' + primitive);
    }
    return result;
  }

  // Utility method for naming conflict resolution
  private static generateNewObjType(generatedSet: Map<string, JsonType>, t: JsonType, typeName: string): string {
    let newName: string;
    let type: JsonType | null = t;
    do {
      const parent: JsonType | null = type.getParent();
      const parentName = parent === null ? '' : sanitiseField(parent.getName()).replace(/^\w/, (c) => c.toUpperCase());
      const thisName = sanitiseField(typeName).replace(/^\w/, (c) => c.toUpperCase());
      newName = parentName + thisName;
      type = parent;
    } while (type !== null && generatedSet.has(newName));
    return newName;
  }
}
