import { defineConfig } from 'orval'

export default defineConfig({
  trustpass: {
    input: './openapi.json',
    output: {
      mode: 'single',
      target: 'src/api/generated/trustpass.ts',
      schemas: 'src/api/generated/model',
      client: 'react-query',
      clean: true,
      override: {
        header: false,
        mutator: {
          path: './src/api/client.ts',
          name: 'customInstance',
        },
        query: {
          useQuery: true,
          useMutation: true,
        },
      },
    },
  },
})
