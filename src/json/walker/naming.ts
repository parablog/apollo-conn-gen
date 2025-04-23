/**
 * Utility functions for name manipulation.
 */
import _ from 'lodash';

const PROTECTED_NAMES = ['$']

function capitaliseParts(cleanedPath: string, splitChar: string): string {
  // Split the string using a regular expression based on splitChar.
  const parts = cleanedPath.split(new RegExp(splitChar));
  let formattedPath = '';
  for (const part of parts) {
    if (part) {
      // Capitalize the first letter of each part
      formattedPath += upperFirst(part)
    }
  }
  return formattedPath;
}

function lowerFirst(s: string): string {
  if (!s) return s;
  return _.lowerFirst(s)
}

export function genParamName(param: string): string {
  return lowerFirst(capitaliseParts(param, '[\\-_\\.:]'));
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
  } else {
    const needsQuotes = /.*[:_\-.].*/.test(fieldName) || name.startsWith('@') || isProtected(name);
    let builder = sanitised + ': ';
    if (needsQuotes) {
      builder += '"' + (name.startsWith('@') ? name : fieldName) + '"';
    } else {
      builder += name.startsWith('@') ? name : fieldName;
    }
    return builder;
  }
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