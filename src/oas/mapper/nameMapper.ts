import { MapRules as MapRules, Mapper } from './types.js';

export class OpNameMapper implements Mapper {
  private rules: { regex: RegExp; replacement: string }[];

  constructor(rules: MapRules) {
    this.rules = rules.rules
      .filter((rule) => rule.enabled !== false)
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)) // Higher priority first
      .map((rule) => {
        try {
          return {
            regex: new RegExp(rule.pattern),
            replacement: rule.replacement,
          };
        } catch (error) {
          console.warn(`Invalid regex pattern "${rule.pattern}": ${error}`);
          return null;
        }
      })
      .filter((rule): rule is { regex: RegExp; replacement: string } => rule !== null);
  }

  public operationName(name: string): string {
    let mappedName = name;

    for (const rule of this.rules) {
      mappedName = mappedName.replace(rule.regex, rule.replacement);
    }

    return mappedName;
  }

  public static fromRules(rules: MapRules): OpNameMapper {
    return new OpNameMapper(rules);
  }

  public static fromPattern(pattern: string): OpNameMapper {
    const [regexPattern, replacement] = pattern.split(':');
    const rules: MapRules = {
      rules: [
        {
          pattern: regexPattern,
          replacement: replacement || '$1',
        },
      ],
    };
    return new OpNameMapper(rules);
  }
}
