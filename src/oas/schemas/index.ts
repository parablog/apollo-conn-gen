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
            description: 'A synthetic response used when an operation returns no value. ' +
              'Set to "true" in the connector selection.',
            type: 'boolean',
            default: 'true',
          },
        },
      },
    },
  },
};
