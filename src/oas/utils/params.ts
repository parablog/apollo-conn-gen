import _ from 'lodash';
import { ParameterObject } from 'oas/types';

// OAS parameter serialization helpers (shared by the operation writer and the R6 batch path).
export class Params {
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
