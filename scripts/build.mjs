import { build } from 'vite';
import config from '../vite.config.mjs';
// Import configuration directly; Vite's config bundler cannot traverse sandboxed Windows ancestors.
await build({ ...config, configFile: false });
