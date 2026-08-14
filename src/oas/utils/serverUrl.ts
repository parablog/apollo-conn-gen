import { ServerObject } from 'oas/types';

// Picks the OAS server to use as the connector's baseURL, e.g.
//   servers: [{ url: '/v1.33' }, { url: 'https://docker.com/1.33' }]
// skips the first one (no host) and uses the second. see docs/FIXED.md #41
export class ServerUrl {
  public static resolve(servers: ServerObject[] | undefined): string {
    for (const server of servers ?? []) {
      const url = ServerUrl.substituteVariables(server);
      // "//host" (no http/https) just needs a scheme added, not a new host
      const normalized = url.startsWith('//') ? `https:${url}` : url;
      if (/^https?:\/\//i.test(normalized)) return normalized;
    }
    return 'http://localhost:4010';
  }

  private static substituteVariables(server: ServerObject): string {
    let url: string = server.url;
    if (server.variables) {
      for (const key in server.variables) {
        url = url.replace('{' + key + '}', server.variables[key].default);
      }
    }
    return url;
  }
}
