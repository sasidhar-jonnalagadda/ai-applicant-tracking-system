import globals from "globals";
import baseConfig from "./base.js";

/**
 * Specialized ESLint configuration for Node.js services.
 */
export default [
  ...baseConfig,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Node-specific rules can be added here
    },
  },
];