import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  outDir: 'lib',
  dts: true,
  clean: true,
  external: [
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-code-runtime',
    '@deepseek-ai/dsh-commands',
    '@deepseek-ai/dsh-llm',
    '@deepseek-ai/dsh-session',
    '@deepseek-ai/dsh-tools',
    '@deepseek-ai/schemastery'
  ]
});
