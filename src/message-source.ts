/**
 * DSH Script Manager Plugin - Message Source
 *
 * DSH 的 MessageSourceMap 是合并可扩展的，内置来源只覆盖 user / model / tool /
 * system-prompt。插件需要向模型交代"这条消息不是用户说的，而是插件（系统侧）的
 * 说明"时，必须自行登记一个 kind —— 冒充用户发言是被明确禁止的。来源 kind 在
 * 全进程内唯一，故集中在本模块登记。
 */

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'dsh-script-manager': { kind: 'dsh-script-manager' };
  }
}

/** 插件来源标记：系统侧说明，绝不冒充用户发言。 */
export const SCRIPT_MANAGER_SOURCE = { kind: 'dsh-script-manager' } as const;
