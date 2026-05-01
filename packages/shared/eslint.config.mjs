import baseConfig from "@repo/eslint-config/base.js";

/** @type {import("eslint").Linter.Config[]} */
export default [
    ...baseConfig,
    {
        ignores: ["dist/**", "node_modules/**"]
    }
];