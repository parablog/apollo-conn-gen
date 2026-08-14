import _ from 'lodash';
import { ParameterObject } from 'oas/types';
import { Naming } from './naming.js';

// OAS parameter serialization helpers (shared by the operation writer and the R6 batch path).
export class Params {
  // every `{token}` in the path needs a parameter of the same name, because the URL always asks for
  // `{$args.<token>}` — so a parameter is renamed to the token it serves, and a token with nothing
  // declared gets a required String invented for it. see docs/FIXED.md #81
  //   (omni)     `/v1/labels/{labelName}`  declares `name`     -> renamed to `labelName`
  //   (mindbody) `/add-ons/{addOnId}`      declares `addonId`  -> renamed to `addOnId`
  //   (omni)     `/v1/api-keys/{id}`       declares nothing    -> `id: String!` invented
  public static matchToPath(parameters: ParameterObject[], path: string): ParameterObject[] {
    const pathTokens = Params.findPathTokens(path);
    const pathParams = parameters.filter((p) => p.in?.toLowerCase() === 'path');

    const matched = Params.matchPathTokensAndParams(pathTokens, pathParams);
    const unmatchedTokens = pathTokens.filter((token) => !matched.has(token));

    // only where the argument names really differ — a snake-cased `label_name` already serves
    // `{labelName}`, and entity resolvers look up properties by the raw name. see docs/FIXED.md #81
    const renames = new Map(
      Array.from(matched, ([token, param]): [ParameterObject, string] => [param, token]).filter(
        ([p, token]) => Naming.genParamName(p.name) !== Naming.genParamName(token),
      ),
    );

    // we are good, bail
    if (unmatchedTokens.length === 0 && renames.size === 0) {
      return parameters;
    }

    return [
      ...parameters.map((p) => (renames.has(p) ? { ...p, name: renames.get(p)! } : p)),

      // we'll add the unmatched tokens ones as Parameters of type string
      ...unmatchedTokens.map(
        (token) => ({ name: token, in: 'path', required: true, schema: { type: 'string' } }) as ParameterObject,
      ),
    ];
  }

  // finds the `{token}` segments of an OAS path — the `oas` library has nothing that reads them, see #81
  // e.g. (mindbody) `/subscribers/{subscriberId}/add-ons/{addOnId}` -> [subscriberId, addOnId]
  private static findPathTokens(path: string): string[] {
    // an override path may already say `{$args.id}` — that one is the router's, not a spec token
    return Array.from(path.matchAll(/\{([^}]+)\}/g), (match) => match[1]).filter((token) => !token.startsWith('$'));
  }

  // token -> the parameter serving it. both sides are keyed by their argument name ignoring case, so
  // a token takes its parameter out of the pool, and a lone leftover of each can only be a pair.
  // e.g. (mindbody) `{addOnId}` declares `addonId`; (omni) `{labelName}` declares `name`
  private static matchPathTokensAndParams(
    pathTokens: string[],
    pathParams: ParameterObject[],
  ): Map<string, ParameterObject> {
    const matchKey = (name: string): string => Naming.genParamName(name).toLowerCase();
    const pool = new Map(pathParams.map((p) => [matchKey(p.name), p]));

    const matched = new Map<string, ParameterObject>();
    for (const token of pathTokens) {
      const param = pool.get(matchKey(token));
      if (param) {
        matched.set(token, param);
        pool.delete(matchKey(token));
      }
    }

    const leftover = pathTokens.filter((token) => !matched.has(token));
    if (leftover.length === 1 && pool.size === 1) {
      matched.set(leftover[0], [...pool.values()][0]);
    }

    return matched;
  }

  // a non-exploded array param (`?ids=1,2,3`) needs its values joined: `ids->joinNotNull(",")`; an
  // exploded array (the OAS default) works as a plain value, so no join. see ROADMAP R8/R6
  public static arrayJoin(parameter: ParameterObject): string {
    if (_.get(parameter, 'schema.type') !== 'array' || parameter.explode !== false) {
      return '';
    }
    const delimiter = parameter.style === 'spaceDelimited' ? ' ' : parameter.style === 'pipeDelimited' ? '|' : ',';
    return `->joinNotNull("${delimiter}")`;
  }
}
