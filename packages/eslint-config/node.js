import globals from "globals";
import { config as baseConfig } from "./base.js";

/**
 * Specialized ESLint configuration for Node.js services.
 */
export const nodeConfig = [
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
