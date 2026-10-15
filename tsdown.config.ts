import { defineConfig } from 'tsdown';

/**
 * 宿主提供的包一律不打包（插件运行时由 DSH profile 的解析表提供这些依赖；
 * 打进产物会在同一进程内复制出第二份服务定义）。
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  outDir: 'lib',
  dts: true,
  clean: true,
  deps: {
    neverBundle: [/^@deepseek-ai\//],
  },
});
