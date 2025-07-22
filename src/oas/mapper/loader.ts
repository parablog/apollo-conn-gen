import fs from 'fs';
import { MapRules as MapRules, MapRule } from './types.js';

export class RulesLoader {
  public static fromFile(filePath: string): MapRules {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Transform rules file not found: ${filePath}`);
    }

    const content: string = fs.readFileSync(filePath, 'utf-8');
    return RulesLoader.fromString(content);
  }

  public static fromString(json: string): MapRules {
    const rules: MapRules = JSON.parse(json);

    // Validate the structure
    if (!rules.rules || !Array.isArray(rules.rules)) {
      throw new Error('Invalid transform rules: missing or invalid "rules" array');
    }

    // Validate each rule
    rules.rules.forEach((rule: MapRule, index: number) => {
      if (!rule.pattern || typeof rule.pattern !== 'string') {
        throw new Error(`Invalid rule at index ${index}: missing or invalid "pattern"`);
      }
      if (!rule.replacement || typeof rule.replacement !== 'string') {
        throw new Error(`Invalid rule at index ${index}: missing or invalid "replacement"`);
      }
    });

    return rules;
  }
}
