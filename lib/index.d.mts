import Schema from "@deepseek-ai/schemastery";
import { Context } from "@deepseek-ai/cordis";
//#region src/index.d.ts
declare const name = "dsh-script-manager";
declare const inject: string[];
declare const Config: Schema<Schemastery.ObjectS<{
  scriptsDir: Schema<string, string>;
  maxExecutionTime: Schema<number, number>;
  historyEnabled: Schema<boolean, boolean>;
  stateDir: Schema<string, string>;
  historyChangesMax: Schema<number, number>;
  historyRunsMax: Schema<number, number>;
}>, Schemastery.ObjectT<{
  scriptsDir: Schema<string, string>;
  maxExecutionTime: Schema<number, number>;
  historyEnabled: Schema<boolean, boolean>;
  stateDir: Schema<string, string>;
  historyChangesMax: Schema<number, number>;
  historyRunsMax: Schema<number, number>;
}>>;
/** 插件配置输出类型：由 Config schema 的调用签名推导（Schema 可调用并返回解析后的对象）。 */
type Config = ReturnType<typeof Config>;
declare function apply(ctx: Context, config?: Partial<Config>): void;
//#endregion
export { Config, apply, inject, name };
//# sourceMappingURL=index.d.mts.map