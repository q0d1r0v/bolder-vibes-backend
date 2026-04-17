// Force Metro to use a predictable on-disk cache location so the warmup
// transforms we compute during `docker build` are committed to the image
// layer and reused by every runtime container.
const { getDefaultConfig } = require('expo/metro-config');
const { FileStore } = require('metro-cache');

const config = getDefaultConfig(__dirname);
config.cacheStores = [
  new FileStore({ root: '/root/.metro-cache' }),
];

module.exports = config;
