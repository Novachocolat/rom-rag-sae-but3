// @ts-check
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

// In this npm-workspaces monorepo, the root node_modules hoists an older
// `cookie` that shadows the one astro itself depends on when its build resolves 
// a bare `cookie` import from outside astro/node_modules/.
const astroDir = new URL('.', import.meta.resolve('astro/package.json'))
const astroCookie = fileURLToPath(new URL('node_modules/cookie', astroDir))

// https://astro.build/config
export default defineConfig({
  vite: {
    resolve: {
      alias: { cookie: astroCookie },
    },
  },
  integrations: [
    starlight({
      title: 'ROM RAG',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/Novachocolat/rom-rag-sae-but3',
        },
      ],
      sidebar: [
        {
          label: 'Getting started',
          items: [{ label: 'Example Guide', slug: 'guides/example' }],
        },
        {
          label: 'Reference',
          items: [{ autogenerate: { directory: 'reference' } }],
        },
      ],
    }),
  ],
})
