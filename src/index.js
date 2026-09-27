// suite 主入口：bundle 行全部经 ./shell 挂载，主入口仅承载元信息与观测面。
export { apply, inject, listDegraded } from "./shell.js";
export const name = "@240xu/dsh-suite";
export default { name, inject, apply };
