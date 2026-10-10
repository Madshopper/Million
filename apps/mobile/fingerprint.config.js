// Fingerprint afgør, om en opdatering over nettet passer til det build, der
// ligger på telefonen (runtimeVersion i app.config.js, kun MadShopper Test).
// `extra` er rene JS-værdier (API-adresse, nøgler fra miljøet) og ændrer ikke
// native-delen, så de skal ikke give et nyt fingerprint: ellers ville en lille
// forskel i miljøet mellem Mac'en og GitHub Actions stoppe alle opdateringer.
/** @type {import('expo/fingerprint').Config} */
const { SourceSkips } = require('@expo/fingerprint');

module.exports = {
  sourceSkips: SourceSkips.ExpoConfigExtraSection,
};
