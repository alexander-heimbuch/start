const CACHE_VERSION = 1;

const EXTERNAL_FILES = [
  "https://fonts.googleapis.com/css?family=Roboto:400,500,700,900",
  "https://cdnjs.cloudflare.com/ajax/libs/handlebars.js/4.7.7/handlebars.min.js",
  "https://code.iconify.design/1/1.0.7/iconify.min.js",
];

const CACHE_FILES = [
  ...EXTERNAL_FILES,
  "/start/index.html",
  "/start/favicon.svg",
  "/start/assets/css/styles.css",
  "/start/assets/js/data.js",
  "/start/assets/js/script.js",
  "/start/assets/js/search.js",
  "/start/apps.json",
  "/start/links.json",
  "/start/manifest.json",
];

const OFFLINE_PAGE = "/index.html";

const CACHE_VERSIONS = {
  assets: "assets-v" + CACHE_VERSION,
  content: "content-v" + CACHE_VERSION,
  offline: "offline-v" + CACHE_VERSION,
  notFound: "404-v" + CACHE_VERSION,
};

// Define MAX_TTL's in SECONDS for specific file extensions
const MAX_TTL = {
  "/": 3600,
  html: 3600,
  json: 86400,
  js: 86400,
  css: 86400,
};

const CACHE_BLACKLIST = [
  //(str) => {
  //    return !str.startsWith('http://localhost') && !str.startsWith('https://gohugohq.com');
  //},
];

const SUPPORTED_METHODS = ["GET"];

/**
 * isBlackListed
 * @param {string} url
 * @returns {boolean}
 */
function isBlacklisted(url) {
  return CACHE_BLACKLIST.length > 0
    ? !CACHE_BLACKLIST.filter((rule) => {
        if (typeof rule === "function") {
          return !rule(url);
        } else {
          return false;
        }
      }).length
    : false;
}

/**
 * getFileExtension
 * @param {string} url
 * @returns {string}
 */
function getFileExtension(url) {
  let extension = url.split(".").reverse()[0].split("?")[0];
  return extension.endsWith("/") ? "/" : extension;
}

/**
 * getTTL
 * @param {string} url
 */
function getTTL(url) {
  if (typeof url === "string") {
    let extension = getFileExtension(url);
    if (typeof MAX_TTL[extension] === "number") {
      return MAX_TTL[extension];
    } else {
      return null;
    }
  } else {
    return null;
  }
}

/**
 * installServiceWorker
 * @returns {Promise}
 */
function installServiceWorker() {
  return Promise.all([
    caches.open(CACHE_VERSIONS.assets).then((cache) => {
      return cache.addAll(CACHE_FILES);
    }),
    caches.open(CACHE_VERSIONS.offline).then((cache) => {
      return cache.addAll(CACHE_FILES);
    }),
    caches.open(CACHE_VERSIONS.notFound).then((cache) => {
      return cache.addAll(CACHE_FILES);
    }),
  ]).then(() => {
    return self.skipWaiting();
  });
}

/**
 * cleanupLegacyCache
 * @returns {Promise}
 */
function cleanupLegacyCache() {
  let currentCaches = Object.keys(CACHE_VERSIONS).map((key) => {
    return CACHE_VERSIONS[key];
  });

  return new Promise((resolve, reject) => {
    caches
      .keys()
      .then((keys) => {
        return (legacyKeys = keys.filter((key) => {
          return !~currentCaches.indexOf(key);
        }));
      })
      .then((legacy) => {
        if (legacy.length) {
          Promise.all(
            legacy.map((legacyKey) => {
              return caches.delete(legacyKey);
            })
          )
            .then(() => {
              resolve();
            })
            .catch((err) => {
              reject(err);
            });
        } else {
          resolve();
        }
      })
      .catch(() => {
        reject();
      });
  });
}

function precacheUrl(url) {
  if (!isBlacklisted(url)) {
    caches.open(CACHE_VERSIONS.content).then((cache) => {
      cache
        .match(url)
        .then((response) => {
          if (!response) {
            return fetch(url);
          } else {
            // already in cache, nothing to do.
            return null;
          }
        })
        .then((response) => {
          if (response) {
            return cache.put(url, response.clone());
          } else {
            return null;
          }
        });
    });
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(Promise.all([installServiceWorker(), self.skipWaiting()]));
});

// The activate handler takes care of cleaning up old caches.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      cleanupLegacyCache(),
      self.clients.claim(),
      self.skipWaiting(),
    ]).catch((err) => {
      event.skipWaiting();
    })
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.open(CACHE_VERSIONS.content).then((cache) => {
      return cache
        .match(event.request)
        .then((response) => {
          if (response) {
            let headers = response.headers.entries();
            let date = null;

            for (let pair of headers) {
              if (pair[0] === "date") {
                date = new Date(pair[1]);
              }
            }

            if (date) {
              let age = parseInt(
                (new Date().getTime() - date.getTime()) / 1000
              );
              let ttl = getTTL(event.request.url);

              if (ttl && age > ttl) {
                return new Promise((resolve) => {
                  return fetch(event.request.clone())
                    .then((updatedResponse) => {
                      if (updatedResponse) {
                        cache.put(event.request, updatedResponse.clone());
                        resolve(updatedResponse);
                      } else {
                        resolve(response);
                      }
                    })
                    .catch(() => {
                      resolve(response);
                    });
                }).catch((err) => {
                  return response;
                });
              } else {
                return response;
              }
            } else {
              return response;
            }
          } else {
            return null;
          }
        })
        .then((response) => {
          if (response) {
            return response;
          } else {
            return fetch(event.request.clone())
              .then((response) => {
                if (response.status < 400) {
                  if (
                    ~SUPPORTED_METHODS.indexOf(event.request.method) &&
                    !isBlacklisted(event.request.url)
                  ) {
                    cache.put(event.request, response.clone());
                  }
                  return response;
                } else {
                  return caches.open(CACHE_VERSIONS.notFound).then((cache) => {
                    return cache.match(OFFLINE_PAGE);
                  });
                }
              })
              .then((response) => {
                if (response) {
                  return response;
                }
              })
              .catch(() => {
                return caches
                  .open(CACHE_VERSIONS.offline)
                  .then((offlineCache) => {
                    return offlineCache.match(OFFLINE_PAGE);
                  });
              });
          }
        })
        .catch((error) => {
          console.error("  Error in fetch handler:", error);
          throw error;
        });
    })
  );
});

self.addEventListener("message", (event) => {
  if (typeof event.data === "object" && typeof event.data.action === "string") {
    switch (event.data.action) {
      case "cache":
        precacheUrl(event.data.url);
        break;
      default:
        console.log("Unknown action: " + event.data.action);
        break;
    }
  }
});
