export const CLAUDE_TOOLS = [
  {
    name: 'bash',
    description: 'Execute a shell command in the task work directory.',
    input_schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Shell command to execute',
        },
        timeout_ms: {
          type: 'number',
          description: 'Max execution time in milliseconds. Defaults to 30000.',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file, creating it if necessary.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'str_replace_file',
    description: 'Replace a specific string in a file.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_str: { type: 'string' },
        new_str: { type: 'string' },
      },
      required: ['path', 'old_str', 'new_str'],
    },
  },
  {
    name: 'fetch_url',
    description: 'Fetch content from a URL via HTTP GET or POST. Returns the response body as text.',
    input_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to fetch',
        },
        method: {
          type: 'string',
          enum: ['GET', 'POST'],
          description: 'HTTP method. Defaults to GET.',
        },
        headers: {
          type: 'object',
          description: 'Optional HTTP headers as key-value pairs.',
          additionalProperties: { type: 'string' },
        },
        body: {
          type: 'string',
          description: 'Request body for POST requests.',
        },
      },
      required: ['url'],
    },
  },
] as const;

export type ClaudeToolName = (typeof CLAUDE_TOOLS)[number]['name'];
