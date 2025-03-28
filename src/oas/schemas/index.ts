import { ResponseObject } from 'oas/types';

export const APOLLO_SYNTHETIC_OBJ: string = "__apollo_synthetic";

export const SYN_SUCCESS_RESPONSE: ResponseObject = {
  description: 'A default success response.',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        format: APOLLO_SYNTHETIC_OBJ,
        properties: {
          'success': {
            type: 'boolean',
            default: 'true',
          },
        },
      },
    },
  },
};
