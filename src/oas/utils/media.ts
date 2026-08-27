// Media-type questions asked while reading responses and request bodies.
export class Media {
  private static readonly JSON_MEDIA_TYPE = /^application\/(?:.*\+)?json/i;

  // The content key holding a JSON-readable schema: a JSON media type first, else the wildcard —
  // a schema published under "any representation" reads as JSON here. see docs/FIXED.md #175
  //   e.g. (docusign) produces: [] converts to content: { '*/*': { schema: … } } -> read as JSON
  public static findJsonMediaType(keys: string[]): string | undefined {
    return keys.find((k) => Media.JSON_MEDIA_TYPE.test(k)) ?? keys.find((k) => k === '*/*');
  }
}
