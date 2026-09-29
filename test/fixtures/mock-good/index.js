let started = 0;
export const name = "mock-good";
export const inject = [];
export function apply(ctx, config) { started++; return { config }; }
export function startCount() { return started; }
