const { SuggestionStore } = require('./suggestionStore')
const { PreferencePatternDetector } = require('./PreferencePatternDetector')

let _storeInstance = null

function getSuggestionStore() {
  if (!_storeInstance) {
    _storeInstance = new SuggestionStore()
  }
  return _storeInstance
}

module.exports = {
  SuggestionStore,
  PreferencePatternDetector,
  getSuggestionStore
}
