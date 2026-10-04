// Navnet under ikonet på Android-hjemmeskærmen (strings.xml -> app_name).
//
// Expo tager det fra `name` i app.config.js, men `name` styrer også iOS-
// projektets mappenavn, så testappen ændrer kun Android-navnet her. På
// iPhone sættes "MadShopper Test" med CFBundleDisplayName.
const { withStringsXml, AndroidConfig } = require('expo/config-plugins');

module.exports = function withAndroidAppName(config, { name }) {
  return withStringsXml(config, (cfg) => {
    cfg.modResults = AndroidConfig.Strings.setStringItem(
      [AndroidConfig.Resources.buildResourceItem({ name: 'app_name', value: name })],
      cfg.modResults,
    );
    return cfg;
  });
};
