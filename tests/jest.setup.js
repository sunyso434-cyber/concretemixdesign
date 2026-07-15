const fs = require('fs')
const path = require('path')

const testDataRoot = path.resolve(__dirname, '..', '.tmp-test-user-data')
fs.mkdirSync(testDataRoot, { recursive: true })

process.env.USER_DATA_PATH = fs.mkdtempSync(path.join(testDataRoot, 'suite-'))
