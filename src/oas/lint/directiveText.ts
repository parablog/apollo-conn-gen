import type { StringValueNode } from 'graphql';

/**
 * The text inside a `selection:` argument, plus where each character came from.
 *
 * `sdlPositions[i]` is the position in the SDL of the character at `text[i]`, so a name found while
 * reading the selection can be reported against the user's document. There is one extra entry at
 * the end, holding the position just past the text.
 */
export interface DirectiveText {
  text: string;
  sdlPositions: number[];
}

export class DirectiveTextReader {
  // the escapes GraphQL allows in an ordinary "..." string
  private static readonly ESCAPES: Record<string, string> = {
    '"': '"',
    '\\': '\\',
    '/': '/',
    b: '\b',
    f: '\f',
    n: '\n',
    r: '\r',
    t: '\t',
  };

  /**
   * Read a `selection:` argument, remembering where every character sits in the SDL.
   *
   * Indentation is kept. graphql-js strips it from `node.value` for `"""` strings, and using that
   * would put every underline and every fix a few characters to the left.
   */
  public static read(sdl: string, node: StringValueNode): DirectiveText | null {
    if (!node.loc) {
      return null;
    }
    const quoteLength = node.block ? 3 : 1;
    const start = node.loc.start + quoteLength;
    const end = node.loc.end - quoteLength;
    if (end < start) {
      return null;
    }

    const characters: string[] = [];
    const sdlPositions: number[] = [];
    let at = start;

    while (at < end) {
      const character = sdl[at];
      if (character !== '\\') {
        characters.push(character);
        sdlPositions.push(at);
        at += 1;
        continue;
      }
      at = node.block
        ? DirectiveTextReader.readBlockEscape(sdl, at, characters, sdlPositions)
        : DirectiveTextReader.readEscape(sdl, at, characters, sdlPositions);
    }

    sdlPositions.push(end);
    return { text: characters.join(''), sdlPositions };
  }

  // a """ string has one escape: \""" for a literal """
  private static readBlockEscape(sdl: string, at: number, characters: string[], sdlPositions: number[]): number {
    if (sdl.startsWith('\\"""', at)) {
      for (const quote of '"""') {
        characters.push(quote);
        sdlPositions.push(at);
      }
      return at + 4;
    }
    characters.push('\\');
    sdlPositions.push(at);
    return at + 1;
  }

  private static readEscape(sdl: string, at: number, characters: string[], sdlPositions: number[]): number {
    const marker = sdl[at + 1];

    if (marker === 'u') {
      const code = parseInt(sdl.slice(at + 2, at + 6), 16);
      if (!Number.isNaN(code)) {
        for (const character of String.fromCodePoint(code)) {
          characters.push(character);
          sdlPositions.push(at);
        }
        return at + 6;
      }
    }

    const escaped = marker === undefined ? undefined : DirectiveTextReader.ESCAPES[marker];
    if (escaped !== undefined) {
      characters.push(escaped);
      sdlPositions.push(at);
      return at + 2;
    }

    // a backslash on its own, which happens while the user is still typing — keep it and say nothing
    characters.push('\\');
    sdlPositions.push(at);
    return at + 1;
  }
}
