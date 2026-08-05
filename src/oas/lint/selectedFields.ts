import type { SelectedField } from './types.js';

export class SelectedFields {
  /**
   * The fields a check is allowed to speak about: everything up to the first one that could not be
   * read. Past that point the reader was guessing, so a complaint would be about the user's
   * half-typed line rather than about their schema.
   *
   * Every check goes through here so the rule cannot drift between them.
   */
  public static readable(fields: SelectedField[]): SelectedField[] {
    const firstUnreadable = fields.findIndex((field) => field.unreadable);
    return firstUnreadable === -1 ? fields : fields.slice(0, firstUnreadable);
  }
}
