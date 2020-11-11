const http = require('http')
const request = require('request')
const fetch = require('node-fetch')
const express = require('express')
const app = express()
const unzipper = require('unzipper')
const protobuf = require('protobufjs')
const { response } = require('express')

const urls = {
  'LT': 'https://download.koronastop.lt',
  'DE': 'https://svc90.main.px.t-online.de'
}
 
app.use(express.json())
app.use(express.static('express'))
app.use(express.static('.'))
app.get('/data/:countryCode/:type', async function(req, res) {
    protobuf.load("gaen.proto", async function (err, root) {
      const cc = req.params.countryCode
      const type = req.params.type
      const url = urls[cc]
      try {
        const TemporaryExposureKeyExport = root.lookupType("TemporaryExposureKeyExport")
        const datesResp = await fetch(`${url}/version/v1/diagnosis-keys/country/${cc}/date`)
        if (!datesResp.ok) {
          throw new Error(datesResp.statusText)
        }
        const dates = await datesResp.json()
        const dailyFiles = dates.map(date => `${url}/version/v1/diagnosis-keys/country/${cc}/date/${date}`)

        const hourlyFiles = [].concat.apply([], await Promise.all(
          dailyFiles
            .map(dailyFile =>
              fetch(`${dailyFile}/hour`)
                .then(response => response.json())
                .then(hours => hours.map(hour => `${dailyFile}/hour/${hour}`))
            )
        ))
        const files = type == "hourly" ? hourlyFiles : dailyFiles

        let requests = []
        let counters = []
        while (files.length) {
          requests.push(files.shift())
          if (requests.length == 15 || files.length == 0) { // Max 15 requests at a time
            let partialCounters = await Promise.all(
              requests.map(file => extractKeyCount(file, 'export.bin', TemporaryExposureKeyExport))
            )
            counters.push(...partialCounters)
            requests = []
          }
        }

        res.send(counters)
      } catch (e) {
        console.log(e)
        res.statusMessage = e
        res.status(500).end()
      }

    })
  }
)

const server = http.createServer(app)
const port = process.env.PORT || 3000
server.listen(port)
console.debug('Server listening on port ' + port)

async function extractKeyCount(url, fileName, TemporaryExposureKeyExport) {
  const directory = await unzipper.Open.url(request, url)
  const file = directory.files.find(d => d.path === fileName)
  const content = await file.buffer()
  const keys = content.slice(16)
  const temporaryExposureKeyExport = TemporaryExposureKeyExport.decode(keys)
  return { "date": extractDate(url), "count": temporaryExposureKeyExport["keys"].length + temporaryExposureKeyExport["revisedKeys"].length }
}

function extractDate(keyValue) {
  var elems = keyValue.split("/")
  if (keyValue.includes("hour")) {
    var hour = `0${elems[elems.length - 1]}:00:00`.slice(-8)
    var date = elems[elems.length - 3]
    return `${date}T${hour}`
  } else {
    return elems[elems.length - 1]
  }
}
