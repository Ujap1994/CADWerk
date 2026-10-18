/**
 * Product identity in one place, so a rename only touches this file,
 * package.json and electron-builder.yml.
 */
export const APP_NAME = 'ParaWerk';
export const APP_ID = 'io.github.ujap1994.parawerk';
export const REPOSITORY_URL = 'https://github.com/Ujap1994/ParaWerk';

/** Custom protocol that serves the renderer in production builds. */
export const APP_SCHEME = 'app';
export const APP_HOST = 'parawerk';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

export const PART_FILE_EXTENSION = 'pwpart';
