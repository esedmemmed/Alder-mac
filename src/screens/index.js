/*
 * Phase 4B screens, as router factories: main.js merges this table into the router's screens.
 *   details  streams  search  settings  addons
 */
import { createDetailsScreen as details } from './details.js';
import { createStreamsScreen as streams } from './streams.js';
import { createSearchScreen as search } from './search.js';
import { createSettingsScreen as settings } from './settings.js';
import { createAddonsScreen as addons } from './addons.js';

export const screensB = { details, streams, search, settings, addons };
