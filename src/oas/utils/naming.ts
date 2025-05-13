import _ from 'lodash';
import { Operation } from 'oas/operation';

interface Converter {
  convert(input: string): string;
}

abstract class AbstractConverter implements Converter {
  private next?: Converter;

  constructor(next?: Converter) {
    this.next = next;
  }

  public convert(input: string): string {
    const result = this.process(input);
    return this.next ? this.next.convert(result) : result;
  }

  protected abstract process(input: string): string;
}

class ReplaceBracketsConverter extends AbstractConverter {
  constructor(next: Converter) {
    super(next);
  }

  public process(input: string): string {
    return input.replace(/\[|\]/g, '-');
  }
}

class CapitalisePartsConverter extends AbstractConverter {
  constructor(next: Converter) {
    super(next);
  }

  public process(input: string): string {
    return Naming.capitaliseParts(input, /[-_.]/);
  }
}

class FinalFirstLowerCaseConverter extends AbstractConverter {
  public process(input: string): string {
    return _.lowerFirst(input);
  }
}

class RemoveRefConverter extends AbstractConverter {
  constructor(converter: Converter) {
    super(converter);
  }

  public process(input: string): string {
    let result = input || '';
    if (result.includes('#/components/schemas/')) {
      result = result.replace(/#\/components\/schemas\//g, '');
    }
    if (result.includes('#/components/responses/')) {
      result = result.replace(/#\/components\/responses\//g, '');
    }
    if (result.includes('#/components/parameters/')) {
      result = result.replace(/#\/components\/parameters\//g, '');
    }
    return result;
  }
}

class FinalFirstUpperCaseConverter extends AbstractConverter {
  constructor() {
    super();
  }
  public process(input: string): string {
    return _.upperFirst(input);
  }
}

class FinalConverter extends AbstractConverter {
  protected process(input: string): string {
    return input; // do nothing
  }
}

export class Naming {
  public static genParamName(param: string): string {
    return Naming.PARAM_CONVERTER.convert(param);
  }

  public static genTypeName(name: string): string {
    return Naming.TYPE_CONVERTER.convert(name);
  }

  public static sanitiseField(name: string): string {
    const fieldName = name.startsWith('@') ? name.substring(1) : name;
    return Naming.genParamName(fieldName);
  }

  public static sanitiseFieldForSelect(name: string, isInput: boolean = false): string {
    const fieldName = name.startsWith('@') ? name.substring(1) : name;
    const sanitised = Naming.genParamName(fieldName);
    if (sanitised === name) {
      return sanitised;
    } else {
      const needsQuotes = /[:_\-.]/.test(fieldName) || name.startsWith('@');
      let builder = (isInput ? fieldName : sanitised) + ': ';
      if (needsQuotes) {
        builder += '"';
      }
      builder += name.startsWith('@') ? name : isInput ? sanitised : fieldName;
      if (needsQuotes) {
        builder += '"';
      }
      return builder;
    }
  }

  public static genOperationName(path: string, operation: Operation): string {
    const parameters = operation.hasParameters()
      ? operation
          .getParameters()
          .filter((p) => p.required && p.in.toLowerCase() !== 'header')
          .map((p) => {
            const paramName = Naming.genParamName(p.name);
            return `By${_.upperFirst(paramName)}`;
          })
      : [];

    const result = Naming.formatPath(path, parameters);
    return _.lowerFirst(result);
  }

  public static genArrayItems(name: string): string {
    return _.upperFirst(Naming.genParamName(name)) + 'Item';
  }

  public static getRefName(ref: string): string {
    return ref ? Naming.REF_CONVERTER.convert(ref) : '';
  }

  public static formatPath(path: string, parameters: string[]): string {
    if (!path) {
      return path;
    }

    // Step 1: Remove parameters enclosed in {}.
    const paramsJoined = parameters.join('');
    let cleanedPath = path.replace(/\{[^}]*\}/g, paramsJoined);
    cleanedPath = Naming.capitaliseParts(cleanedPath, /[:\-.+]+/); // using regex similar to "[:\-\.]+"

    // Step 2: Split the path by "/" and capitalize each part.
    const capitalisedParts = Naming.capitaliseParts(cleanedPath, '/');

    // Step 3: Check if the path starts with a number and remove it if so
    // the pattern we are looking for is like so: /2.3.0/entrypoint
    if (/^\d/.test(capitalisedParts)) {
      return capitalisedParts.replace(/^\d+(?=[a-zA-Z])/g, '');
    }

    return capitalisedParts;
  }

  public static capitaliseParts(input: string, splitPattern: RegExp | string): string {
    // If splitPattern is a string, convert it to a RegExp.
    const regex = typeof splitPattern === 'string' ? new RegExp(splitPattern, 'g') : splitPattern;

    // Split the input, capitalize each non-empty part, and join them back together.
    return input
      .split(regex)
      .map((part) => (part ? _.upperFirst(part) : ''))
      .join('');
  }
  private static readonly PARAM_CONVERTER: Converter = new ReplaceBracketsConverter(
    new CapitalisePartsConverter(new FinalFirstLowerCaseConverter()),
  );

  private static readonly TYPE_CONVERTER: Converter = new RemoveRefConverter(
    new CapitalisePartsConverter(new FinalFirstUpperCaseConverter()),
  );

  private static readonly REF_CONVERTER: Converter = new RemoveRefConverter(new FinalConverter());

  // internal stuff
  private static readonly NUMBER_PREFIX = '_';

  public formatPath(path: string, parameters: string[]): string {
    // Replace with your actual formatting logic.
    // This example simply concatenates the parameters to the path.
    return path + parameters.join('');
  }
}
