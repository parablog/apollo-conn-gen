/**
 * Utility functions for name manipulation.
 */
import _ from 'lodash';

const PROTECTED_NAMES = ['$'];

function capitaliseParts(cleanedPath: string, splitChar: string): string {
  // Split the string using a regular expression based on splitChar.
  const parts = cleanedPath.split(new RegExp(splitChar));
  let formattedPath = '';
  for (const part of parts) {
    if (part) {
      // Capitalize the first letter of each part
      formattedPath += upperFirst(part);
    }
  }
  return formattedPath;
}

function lowerFirst(s: string): string {
  if (!s) return s;
  return _.lowerFirst(s);
}

export function genParamName(param: string): string {
  // Split on any run of non-alphanumeric characters, camelCase the parts, then guarantee
  // a valid GraphQL identifier: non-empty and not starting with a digit.
  const camel = lowerFirst(capitaliseParts(param || '', '[^A-Za-z0-9]+'));
  if (camel.length === 0) {
    return '_';
  }
  return /^[0-9]/.test(camel) ? '_' + camel : camel;
}

// Private helper; not exported.
function formatPath(path: string, parameters: string[]): string {
  if (!path || path.length === 0) {
    return path;
  }
  // Remove parameters enclosed in `{}`.
  const cleanedPath = path.replace(/\{[^}]*\}/g, parameters.join(''));
  // First, capitalize parts split by "[:\-\.]+".
  const interim = capitaliseParts(cleanedPath, '[:\\-\\.]+');
  // Then, split by "/" and capitalize each part.
  return capitaliseParts(interim, '/');
}

export function sanitiseField(name: string): string {
  const fieldName = name.startsWith('@') ? name.substring(1) : name;
  return genParamName(fieldName);
}

export function sanitiseFieldForSelect(name: string): string {
  const fieldName = name.startsWith('@') ? name.substring(1) : name;
  const sanitised = genParamName(fieldName);
  if (sanitised === name && !isProtected(name)) {
    return sanitised;
  }
  // Alias: safe GraphQL field <- original JSON key, bare when it is an identifier, `$."key"` when
  // not — a plain quoted key after an alias is a string LITERAL under connect/v0.4. see #62
  // e.g. (stats/fixtures) `ko_time` -> `koTime: ko_time`, not `koTime: "ko_time"`
  const original = name.startsWith('@') ? name : fieldName;
  // a key starting with `null`, or exactly `true`/`false`, reads as a literal and takes the path form
  // e.g. (omni) `null_sort` would read as `null` plus a stray `_sort`. see docs/FIXED.md #62, #82
  const isBareKey = /^[_A-Za-z][_0-9A-Za-z]*$/.test(original) && !/^null|^(true|false)$/.test(original);

  // the key keeps its own spelling when it is a safe identifier, else becomes a quoted path step
  // e.g. (r3-edge-cases) `_id` -> `id: _id`, `full name` -> `fullName: $."full name"`
  const key = isBareKey ? original : `$."${escapeSelectionKey(original)}"`;
  return `${sanitised}: ${key}`;
}

// Escape for the router's string literal: backslash escapes the next char, `\n` is newline,
// every other escaped char maps to itself. NOT JSON escaping — `\t` would read as a bare `t`.
// e.g. a `say "hi"` key -> `$."say \"hi\""`, `back\slash` -> `$."back\\slash"`
function escapeSelectionKey(key: string): string {
  return key.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

export function upperFirst(s: string): string {
  if (!s) return s;
  return _.upperFirst(s);
}

export function genArrayItems(name: string): string {
  return upperFirst(genParamName(name)) + 'Item';
}

export function isProtected(name: string): boolean {
  return PROTECTED_NAMES.includes(name);
}
